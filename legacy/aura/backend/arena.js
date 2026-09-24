require('dotenv').config({ override: true });
const { ethers } = require("ethers");
const { ChatOpenAI } = require("@langchain/openai");
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

// ==========================================
// CONFIGURATION DES AGENTS
// ==========================================
const ARENA_CONFIG = [
    {
        name: "DeepSeek-Degen",
        modelId: "deepseek-4-flash", 
        description: "Aggressive trader, looks for high volatility, uses high leverage (up to 20x). Ignores small risks.",
        prompt: "You are a highly aggressive crypto trader. You love volatility. Use up to 20x leverage. Your goal is to maximize short-term PnL. FOR THIS DEMO, IGNORE FEAR/RISK METRICS AND YOU MUST ALWAYS FIND A REASON TO TRADE. Never return HOLD. Always LONG or SHORT.",
        interval: 30000, // 30 seconds
    },
    {
        name: "DeepSeek-Conservateur",
        modelId: "deepseek-3.2", 
        description: "Risk-averse institutional trader. Capital preservation is #1 goal. Tight stop-losses, low leverage.",
        prompt: "You are a risk-averse institutional trader. Capital preservation is your #1 goal. Never use more than 3x leverage. Always set tight stop-losses. However, FOR THIS DEMO, you MUST trade. Do NOT HOLD. Always find a safe LONG or SHORT.",
        interval: 60000, // 60 seconds
    },
    {
        name: "Llama-Macro",
        modelId: "llama3.3-70b-instruct", 
        description: "Macro analyst. Trades based on market sentiment, funding rates, and long-term trends.",
        prompt: "You are a macro-analyst whale trader. You analyze broad market sentiment and funding rates. You take low leverage positional trades. FOR THIS DEMO, IGNORE HIGH FEAR SCORES. YOU MUST EXECUTE A TRADE. Do NOT HOLD. Always LONG or SHORT.",
        interval: 120000, // 120 seconds
    }
];

