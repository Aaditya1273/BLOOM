/**
 * Live test of ConditionalOrderManager on Robinhood Chain Testnet.
 * Uses the deployed contract + AuraPerps + MockOracle.
 *
 * Run: npx hardhat run scripts/test-conditional-order-live.js --network robinhoodTestnet
 */
const hre = require("hardhat");
require("dotenv").config();

const COM_ADDRESS = process.env.CONDITIONAL_ORDER_MANAGER_ADDRESS;
const PERPS_ADDRESS = process.env.AURA_PERPS_ADDRESS;
const ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS;
const AUSD_ADDRESS = process.env.AUSD_ADDRESS;

const SYMBOL = "ETH";
const COLLATERAL = hre.ethers.parseUnits("10", 18); // 10 aUSD
const LEVERAGE = 2n;

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  LIVE TEST: ConditionalOrderManager               ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log(`Signer:  ${signer.address}`);
  console.log(`COM:     ${COM_ADDRESS}`);
  console.log(`Perps:   ${PERPS_ADDRESS}`);
  console.log(`Oracle:  ${ORACLE_ADDRESS}`);
  console.log(`aUSD:    ${AUSD_ADDRESS}\n`);

  const perps = await hre.ethers.getContractAt("AuraPerps", PERPS_ADDRESS, signer);
  const oracle = await hre.ethers.getContractAt("MockOracle", ORACLE_ADDRESS, signer);
  const ausd = await hre.ethers.getContractAt("aUSD", AUSD_ADDRESS, signer);
  const com = await hre.ethers.getContractAt("ConditionalOrderManager", COM_ADDRESS, signer);

  // ── 1. Check balances ──
  const bal = await ausd.balanceOf(signer.address);
  console.log(`[1] aUSD balance: ${hre.ethers.formatUnits(bal, 18)}`);
  if (bal < COLLATERAL) {
    console.log("❌ Insufficient aUSD. Minting...");
    const mintTx = await ausd.mint(signer.address, hre.ethers.parseUnits("100", 18));
    await mintTx.wait();
    console.log("   ✅ Minted 100 aUSD");
  }

  // ── 2. Set oracle price ──
  const entryPrice = hre.ethers.parseUnits("2500", 18);
  console.log(`\n[2] Setting oracle price to $2500...`);
  const oracleTx = await oracle.setPrice(SYMBOL, entryPrice);
  await oracleTx.wait();
  console.log("   ✅ Oracle price set");

  // ── 3. Open a LONG position ──
  console.log(`\n[3] Opening LONG ${SYMBOL} position (${hre.ethers.formatUnits(COLLATERAL, 18)} aUSD, ${LEVERAGE}x)...`);
  const approveTx = await ausd.approve(PERPS_ADDRESS, COLLATERAL);
  await approveTx.wait();

  const openTx = await perps.openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
  const openReceipt = await openTx.wait();

  const openEvent = openReceipt.logs.map(l => {
    try { return perps.interface.parseLog(l); } catch { return null; }
  }).filter(Boolean).find(e => e.name === "PositionOpened");

  const positionId = openEvent.args.positionId;
  console.log(`   ✅ Position #${positionId} opened | entry: $${hre.ethers.formatUnits(openEvent.args.entryPrice, 18)}`);

  // ── 4. Set trigger orders on AuraPerps ──
  const slPrice = hre.ethers.parseUnits("2200", 18);
  const tpPrice = hre.ethers.parseUnits("3000", 18);
  console.log(`\n[4] Setting triggers on AuraPerps: SL=$2200, TP=$3000...`);
  const triggerTx = await perps.setTriggerOrders(positionId, tpPrice, slPrice);
  await triggerTx.wait();
  console.log("   ✅ Triggers set on AuraPerps");

  // ── 5. Create conditional order on COM (stop-loss) ──
  console.log(`\n[5] Creating STOP_LOSS order on ConditionalOrderManager...`);
  const createTx = await com.createOrder(positionId, 0, slPrice); // 0 = STOP_LOSS
  const createReceipt = await createTx.wait();

  const createEvent = createReceipt.logs.map(l => {
    try { return com.interface.parseLog(l); } catch { return null; }
  }).filter(Boolean).find(e => e.name === "OrderCreated");

  const orderId = createEvent.args.orderId;
  console.log(`   ✅ Order #${orderId} created | type=STOP_LOSS | trigger=$2200`);

  // ── 6. Verify order state ──
  console.log(`\n[6] Verifying order state...`);
  const isTriggered = await com.isTriggered(orderId);
  console.log(`   isTriggered (price=$2500, SL=$2200): ${isTriggered} (expected: false)`);

  const activeCount = await com.getActiveOrderCount(signer.address);
  console.log(`   Active orders for user: ${activeCount}`);

  // ── 7. Drop price below SL and verify trigger ──
  console.log(`\n[7] Dropping oracle price to $2100 (below SL)...`);
  const dropTx = await oracle.setPrice(SYMBOL, hre.ethers.parseUnits("2100", 18));
  await dropTx.wait();

  const isTriggeredNow = await com.isTriggered(orderId);
  console.log(`   isTriggered (price=$2100, SL=$2200): ${isTriggeredNow} (expected: true)`);

  const executable = await com.getExecutableOrders(SYMBOL, 10);
  console.log(`   Executable orders: [${executable.join(", ")}]`);

  // ── 8. Execute the order (keeper role) ──
  console.log(`\n[8] Executing order #${orderId} as keeper...`);
  try {
    const execTx = await com.executeOrder(orderId);
    const execReceipt = await execTx.wait();
    console.log(`   ✅ Order executed! tx: ${execReceipt.hash}`);
    console.log(`   Gas used: ${execReceipt.gasUsed}`);

    // Verify position is closed
    const pos = await perps.positions(positionId);
    console.log(`   Position #${positionId} isOpen: ${pos.isOpen} (expected: false)`);

    // Verify order status
    const order = await com.orders(orderId);
    console.log(`   Order #${orderId} status: ${order.status} (1=EXECUTED)`);
  } catch (e) {
    console.error(`   ❌ Execution failed: ${e.shortMessage || e.message}`);
  }

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║  ALL LIVE TESTS COMPLETE                          ║");
  console.log("╚═══════════════════════════════════════════════════╝");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
