const { ChatOpenAI } = require("@langchain/openai");
const dotenv = require("dotenv");
const { ethers } = require("ethers");
const { analyzeMacroSentiment } = require("./macroAnalyzer");

dotenv.config();

// ═══════════════════════════════════════════════════════════════
//                     CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const VAULT_CONFIG = {
    // Protocol addresses on Robinhood Chain
    // Hardcoded to bypass wrong .env configurations where ROUTER_ADDRESS points to LOB router
    SYNTHRA_ROUTER: "0x6F308B834595312f734e65e273F2210f43Fc48F8",
    AUSD_ADDRESS: process.env.AUSD_ADDRESS || "0x50a8Ecee8B72A21F33847FD44cC491B1dD338aE0",
    WETH: "0x33e4191705c386532ba27cBF171Db86919200B94",

    // Known tokens for allocation strategies
    TOKENS: {
        WETH: "0x33e4191705c386532ba27cBF171Db86919200B94",
        TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
        AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
        NFLX: "0x4e464c5800000000000000000000000000000000",
        AMD:  "0x71178BAc73cBeb415514eB542a8995b82669778d",
        PLTR: "0x504c545200000000000000000000000000000000",
        BTC:  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
        USDC: "0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F",
        SYN:  "0xC5124C846c6e6307986988dFb7e743327aA05F19"
    }
};

