require("dotenv").config({ path: "./backend/.env" });
const { Client } = require("pg");

async function main() {
    const db = new Client({
        connectionString: "postgres://postgres:AuraProtocol2026@34.163.254.250:5432/postgres",
        ssl: { rejectUnauthorized: false }
    });
    
    await db.connect();
    
    const res = await db.query("SELECT * FROM positions_opened WHERE position_id = '34'");
    console.log("Position 34 in DB:", res.rows[0]);
    
    process.exit(0);
}

main().catch(console.error);
