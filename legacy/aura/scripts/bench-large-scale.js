/**
 * scripts/bench-large-scale.js
 *
 * Heavier-workload bench: seed 60 active orders into BOTH LOBs (under a fresh
 * asset hash, to avoid contaminating the previous bench's state) and measure
 * the compute-bound operations:
 *   - match_orders (full scan over 60 orders)
 *   - get_active_orders_sorted (insertion sort over 60 candidates)
 *
 * Hypothesis: at ~60+ orders the sort/scan compute starts to dominate the
 * fixed ~18k WASM activation overhead, and Stylus should narrow the gap.
 *
 * Run:
 *   npx hardhat run scripts/bench-large-scale.js --network arbitrumSepolia
 */

const hre = require("hardhat");
require("dotenv").config({ override: true });

const COMMON_ABI = [
    "function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) returns (uint256)",
    "function match_orders(uint256 asset_hash, uint256 current_price) returns (uint256)",
    "function get_active_orders_sorted(uint256 asset_hash, bool is_long, uint256 max_results) view returns (uint256[], uint256[], uint256[])",
    "function get_book_depth(uint256 asset_hash) view returns (uint256, uint256)",
    "function get_stats() view returns (uint256, uint256, uint256)",
];

const N_BIDS = 30;
const N_ASKS = 30;
// Use a fresh asset hash so we don't bench against orders left over from prior runs.
const ASSET = "0x" + (Date.now().toString(16).padStart(64, "0"));

async function main() {
    const stylusAddr   = process.env.STYLUS_LOB_ADDRESS;
    const solidityAddr = process.env.SOLIDITY_LOB_SEPOLIA_ADDRESS;

    const [deployer] = await hre.ethers.getSigners();
    console.log("──────────────────────────────────────────────────────────");
    console.log("⚖️  Large-scale bench (60 orders, fresh asset hash)");
    console.log("──────────────────────────────────────────────────────────");
    console.log("Stylus LOB     :", stylusAddr);
    console.log("Solidity LOB   :", solidityAddr);
    console.log("Asset hash     :", ASSET);
    console.log("──────────────────────────────────────────────────────────\n");

    const stylus   = new hre.ethers.Contract(stylusAddr,   COMMON_ABI, deployer);
    const solidity = new hre.ethers.Contract(solidityAddr, COMMON_ABI, deployer);

    // ─── Seed 30 bids + 30 asks into both LOBs ───
    console.log(`▶ Seeding ${N_BIDS} bids + ${N_ASKS} asks (= ${N_BIDS + N_ASKS} orders/LOB)...`);
    const inputs = [];
    for (let i = 0; i < N_BIDS; i++) inputs.push({ isLong: true,  price: 1000 + i });
    for (let i = 0; i < N_ASKS; i++) inputs.push({ isLong: false, price: 2030 + i });

    let stTotal = 0, soTotal = 0;
    for (let i = 0; i < inputs.length; i++) {
        const { isLong, price } = inputs[i];
        const stTx = await stylus.store_order(deployer.address, ASSET, isLong, 100, 5, price);
        const stRc = await stTx.wait();
        stTotal += Number(stRc.gasUsed);

        const soTx = await solidity.store_order(deployer.address, ASSET, isLong, 100, 5, price);
        const soRc = await soTx.wait();
        soTotal += Number(soRc.gasUsed);

        if ((i + 1) % 10 === 0) console.log(`   …${i + 1}/${inputs.length}`);
    }
    console.log(`   ✓ seeded\n`);

    const stDepth = await stylus.get_book_depth(ASSET);
    const soDepth = await solidity.get_book_depth(ASSET);
    console.log(`📦 book depth | stylus bids=${stDepth[0]} asks=${stDepth[1]} | solidity bids=${soDepth[0]} asks=${soDepth[1]}\n`);

    // ─── Compute-bound ops ───
    console.log("▶ get_active_orders_sorted(bid, cap=20)  — sort over 30 bids");
    const stSort20 = await stylus.get_active_orders_sorted.estimateGas(ASSET, true, 20);
    const soSort20 = await solidity.get_active_orders_sorted.estimateGas(ASSET, true, 20);
    console.log(`   stylus=${stSort20}  solidity=${soSort20}\n`);

    console.log("▶ get_active_orders_sorted(bid, cap=30)  — sort over 30 bids, full");
    const stSort30 = await stylus.get_active_orders_sorted.estimateGas(ASSET, true, 30);
    const soSort30 = await solidity.get_active_orders_sorted.estimateGas(ASSET, true, 30);
    console.log(`   stylus=${stSort30}  solidity=${soSort30}\n`);

    // match_orders @ no-hit price → measures pure scan cost over ALL orders
    // (note: scan walks every order id ever placed across both prior + this asset
    // hash, so cost is amortized against everything in the book. Compute is the
    // dominant cost here when N is large.)
    console.log("▶ match_orders @ price=10000 (0 hits — measures pure scan cost over book)");
    const stM0 = await stylus.match_orders(ASSET, 10000);
    const stM0Rc = await stM0.wait();
    const soM0 = await solidity.match_orders(ASSET, 10000);
    const soM0Rc = await soM0.wait();
    console.log(`   stylus=${stM0Rc.gasUsed}  solidity=${soM0Rc.gasUsed}\n`);

    // match_orders @ price=1015 → fills bids 1000..1015 (16 hits)
    console.log("▶ match_orders @ price=1015 (16 hits — fills + scan)");
    const stM1 = await stylus.match_orders(ASSET, 1015);
    const stM1Rc = await stM1.wait();
    const soM1 = await solidity.match_orders(ASSET, 1015);
    const soM1Rc = await soM1.wait();
    console.log(`   stylus=${stM1Rc.gasUsed}  solidity=${soM1Rc.gasUsed}\n`);

    // ─── Final report ───
    const rows = [
        row("seed total (60 store_order)", stTotal, soTotal),
        row("get_active_orders_sorted (cap=20, 30 bids)", Number(stSort20), Number(soSort20)),
        row("get_active_orders_sorted (cap=30, 30 bids)", Number(stSort30), Number(soSort30)),
        row("match_orders (full scan, 0 hits)", Number(stM0Rc.gasUsed), Number(soM0Rc.gasUsed)),
        row("match_orders (full scan, 16 hits)", Number(stM1Rc.gasUsed), Number(soM1Rc.gasUsed)),
    ];

    console.log("──────────────────────────────────────────────────────────");
    console.log("📊 Large-scale bench report");
    console.log("──────────────────────────────────────────────────────────");
    console.log(
        "Op".padEnd(46),
        "Stylus".padStart(10),
        "Solidity".padStart(10),
        "Δ (Sty−Sol)".padStart(13),
        "Sty / Sol"
    );
    console.log("─".repeat(91));
    for (const r of rows) {
        console.log(
            r.op.padEnd(46),
            String(r.stylusGas).padStart(10),
            String(r.solidityGas).padStart(10),
            (r.delta > 0 ? "+" + r.delta : String(r.delta)).padStart(13),
            (r.ratio.toFixed(3) + "x").padStart(8)
        );
    }
    console.log("──────────────────────────────────────────────────────────");
}

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
