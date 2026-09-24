/**
 * macroAnalyzer.js - AI-Powered Macro-Economic Sentiment Analysis
 * 
 * Uses the LLM (Qwen3.5 Plus via OrcaRouter) to analyze market context 
 * and provide sentiment scoring + strategic recommendations.
 */

const { ChatOpenAI } = require("@langchain/openai");
const dotenv = require("dotenv");
dotenv.config();

const { getMarketContext, getAllPrices } = require("./market");

const analyzerModel = new ChatOpenAI({
    apiKey: process.env.DO_API_KEY,
    modelName: "deepseek-3.2",
    temperature: 0.1,
    configuration: {
        baseURL: "https://inference.do-ai.run/v1",
    },
});

/**
 * Analyze market sentiment using LLM + real market data.
 * @param {string} targetAsset - The asset the user wants to trade (e.g., "TSLA")
 * @returns {Object} { sentiment, score, summary, recommendation, correlationWarnings }
 */
async function analyzeMacroSentiment(targetAsset) {
    try {
        const context = await getMarketContext();

        // Format news for the prompt
        const newsBlock = context.news.map((n, i) => 
            `${i + 1}. [${n.source}] "${n.title}" — ${n.description}`
        ).join("\n");

        // Format prices
        const priceBlock = Object.entries(context.prices)
            .filter(([k]) => !k.includes("_24h_change"))
            .map(([sym, price]) => {
                const change = context.prices[`${sym}_24h_change`];
                const changeStr = change ? ` (${change > 0 ? '+' : ''}${change.toFixed(2)}% 24h)` : '';
                return `  - ${sym}: $${price}${changeStr}`;
            }).join("\n");

        // Format relevant correlations for the target asset
        const relevantCorr = context.correlations
            .filter(c => c.assetA === targetAsset.toUpperCase() || c.assetB === targetAsset.toUpperCase())
            .map(c => `  - ${c.assetA}/${c.assetB}: ${c.correlation} (${c.interpretation})`)
            .join("\n");

        const prompt = `You are Aura's Macro-Economic Risk Analyst. Analyze the current market conditions and provide a sentiment assessment.

CURRENT MARKET DATA:
${priceBlock}

LATEST NEWS HEADLINES:
${newsBlock}

CORRELATIONS FOR ${targetAsset.toUpperCase()}:
${relevantCorr || "  No correlation data available."}

TARGET: The user wants to trade ${targetAsset.toUpperCase()}.

Based on the above data, provide your analysis as strict JSON:
{
  "sentiment": "<BULLISH | BEARISH | NEUTRAL>",
  "score": <integer from -100 to 100, where -100 is extremely bearish and 100 is extremely bullish>,
  "summary": "<2-3 sentence summary of the macro-economic outlook for this asset>",
  "recommendation": "<PROCEED | CAUTION | DELAY>",
  "recommendation_reason": "<1 sentence explaining the recommendation>",
  "correlation_warnings": ["<any warnings based on correlation data, empty array if none>"],
  "key_factors": ["<top 3 factors influencing the analysis>"]
}

IMPORTANT: Return ONLY raw JSON. No markdown.`;

        console.log(` Running macro sentiment analysis for ${targetAsset}...`);

        const response = await analyzerModel.invoke([{
            role: "user",
            content: prompt
        }]);

        const clean = response.content.replace(/```json/g, "").replace(/```/g, "").trim();
        const analysis = JSON.parse(clean);

        console.log(` Macro Analysis Result: ${analysis.sentiment} (Score: ${analysis.score}) - ${analysis.recommendation}`);

        return {
            ...analysis,
            timestamp: context.timestamp,
            rawPrices: context.prices,
        };

    } catch (err) {
        console.error(" Macro analysis failed:", err.message);
        // Return a neutral fallback so the system doesn't block trades
        return {
            sentiment: "NEUTRAL",
            score: 0,
            summary: "Market analysis temporarily unavailable. Proceeding with standard execution.",
            recommendation: "PROCEED",
            recommendation_reason: "Analysis service unavailable — defaulting to neutral stance.",
            correlation_warnings: [],
            key_factors: ["Analysis unavailable"],
            timestamp: new Date().toISOString(),
            rawPrices: await getAllPrices().catch(() => ({})),
        };
    }
}

/**
 * Quick sentiment check — lighter weight, used for UI display.
 * Returns just the sentiment + score without full analysis.
 */
async function getQuickSentiment() {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const apiKey = process.env.COINMARKETCAP;
        
        if (!apiKey) throw new Error("COINMARKETCAP API key missing in .env");

        const response = await fetch("https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest", {
            headers: {
                "X-CMC_PRO_API_KEY": apiKey,
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`CoinMarketCap API HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data && data.data) {
            const score = data.data.value; // e.g. 50 (0-100)
            const classification = data.data.value_classification; // e.g. "Neutral", "Greed", "Fear"
            
            // Map "Greed" to "BULLISH", "Fear" to "BEARISH", "Neutral" to "NEUTRAL"
            let sentiment = "NEUTRAL";
            if (classification.toLowerCase().includes("greed")) sentiment = "BULLISH";
            else if (classification.toLowerCase().includes("fear")) sentiment = "BEARISH";
            
            // Normalize score from (0 to 100) to (-100 to +100) for our UI
            const normalizedScore = (score - 50) * 2;
            
            return {
                sentiment: sentiment,
                score: normalizedScore,
                one_liner: `CoinMarketCap Fear & Greed Index: ${score}/100 (${classification})`
            };
        }
        
        throw new Error("Invalid response format from CoinMarketCap");

    } catch (err) {
        console.warn(" Quick sentiment failed:", err.message);
        return {
            sentiment: "NEUTRAL",
            score: 0,
            one_liner: "Market sentiment analysis unavailable"
        };
    }
}

module.exports = { analyzeMacroSentiment, getQuickSentiment };
