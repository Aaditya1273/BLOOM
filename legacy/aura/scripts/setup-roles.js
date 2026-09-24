const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Setting up roles with account:", deployer.address);

  // New Contract Addresses
  const AUSD_ADDRESS = "0xFD3A7906822fEE396756322378B4cE23FBD07047";
  const AURA_PERPS_ADDRESS = "0x9f1C6D18094865396e0bAaAd60dBcA1FD49f1B2A";

  // ABI for granting role (simplified)
  const ausdAbi = [
    "function MINTER_ROLE() view returns (bytes32)",
    "function grantRole(bytes32 role, address account) external"
  ];

  const ausd = await ethers.getContractAt(ausdAbi, AUSD_ADDRESS);
  const minterRole = await ausd.MINTER_ROLE();

  console.log("Granting MINTER_ROLE to AuraPerps...");
  const tx = await ausd.grantRole(minterRole, AURA_PERPS_ADDRESS);
  await tx.wait();
  console.log("✅ MINTER_ROLE granted successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
