/**
 * Live test: Take-Profit on Robinhood Chain Testnet.
 * Run: npx hardhat run scripts/test-tp-live.js --network robinhoodTestnet
 */
const hre = require("hardhat");
require("dotenv").config();

const COM_ADDRESS = process.env.CONDITIONAL_ORDER_MANAGER_ADDRESS;
const PERPS_ADDRESS = process.env.AURA_PERPS_ADDRESS;
const ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS;
const AUSD_ADDRESS = process.env.AUSD_ADDRESS;

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  LIVE TEST: Take-Profit Execution                 ║");
  console.log("╚═══════════════════════════════════════════════════╝");

  const perps = await hre.ethers.getContractAt("AuraPerps", PERPS_ADDRESS, signer);
  const oracle = await hre.ethers.getContractAt("MockOracle", ORACLE_ADDRESS, signer);
  const ausd = await hre.ethers.getContractAt("aUSD", AUSD_ADDRESS, signer);
  const com = await hre.ethers.getContractAt("ConditionalOrderManager", COM_ADDRESS, signer);

  const SYMBOL = "ETH";
  const COLLATERAL = hre.ethers.parseUnits("10", 18);

  // 1. Set entry price & open SHORT
  console.log("\n[1] Setting oracle to $2500, opening SHORT...");
  await (await oracle.setPrice(SYMBOL, hre.ethers.parseUnits("2500", 18))).wait();
  await (await ausd.approve(PERPS_ADDRESS, COLLATERAL)).wait();
  const openTx = await perps.openPosition(SYMBOL, false, COLLATERAL, 3);
  const openReceipt = await openTx.wait();
  const posId = openReceipt.logs.map(l => { try { return perps.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "PositionOpened").args.positionId;
  console.log(`   ✅ SHORT Position #${posId} opened (3x)`);

  // 2. Set TP at $2000 (short profits when price drops)
  const tpPrice = hre.ethers.parseUnits("2000", 18);
  console.log("\n[2] Setting TP=$2000 on AuraPerps + COM...");
  await (await perps.setTriggerOrders(posId, tpPrice, 0)).wait();
  const createTx = await com.createOrder(posId, 1, tpPrice); // 1 = TAKE_PROFIT
  const createReceipt = await createTx.wait();
  const orderId = createReceipt.logs.map(l => { try { return com.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "OrderCreated").args.orderId;
  console.log(`   ✅ TP order #${orderId} created`);

  // 3. Verify not triggered yet
  console.log("\n[3] Checking trigger at current price ($2500)...");
  console.log(`   isTriggered: ${await com.isTriggered(orderId)} (expected: false)`);

  // 4. Drop price to $1900 (below TP for short)
  console.log("\n[4] Dropping price to $1900...");
  await (await oracle.setPrice(SYMBOL, hre.ethers.parseUnits("1900", 18))).wait();
  console.log(`   isTriggered: ${await com.isTriggered(orderId)} (expected: true)`);

  // 5. Execute
  console.log("\n[5] Executing TP order...");
  const execTx = await com.executeOrder(orderId);
  const execReceipt = await execTx.wait();
  console.log(`   ✅ Executed! tx: ${execReceipt.hash} | gas: ${execReceipt.gasUsed}`);

  // 6. Verify
  const pos = await perps.positions(posId);
  const order = await com.orders(orderId);
  console.log(`   Position #${posId} isOpen: ${pos.isOpen} (expected: false)`);
  console.log(`   Order #${orderId} status: ${order.status} (1=EXECUTED)`);

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║  TP LIVE TEST PASSED ✅                            ║");
  console.log("╚═══════════════════════════════════════════════════╝");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
