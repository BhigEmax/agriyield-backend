const db = require('./db');

exports.purchaseLease = async (req, res) => {
  const userId = req.user.id; // Extracted from JWT auth middleware
  const { tier_id } = req.body;

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1. Fetch User & Equipment Tier details with ROW LOCK
    const userRes = await client.query('SELECT wallet_balance, referrer_id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const tierRes = await client.query('SELECT * FROM equipment_tiers WHERE id = $1 AND is_available = TRUE', [tier_id]);

    if (tierRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Equipment tier not found or unavailable.' });
    }

    const user = userRes.rows[0];
    const tier = tierRes.rows[0];

    // 2. Check sufficient balance
    if (parseFloat(user.wallet_balance) < parseFloat(tier.price)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient wallet balance. Please top up first.' });
    }

    // 3. Deduct User Balance
    await client.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [tier.price, userId]);

    // 4. Create Active Lease
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + tier.duration_days);

    await client.query(
      `INSERT INTO user_leases (user_id, tier_id, amount_paid, daily_yield, end_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, tier.id, tier.price, tier.daily_yield, endDate]
    );

    // 5. Calculate and award 1-Level Referral Bonus (10% Direct Commission)
    if (user.referrer_id) {
      const commissionAmount = parseFloat(tier.price) * 0.10; // 10% bonus

      // Credit Referrer
      await client.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [commissionAmount, user.referrer_id]);

      // Record Referral Transaction Log
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, status)
         VALUES ($1, 'REFERRAL_COMMISSION', $2, 'APPROVED')`,
        [user.referrer_id, commissionAmount]
      );
    }

    await client.query('COMMIT');
    return res.status(200).json({ message: 'Machinery leased successfully! Daily earnings activated.' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Lease Error:', err);
    return res.status(500).json({ error: 'Failed to complete lease transaction' });
  } finally {
    client.release();
  }
};