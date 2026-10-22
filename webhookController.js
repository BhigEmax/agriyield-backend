const crypto = require('crypto');
const db = require('./db');

exports.handleFlutterwaveWebhook = async (req, res) => {
  // 1. Verify Flutterwave Secret Hash Signature
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== process.env.FLW_SECRET_HASH) {
    return res.status(401).send('Unauthorized webhook signature');
  }

  const eventData = req.body;

  // Acknowledge receipt immediately with 200 OK (Flutterwave requirement within 60s)
  res.sendStatus(200);

  // 2. Process only successful charge events
  if (eventData && eventData.event === 'charge.completed' && eventData.data.status === 'successful') {
    const paymentData = eventData.data;
    const txRef = paymentData.tx_ref;
    const amountPaid = paymentData.amount;
    const customerEmail = paymentData.customer.email;
    const customerPhone = paymentData.customer.phone_number;

    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // Check if this transaction reference was already processed (Idempotency check)
      const existingTx = await client.query('SELECT id, status FROM transactions WHERE payment_reference = $1', [txRef]);
      
      if (existingTx.rows.length > 0) {
        if (existingTx.rows[0].status === 'COMPLETED') {
          await client.query('ROLLBACK');
          return; // Already processed
        }
      }

      // Find user by email or phone
      const userRes = await client.query(
        'SELECT id FROM users WHERE email = $1 OR phone_number = $2',
        [customerEmail, customerPhone]
      );

      if (userRes.rows.length === 0) {
        await client.query('ROLLBACK');
        console.error(`[WEBHOOK ERROR] User not found for payment reference: ${txRef}`);
        return;
      }

      const userId = userRes.rows[0].id;

      // 3. Credit User Wallet
      await client.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [amountPaid, userId]);

      // 4. Record or Update Transaction Ledger
      if (existingTx.rows.length > 0) {
        await client.query('UPDATE transactions SET status = $1 WHERE payment_reference = $2', ['COMPLETED', txRef]);
      } else {
        await client.query(
          `INSERT INTO transactions (user_id, type, amount, status, payment_reference)
           VALUES ($1, 'DEPOSIT', $2, 'COMPLETED', $3)`,
          [userId, amountPaid, txRef]
        );
      }

      await client.query('COMMIT');
      console.log(`[WEBHOOK SUCCESS] Credited ₦${amountPaid} to user ID ${userId} via Flutterwave.`);

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[WEBHOOK DB ERROR] Failed to process payment:', err);
    } finally {
      client.release();
    }
  }
};