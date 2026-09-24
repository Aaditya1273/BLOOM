require("dotenv").config(); 
const { Client } = require("pg"); 
const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
}); 
client.connect().then(() => client.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('positions_opened', 'positions_closed')")).then(res => { 
    console.log(res.rows); 
    client.end(); 
}).catch(console.error);
