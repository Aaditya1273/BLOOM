const hre = require("hardhat");
const { ethers } = hre;

async function main() {
    console.log("\n===================================================================");
    console.log("🛡️  AURA DEFENSE IN DEPTH: STYLUS GUARDRAIL DEMO (ROBINHOOD CHAIN)");
    console.log("===================================================================\n");

    const [admin, aiAgent, user] = await ethers.getSigners();

    // 1. Deploy Mocks & Vault
    console.log("📦 1. Deploying Core Contracts...");
    const Asset = await ethers.getContractFactory("aUSD");
    const asset = await Asset.deploy();
    
    const MockGuardrail = await ethers.getContractFactory("MockVaultGuardrail");
    const guardrail = await MockGuardrail.deploy();

    const Vault = await ethers.getContractFactory("AuraIntelligenceVault");
    const vault = await Vault.deploy(asset.target, admin.address, guardrail.target);

    // 2. Setup Roles and Balances
    console.log("⚙️  2. Configuring AI Agent Role & User Deposits...");
    const AI_EXECUTOR_ROLE = await vault.AI_EXECUTOR_ROLE();
    await vault.grantRole(AI_EXECUTOR_ROLE, aiAgent.address);

    await asset.mint(user.address, ethers.parseEther("100000"));
    await asset.connect(user).approve(vault.target, ethers.parseEther("100000"));
    await vault.connect(user).deposit(ethers.parseEther("100000"), user.address);

    const initialAssets = await vault.totalAssets();
    console.log(`\n💰 Vault TVL: $${ethers.formatEther(initialAssets)} aUSD (Funds are Safe)\n`);

    // 3. Setup malicious target (e.g., an unauthorized or risky DeFi protocol)
    const Target = await ethers.getContractFactory("MockDapp");
    const maliciousTarget = await Target.deploy();
    
    // Whitelist it so Layer 1 Solidity check passes (simulate a compromised whitelist or complex attack)
    await vault.whitelistProtocol(maliciousTarget.target, true);
    
    // Approve a selector so Layer 1 selector check passes
    const maliciousCalldata = maliciousTarget.interface.encodeFunctionData("testCall", []);
    const maliciousSelector = maliciousCalldata.substring(0, 10);
    await vault.approveSelector(maliciousTarget.target, maliciousSelector, true);

    console.log("🤖 [AI AGENT]: Analyzing market sentiment via LangGraph...");
    console.log("🤖 [AI AGENT]: Found opportunity. Proposing strategy on Target Protocol...");
    console.log(`   └─ Target: ${maliciousTarget.target}`);
    console.log(`   └─ Action: DRAIN_VAULT (Simulated malicious payload)`);

    // 4. Configure Stylus Guardrail to detect the anomaly and reject
    // Simulating deep calldata analysis by the Rust WASM module
    await guardrail.setRejectAll(true);
    // 0x04 = BEHAVIORAL_ANOMALY
    await guardrail.setRejectionReason(ethers.zeroPadValue("0x04", 32)); 

    console.log("\n🔎 [STYLUS GUARDRAIL (Layer 2 WASM)]: Intercepting calldata stream...");
    console.log("🔎 [STYLUS GUARDRAIL (Layer 2 WASM)]: Analyzing execution graph & behavioral risk...");
    console.log("🔎 [STYLUS GUARDRAIL (Layer 2 WASM)]: ⚠️  ANOMALY DETECTED IN CALLDATA\n");
    
    // 5. Execute and Catch
    try {
        console.log("⚡ Broadcasting AI transaction to Arbitrum Orbit...");
        await vault.connect(aiAgent).executeStrategy(maliciousTarget.target, maliciousCalldata, 50);
        console.log("❌ Execution Succeeded (THIS SHOULD NOT HAPPEN)");
    } catch (error) {
        console.log("\n🚨 =================== REJECTION INTERCEPTED =================== 🚨");
        if (error.message.includes("StylusGuardrailRejected")) {
            console.log("🛑 Transaction REVERTED by Stylus Guardrail!");
            console.log("🛑 Custom Error: StylusGuardrailRejected(bytes32 reason)");
            console.log("🛑 Reason Code:  0x0000000000000000000000000000000000000000000000000000000000000004");
            console.log("🛑 Interpretation: [CRITICAL] BEHAVIORAL_ANOMALY / EXCESSIVE_RISK");
        } else {
            console.log("🛑 Error:", error.message);
        }
        console.log("🚨 =============================================================== 🚨\n");
    }

    const finalAssets = await vault.totalAssets();
    console.log(`✅ Final Vault TVL: $${ethers.formatEther(finalAssets)} aUSD`);
    if (finalAssets === initialAssets) {
        console.log("✅ User funds are safe and untouched. Defense in depth validated.\n");
    }
}

main().catch(console.error);