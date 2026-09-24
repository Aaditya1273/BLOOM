/**
 * scripts/bench-stylus-vs-solidity.js
 *
 * Apples-to-apples gas benchmark of the Stylus WASM AuraOrderBook against
 * the Solidity reference implementation, both deployed on Arbitrum Sepolia
 * and initialized with the deployer EOA as router/keeper.
 *
 * Operations measured:
 *   1. store_order              — write, 7 storage slots, parallel maps
 *   2. cancel_order             — write, 1 status flip + 1 counter dec
 *   3. consume_order            — write, 1 status flip + 1 counter dec
 *   4. match_orders             — write, scans all orders + flips matches
 *   5. get_active_orders_sorted — view, O(N * cap) bounded sort
 *
 * Run:
 *   npx hardhat run scripts/bench-stylus-vs-solidity.js --network arbitrumSepolia
 */

const hre = require("hardhat");
require("dotenv").config({ override: true });

const COMMON_ABI = [
    "function initialize(address router, address keeper)",
    "function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) returns (uint256)",
    "function cancel_order(uint256 order_id, address caller) returns (bool)",
    "function consume_order(uint256 order_id) returns (bool)",
    "function match_orders(uint256 asset_hash, uint256 current_price) returns (uint256)",
    "function get_order(uint256 order_id) view returns (address, uint256, bool, uint256, uint256, uint256, uint256, uint256)",
    "function get_active_orders_sorted(uint256 asset_hash, bool is_long, uint256 max_results) view returns (uint256[], uint256[], uint256[])",
    "function get_book_depth(uint256 asset_hash) view returns (uint256, uint256)",
    "function get_stats() view returns (uint256, uint256, uint256)",
    "function next_id() view returns (uint256)",
];

const ASSET = "0x" + "ab".repeat(32); // arbitrary 256-bit asset hash
const SEED_BIDS  = 5; // ordered ascending so we can match cleanly
const SEED_ASKS  = 5;

