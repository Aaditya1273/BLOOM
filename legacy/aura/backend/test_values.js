const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:AuraProtocol2026@34.163.254.250:5432/postgres', ssl: { rejectUnauthorized: false } });
pool.query(`
    SELECT block_timestamp, pnl, is_profit 
    FROM positions_closed 
    WHERE owner ILIKE '0xb4DD0565207Ca66432C0BaD06b69Bb97514E033d'
    LIMIT 5;
`).then(res => {
  console.log('Values:', res.rows);
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
