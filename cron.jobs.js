const cron = require('node-cron');
const db = require('./db');

// Run automatically every night at midnight (00:00)
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Running daily machinery yield distribution...');
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Fetch active leases that have not expired
    const activeLeases = await client.query(
      `SELECT id, user_id, daily_yield 
       FROM user_leases 
       WHERE status = 'ACTIVE' AND end_date > CURRENT_TIMESTAMP`
    );

    for (let lease of activeLeases.rows) {
      // 1. Credit user wallet
      await client.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [lease.daily_yield, lease.user_id]);

      // 2. Update lease total earnings log
      await client.query('UPDATE user_leases SET total_earned = total_earned + $1, last_yield_time = CURRENT_TIMESTAMP WHERE id = $2', [lease.daily_yield, lease.id]);

      // 3. Record transaction ledger
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, status) VALUES ($1, 'DAILY_YIELD', $2, 'APPROVED')`,
        [lease.user_id, lease.daily_yield]
      );
    }

    // Mark completed expired leases
    await client.query(`UPDATE user_leases SET status = 'COMPLETED' WHERE end_date <= CURRENT_TIMESTAMP`);

    await client.query('COMMIT');
    console.log(`[CRON] Successfully processed yield for ${activeLeases.rows.length} active leases.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRON ERROR] Yield payout failed:', err);
  } finally {
    client.release();
  }
});