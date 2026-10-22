const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Generate unique 8-char referral code
function generateReferralCode() {
  return 'AGRI' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

exports.register = async (req, res) => {
  const { full_name, email, phone_number, password, invite_code } = req.body;

  if (!full_name || !phone_number || !password) {
    return res.status(400).json({ error: 'Full name, phone, and password are required.' });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1. Check if user already exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE phone_number = $1 OR (email IS NOT NULL AND email = $2)',
      [phone_number, email || null]
    );

    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'User with this phone number or email already exists.' });
    }

    // 2. Validate referrer code if provided
    let referrerId = null;
    if (invite_code) {
      const parentRes = await client.query('SELECT id FROM users WHERE referral_code = $1', [invite_code.trim().toUpperCase()]);
      if (parentRes.rows.length > 0) {
        referrerId = parentRes.rows[0].id;
      }
    }

    // 3. Hash password and generate referral code
    const hashedPassword = await bcrypt.hash(password, 10);
    const newRefCode = generateReferralCode();

    // 4. Insert user
    const insertRes = await client.query(
      `INSERT INTO users (full_name, email, phone_number, password_hash, referral_code, referrer_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, phone_number, referral_code`,
      [full_name, email || null, phone_number, hashedPassword, newRefCode, referrerId]
    );

    await client.query('COMMIT');

    const newUser = insertRes.rows[0];
    const token = jwt.sign({ id: newUser.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: newUser
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Registration Error:', err);
    return res.status(500).json({ error: 'Server error during registration' });
  } finally {
    client.release();
  }
};