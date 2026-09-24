const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying AuraAuditTrail with:", deployer.address);

  const AuditTrail = await hre.ethers.getContractFactory("AuraAuditTrail");
  const auditTrail = await AuditTrail.deploy();
  await auditTrail.waitForDeployment();

  const address = await auditTrail.getAddress();
  console.log("✅ AuraAuditTrail deployed to:", address);
  console.log("\nAdd to your .env:");
  console.log(`AUDIT_TRAIL_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
