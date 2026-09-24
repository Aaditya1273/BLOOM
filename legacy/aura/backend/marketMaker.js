/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║     AURA AI MARKET MAKER — Direct Stylus LOB driver               ║
 * ║   Posts symmetric bid/ask quotes around the Pyth mid price into   ║
 * ║   the WASM order book on Arbitrum Sepolia.                        ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * Architecture (post Wave-4 recadrage):
 *   - The Stylus LOB lives on Arbitrum Sepolia (chain 421614). Initialized
 *     with the deployer EOA as both `router` and `keeper`, so this script
 *     (using the same PRIVATE_KEY) can call `store_order` directly.
 *   - No Solidity router, no MMFund, no aUSD escrow. The WASM contract
 *     records orders without pulling collateral, so the MM only needs gas.
 *   - Pyth Hermes feeds the mid price; we wrap a configurable spread around
 *     it and place N bids and N asks per cycle.
 *
 * Run:
 *   node marketMaker.js
 *
 * Env (read from backend/.env):
 *   - PRIVATE_KEY               (must match the Stylus LOB router EOA)
 *   - STYLUS_LOB_ADDRESS        (default: deployed v2 address)
 *   - ARB_SEPOLIA_RPC           (optional override)
 *   - MM_LEVELS_PER_SIDE        (default 3)
 *   - MM_BASE_SPREAD_BPS        (default 30 = 0.3%)
 *   - MM_LEVEL_STEP_BPS         (default 20 = 0.2% between adjacent levels)
 *   - MM_INTERVAL_MS            (default 30000)
 *   - MM_COLLATERAL             (default 100, used by the contract for size = collateral * leverage)
 *   - MM_LEVERAGE               (default 1)
 *   - MM_ASSETS                 (default "BTC,ETH,AMZN,TSLA,AMD,NFLX,PLTR")
 *   - MM_MAX_ACTIVE_PER_SIDE    (default 12, hard cap to keep the book bounded)
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env"), override: true });
const { ethers } = require("ethers");

// ── Config ─────────────────────────────────────────────────────────────
const PRIVATE_KEY        = process.env.PRIVATE_KEY;
const STYLUS_LOB_ADDRESS = process.env.STYLUS_LOB_ADDRESS;
const ARB_SEPOLIA_RPC    = process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc";

const LEVELS_PER_SIDE     = parseInt(process.env.MM_LEVELS_PER_SIDE  || "3");
const BASE_SPREAD_BPS     = parseInt(process.env.MM_BASE_SPREAD_BPS  || "30");
const LEVEL_STEP_BPS      = parseInt(process.env.MM_LEVEL_STEP_BPS   || "20");
const INTERVAL_MS         = parseInt(process.env.MM_INTERVAL_MS      || "30000");
const COLLATERAL          = process.env.MM_COLLATERAL || "100";  // human units
const LEVERAGE            = parseInt(process.env.MM_LEVERAGE        || "1");
const ASSETS              = (process.env.MM_ASSETS || "BTC,ETH,AMZN,TSLA,AMD,NFLX,PLTR").split(",").map(s => s.trim().toUpperCase());
const MAX_ACTIVE_PER_SIDE = parseInt(process.env.MM_MAX_ACTIVE_PER_SIDE || "12");

// ── Stylus LOB ABI (snake_case, matches lib.rs #[selector] annotations) ──
const STYLUS_LOB_ABI = [
    "function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) returns (uint256)",
    "function get_book_depth(uint256 asset_hash) view returns (uint256, uint256)",
    "function get_stats() view returns (uint256, uint256, uint256)",
];

// ── Pyth Hermes IDs ──
const PYTH_IDS = {
    BTC:  "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH:  "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    AMZN: "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
    TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    AMD:  "3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e",
    NFLX: "8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2",
    PLTR: "11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0",
};

let provider, wallet, lob;

function assetHash(symbol) {
    return BigInt(ethers.keccak256(ethers.toUtf8Bytes(symbol.toUpperCase())));
}

async function fetchPythMids() {
    const ids = ASSETS.map(a => PYTH_IDS[a]).filter(Boolean);
    if (ids.length === 0) return {};
    const url = `https://hermes.pyth.network/v2/updates/price/latest?` + ids.map(id => `ids[]=${id}`).join("&");
    try {
        const res = await fetch(url);
        const data = await res.json();
        const out = {};
        for (const entry of data.parsed || []) {
            const px = Number(entry.price.price) * Math.pow(10, entry.price.expo);
            const id = entry.id; // 64 hex chars, no 0x
            for (const [sym, pythId] of Object.entries(PYTH_IDS)) {
                if (id.toLowerCase() === pythId.toLowerCase()) {
                    out[sym] = px;
                }
            }
        }
        return out;
    } catch (e) {
        console.error("[MM] Pyth fetch error:", e.message);
        return {};
    }
}

