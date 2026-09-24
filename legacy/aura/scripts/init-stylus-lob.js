/**
 * scripts/init-stylus-lob.js
 *
 * Initialise the freshly-deployed Stylus AuraOrderBook on Arbitrum Sepolia.
 *
 * Stylus LOB and the Solidity router live on different networks:
 *   - Stylus LOB     → Arbitrum Sepolia (this script's target)
 *   - Solidity router → Robinhood Chain testnet (separate deployment)
 *
 * For now we initialize the Stylus LOB with the deployer EOA acting as both
 * `router` and `keeper`, so we can drive `store_order` / `match_orders` / etc.
 * directly from off-chain benches and demos. A real cross-chain wiring (or a
 * router redeployed on Arbitrum Sepolia) can come later by calling
 * `set_router` / `set_keeper` from the owner.
 *
 * Run:
 *   npx hardhat run scripts/init-stylus-lob.js --network arbitrumSepolia
 */

const hre = require("hardhat");
require("dotenv").config({ override: true });

const STYLUS_LOB_ABI = [
    // Stylus contract v2 exposes snake_case selectors (via #[selector(name=...)]
    // annotations in lib.rs) for drop-in compat with `interface IAuraOrderBook`
    // in contracts/AuraPerpsRouter.sol.
    "function initialize(address router, address keeper)",
    "function set_router(address router)",
    "function set_keeper(address keeper)",
    "function get_router() view returns (address)",
    "function get_keeper() view returns (address)",
    "function next_id() view returns (uint256)",
    "function get_stats() view returns (uint256, uint256, uint256)",
];

async function main() {
    const stylusAddress = process.env.STYLUS_LOB_ADDRESS;
    if (!stylusAddress) throw new Error("STYLUS_LOB_ADDRESS not set in .env");

    const [deployer] = await hre.ethers.getSigners();
    console.log("──────────────────────────────────────────────────────────");
    console.log("🛠  Stylus LOB Initialization");
    console.log("──────────────────────────────────────────────────────────");
    console.log("Network        :", hre.network.name);
    console.log("Stylus LOB     :", stylusAddress);
    console.log("Deployer EOA   :", deployer.address);
    console.log("──────────────────────────────────────────────────────────");

    const lob = new hre.ethers.Contract(stylusAddress, STYLUS_LOB_ABI, deployer);

    // Allow override via env if you want to wire a deployed router/keeper later.
    const routerArg = process.env.STYLUS_LOB_ROUTER || deployer.address;
    const keeperArg = process.env.STYLUS_LOB_KEEPER || deployer.address;

    // Pre-state
    let routerCur, keeperCur;
    try {
        routerCur = await lob.get_router();
        keeperCur = await lob.get_keeper();
    } catch (e) {
        console.warn("⚠️  get_router/get_keeper revert — contract probably uninitialized.");
    }
    console.log("Current router :", routerCur || "(unset)");
    console.log("Current keeper :", keeperCur || "(unset)");

    const ZERO = "0x0000000000000000000000000000000000000000";
    const alreadyInitialized =
        routerCur && routerCur !== ZERO && keeperCur && keeperCur !== ZERO;

    if (!alreadyInitialized) {
        console.log("\n→ Calling initialize(router, keeper)...");
        const tx = await lob.initialize(routerArg, keeperArg);
        console.log("   tx:", tx.hash);
        const receipt = await tx.wait();
        console.log("   ✓ mined in block", receipt.blockNumber, "| gasUsed:", receipt.gasUsed.toString());
    } else {
        console.log("\nℹ Already initialized — patching with set_router / set_keeper instead.");

        if (routerCur.toLowerCase() !== routerArg.toLowerCase()) {
            console.log(`→ set_router(${routerArg})...`);
            const tx = await lob.set_router(routerArg);
            console.log("   tx:", tx.hash);
            await tx.wait();
        }
        if (keeperCur.toLowerCase() !== keeperArg.toLowerCase()) {
            console.log(`→ set_keeper(${keeperArg})...`);
            const tx = await lob.set_keeper(keeperArg);
            console.log("   tx:", tx.hash);
            await tx.wait();
        }
    }

    // Post-state
    const router = await lob.get_router();
    const keeper = await lob.get_keeper();
    const nextId = await lob.next_id();
    const stats = await lob.get_stats();

    console.log("\n──────────────────────────────────────────────────────────");
    console.log("✅ Stylus LOB initialized");
    console.log("──────────────────────────────────────────────────────────");
    console.log("router         :", router);
    console.log("keeper         :", keeper);
    console.log("next_order_id  :", nextId.toString());
    console.log("stats          : nextId =", stats[0].toString(),
                                "| placed =", stats[1].toString(),
                                "| filled =", stats[2].toString());
    console.log("──────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
