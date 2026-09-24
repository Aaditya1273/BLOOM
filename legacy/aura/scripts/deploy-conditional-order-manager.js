const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying ConditionalOrderManager with:", deployer.address);

  const AURA_PERPS = process.env.AURA_PERPS_ADDRESS || "0x8AECF449B27BB41E34C04D8C99F4348FF38bB9a2";
  const MOCK_ORACLE = process.env.MOCK_ORACLE_ADDRESS || "0x097AeB196366317cf97986A04f32Df312c96ABa1";

  console.log("  AuraPerps:", AURA_PERPS);
  console.log("  MockOracle:", MOCK_ORACLE);

  const COM = await hre.ethers.getContractFactory("ConditionalOrderManager");
  const com = await COM.deploy(AURA_PERPS, MOCK_ORACLE);
  await com.waitForDeployment();

  const address = await com.getAddress();
  console.log("✅ ConditionalOrderManager deployed to:", address);
  console.log("\nAdd to your .env:");
  console.log(`CONDITIONAL_ORDER_MANAGER_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
