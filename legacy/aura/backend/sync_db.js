require("dotenv").config({ path: "./.env" });
const { ethers } = require("ethers");
const { Client } = require("pg");

const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 15000;

const PERPS_ADDRESS = "0xc12A0864095b2F4Dc0D1aF0169B760c53D59Cb42";
const PERPS_ABI = [
    "function positions(uint256) view returns (address owner, string asset, bool isLong, uint256 collateralAmount, uint256 leverage, uint256 entryPrice, uint256 positionSize, bool isOpen, uint256 openedAt, uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice, uint256 takeProfitPrice, uint256 stopLossPrice)",
    "function nextPositionId() view returns (uint256)"
];
const perps = new ethers.Contract(PERPS_ADDRESS, PERPS_ABI, provider);

async function syncLoop() {
    console.log("==================================================");
    console.log("  DÉMARRAGE DE LA SYNCHRONISATION DB (AURA)       ");
    console.log("==================================================");
    
    const db = new Client({
        connectionString: process.env.GCP_DB_URL || process.env.DATABASE_URL || "postgres://postgres:AuraProtocol2026@34.163.254.250:5432/postgres",
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await db.connect();
        
        const nextId = await perps.nextPositionId();
        let syncedCount = 0;
        
        for (let i = 1; i < Number(nextId); i++) {
            try {
                const pos = await perps.positions(i);
                
                if (pos.isOpen) {
                    await db.query("DELETE FROM positions_opened WHERE position_id = $1", [i.toString()]);
                    
                    const mockId = `sync_${Date.now()}_${i}`;
                    const query = `
                        INSERT INTO positions_opened 
                        (id, block_number, transaction_hash, log_index, block_timestamp, position_id, owner, asset, is_long, collateral, leverage, entry_price, opened_at)
                        VALUES ($1, 0, '0x0', 0, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    `;
                    const values = [
                        mockId, 
                        pos.openedAt.toString(), 
                        i.toString(), 
                        pos.owner.toLowerCase(), 
                        pos.asset, 
                        pos.isLong, 
                        Number(ethers.formatUnits(pos.collateralAmount, 18)), 
                        Number(pos.leverage), 
                        Number(pos.entryPrice),
                        pos.openedAt.toString()
                    ];
                    
                    await db.query(query, values);
                    syncedCount++;
                } else {
                    const res = await db.query("SELECT id FROM positions_closed WHERE position_id = $1", [i.toString()]);
                    if (res.rows.length === 0) {
                        const mockId = `closed_sync_${Date.now()}_${i}`;
                        await db.query(`
                            INSERT INTO positions_closed 
                            (id, block_number, transaction_hash, log_index, block_timestamp, position_id, owner, pnl, is_profit, exit_price, funding_fee)
                            VALUES ($1, 0, '0x0', 0, 0, $2, $3, 0, false, 0, 0)
                        `, [mockId, i.toString(), pos.owner.toLowerCase()]);
                    }
                }
            } catch (err) {
                console.error(`[Sync] Error syncing position ${i}:`, err.message);
            }
        }
        
        console.log(`✅ Synchronisation terminée : ${syncedCount} positions ouvertes corrigées.`);
    } catch (err) {
        console.error("❌ Erreur critique dans la boucle de sync:", err);
    } finally {
        await db.end();
        console.log("Attente de 15 secondes avant le prochain scan...");
        setTimeout(syncLoop, 15000); // Utiliser setTimeout au lieu de setInterval pour éviter l'engorgement
    }
}

// Lancer la première itération
syncLoop();
