/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║         AURA LOB KEEPER — Direct Stylus LOB matcher              ║
 * ║   Polls Pyth, calls match_orders(asset_hash, price) directly     ║
 * ║   on the Stylus WASM order book (Arbitrum Sepolia).              ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * Architecture (post Wave-4 recadrage):
 *   - The Stylus LOB lives on Arbitrum Sepolia (chain 421614). It was
 *     initialized with the deployer EOA as router AND keeper, so this
 *     script using the same PRIVATE_KEY can call match_orders() directly.
 *   - Pyth Hermes provides off-chain prices; we feed the latest mid into
 *     `match_orders(asset_hash, current_price)` and the WASM contract flips
 *     every ACTIVE order whose limit triggers (long: price <= limit;
 *     short: price >= limit) into FILLED state.
 *   - No oracle.setPrice() needed — the Stylus contract takes the price
 *     as a per-call parameter, off-chain freshness is enforced by the keeper.
 *
 * Run:
 *   node lobKeeper.js
 *
 * Env (read from backend/.env):
 *   - PRIVATE_KEY               (must match the Stylus LOB keeper EOA)
 *   - STYLUS_LOB_ADDRESS        (default: deployed v2 address)
 *   - ARB_SEPOLIA_RPC           (optional override)
 *   - KEEPER_INTERVAL_MS        (default 10000)
 *   - KEEPER_ASSETS             (default "BTC,ETH")
 *   - KEEPER_MIN_ACTIVE         (default 1, skip match_orders if total active < this)
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env"), override: true });
require("./patch_provider.js");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// ── Settlement Events Log (shared with index.js for SSE) ──
const SETTLEMENT_LOG = path.join(__dirname, "settlement-events.json");

function logSettlementEvent(event) {
    let events = [];
    try {
        if (fs.existsSync(SETTLEMENT_LOG)) {
            events = JSON.parse(fs.readFileSync(SETTLEMENT_LOG, "utf8"));
        }
    } catch {}
    events.push({ ...event, timestamp: Date.now() });
    if (events.length > 50) events = events.slice(-50);
    fs.writeFileSync(SETTLEMENT_LOG, JSON.stringify(events));
}

// ── Config ──
const PRIVATE_KEY        = (process.env.PRIVATE_KEY || "").trim();
const KEEPER_PRIVATE_KEY = (process.env.KEEPER_PRIVATE_KEY || "").trim();
const STYLUS_LOB_ADDRESS = (process.env.STYLUS_LOB_ADDRESS || "").trim();
const ARB_SEPOLIA_RPC    = (process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc").trim();
const ROBINHOOD_RPC      = (process.env.RPC_URL || "https://rpc.testnet.chain.robinhood.com").trim();
const INTERVAL_MS        = parseInt(process.env.KEEPER_INTERVAL_MS || "10000");
const ASSETS             = (process.env.KEEPER_ASSETS || "BTC,ETH").split(",").map(s => s.trim().toUpperCase());
const MIN_ACTIVE         = parseInt(process.env.KEEPER_MIN_ACTIVE || "1");

// Cross-chain settlement config
const AURA_PERPS_ADDRESS = (process.env.AURA_PERPS_ADDRESS || "").trim();
const AUSD_ADDRESS       = (process.env.AUSD_ADDRESS || "").trim();
const ENABLE_SETTLEMENT  = process.env.KEEPER_ENABLE_SETTLEMENT !== "0"; // default ON

// ── Stylus LOB ABI (snake_case selectors) ──
const STYLUS_LOB_ABI = [
    "function match_orders(uint256 asset_hash, uint256 current_price) returns (uint256)",
    "function get_book_depth(uint256 asset_hash) view returns (uint256, uint256)",
    "function get_stats() view returns (uint256, uint256, uint256)",
    "function get_filled_orders(uint256 asset_hash) view returns (uint256[])",
    "function get_order(uint256 order_id) view returns (address, uint256, bool, uint256, uint256, uint256, uint256, uint256)",
    "function mark_executed(uint256 order_id) returns (bool)",
];

// ── AuraPerps ABI (Robinhood Chain) ──
const PERPS_ABI = [
    "function openPosition(string asset, bool isLong, uint256 collateralAmount, uint256 leverage) returns (uint256)",
    "function openPositionFor(address user, string asset, bool isLong, uint256 collateralAmount, uint256 leverage) returns (uint256)"
];
const AUSD_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
];
const ORACLE_ABI = [
    "function setPrice(string asset, uint256 price) external",
];

// ── Pyth Hermes price IDs (testnet-reliable) ──
const PYTH_IDS = {
    BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
};

const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || "").trim();
const ESCROW_ABI = ["function execute_and_bridge(uint256 order_id) external"];

let sepoliaProvider, robinhoodProvider, sepoliaWallet, robinhoodWallet, keeperWalletSepolia, keeperWalletRobinhood, lob, perps, ausd, oracle, escrow;

// Asset symbol → hash (same convention as everywhere else)
function assetHash(symbol) {
    return BigInt(ethers.keccak256(ethers.toUtf8Bytes(symbol.toUpperCase())));
}

