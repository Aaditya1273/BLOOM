/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║   DEPLOY: AuraIntelligenceVault → Robinhood Chain (Testnet)      ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   npx hardhat run scripts/deploy-intelligence-vault.js --network robinhoodTestnet
 *
 * Steps:
 *   1. Deploy AuraIntelligenceVault (ERC-4626) with aUSD as underlying
 *   2. Configure guardrail, whitelist protocols, approve selectors
 *   3. Grant AI_EXECUTOR_ROLE to the backend agent wallet
 */

const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  Deploying AuraIntelligenceVault             ║");
    console.log("╚══════════════════════════════════════════════╝");
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  Network:  ${(await ethers.provider.getNetwork()).name}`);
    console.log(`  Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    // ── Configuration ─────────────────────────────────────────
    const AUSD_ADDRESS = process.env.AUSD_ADDRESS || "0x359961489f069F16E5dbA46d9b174bBF7b25147B";
    const STYLUS_GUARDRAIL = process.env.AURA_GUARDRAIL_ADDRESS || ethers.ZeroAddress;
    const SYNTHRA_ROUTER = process.env.ROUTER_ADDRESS || "0x63110251e8C487bAb7f77861F230E2251Bd86335";

    // The agent wallet address (reads from .aura_agent_key or PRIVATE_KEY)
    const AGENT_ADDRESS = process.env.AGENT_ADDRESS || deployer.address;

    // ── Step 1: Deploy Vault ──────────────────────────────────
    console.log("📦 Deploying AuraIntelligenceVault...");
    const Vault = await ethers.getContractFactory("AuraIntelligenceVault");
    const vault = await Vault.deploy(
        AUSD_ADDRESS,
        deployer.address,       // admin
        STYLUS_GUARDRAIL        // Stylus guardrail (can be address(0))
    );
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log(`  ✅ Vault deployed at: ${vaultAddr}\n`);

    // ── Step 2: Grant AI Executor Role ────────────────────────
    const AI_EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AI_EXECUTOR_ROLE"));
    console.log(`🔑 Granting AI_EXECUTOR_ROLE to: ${AGENT_ADDRESS}`);
    const tx1 = await vault.grantRole(AI_EXECUTOR_ROLE, AGENT_ADDRESS);
    await tx1.wait();
    console.log("  ✅ Role granted.\n");

    // ── Step 3: Whitelist Protocols ───────────────────────────
    console.log("📋 Whitelisting protocols...");

    // Whitelist Synthra Router (DEX)
    const tx2 = await vault.whitelistProtocol(SYNTHRA_ROUTER, true);
    await tx2.wait();
    console.log(`  ✅ Synthra Router: ${SYNTHRA_ROUTER}`);

    // Whitelist aUSD for token operations
    const tx3 = await vault.whitelistProtocol(AUSD_ADDRESS, true);
    await tx3.wait();
    console.log(`  ✅ aUSD: ${AUSD_ADDRESS}\n`);

    // ── Step 4: Approve Function Selectors ────────────────────
    console.log("🔧 Approving function selectors...");

    const selectors = [
        { name: "approve(address,uint256)", sig: "0x095ea7b3" },
        { name: "transfer(address,uint256)", sig: "0xa9059cbb" },
        { name: "execute(bytes,bytes[],uint256)", sig: "0x3693d8a0" },
    ];

    for (const sel of selectors) {
        // Approve for Synthra Router
        const tx = await vault.approveSelector(SYNTHRA_ROUTER, sel.sig, true);
        await tx.wait();
        console.log(`  ✅ ${sel.name} → Synthra Router`);
    }

    // Approve ERC-20 selectors on aUSD
    const erc20Selectors = ["0x095ea7b3", "0xa9059cbb"];
    for (const sig of erc20Selectors) {
        const tx = await vault.approveSelector(AUSD_ADDRESS, sig, true);
        await tx.wait();
    }
    console.log(`  ✅ ERC-20 ops → aUSD\n`);

    // ── Summary ───────────────────────────────────────────────
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  🎉 Deployment Complete!                     ║");
    console.log("╠══════════════════════════════════════════════╣");
    console.log(`║  Vault:     ${vaultAddr}`);
    console.log(`║  Asset:     ${AUSD_ADDRESS}`);
    console.log(`║  Guardrail: ${STYLUS_GUARDRAIL}`);
    console.log(`║  Executor:  ${AGENT_ADDRESS}`);
    console.log("╚══════════════════════════════════════════════╝");
    console.log("\n📝 Add to your .env:");
    console.log(`INTELLIGENCE_VAULT_ADDRESS=${vaultAddr}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