const VAULT_ABI = [
    "function executeStrategy(address target, bytes data, uint256 riskScore) external",
    "function deployCapital(address target, uint256 amount, bytes data, uint256 riskScore) external",
    "function totalAssets() view returns (uint256)",
    "function idleCapital() view returns (uint256)",
    "function strategyNonce() view returns (uint256)",
    "event StrategyExecuted(uint256 indexed nonce, address indexed executor, address indexed target, uint256 riskScore, uint256 value, bool success)"
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const ROUTER_ABI = [
    "function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable"
];

// ═══════════════════════════════════════════════════════════════
//                     AI MODELS
// ═══════════════════════════════════════════════════════════════

const analystModel = new ChatOpenAI({
    apiKey: process.env.DO_API_KEY,
    modelName: "openai-gpt-oss-120b",
    configuration: { baseURL: "https://inference.do-ai.run/v1" },
    temperature: 0.2,
});

const riskOfficerModel = new ChatOpenAI({
    apiKey: process.env.DO_API_KEY,
    modelName: "openai-gpt-oss-120b",
    configuration: { baseURL: "https://inference.do-ai.run/v1" },
    temperature: 0,
});

// ═══════════════════════════════════════════════════════════════
//                     CORE LOGIC
// ═══════════════════════════════════════════════════════════════

async function askAI(model, prompt) {
    try {
        const response = await model.invoke([{
            role: "user",
            content: prompt + " \nIMPORTANT: Return ONLY raw JSON. No markdown. No explanations."
        }]);
        const clean = response.content.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(clean);
    } catch (e) {
        console.error(" AI failure:", e.message);
        throw e;
    }
}

/**
 * Strategy 1: Rebalance Portfolio
 * Analyzes market and vault idle capital to deploy to yields or swaps.
 */
async function generateRebalanceStrategy(vaultState, macroSentiment) {
    console.log(" [Analyst Agent] Analyzing market conditions...");
    
    const prompt = `You are the Aura Vault Analyst. 
    Current Vault State:
    - TVL: ${vaultState.tvl} aUSD
    - Idle: ${vaultState.idle} aUSD
    - Current Macro Sentiment for ETH: ${macroSentiment.sentiment} (Score: ${macroSentiment.score}/100)
    
    Available Assets: ${JSON.stringify(VAULT_CONFIG.TOKENS)}
    Available Protocols: 
    - Synthra Router (DEX): ${VAULT_CONFIG.SYNTHRA_ROUTER}
    
    Objective: Propose an allocation strategy.
    
    If sentiment is BULLISH (>50), consider swapping idle aUSD for tokens (WETH, BTC, TSLA).
    If sentiment is BEARISH (< -50), consider staying in idle aUSD.
    
    Return a list of proposed actions.
    Example: [{"action": "SWAP", "token": "WETH", "percentage_of_vault": 10}]
    
    Return strict JSON list of actions.`;

    const proposals = await askAI(analystModel, prompt);
    return proposals;
}

/**
 * Risk Audit for Proposed Strategies
 */
async function auditStrategy(proposals, vaultState) {
    console.log(" [Risk Officer] Validating proposal...");
    
    const prompt = `You are the Aura Risk Officer. Audit the following proposed vault actions:
    ${JSON.stringify(proposals)}
    
    Vault Constraints:
    - Max Protocol Exposure: 40%
    - Max Risk Score: 70
    - TVL: ${vaultState.tvl}
    
    Evaluate the overall risk score (0-100).
    If it's too risky, set "approved": false.
    
    Return JSON: {"approved": true, "riskScore": 35, "rationale": "..."}`;

    return await askAI(riskOfficerModel, prompt);
}

/**
 * Encode strategies for the on-chain vault
 */
function encodeVaultActions(proposals, vaultState) {
    console.log(" [Encoder] Generating on-chain calldata...");
    const vaultIface = new ethers.Interface(VAULT_ABI);
    const erc20Iface = new ethers.Interface(ERC20_ABI);
    const routerIface = new ethers.Interface(ROUTER_ABI);
    
    const encodedActions = [];

    for (const prop of proposals) {
        if (prop.action === "SWAP") {
            let amountAUSD = (BigInt(vaultState.tvl_raw) * BigInt(prop.percentage_of_vault)) / 100n;
            
            // Safety cap: take into account liquidity size (pool is ~11k aUSD)
            // Max 500 aUSD per swap to avoid high slippage
            const MAX_SWAP_SIZE = ethers.parseEther("500");
            if (amountAUSD > MAX_SWAP_SIZE) {
                amountAUSD = MAX_SWAP_SIZE;
            }

            if (amountAUSD === 0n) continue;

            const tokenOut = VAULT_CONFIG.TOKENS[prop.token];
            if (!tokenOut) continue;

            // 1. Approve aUSD to Router
            const approveData = erc20Iface.encodeFunctionData("approve", [VAULT_CONFIG.SYNTHRA_ROUTER, amountAUSD]);
            encodedActions.push({
                target: VAULT_CONFIG.AUSD_ADDRESS,
                data: approveData,
                description: `Approve Router for swap (${prop.token})`
            });

            // 2. Execute Swap on Router
            // Path: aUSD -> WETH -> TokenOut (or just aUSD -> WETH)
            const path = prop.token === "WETH" 
                ? ethers.solidityPacked(["address", "uint24", "address"], [VAULT_CONFIG.AUSD_ADDRESS, 3000, VAULT_CONFIG.WETH])
                : ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [VAULT_CONFIG.AUSD_ADDRESS, 3000, VAULT_CONFIG.WETH, 3000, tokenOut]);
            
            const swapInput = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "uint256", "bytes", "bool"],
                [process.env.INTELLIGENCE_VAULT_ADDRESS, amountAUSD, 0, path, false]
            );

            const routerData = routerIface.encodeFunctionData("execute", ["0x00", [swapInput], Math.floor(Date.now()/1000) + 3600]);
            encodedActions.push({
                target: VAULT_CONFIG.SYNTHRA_ROUTER,
                data: routerData,
                description: `Swap ${prop.percentage_of_vault}% vault (${ethers.formatUnits(amountAUSD, 18)} aUSD → ${prop.token})`
            });
        }
    }
    
    return encodedActions;
}

/**
 * Main function for manual or API trigger
 */