// Reverse lookup: hash → symbol (for settlement)
const HASH_TO_SYMBOL = {};
function initHashMap() {
    for (const sym of ASSETS) {
        HASH_TO_SYMBOL[assetHash(sym).toString()] = sym;
    }
}

async function fetchPythMids() {
    try {
        const ids = ASSETS.map(a => PYTH_IDS[a]).filter(Boolean);
        if (ids.length === 0) return {};
        const url = `https://hermes.pyth.network/v2/updates/price/latest?` + ids.map(id => `ids[]=${id}`).join("&");
        
        // Fetch with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        const out = {};
        for (const entry of data.parsed || []) {
            const px = Number(entry.price.price) * Math.pow(10, entry.price.expo);
            for (const [sym, pythId] of Object.entries(PYTH_IDS)) {
                if (entry.id.toLowerCase() === pythId.toLowerCase()) {
                    out[sym] = px;
                }
            }
        }
        return out;
    } catch (e) {
        console.error("[Keeper] Pyth fetch error:", e.message);
        return {};
    }
}

const failedSettlements = new Set();

/// Cross-chain settlement: for each filled order on Stylus LOB,
/// open the corresponding position on AuraPerps (Robinhood Chain).
async function settleFilledOrders(symbol, midPrice) {
    if (!ENABLE_SETTLEMENT || !perps) return;

    const hash = assetHash(symbol);
    let filledIds;
    try {
        filledIds = await lob.get_filled_orders(hash);
    } catch (e) {
        return; // no fills or call failed
    }
    
    // Filter out orders we already know will fail
    const toProcess = filledIds.filter(id => !failedSettlements.has(id.toString()));
    if (toProcess.length === 0) return;

    console.log(`[Keeper]  ${toProcess.length} filled order(s) for ${symbol} — settling on Robinhood Chain...`);

    // Update oracle on Robinhood Chain with fresh Pyth price before opening positions
    try {
        const priceWei = ethers.parseUnits(midPrice.toFixed(2), 18);
        await (await oracle.setPrice(symbol, priceWei)).wait();
    } catch (e) {
        console.warn(`[Keeper] Oracle update failed for ${symbol}:`, e.shortMessage || e.message);
    }

    for (const orderId of toProcess) {
        try {
            // Read order details from Stylus LOB
            const order = await lob.get_order(orderId);
            const [owner, , isLong, collateral, leverage, limitPrice, ,] = order;

            // Open position on Robinhood Chain (keeper advances the aUSD)
            const collatNum = collateral;
            
            // Execute escrow to collect aUSD collateral on Arbitrum Sepolia
            if (escrow) {
                try {
                    const escrowTx = await escrow.execute_and_bridge(orderId);
                    await escrowTx.wait();
                    console.log(`[Keeper]  Escrow settled on Arbitrum Sepolia for order #${orderId}`);
                } catch (e) {
                    console.warn(`[Keeper] Escrow settlement failed (maybe already settled?):`, e.shortMessage || e.message);
                }
            }

            // Ensure approval
            const allowance = await ausd.allowance(keeperWalletRobinhood.address, AURA_PERPS_ADDRESS);
            if (allowance < collatNum) {
                const MAX = ethers.MaxUint256;
                await (await ausd.approve(AURA_PERPS_ADDRESS, MAX)).wait();
                console.log(`[Keeper]  aUSD approved for AuraPerps (unlimited)`);
            }

            // Open position FOR THE ACTUAL USER (requires Keeper to be authorized as Router on AuraPerps)
            // If the keeper is not authorized, this will revert.
            const tx = await perps.openPositionFor(owner, symbol, isLong, collatNum, leverage);
            const receipt = await tx.wait();
            console.log(
                `[Keeper]  Position opened on Robinhood Chain for owner ${owner} | order #${orderId} | ${isLong ? "LONG" : "SHORT"} ${symbol} ${leverage}x | tx ${receipt.hash}`
            );

            logSettlementEvent({
                orderId: Number(orderId),
                asset: symbol,
                isLong,
                leverage: Number(leverage),
                collateral: Number(ethers.formatUnits(collatNum, 18)),
                txHash: receipt.hash,
                sourceChain: "Arbitrum Sepolia",
                destChain: "Robinhood Chain",
            });

            // Mark as executed on Stylus LOB (Fallback)
            if (!escrow) {
                await (await lob.mark_executed(orderId)).wait();
                console.log(`[Keeper]  Order #${orderId} marked EXECUTED on Stylus LOB`);
            }
        } catch (e) {
            console.error(`[Keeper] Settlement failed for order #${orderId}:`, e.shortMessage || e.message);
            failedSettlements.add(orderId.toString());
        }
    }
}