async function main() {
    const stylusAddr   = process.env.STYLUS_LOB_ADDRESS;
    const solidityAddr = process.env.SOLIDITY_LOB_SEPOLIA_ADDRESS;
    if (!stylusAddr)   throw new Error("STYLUS_LOB_ADDRESS not set");
    if (!solidityAddr) throw new Error("SOLIDITY_LOB_SEPOLIA_ADDRESS not set");

    const [deployer] = await hre.ethers.getSigners();
    console.log("──────────────────────────────────────────────────────────");
    console.log("⚖️  Gas Bench: Stylus vs Solidity AuraOrderBook");
    console.log("──────────────────────────────────────────────────────────");
    console.log("Network        :", hre.network.name);
    console.log("Deployer/router:", deployer.address);
    console.log("Stylus LOB     :", stylusAddr);
    console.log("Solidity LOB   :", solidityAddr);
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("Balance        :", hre.ethers.formatEther(balance), "ETH");
    console.log("──────────────────────────────────────────────────────────\n");

    const stylus   = new hre.ethers.Contract(stylusAddr,   COMMON_ABI, deployer);
    const solidity = new hre.ethers.Contract(solidityAddr, COMMON_ABI, deployer);

    // Snapshot starting next_id on each side so the bench is robust to prior state.
    // Use get_stats() which returns (nextOrderId, placed, filled) on both sides.
    const stStart = Number((await stylus.get_stats())[0]);
    const soStart = Number((await solidity.get_stats())[0]);
    console.log(`📍 starting next_id  | stylus=${stStart}  solidity=${soStart}\n`);

    const results = []; // { op, stylusGas, solidityGas, delta }

    // ─────────────────────────────────────────────────────────────────
    // 1. store_order × N (bench MEAN gas across the SEED_BIDS+SEED_ASKS)
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ store_order (placing", SEED_BIDS + SEED_ASKS, "orders on each LOB)");
    const stStoreGas = [];
    const soStoreGas = [];
    // Bids: ascending limit prices [1000..1004], all is_long=true
    // Asks: descending limit prices [2004..2000], is_long=false
    const orderInputs = [];
    for (let i = 0; i < SEED_BIDS; i++) orderInputs.push({ isLong: true,  price: 1000 + i });
    for (let i = 0; i < SEED_ASKS; i++) orderInputs.push({ isLong: false, price: 2004 - i });

    for (const { isLong, price } of orderInputs) {
        const collateral = 100;
        const leverage   = 5;

        const stTx = await stylus.store_order(deployer.address, ASSET, isLong, collateral, leverage, price);
        const stRc = await stTx.wait();
        stStoreGas.push(Number(stRc.gasUsed));

        const soTx = await solidity.store_order(deployer.address, ASSET, isLong, collateral, leverage, price);
        const soRc = await soTx.wait();
        soStoreGas.push(Number(soRc.gasUsed));
    }

    const stStoreMean = mean(stStoreGas);
    const soStoreMean = mean(soStoreGas);
    results.push(row("store_order (mean over " + (SEED_BIDS + SEED_ASKS) + ")", stStoreMean, soStoreMean));
    console.log(`   stylus mean=${stStoreMean.toFixed(0)}  solidity mean=${soStoreMean.toFixed(0)}\n`);

    // Track the 10 ids we just inserted so we can target them in later ops.
    const stIds = Array.from({ length: orderInputs.length }, (_, i) => stStart + i);
    const soIds = Array.from({ length: orderInputs.length }, (_, i) => soStart + i);

    // ─────────────────────────────────────────────────────────────────
    // 2. get_active_orders_sorted (view) — gas estimate
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ get_active_orders_sorted(asset, is_long=true, cap=12) — view, eth_estimateGas");
    const stEstSorted = await stylus.get_active_orders_sorted.estimateGas(ASSET, true, 12);
    const soEstSorted = await solidity.get_active_orders_sorted.estimateGas(ASSET, true, 12);
    results.push(row("get_active_orders_sorted (cap=12, bid)", Number(stEstSorted), Number(soEstSorted)));
    console.log(`   stylus est=${stEstSorted}  solidity est=${soEstSorted}\n`);

    // ─────────────────────────────────────────────────────────────────
    // 3. match_orders (no-op price: current_price = 1500 → matches NO order)
    //    Then a real match: current_price = 1002 fills bids 1000..1002 (3 of 5)
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ match_orders @ price=1500 (no fills — measures pure scan cost)");
    const stMatch0 = await stylus.match_orders(ASSET, 1500);
    const stMatch0Rc = await stMatch0.wait();
    const soMatch0 = await solidity.match_orders(ASSET, 1500);
    const soMatch0Rc = await soMatch0.wait();
    results.push(row("match_orders (0 hits)", Number(stMatch0Rc.gasUsed), Number(soMatch0Rc.gasUsed)));
    console.log(`   stylus=${stMatch0Rc.gasUsed}  solidity=${soMatch0Rc.gasUsed}\n`);

    console.log("▶ match_orders @ price=1002 (fills 3 long bids ≤ 1002)");
    const stMatch1 = await stylus.match_orders(ASSET, 1002);
    const stMatch1Rc = await stMatch1.wait();
    const soMatch1 = await solidity.match_orders(ASSET, 1002);
    const soMatch1Rc = await soMatch1.wait();
    results.push(row("match_orders (3 hits)", Number(stMatch1Rc.gasUsed), Number(soMatch1Rc.gasUsed)));
    console.log(`   stylus=${stMatch1Rc.gasUsed}  solidity=${soMatch1Rc.gasUsed}\n`);

    // ─────────────────────────────────────────────────────────────────
    // 4. cancel_order — pick a still-ACTIVE bid id (e.g. the highest bid 1004)
    // ─────────────────────────────────────────────────────────────────
    const cancelStId = stIds[4]; // bid @1004 — still ACTIVE after match @1002
    const cancelSoId = soIds[4];
    console.log(`▶ cancel_order on still-ACTIVE bid (stIds[${cancelStId}], soIds[${cancelSoId}])`);
    const stCancel = await stylus.cancel_order(cancelStId, deployer.address);
    const stCancelRc = await stCancel.wait();
    const soCancel = await solidity.cancel_order(cancelSoId, deployer.address);
    const soCancelRc = await soCancel.wait();
    results.push(row("cancel_order", Number(stCancelRc.gasUsed), Number(soCancelRc.gasUsed)));
    console.log(`   stylus=${stCancelRc.gasUsed}  solidity=${soCancelRc.gasUsed}\n`);

    // ─────────────────────────────────────────────────────────────────
    // 5. consume_order — pick a still-ACTIVE ask id (asks[0] @2004)
    // ─────────────────────────────────────────────────────────────────
    const consumeStId = stIds[5]; // first ask
    const consumeSoId = soIds[5];
    console.log(`▶ consume_order on still-ACTIVE ask (stIds[${consumeStId}], soIds[${consumeSoId}])`);
    const stConsume = await stylus.consume_order(consumeStId);
    const stConsumeRc = await stConsume.wait();
    const soConsume = await solidity.consume_order(consumeSoId);
    const soConsumeRc = await soConsume.wait();
    results.push(row("consume_order", Number(stConsumeRc.gasUsed), Number(soConsumeRc.gasUsed)));
    console.log(`   stylus=${stConsumeRc.gasUsed}  solidity=${soConsumeRc.gasUsed}\n`);

    // ─────────────────────────────────────────────────────────────────
    // Final report
    // ─────────────────────────────────────────────────────────────────
    console.log("──────────────────────────────────────────────────────────");
    console.log("📊 Final report");
    console.log("──────────────────────────────────────────────────────────");
    console.log(
        "Op".padEnd(40),
        "Stylus".padStart(10),
        "Solidity".padStart(10),
        "Δ (Sty−Sol)".padStart(13),
        "Sty / Sol"
    );
    console.log("─".repeat(85));
    for (const r of results) {
        console.log(
            r.op.padEnd(40),
            String(r.stylusGas).padStart(10),
            String(r.solidityGas).padStart(10),
            (r.delta > 0 ? "+" + r.delta : String(r.delta)).padStart(13),
            (r.ratio.toFixed(3) + "x").padStart(8)
        );
    }
    console.log("──────────────────────────────────────────────────────────");

    const stStats = await stylus.get_stats();
    const soStats = await solidity.get_stats();
    console.log("\n📈 Final stats (next_id, placed, filled):");
    console.log("   stylus  :", stStats[0].toString(), stStats[1].toString(), stStats[2].toString());
    console.log("   solidity:", soStats[0].toString(), soStats[1].toString(), soStats[2].toString());
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function row(op, stylusGas, solidityGas) {
    return {
        op,
        stylusGas: Math.round(stylusGas),
        solidityGas: Math.round(solidityGas),
        delta: Math.round(stylusGas - solidityGas),
        ratio: stylusGas / solidityGas,
    };
}

main().catch((err) => { console.error(err); process.exit(1); });
