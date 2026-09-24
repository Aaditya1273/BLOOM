/**
 * scripts/deploy-solidity-lob-sepolia.js
 *
 * Deploys the Solidity AuraOrderBook on Arbitrum Sepolia and initializes it
 * with the deployer EOA as both router and keeper, so we can drive
 * `store_order`, `match_orders`, etc. directly from EOA (mirrors the Stylus
 * LOB setup) for an apples-to-apples gas bench.
 *
 * Run:
 *   npx hardhat run scripts/deploy-solidity-lob-sepolia.js --network arbitrumSepolia
 */

const hre = require("hardhat");
require("dotenv").config({ override: true });

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("──────────────────────────────────────────────────────────");
    console.log("📦 Solidity AuraOrderBook — Sepolia deploy (for bench)");
    console.log("──────────────────────────────────────────────────────────");
    console.log("Network        :", hre.network.name);
    console.log("Deployer       :", deployer.address);

    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("Balance        :", hre.ethers.formatEther(balance), "ETH");
    console.log("──────────────────────────────────────────────────────────");

    const Factory = await hre.ethers.getContractFactory("AuraOrderBook");
    console.log("→ Deploying...");
    const lob = await Factory.deploy();
    await lob.waitForDeployment();

    const address = await lob.getAddress();
    const deployTx = lob.deploymentTransaction();
    console.log("   ✓ deployed:", address);
    console.log("   tx        :", deployTx.hash);

    // Init with deployer as both router & keeper (matches Stylus init).
    console.log("\n→ initialize(deployer, deployer)...");
    const initTx = await lob.initialize(deployer.address, deployer.address);
    const initRc = await initTx.wait();
    console.log("   tx        :", initTx.hash);
    console.log("   gasUsed   :", initRc.gasUsed.toString());

    console.log("\n──────────────────────────────────────────────────────────");
    console.log("✅ Solidity LOB on Arbitrum Sepolia ready");
    console.log("──────────────────────────────────────────────────────────");
    console.log("address        :", address);
    console.log("router         :", await lob.router());
    console.log("keeper         :", await lob.keeper());
    console.log("──────────────────────────────────────────────────────────");
    console.log("\n💡 Add this to .env:");
    console.log(`SOLIDITY_LOB_SEPOLIA_ADDRESS=${address}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