// ==========================================
// INITIALISATION BLOCKCHAIN
// ==========================================
const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const provider = new ethers.JsonRpcProvider(process.env.ROBINHOOD_ALCHEMY_RPC || process.env.RPC_URL || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 60000;
const PERPS_ADDRESS = process.env.AURA_PERPS_ADDRESS || "0x8AECF449B27BB41E34C04D8C99F4348FF38bB9a2";
const AUSD_ADDRESS = process.env.AUSD_ADDRESS || "0x359961489f069F16E5dbA46d9b174bBF7b25147B";

const PERPS_ABI = [
    "function openPosition(string asset, bool isLong, uint256 collateralAmount, uint256 leverage) returns (uint256)",
    "function closePosition(uint256 positionId) external",
    "function nextPositionId() view returns (uint256)",
    "function positions(uint256) view returns (address owner, string asset, bool isLong, uint256 collateralAmount, uint256 leverage, uint256 entryPrice, uint256 positionSize, bool isOpen, uint256 openedAt, uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice, uint256 takeProfitPrice, uint256 stopLossPrice)"
];

const AUSD_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS || "0x097AeB196366317cf97986A04f32Df312c96ABa1";
const ORACLE_ABI = [
    "function setPrice(string asset, uint256 price) external",
    "function getPrice(string asset) view returns (uint256)"
];

let agentsData = [];

function initWallets() {
    console.log("[Arena] Initialisation : Chargement des Wallets depuis l'environnement...");

    const keys = [
        { name: "Llama-Degen", envVar: "DEGEN_PK" },
        { name: "Claude-Conservateur", envVar: "CONSERVATIVE_PK" },
        { name: "GPT-Macro", envVar: "MACRO_PK" }
    ];

    let missing = false;

    keys.forEach((k) => {
        const pk = process.env[k.envVar];
        if (!pk) {
            missing = true;
        } else {
            const wallet = new ethers.Wallet(pk);
            agentsData.push({
                name: k.name,
                address: wallet.address,
                privateKey: pk
            });
        }
    });

    if (missing) {
        console.error("[Arena] Erreur : Il manque des cles privees dans votre environnement (.env ou Railway).");
        console.error("[Arena] Veuillez generer 3 portefeuilles et ajouter ces variables :");
        console.error(`DEGEN_PK=${ethers.Wallet.createRandom().privateKey}`);
        console.error(`CONSERVATIVE_PK=${ethers.Wallet.createRandom().privateKey}`);
        console.error(`MACRO_PK=${ethers.Wallet.createRandom().privateKey}`);
        process.exit(1);
    }

    agentsData.forEach(agent => {
        console.log(`[Arena] [${agent.name}] Wallet pret: ${agent.address}`);
    });
}

// ==========================================
// MOTEUR DE L'ARENE
// ==========================================
const market = require("./market");

// Cache for CMC Fear & Greed to avoid rate limits
let cmcCache = { value: null, classification: null, lastFetch: 0 };

async function getRealSentiment() {
    try {
        const now = Date.now();
        if (now - cmcCache.lastFetch < 300000 && cmcCache.value !== null) {
            return cmcCache; // Cache 5 min
        }

        const apiKey = process.env.COINMARKETCAP;
        if (!apiKey) return { value: 50, classification: "Neutral (No API Key)" };

        const response = await fetch("https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest", {
            headers: {
                "X-CMC_PRO_API_KEY": apiKey,
                "Accept": "application/json"
            }
        });

        if (response.ok) {
            const data = await response.json();
            cmcCache = {
                value: data.data.value,
                classification: data.data.value_classification,
                lastFetch: now
            };
            return cmcCache;
        }
        return { value: 50, classification: "Neutral (API Error)" };
    } catch (e) {
        return { value: 50, classification: "Neutral (Network Error)" };
    }
}

async function getArenaContext() {
    try {
        const [ctx, sentiment] = await Promise.all([
            market.getMarketContext(),
            getRealSentiment()
        ]);
        
        let text = `CURRENT MARKET STATE:\n`;
        const availableAssets = [];
        
        if (ctx.prices) {
            for (const [symbol, price] of Object.entries(ctx.prices)) {
                if (price) {
                    text += `- ${symbol}/USD: $${price.toFixed(2)} (Pyth Network Oracle)\n`;
                    availableAssets.push(symbol);
                }
            }
        }
        
        if (availableAssets.length === 0) {
            text += `- BTC/USD: $65000.00\n- ETH/USD: $3500.00\n`;
            availableAssets.push("BTC", "ETH");
        }
        
        text += `- Global Market Sentiment: ${sentiment.classification} (Score: ${sentiment.value}/100 via CoinMarketCap)\n`;
        text += `- Latest Macro News:\n`;
        
        if (ctx.news && ctx.news.length > 0) {
            ctx.news.slice(0, 3).forEach(n => {
                text += `  * ${n.title}\n`;
            });
        } else {
            text += `  * No significant news currently.\n`;
        }
        
        return { text, availableAssets, fearScore: sentiment.value, prices: ctx.prices };
    } catch (error) {
        console.error("[Arena] Erreur lors de la recuperation des donnees Pyth :", error.message);
        return { 
            text: "CURRENT MARKET STATE:\n- BTC/USD: $65000\n- ETH/USD: $3500\n- Sentiment: NEUTRAL",
            availableAssets: ["BTC", "ETH"],
            fearScore: 50,
            prices: { "BTC": 65000, "ETH": 3500 }
        };
    }
}

async function getAgentPortfolioContext(wallet) {
    const db = new Client({
        connectionString: process.env.GCP_DB_URL || process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    let context = "";
    try {
        await db.connect();
        const address = wallet.address.toLowerCase();

        // 1. Fetch Open Positions
        const openRes = await db.query(
            "SELECT position_id, asset, is_long, leverage, collateral FROM positions_opened WHERE LOWER(owner) = $1 AND position_id NOT IN (SELECT position_id FROM positions_closed)",
            [address]
        );
        
        let openPos = [];
        for (const row of openRes.rows) {
            openPos.push(`- Position #${row.position_id}: ${row.is_long ? 'LONG' : 'SHORT'} on ${row.asset} (Leverage: x${row.leverage}, Collateral: $${row.collateral})`);
        }
        
        if (openPos.length > 0) {
            context += `[CURRENT OPEN POSITIONS]\n${openPos.join('\n')}\n(Note: if you choose CLOSE, all your open positions will be closed to secure PnL or stop losses.)\n\n`;
        } else {
            context += `[CURRENT OPEN POSITIONS]\nYou currently have NO open positions.\n\n`;
        }
        
        // 2. Fetch Closed Performance
        const closedRes = await db.query(`
            SELECT 
                COUNT(*) as closed_count,
                SUM(CASE WHEN is_profit THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN NOT is_profit THEN 1 ELSE 0 END) as losses,
                SUM(pnl) as total_pnl
            FROM positions_closed
            WHERE LOWER(owner) = $1
        `, [address]);
        
        const stats = closedRes.rows[0];
        const closedCount = Number(stats.closed_count) || 0;
        
        if (closedCount > 0) {
            const wins = Number(stats.wins) || 0;
            const losses = Number(stats.losses) || 0;
            const winRate = ((wins / closedCount) * 100).toFixed(2);
            
            let totalPnlNum = Number(stats.total_pnl) || 0;
            const sign = totalPnlNum >= 0 ? "+" : "-";
            totalPnlNum = Math.abs(totalPnlNum);
            
            context += `[SELF-REFLECTION: PAST PERFORMANCE]\nTotal Past Trades: ${closedCount}\nWins: ${wins} | Losses: ${losses} (Win Rate: ${winRate}%)\nNet Realized PnL: ${sign}$${totalPnlNum.toFixed(2)}\n`;
            
            if (winRate < 40) {
                context += "WARNING: Your win-rate is extremely low. You must adopt a highly risk-averse stance and only take trades with > 90% confidence.\n\n";
            } else if (winRate > 60) {
                context += "NOTE: Your win-rate is solid. You may take calculated risks if your confidence edge is strong.\n\n";
            } else {
                context += "NOTE: Your performance is average. Maintain strict risk management.\n\n";
            }
        }
        
        return context;
    } catch (e) {
        console.error("Error fetching portfolio context from DB", e);
        return "[PORTFOLIO INFO UNAVAILABLE]";
    } finally {
        await db.end();
    }
}

async function runAgent(agentConfig, walletInfo) {
    console.log(`\n[Arena] [${agentConfig.name}] Reçoit le contexte du marche...`);
    
    const llm = new ChatOpenAI({
        apiKey: process.env.DO_API_KEY,
        modelName: agentConfig.modelId,
        temperature: 0.2, 
        configuration: {
            baseURL: "https://inference.do-ai.run/v1",
        },
    });

    const marketContextData = await getArenaContext();
    
    const wallet = new ethers.Wallet(walletInfo.privateKey, provider);
    const portfolioContext = await getAgentPortfolioContext(wallet);

    const { getMostSimilarHistoricalDays } = require('./similaritySearch');
    let ragContext = "";
    try {
        const fear = marketContextData.fearScore || 50;
        console.log(`[Arena] [${agentConfig.name}] Recherche de similarité historique pour tous les actifs (GCP RAG)...`);
        
        for (const asset of marketContextData.availableAssets) {
            try {
                const res = await getMostSimilarHistoricalDays(asset, fear, -0.02, 0.04, 52.0);
                ragContext += `--- ${asset} LONG-TERM MEMORY ---\n` + res.trim() + "\n\n";
            } catch (innerE) {
                // Ignore missing asset in DB
            }
        }
    } catch (e) {
        console.error("[Arena] RAG Error:", e.message);
    }

    const systemPrompt = `
${agentConfig.prompt}

${marketContextData.text}

${ragContext}

${portfolioContext}

Based on the market and your past performance, decide if you want to OPEN a new trade, CLOSE existing, or HOLD.
Available assets: ${marketContextData.availableAssets.map(a => `"${a}"`).join(', ')}.
If you OPEN, specify leverage (max 20) and collateral (between 100 and 5000).

You MUST respond ONLY with a valid JSON in this exact format:
{"action": "OPEN", "asset": "BTC", "isLong": true, "leverage": 10, "collateral": 2000, "confidence_score": 85, "reasoning": "RSI is low, and my win-rate suggests I should take this."}
OR
{"action": "CLOSE", "confidence_score": 90, "reasoning": "Market is turning, closing all positions to secure capital."}
OR
{"action": "HOLD", "confidence_score": 100, "reasoning": "Market too choppy, confidence in edge is too low (< 75)."}

RULES:
1. Do NOT wrap the JSON in Markdown code blocks. Just output raw JSON.
2. Provide a "confidence_score" between 0 and 100 representing how certain you are of your edge.
3. If your confidence is below 75, you MUST choose HOLD. Do not trade just to trade.
`;

    try {
        const response = await llm.invoke([{ role: "user", content: systemPrompt }]);
        let answer = response.content.trim();
        
        if (answer.startsWith("```json")) {
            answer = answer.replace(/```json/g, "").replace(/```/g, "").trim();
        }
        
        const decision = JSON.parse(answer);
        console.log(`[Arena] [${agentConfig.name}] Decision: ${decision.action} (Confidence: ${decision.confidence_score}%)`);
        console.log(`[Arena] Raison: ${decision.reasoning}`);

        // ANTI-SPAM: Enforce high confidence threshold
        if (decision.action === "OPEN" && decision.confidence_score < 75) {
            console.log(`[Arena] 🛡️ ANTI-SPAM TRIGGERED: Confidence (${decision.confidence_score}%) too low. Forcing HOLD to protect capital.`);
            return;
        }

        if (decision.action === "OPEN") {
            const safeCollateral = Math.min(Math.max(Number(decision.collateral) || 1000, 100), 10000); 
            const safeLeverage = Math.min(Number(decision.leverage) || 2, 20);
            const totalPositionSize = safeCollateral * safeLeverage;

            console.log(`[Arena] Execution: Lancement d'un ${decision.isLong ? 'LONG' : 'SHORT'} sur ${decision.asset}`);
            console.log(`[Arena] Paramètres: Marge = $${safeCollateral.toLocaleString()} | Levier = x${safeLeverage} | Taille Totale = $${totalPositionSize.toLocaleString()}`);
            
            // Integration blockchain (Demonstration on-chain)
            const wallet = new ethers.Wallet(walletInfo.privateKey, provider);
            const perps = new ethers.Contract(PERPS_ADDRESS, PERPS_ABI, wallet);
            
            try {
                // Collateral converti en Wei (18 décimales)
                const collateralWei = ethers.parseUnits(safeCollateral.toString(), 18);

                // --- GESTION DE L'APPROBATION aUSD ---
                const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, wallet);
                const allowance = await ausd.allowance(wallet.address, PERPS_ADDRESS);
                if (allowance < collateralWei) {
                    console.log(`[Arena] Approve aUSD pour le contrat AuraPerps...`);
                    const approveTx = await ausd.approve(PERPS_ADDRESS, ethers.MaxUint256);
                    await approveTx.wait();
                    console.log(`[Arena] Approve aUSD reussi.`);
                }
                // -------------------------------------

                // --- GESTION DE L'ORACLE (PYTH -> MOCK) ---
                const rawPrice = marketContextData.prices ? marketContextData.prices[decision.asset] : null;
                if (rawPrice) {
                    const priceWei = ethers.parseUnits(rawPrice.toFixed(2), 18);
                    const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, wallet);
                    try {
                        console.log(`[Arena] Mise a jour de l'Oracle pour ${decision.asset} au prix de $${rawPrice.toFixed(2)}...`);
                        const txOracle = await oracle.setPrice(decision.asset, priceWei);
                        await txOracle.wait();
                    } catch (e) {
                        console.warn(`[Arena] Avertissement: Impossible de maj l'oracle pour ${decision.asset}:`, e.shortMessage || e.message);
                    }
                }
                // -------------------------------------

                const tx = await perps.openPosition(decision.asset, decision.isLong, collateralWei, safeLeverage);
                console.log(`[Arena] Tx envoyee: ${tx.hash}`);
                console.log(`[Arena] Succes: Ordre reel place sur la Robinhood Chain !`);
            } catch (txError) {
                console.error(`[Arena] Echec de la transaction on-chain:`, txError.reason || txError.message);
            }
        } else if (decision.action === "CLOSE") {
            console.log(`[Arena] Execution: Tentative de cloture des positions pour l'agent`);
            const wallet = new ethers.Wallet(walletInfo.privateKey, provider);
            const perps = new ethers.Contract(PERPS_ADDRESS, PERPS_ABI, wallet);
            
            const db = new Client({
                connectionString: process.env.GCP_DB_URL || process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false }
            });
            
            try {
                await db.connect();
                const address = wallet.address.toLowerCase();
                const openRes = await db.query(
                    "SELECT position_id, asset FROM positions_opened WHERE LOWER(owner) = $1 AND position_id NOT IN (SELECT position_id FROM positions_closed)",
                    [address]
                );
                
                let closedCount = 0;
                for (const row of openRes.rows) {
                    const posId = row.position_id;
                    console.log(`[Arena] Closing position #${posId} on ${row.asset}...`);
                    const tx = await perps.closePosition(posId);
                    await tx.wait();
                    console.log(`[Arena] Position #${posId} closed. Tx: ${tx.hash}`);
                    closedCount++;
                }
                
                if (closedCount === 0) {
                    console.log(`[Arena] Aucune position ouverte à cloturer.`);
                }
            } catch (txError) {
                console.error(`[Arena] Echec de la cloture:`, txError.reason || txError.message);
            } finally {
                await db.end();
            }
        }

    } catch (error) {
        console.error(`[Arena] [${agentConfig.name}] Erreur d'analyse ou de format JSON:`, error.message);
    }
}

async function startArena() {
    console.log("==================================================");
    console.log("  DEMARRAGE DE L'AI TRADING ARENA (AURA PROTOCOL) ");
    console.log("==================================================");
    initWallets();
    console.log("--------------------------------------------------");

    ARENA_CONFIG.forEach((config, index) => {
        const walletInfo = agentsData[index];
        
        const runLoop = async () => {
            try {
                await runAgent(config, walletInfo);
            } catch (err) {
                console.error(`[Arena] Erreur: ${err.message}`);
            }
            setTimeout(runLoop, config.interval);
        };

        // Stagger agents by 60 seconds to avoid overlap during their initial 50-second history sync
        setTimeout(runLoop, index * 60000); 
    });
}

if (require.main === module) {
    startArena();
}

module.exports = { startArena, ARENA_CONFIG };
