const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Setting up AI_EXECUTOR_ROLE with account:", deployer.address);

  const VAULT_ADDRESS = "0x6E225c5e1279080B7638155C93A4c0A1009d028C";
  const AGENT_ADDRESS = "0xD097668d5b00755c4F1B92C2c99846617146827e";

  const vaultAbi = [
    "function AI_EXECUTOR_ROLE() view returns (bytes32)",
    "function grantRole(bytes32 role, address account) external"
  ];

  const vault = await ethers.getContractAt(vaultAbi, VAULT_ADDRESS);
  const aiRole = await vault.AI_EXECUTOR_ROLE();

  console.log("Granting AI_EXECUTOR_ROLE to Agent...");
  const tx = await vault.grantRole(aiRole, AGENT_ADDRESS);
  await tx.wait();
  console.log("✅ AI_EXECUTOR_ROLE granted successfully to:", AGENT_ADDRESS);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