async function runAuraFundManager(vaultAddr, provider) {
    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
    
    // 1. Get Macro Sentiment
    const macroSentiment = await analyzeMacroSentiment("ETH");
    
    // 2. Get Vault State
    const [tvl_raw, idle_raw] = await Promise.all([
        vault.totalAssets(),
        vault.idleCapital()
    ]);
    const vaultState = {
        tvl_raw: tvl_raw.toString(),
        tvl: ethers.formatUnits(tvl_raw, 18),
        idle: ethers.formatUnits(idle_raw, 18)
    };

    if (parseFloat(vaultState.idle) < 1) {
        return { status: "skipped", message: "Insufficient idle capital" };
    }

    // 3. AI Analyst proposes
    const proposals = await generateRebalanceStrategy(vaultState, macroSentiment);
    if (!proposals || proposals.length === 0) {
        return { status: "skipped", message: "No rebalancing needed" };
    }

    // 4. AI Risk Officer audits
    const audit = await auditStrategy(proposals, vaultState);
    if (!audit.approved) {
        return { status: "rejected", riskScore: audit.riskScore, rationale: audit.rationale };
    }

    // 5. Encoder generates calldata
    const encodedStrategies = encodeVaultActions(proposals, vaultState);
    
    return {
        status: "approved",
        proposals,
        audit,
        encodedStrategies
    };
}

/**
 * Executes strategies on-chain
 */
async function executeStrategiesOnChain(actions, vaultAddr, signer) {
    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
    const results = [];

    for (const action of actions) {
        try {
            console.log(` [Executor] Sending: ${action.description}...`);
            // We use a risk score from the audit, or a default safe one for the individual action
            const tx = await vault.executeStrategy(action.target, action.data, 30, {
                gasLimit: 1000000
            });
            const receipt = await tx.wait();
            console.log(`    Success! Hash: ${tx.hash}`);
            results.push({ description: action.description, success: true, txHash: tx.hash });
        } catch (err) {
            console.error(`    Failed: ${err.message}`);
            results.push({ description: action.description, success: false, error: err.message });
        }
    }
    return results;
}

/**
 * Reads current vault state
 */
async function readVaultState(vaultAddr, provider) {
    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
    const [tvl, idle, nonce] = await Promise.all([
        vault.totalAssets(),
        vault.idleCapital(),
        vault.strategyNonce()
    ]);
    
    return {
        tvl: ethers.formatUnits(tvl, 18),
        idle: ethers.formatUnits(idle, 18),
        strategyCount: nonce.toString()
    };
}

// ═══════════════════════════════════════════════════════════════
//                     MAIN LOOP (STANDALONE)
// ═══════════════════════════════════════════════════════════════

async function runVaultStrategyCycle() {
    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║    AURA FUND MANAGER — Strategy Cycle  ║");
    console.log("╚══════════════════════════════════════════╝\n");

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 60000;
    const wallet = new ethers.Wallet(require("fs").readFileSync("backend/.aura_agent_key", "utf8").trim(), provider);
    const vaultAddr = process.env.INTELLIGENCE_VAULT_ADDRESS;

    try {
        const result = await runAuraFundManager(vaultAddr, provider);
        
        if (result.status === "approved" && result.encodedStrategies) {
            console.log(` [Risk Officer]  APPROVED (Risk: ${result.audit.riskScore}/100)`);
            console.log(` [Fund Manager] ${result.encodedStrategies.length} strategies ready for execution.`);
            await executeStrategiesOnChain(result.encodedStrategies, vaultAddr, wallet);
        } else {
            console.log(` [Fund Manager] Cycle finished: ${result.message || "No actions approved"}`);
        }

    } catch (e) {
        console.error(" Critical error in vault cycle:", e);
    }
}

// Export for usage in index.js
module.exports = { 
    runAuraFundManager, 
    executeStrategiesOnChain, 
    readVaultState, 
    runVaultStrategyCycle,
    VAULT_CONFIG 
};

if (require.main === module) {
    runVaultStrategyCycle();
}
