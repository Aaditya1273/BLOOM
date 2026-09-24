const hre = require("hardhat");
const { ethers } = require("hardhat");
require("dotenv").config();

const GUARDRAIL_ADDRESS = "0xd57a35af5ea3176667d79d6e460e39e9ba79bc08";

const GUARDRAIL_ABI = [
  "function initialize(address router, uint256 max_leverage, uint256 max_position_size, uint256 min_collateral, uint256 daily_volume_cap)",
  "function allow_asset(uint256 asset_hash)",
  "function get_params() view returns (uint256, uint256, uint256, uint256)",
  "function is_asset_allowed(uint256 asset_hash) view returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Initializing AuraGuardrail with:", deployer.address);

  const guardrail = new ethers.Contract(GUARDRAIL_ADDRESS, GUARDRAIL_ABI, deployer);

  // Initialize: router=deployer, max_leverage=50, max_position=500k, min_collateral=1, daily_cap=10M
  console.log("\n1. Initializing guardrail parameters...");
  const tx1 = await guardrail.initialize(
    deployer.address,
    50,
    ethers.parseEther("500000"),
    ethers.parseEther("1"),
    ethers.parseEther("10000000")
  );
  await tx1.wait();
  console.log("   ✅ Initialized");

  // Whitelist assets
  const assets = ["ETH", "BTC", "TSLA", "AMZN", "NFLX", "AMD", "PLTR"];
  console.log("\n2. Whitelisting assets...");
  for (const asset of assets) {
    const hash = BigInt(ethers.keccak256(ethers.toUtf8Bytes(asset)));
    try {
      const tx = await guardrail.allow_asset(hash, { gasLimit: 500000 });
      await tx.wait();
      console.log(`   ✅ ${asset} whitelisted`);
    } catch (e) {
      console.log(`   ❌ ${asset} failed: ${e.shortMessage || e.message}`);
    }
  }

  // Verify
  console.log("\n3. Verifying...");
  const params = await guardrail.get_params();
  console.log(`   max_leverage: ${params[0]}`);
  console.log(`   max_position: ${ethers.formatEther(params[1])} tokens`);
  console.log(`   min_collateral: ${ethers.formatEther(params[2])} tokens`);
  console.log(`   daily_cap: ${ethers.formatEther(params[3])} tokens`);

  const ethHash = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ETH")));
  const allowed = await guardrail.is_asset_allowed(ethHash);
  console.log(`   ETH allowed: ${allowed}`);

  console.log("\n🎉 AuraGuardrail fully initialized on Arbitrum Sepolia!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
