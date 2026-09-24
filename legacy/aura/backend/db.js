const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for most cloud DBs
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
