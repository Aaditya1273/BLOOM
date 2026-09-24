const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   AURA PROTOCOL — Solidity LOB Deployment         ║");
  console.log("║   (Fallback for Stylus)                           ║");
  console.log("╚═══════════════════════════════════════════════════╝");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const routerAddr = process.env.ROUTER_ADDRESS;
  if (!routerAddr) {
    throw new Error("ROUTER_ADDRESS not found in .env. Run deploy-hybrid-lob.js first.");
  }

  // ── 1. Deploy Solidity LOB ──
  const OrderBook = await ethers.getContractFactory("AuraOrderBook");
  const lob = await OrderBook.deploy();
  await lob.waitForDeployment();
  const lobAddr = await lob.getAddress();
  console.log("✅ Solidity AuraOrderBook:", lobAddr);

  // ── 2. Link Router to LOB ──
  const Router = await ethers.getContractFactory("AuraPerpsRouter");
  const router = Router.attach(routerAddr);
  console.log("Linking Router at", routerAddr, "to LOB at", lobAddr);
  await (await router.setOrderBook(lobAddr)).wait();
  console.log("✅ Router linked to LOB");

  // ── 3. Initialize LOB ──
  console.log("Initializing LOB...");
  await (await lob.initialize(routerAddr, deployer.address)).wait();
  console.log("✅ LOB Initialized");

  console.log("\n# Updated .env:");
  console.log(`STYLUS_LOB_ADDRESS=${lobAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