async function tickAsset(symbol, midPrice) {
    const hash = assetHash(symbol);
    const [bids, asks] = await lob.get_book_depth(hash);
    const totalActive = Number(bids) + Number(asks);

    if (totalActive < MIN_ACTIVE) return;

    const priceWei = ethers.parseUnits(midPrice.toFixed(2), 18);
    try {
        // Prevent burning gas by simulating first using an explicit eth_call to guarantee msg.sender
        const txData = lob.interface.encodeFunctionData("match_orders", [hash, priceWei]);
        const resultData = await sepoliaProvider.call({
            from: keeperWalletSepolia.address,
            to: STYLUS_LOB_ADDRESS,
            data: txData
        });
        const matchedOrders = lob.interface.decodeFunctionResult("match_orders", resultData)[0];
        
        console.log(`[Keeper] Evaluated ${symbol} at $${midPrice.toFixed(2)} - Should match: ${matchedOrders}`);
        
        if (matchedOrders > 0n) {
            const tx = await lob.match_orders(hash, priceWei);
            const receipt = await tx.wait();
            console.log(
                `[Keeper]  match_orders(${symbol}, $${midPrice.toFixed(2)}) | matched: ${matchedOrders} | tx ${receipt.hash} | gas ${receipt.gasUsed}`
            );
        }
        
        // Cross-chain settlement: open positions on Robinhood for ANY filled orders (new or pending retry)
        await settleFilledOrders(symbol, midPrice);
    } catch (e) {
        console.error(`[Keeper] match_orders(${symbol}) failed:`, e.shortMessage || e.message);
    }
}

async function cycle() {
    const mids = await fetchPythMids();
    if (Object.keys(mids).length === 0) {
        console.error("[Keeper] No Pyth prices, skipping cycle.");
        setTimeout(cycle, INTERVAL_MS);
        return;
    }

    for (const symbol of ASSETS) {
        const mid = mids[symbol];
        if (!mid) continue;
        try {
            await tickAsset(symbol, mid);
        } catch(e) { console.error(`Tick ${symbol} failed:`, e); }
    }

    try {
        const stats = await lob.get_stats();
        console.log(`[Keeper]  LOB stats: nextId=${stats[0]} placed=${stats[1]} filled=${stats[2]}`);
    } catch {}
    
    setTimeout(cycle, INTERVAL_MS);
}

async function main() {
    console.log("╔═══════════════════════════════════════════════════╗");
    console.log("║   AURA LOB KEEPER — Stylus / Arb Sepolia          ║");
    console.log("║   + Cross-Chain Settlement → Robinhood Chain       ║");
    console.log("╚═══════════════════════════════════════════════════╝");

    if (!PRIVATE_KEY) {
        console.error("Missing PRIVATE_KEY. Aborting.");
        process.exit(1);
    }
    if (!STYLUS_LOB_ADDRESS) {
        console.error("Missing STYLUS_LOB_ADDRESS. Aborting.");
        process.exit(1);
    }

    // ── Arbitrum Sepolia (Stylus LOB) ──
    sepoliaProvider = new ethers.JsonRpcProvider(ARB_SEPOLIA_RPC);
    robinhoodProvider = new ethers.JsonRpcProvider(ROBINHOOD_RPC);

    sepoliaWallet = new ethers.Wallet(PRIVATE_KEY, sepoliaProvider);
    robinhoodWallet = new ethers.Wallet(PRIVATE_KEY, robinhoodProvider);
    keeperWalletSepolia = new ethers.Wallet(KEEPER_PRIVATE_KEY, sepoliaProvider);
    keeperWalletRobinhood = new ethers.Wallet(KEEPER_PRIVATE_KEY, robinhoodProvider);

    lob = new ethers.Contract(STYLUS_LOB_ADDRESS, STYLUS_LOB_ABI, keeperWalletSepolia);
    perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, keeperWalletRobinhood);
    ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, keeperWalletRobinhood);
    oracle = new ethers.Contract(process.env.MOCK_ORACLE_ADDRESS || "0x097AeB196366317cf97986A04f32Df312c96ABa1", ORACLE_ABI, robinhoodWallet);
    if (ESCROW_ADDRESS) {
        escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, keeperWalletSepolia);
        console.log(`[Keeper]  Escrow active at ${ESCROW_ADDRESS}`);
    }

    initHashMap();

    const sepoliaBal = await sepoliaProvider.getBalance(sepoliaWallet.address);
    const robinhoodBal = await robinhoodProvider.getBalance(robinhoodWallet.address);

    console.log(`Keeper EOA:    ${keeperWalletSepolia.address}`);
    console.log(`Stylus LOB:    ${STYLUS_LOB_ADDRESS}`);
    console.log(`Arb Sepolia:   ${ethers.formatEther(sepoliaBal)} ETH`);
    console.log(`Robinhood:     ${ethers.formatEther(robinhoodBal)} ETH`);
    console.log(`Settlement:    ${ENABLE_SETTLEMENT ? " ON (→ AuraPerps " + AURA_PERPS_ADDRESS + ")" : " OFF"}`);
    console.log(`Assets:        ${ASSETS.join(", ")}`);
    console.log(`Cycle every:   ${INTERVAL_MS / 1000}s\n`);

    await cycle();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
