const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:AuraProtocol2026@34.163.254.250:5432/postgres', ssl: { rejectUnauthorized: false } });
pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'positions_closed';
`).then(res => {
  console.log('Columns in positions_closed:', res.rows);
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
