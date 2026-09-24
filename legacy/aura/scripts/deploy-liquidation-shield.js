const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying LiquidationShield with:", deployer.address);

  const AURA_PERPS = process.env.AURA_PERPS_ADDRESS || "0x8AECF449B27BB41E34C04D8C99F4348FF38bB9a2";
  console.log("  AuraPerps:", AURA_PERPS);

  const Shield = await hre.ethers.getContractFactory("LiquidationShield");
  const shield = await Shield.deploy(AURA_PERPS);
  await shield.waitForDeployment();

  const address = await shield.getAddress();
  console.log("✅ LiquidationShield deployed to:", address);
  console.log("\nAdd to your .env:");
  console.log(`LIQUIDATION_SHIELD_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
