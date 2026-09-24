const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying AuraFactory with:", deployer.address);

  // Utiliser l'EntryPoint existant ou Mock
  const entryPointAddress = "0xBa2D1a7Ab3802A536cE78d7dA90A0289AC3B4C00";

  const AuraFactory = await hre.ethers.getContractFactory("AuraFactory");
  const factory = await AuraFactory.deploy(entryPointAddress);
  console.log("AuraFactory deployed to:", factory.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
