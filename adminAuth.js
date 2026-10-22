const db = require('./db');

exports.verifyAdmin = async (req, res, next) => {
  try {
    const userId = req.user.id; // From standard JWT auth middleware
    const result = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
    }

    next();
  } catch (err) {
    console.error('Admin Auth Error:', err);
    return res.status(500).json({ error: 'Internal server error checking admin privileges' });
  }
};