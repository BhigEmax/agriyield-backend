const db = require('./db');

// 1. Get all pending transactions (deposits or withdrawals)
exports.getPendingTransactions = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.*, u.full_name, u.phone_number 
       FROM transactions t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.status = 'PENDING' 
       ORDER BY t.created_at ASC`
    );
    return res.status(200).json({ pending_transactions: result.rows });
  } catch (err) {
    console.error('Fetch Pending Error:', err);
    return res.status(500).json({ error: 'Failed to fetch pending transactions' });
  }
};

// 2. Approve or Reject a Deposit / Withdrawal
exports.resolveTransaction = async (req, res) => {
  const { transaction_id, action } = req.body; // action: 'APPROVED' or 'REJECTED'

  if (!['APPROVED', 'REJECTED'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action parameter. Use APPROVED or REJECTED.' });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Fetch transaction with row lock
    const txRes = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [transaction_id]);
    if (txRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    const tx = txRes.rows[0];

    if (tx.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Transaction has already been processed.' });
    }

    if (action === 'APPROVED') {
      if (tx.type === 'DEPOSIT') {
        // Credit user wallet
        await client.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [tx.amount, tx.user_id]);
      } else if (tx.type === 'WITHDRAWAL') {
        // For withdrawals, approving means admin has sent funds from bank. Deduct user balance or ensure it was escrowed.
        const userRes = await client.query('SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE', [tx.user_id]);
        if (parseFloat(userRes.rows[0].wallet_balance) < parseFloat(tx.amount)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'User balance is insufficient to cover this approved withdrawal.' });
        }
        await client.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [tx.amount, tx.user_id]);
      }
    }

    // Update transaction status
    await client.query('UPDATE transactions SET status = $1 WHERE id = $2', [action, transaction_id]);

    await client.query('COMMIT');
    return res.status(200).json({ message: `Transaction successfully ${action.toLowerCase()}.` });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Resolve Transaction Error:', err);
    return res.status(500).json({ error: 'Failed to process transaction review' });
  } finally {
    client.release();
  }
};