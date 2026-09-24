/**
 * bench-guardrail.js — Benchmark Stylus vs Solidity Guardrail on Arb Sepolia
 * 
 * Usage: npx hardhat run scripts/bench-guardrail.js --network arbitrumSepolia
 */
const { ethers } = require("hardhat");

const STYLUS_GUARDRAIL = "0xd57a35af5ea3176667d79d6e460e39e9ba79bc08";

// ABI for both (identical interface)
const GUARDRAIL_ABI = [
    "function initialize(address,uint256,uint256,uint256,uint256)",
    "function validate_trade(address,uint256,uint256,uint256) returns (bool,uint256)",
    "function allow_asset(uint256)",
    "function get_params() view returns (uint256,uint256,uint256,uint256)",
    "function get_stats() view returns (uint256,uint256)",
    "function is_asset_allowed(uint256) view returns (bool)",
    "function get_user_daily_volume(address) view returns (uint256)",
];

async function main() {
    const [signer] = await ethers.getSigners();
    console.log(`\n🏁 Guardrail Benchmark — Stylus vs Solidity`);
    console.log(`   Signer: ${signer.address}\n`);

    // ── Deploy Solidity Guardrail ──
    console.log("📦 Deploying SolidityGuardrail...");
    const SolGuardrail = await ethers.getContractFactory("SolidityGuardrail");
    const solGuardrail = await SolGuardrail.deploy();
    await solGuardrail.waitForDeployment();
    const solAddr = await solGuardrail.getAddress();
    console.log(`   Solidity deployed: ${solAddr}`);

    // Initialize Solidity version with same params as Stylus
    const stylusContract = new ethers.Contract(STYLUS_GUARDRAIL, GUARDRAIL_ABI, signer);

    // Read params from Stylus
    const [maxLev, maxPos, minCol, dailyCap] = await stylusContract.get_params();
    console.log(`   Stylus params: maxLev=${maxLev}, maxPos=${maxPos}, minCol=${minCol}, dailyCap=${dailyCap}`);

    // Init Solidity with same params
    const initTx = await solGuardrail.initialize(signer.address, maxLev, maxPos, minCol, dailyCap);
    await initTx.wait();

    // Whitelist same asset (BTC hash)
    const btcHash = ethers.keccak256(ethers.toUtf8Bytes("BTC"));
    const btcHashNum = BigInt(btcHash);

    // Check if asset is allowed on Stylus
    const stylusAllowed = await stylusContract.is_asset_allowed(btcHashNum);
    console.log(`   Stylus BTC allowed: ${stylusAllowed}`);

    // Allow on Solidity
    const allowTx = await solGuardrail.allow_asset(btcHashNum);
    await allowTx.wait();

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Operation                    │ Stylus (WASM)  │ Solidity (EVM) │ Savings");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // ── Benchmark: validate_trade (APPROVED path — all 5 checks pass) ──
    const collateral = ethers.parseUnits("100", 18);
    const leverage = 10n;

    const stylusGas1 = await stylusContract.validate_trade.estimateGas(signer.address, btcHashNum, collateral, leverage);
    const solGas1 = await solGuardrail.validate_trade.estimateGas(signer.address, btcHashNum, collateral, leverage);
    printRow("validate_trade (APPROVED)", stylusGas1, solGas1);

    // Execute to update state for next tests
    await (await stylusContract.validate_trade(signer.address, btcHashNum, collateral, leverage)).wait();
    await (await solGuardrail.validate_trade(signer.address, btcHashNum, collateral, leverage)).wait();

    // ── Benchmark: validate_trade (REJECTED — leverage exceeded) ──
    const badLeverage = 100n;
    const stylusGas2 = await stylusContract.validate_trade.estimateGas(signer.address, btcHashNum, collateral, badLeverage);
    const solGas2 = await solGuardrail.validate_trade.estimateGas(signer.address, btcHashNum, collateral, badLeverage);
    printRow("validate_trade (REJECT lev)", stylusGas2, solGas2);

    // ── Benchmark: validate_trade (REJECTED — asset not allowed) ──
    const fakeHash = BigInt(ethers.keccak256(ethers.toUtf8Bytes("FAKE")));
    const stylusGas3 = await stylusContract.validate_trade.estimateGas(signer.address, fakeHash, collateral, leverage);
    const solGas3 = await solGuardrail.validate_trade.estimateGas(signer.address, fakeHash, collateral, leverage);
    printRow("validate_trade (REJECT asset)", stylusGas3, solGas3);

    // ── Benchmark: get_stats (view) ──
    const stylusGas4 = await stylusContract.get_stats.estimateGas();
    const solGas4 = await solGuardrail.get_stats.estimateGas();
    printRow("get_stats (view)", stylusGas4, solGas4);

    // ── Benchmark: get_user_daily_volume (view) ──
    const stylusGas5 = await stylusContract.get_user_daily_volume.estimateGas(signer.address);
    const solGas5 = await solGuardrail.get_user_daily_volume.estimateGas(signer.address);
    printRow("get_user_daily_volume (view)", stylusGas5, solGas5);

    // ── Benchmark: Batch validate (10 trades in sequence) ──
    let stylusBatch = 0n;
    let solBatch = 0n;
    for (let i = 0; i < 10; i++) {
        const col = ethers.parseUnits(String(10 + i * 5), 18);
        stylusBatch += await stylusContract.validate_trade.estimateGas(signer.address, btcHashNum, col, leverage);
        solBatch += await solGuardrail.validate_trade.estimateGas(signer.address, btcHashNum, col, leverage);
    }
    printRow("batch 10x validate_trade", stylusBatch, solBatch);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

function printRow(label, stylusGas, solGas) {
    const savings = Number(solGas - stylusGas) * 100 / Number(solGas);
    const savingsStr = savings > 0 ? `${savings.toFixed(0)}%` : `+${(-savings).toFixed(0)}%`;
    console.log(`  ${label.padEnd(30)}│ ${String(stylusGas).padEnd(14)} │ ${String(solGas).padEnd(14)} │ ${savingsStr}`);
}

main().catch(console.error);
