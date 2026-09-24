/**
 * Live test of LiquidationShield on Robinhood Chain Testnet.
 * Run: npx hardhat run scripts/test-shield-live.js --network robinhoodTestnet
 */
const hre = require("hardhat");
require("dotenv").config();
const { computeHealth, recommendTopUp } = require("../backend/healthFactor");

const SHIELD_ADDRESS = process.env.LIQUIDATION_SHIELD_ADDRESS;
const PERPS_ADDRESS = process.env.AURA_PERPS_ADDRESS;
const ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS;
const AUSD_ADDRESS = process.env.AUSD_ADDRESS;

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  LIVE TEST: LiquidationShield                      ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log(`Signer: ${signer.address}`);
  console.log(`Shield: ${SHIELD_ADDRESS}\n`);

  const perps = await hre.ethers.getContractAt("AuraPerps", PERPS_ADDRESS, signer);
  const oracle = await hre.ethers.getContractAt("MockOracle", ORACLE_ADDRESS, signer);
  const ausd = await hre.ethers.getContractAt("aUSD", AUSD_ADDRESS, signer);
  const shield = await hre.ethers.getContractAt("LiquidationShield", SHIELD_ADDRESS, signer);

  // 1. Set entry price & open LONG ETH 5x with 50 aUSD collateral
  const SYMBOL = "ETH";
  const COLLATERAL = hre.ethers.parseUnits("50", 18);
  const LEVERAGE = 5n;
  const ENTRY = hre.ethers.parseUnits("2500", 18);

  console.log("[1] Setting oracle to $2500 and opening LONG 5x...");
  await (await oracle.setPrice(SYMBOL, ENTRY)).wait();
  await (await ausd.approve(PERPS_ADDRESS, COLLATERAL)).wait();
  const openTx = await perps.openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
  const openReceipt = await openTx.wait();
  const positionId = openReceipt.logs.map(l => { try { return perps.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "PositionOpened").args.positionId;
  console.log(`   ✅ Position #${positionId} opened\n`);

  // 2. Arm the shield with threshold 20%, recommended top-up 25 aUSD
  const RECOMMENDED = hre.ethers.parseUnits("25", 18);
  const MAX = hre.ethers.parseUnits("100", 18);
  console.log("[2] Arming shield: threshold=20%, recommended=25 aUSD, max=100 aUSD...");
  const armTx = await shield.armShield(positionId, 2000, RECOMMENDED, MAX);
  await armTx.wait();
  console.log(`   ✅ Shield armed (tx: ${armTx.hash.slice(0, 10)}...)`);

  const m = await shield.mandates(positionId);
  console.log(`   Mandate: armed=${m.armed} threshold=${m.thresholdBps}bps recommended=${hre.ethers.formatUnits(m.recommendedTopUp, 18)} aUSD\n`);

  // 3. Check health while healthy
  console.log("[3] Checking health at current price ($2500)...");
  const pos = await perps.positions(positionId);
  const blk = await hre.ethers.provider.getBlock("latest");
  const currentPriceWei = await oracle.getPrice(SYMBOL);
  const result = computeHealth({
    isLong: pos.isLong,
    collateralAmount: pos.collateralAmount,
    entryPrice: pos.entryPrice,
    positionSize: pos.positionSize,
    openedAt: pos.openedAt,
  }, currentPriceWei, BigInt(blk.timestamp));
  console.log(`   Health: ${(result.healthBps / 100).toFixed(2)}% | isProfit=${result.isProfit}\n`);

  // 4. Drop price to trigger alert
  // collateral=50 (after fee ~49.95), positionSize=50*5=250, entry=2500
  // need pnl > 0.8 * collateral = 40 (to push health < 20%)
  // pnl = 250 * priceDiff / 2500 > 40 → priceDiff > 400 → newPrice < 2100
  const NEW_PRICE = hre.ethers.parseUnits("2080", 18);
  console.log(`[4] Dropping price to $2080 to breach threshold...`);
  await (await oracle.setPrice(SYMBOL, NEW_PRICE)).wait();

  const blk2 = await hre.ethers.provider.getBlock("latest");
  const result2 = computeHealth({
    isLong: pos.isLong,
    collateralAmount: pos.collateralAmount,
    entryPrice: pos.entryPrice,
    positionSize: pos.positionSize,
    openedAt: pos.openedAt,
  }, NEW_PRICE, BigInt(blk2.timestamp));
  console.log(`   New health: ${(result2.healthBps / 100).toFixed(2)}% (threshold: 20%)\n`);

  if (result2.healthBps >= 2000) {
    console.log("⚠️  Health is still above threshold, can't fire alert");
    return;
  }

  // 5. Keeper records alert
  console.log("[5] Keeper recording alert on-chain...");
  const alertTx = await shield.recordAlert(positionId, result2.healthBps);
  const alertReceipt = await alertTx.wait();
  const alertEvent = alertReceipt.logs.map(l => { try { return shield.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "AlertEmitted");
  console.log(`   ✅ Alert recorded! tx: ${alertReceipt.hash}`);
  console.log(`   Event: positionId=${alertEvent.args.positionId}, health=${alertEvent.args.healthBps}bps, recommended=${hre.ethers.formatUnits(alertEvent.args.recommendedTopUp, 18)} aUSD\n`);

  // 6. User responds by adding margin
  console.log("[6] User adds recommended margin to recover position...");
  await (await ausd.approve(PERPS_ADDRESS, RECOMMENDED)).wait();
  const marginTx = await perps.addMargin(positionId, RECOMMENDED);
  await marginTx.wait();
  console.log(`   ✅ Added ${hre.ethers.formatUnits(RECOMMENDED, 18)} aUSD margin (tx: ${marginTx.hash.slice(0, 10)}...)`);

  const posAfter = await perps.positions(positionId);
  const blk3 = await hre.ethers.provider.getBlock("latest");
  const result3 = computeHealth({
    isLong: posAfter.isLong,
    collateralAmount: posAfter.collateralAmount,
    entryPrice: posAfter.entryPrice,
    positionSize: posAfter.positionSize,
    openedAt: posAfter.openedAt,
  }, NEW_PRICE, BigInt(blk3.timestamp));
  console.log(`   New health after top-up: ${(result3.healthBps / 100).toFixed(2)}%\n`);

  // 7. Disarm and close
  console.log("[7] Disarming shield and closing position...");
  await (await shield.disarmShield(positionId)).wait();
  console.log(`   ✅ Shield disarmed`);
  await (await perps.closePosition(positionId)).wait();
  console.log(`   ✅ Position closed\n`);

  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  LIVE TEST PASSED ✅                               ║");
  console.log("╚═══════════════════════════════════════════════════╝");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
