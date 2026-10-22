const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // e.g. postgresql://user:pass@localhost:5432/agriyield
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
};