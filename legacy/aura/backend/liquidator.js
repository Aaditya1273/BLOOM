require('dotenv').config({ override: true });
const { ethers } = require("ethers");
const { Client } = require("pg");
const { computeHealth } = require("./healthFactor");

const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const provider = new ethers.JsonRpcProvider(process.env.ROBINHOOD_RPC || RPC_URL); provider.pollingInterval = 60000;
const PRIVATE_KEY = process.env.LIQUIDATOR_PRIVATE_KEY || process.env.PRIVATE_KEY; // The keeper's wallet
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const PERPS_ADDRESS = process.env.AURA_PERPS_ADDRESS || "0x8AECF449B27BB41E34C04D8C99F4348FF38bB9a2";
const PERPS_ABI = [
    "function positions(uint256) view returns (address owner, string asset, bool isLong, uint256 collateralAmount, uint256 leverage, uint256 entryPrice, uint256 positionSize, bool isOpen, uint256 openedAt, uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice, uint256 takeProfitPrice, uint256 stopLossPrice)",
    "function liquidatePosition(uint256 positionId) external"
];
const perps = new ethers.Contract(PERPS_ADDRESS, PERPS_ABI, wallet);

const ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS || "0x097AeB196366317cf97986A04f32Df312c96ABa1";
const ORACLE_ABI = [
    "function setPrice(string asset, uint256 price) external",
    "function getPrice(string asset) view returns (uint256)"
];
const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, wallet);

const PYTH_IDS = {
    BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    AMZN: "62731dfcc8b8542e52753f208248c3e73fab2ec15422d6f65c2decda71ccea0d",
    NFLX: "8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2",
    AMD: "6969003ef4c5fbb3b57a6be3883102362d05572c2dc7f72b767ad48f4206204b",
    PLTR: "11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0"
};

async function fetchPythPrices() {
    const ids = Object.values(PYTH_IDS);
    const url = `https://hermes.pyth.network/v2/updates/price/latest?` + ids.map(id => `ids[]=${id}`).join("&");
    try {
        const res = await fetch(url);
        const data = await res.json();
        const prices = {};
        for (const entry of data.parsed || []) {
            const px = Number(entry.price.price) * Math.pow(10, entry.price.expo);
            for (const [sym, pythId] of Object.entries(PYTH_IDS)) {
                if (entry.id.toLowerCase() === pythId.toLowerCase()) {
                    prices[sym] = ethers.parseUnits(px.toFixed(2), 18);
                }
            }
        }
        return prices;
    } catch (e) {
        console.error("[Liquidator] Pyth fetch error:", e.message);
        return {};
    }
}