function priceWei(humanPrice) {
    // Round to 2 decimals to keep wei-formatted values reasonable
    return ethers.parseUnits(humanPrice.toFixed(2), 18);
}

async function placeQuote(symbol, isLong, midPrice, levelIdx) {
    const direction = isLong ? -1 : 1; // bid → below mid; ask → above mid
    const offsetBps = BASE_SPREAD_BPS + levelIdx * LEVEL_STEP_BPS;
    const limitPrice = midPrice * (1 + (direction * offsetBps) / 10000);
    const limitWei = priceWei(limitPrice);
    const collatWei = ethers.parseUnits(COLLATERAL, 18);

    const tag = isLong ? " BID" : " ASK";
    try {
        const tx = await lob.store_order(
            wallet.address,
            assetHash(symbol),
            isLong,
            collatWei,
            LEVERAGE,
            limitWei
        );
        const receipt = await tx.wait();
        console.log(
            `[MM] ${tag} ${symbol} L${levelIdx} @ $${limitPrice.toFixed(2)} | mid=$${midPrice.toFixed(2)} | tx ${receipt.hash} | gas ${receipt.gasUsed}`
        );
    } catch (e) {
        console.error(`[MM] place ${tag} ${symbol} L${levelIdx} failed:`, e.shortMessage || e.message);
    }
}

async function cycle() {
    const mids = await fetchPythMids();
    if (Object.keys(mids).length === 0) {
        console.warn("[MM] No mid prices from Pyth. Skipping cycle.");
        return;
    }

    for (const symbol of ASSETS) {
        const mid = mids[symbol];
        if (!mid) {
            console.warn(`[MM] No Pyth price for ${symbol}, skipping.`);
            continue;
        }

        // Hard cap per-side depth to keep the book from drifting unbounded.
        const [bids, asks] = await lob.get_book_depth(assetHash(symbol));
        const bidsAvailable = MAX_ACTIVE_PER_SIDE - Number(bids);
        const asksAvailable = MAX_ACTIVE_PER_SIDE - Number(asks);
        const bidLevels = Math.min(LEVELS_PER_SIDE, Math.max(0, bidsAvailable));
        const askLevels = Math.min(LEVELS_PER_SIDE, Math.max(0, asksAvailable));

        console.log(
            `[MM] ${symbol} mid=$${mid.toFixed(2)} | book bids=${bids} asks=${asks} | placing ${bidLevels} bids + ${askLevels} asks`
        );

        for (let i = 0; i < bidLevels; i++) {
            await placeQuote(symbol, true, mid, i);
        }
        for (let i = 0; i < askLevels; i++) {
            await placeQuote(symbol, false, mid, i);
        }
    }

    try {
        const stats = await lob.get_stats();
        console.log(`[MM]  LOB stats: nextId=${stats[0]} placed=${stats[1]} filled=${stats[2]}`);
    } catch {}
}

async function main() {
    console.log("╔═══════════════════════════════════════════════════╗");
    console.log("║   AURA AI MARKET MAKER — Stylus / Arb Sepolia     ║");
    console.log("╚═══════════════════════════════════════════════════╝");

    if (!PRIVATE_KEY) {
        console.error("Missing PRIVATE_KEY. Aborting.");
        process.exit(1);
    }
    if (!STYLUS_LOB_ADDRESS) {
        console.error("Missing STYLUS_LOB_ADDRESS. Aborting.");
        process.exit(1);
    }

    provider = new ethers.JsonRpcProvider(ARB_SEPOLIA_RPC);
    wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
    lob      = new ethers.Contract(STYLUS_LOB_ADDRESS, STYLUS_LOB_ABI, wallet);

    const balance = await provider.getBalance(wallet.address);

    console.log(`MM Agent EOA:  ${wallet.address}`);
    console.log(`Stylus LOB:    ${STYLUS_LOB_ADDRESS}`);
    console.log(`Network:       Arbitrum Sepolia (${ARB_SEPOLIA_RPC})`);
    console.log(`Balance:       ${ethers.formatEther(balance)} ETH`);
    console.log(`Assets:        ${ASSETS.join(", ")}`);
    console.log(`Levels/side:   ${LEVELS_PER_SIDE} | base spread: ${BASE_SPREAD_BPS} bps | step: ${LEVEL_STEP_BPS} bps`);
    console.log(`Collateral:    ${COLLATERAL} (size = ${COLLATERAL} * ${LEVERAGE}x = ${Number(COLLATERAL) * LEVERAGE})`);
    console.log(`Cycle every:   ${INTERVAL_MS / 1000}s\n`);

    await cycle();
    setInterval(cycle, INTERVAL_MS);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