async function runLiquidator() {
    console.log("==================================================");
    console.log("  DEMARRAGE DU KEEPER DE LIQUIDATION (AURA)       ");
    console.log("==================================================");

    const db = new Client({
        connectionString: process.env.GCP_DB_URL || process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    db.on('error', (err) => {
        console.error('[Liquidator] Database connection error (ECONNRESET etc):', err.message);
        // The process might need to be restarted if the connection is dead, but we prevent uncaught exception
    });

    try {
        await db.connect();
    } catch (err) {
        console.error("[Liquidator] Database connection failed", err.message);
        return;
    }

    async function runCycle() {
        try {
            const prices = await fetchPythPrices();
            if (Object.keys(prices).length > 0) {
                
                // --- HEARTBEAT ORACLE UPDATE FOR UI / MANUAL TRADERS ---
                // We update the Mock Oracle for all assets so the UI gets fresh prices
                // when users manually click Long/Short.
                for (const [asset, priceWei] of Object.entries(prices)) {
                    try {
                        const tx = await oracle.setPrice(asset, priceWei);
                        await tx.wait();
                    } catch (e) {
                        // Ignore rate limits silently
                    }
                }
                // -------------------------------------------------------

                // Fetch all open positions across the entire protocol with details
                // We use a CTE with ROW_NUMBER and block_timestamp to handle overlapping position_ids (e.g. from testnet resets)
                const openRes = await db.query(`
WITH RankedOpened AS (
    SELECT position_id, asset, is_long, collateral, leverage, entry_price, CAST(block_timestamp AS BIGINT) as ts,
           ROW_NUMBER() OVER(PARTITION BY position_id ORDER BY CAST(block_timestamp AS BIGINT) DESC) as rn
    FROM positions_opened
),
RankedClosed AS (
    SELECT position_id, CAST(block_timestamp AS BIGINT) as ts,
           ROW_NUMBER() OVER(PARTITION BY position_id ORDER BY CAST(block_timestamp AS BIGINT) DESC) as rn
    FROM positions_closed
),
RankedLiquidated AS (
    SELECT position_id, CAST(block_timestamp AS BIGINT) as ts,
           ROW_NUMBER() OVER(PARTITION BY position_id ORDER BY CAST(block_timestamp AS BIGINT) DESC) as rn
    FROM positions_liquidated
)
SELECT o.position_id, o.asset, o.is_long, o.collateral, o.leverage, o.entry_price
FROM RankedOpened o
LEFT JOIN RankedClosed c ON o.position_id = c.position_id AND c.rn = 1
LEFT JOIN RankedLiquidated l ON o.position_id = l.position_id AND l.rn = 1
WHERE o.rn = 1
  AND (c.ts IS NULL OR o.ts > c.ts)
  AND (l.ts IS NULL OR o.ts > l.ts)
                `);

                if (openRes.rows.length > 0) {
                    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

                    for (const row of openRes.rows) {
                        const posId = row.position_id;
                        
                        const priceWei = prices[row.asset];
                        if (!priceWei) continue;

                        // --- PRE-FILTER (RPC OPTIMIZATION) ---
                        // To save Alchemy Compute Units (CU), we only query the blockchain
                        // if the position is approximately within 2% of bankruptcy.
                        const entryNum = Number(row.entry_price) / 1e18;
                        const pythNum = Number(ethers.formatUnits(priceWei, 18));
                        const levNum = Number(row.leverage);
                        const liqPriceApprox = row.is_long ? entryNum * (1 - 1 / levNum) : entryNum * (1 + 1 / levNum);
                        
                        // Buffer of 2% to ensure we don't miss borderline liquidations due to funding fees
                        const isBankruptApprox = row.is_long ? (pythNum <= liqPriceApprox * 1.02) : (pythNum >= liqPriceApprox * 0.98);

                        if (!isBankruptApprox) {
                            continue; // Position is safe, skip expensive eth_call
                        }
                        // -------------------------------------

                        try {
                            const pos = await perps.positions(posId);
                            if (!pos.isOpen) continue;

                            const { healthBps } = computeHealth({
                                isLong: pos.isLong,
                                collateralAmount: pos.collateralAmount,
                                entryPrice: pos.entryPrice,
                                positionSize: pos.positionSize,
                                openedAt: pos.openedAt
                            }, priceWei, nowSeconds);

                            if (healthBps === 0) {
                                const entryNum = Number(ethers.formatUnits(pos.entryPrice, 18));
                                const levNum = Number(pos.leverage);
                                let liqNum = 0;
                                if (pos.isLong) {
                                    liqNum = entryNum * (1 - 1 / levNum);
                                } else {
                                    liqNum = entryNum * (1 + 1 / levNum);
                                }

                                const entryFormatted = entryNum.toFixed(2);
                                const liqFormatted = liqNum.toFixed(2);
                                const pythFormatted = Number(ethers.formatUnits(priceWei, 18)).toFixed(2);
                                const collateralFormatted = Number(ethers.formatUnits(pos.collateralAmount, 18)).toFixed(2);
                                const type = pos.isLong ? "LONG" : "SHORT";
                                const lev = pos.leverage.toString();

                                console.log(`\n=========================================================`);
                                console.log(`[Liquidator] ⚠️ BANKRUPT DETECTED: Position #${posId}`);
                                console.log(`[Liquidator] Asset: ${pos.asset} | Type: ${type} ${lev}x`);
                                console.log(`[Liquidator] Collateral: $${collateralFormatted}`);
                                console.log(`[Liquidator] Entry Price: $${entryFormatted}`);
                                console.log(`[Liquidator] Liq. Price : ~$${liqFormatted}`);
                                console.log(`[Liquidator] Pyth Price :  $${pythFormatted}`);
                                console.log(`[Liquidator] Updating Oracle & Sending Transaction...`);
                                console.log(`=========================================================\n`);

                                try {
                                    // Update oracle with live Pyth price so the Smart Contract knows it's bankrupt
                                    const txOracle = await oracle.setPrice(pos.asset, priceWei);
                                    await txOracle.wait();
                                    
                                    const tx = await perps.liquidatePosition(posId);
                                    await tx.wait();
                                    console.log(`[Liquidator] ✅ Successfully liquidated #${posId}. Tx: ${tx.hash}`);
                                } catch (txErr) {
                                    // If reverted, maybe already liquidated or in grace period
                                    if (!txErr.message.includes("Position not open")) {
                                        console.error(`[Liquidator] ❌ Failed to liquidate #${posId}:`, txErr.shortMessage || txErr.message);
                                    }
                                }
                            }
                        } catch (err) {
                            if (err.code === "CALL_EXCEPTION" || (err.message && err.message.includes("429"))) {
                                // Rate limit ou RPC surcharge, on ignore silencieusement
                            } else {
                                console.error(`[Liquidator] Failed to check #${posId}:`, err.shortMessage || err.message);
                            }
                        }
                        
                        // Sleep pour eviter le rate limit RPC d'Alchemy
                        await new Promise(r => setTimeout(r, 300));
                    }
                }
            }
        } catch (err) {
            console.error("[Liquidator] Scan cycle error:", err.message);
        }

        // Relance le prochain cycle 5 secondes APRES la fin de celui-ci pour des prix ultra-rapides
        setTimeout(runCycle, 5000);
    }

    // Demarrage du premier cycle
    runCycle();
}

runLiquidator();
