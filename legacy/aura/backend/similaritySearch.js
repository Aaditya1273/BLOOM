const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const GCP_DB_URL = process.env.GCP_DB_URL || "postgresql://postgres:postgres@localhost:5432/aura_db";

async function getMostSimilarHistoricalDays(coin, currentFear, currentReturn, currentVolatility, currentDominance, limit = 3) {
    const client = new Client({
        connectionString: GCP_DB_URL,
        ssl: { rejectUnauthorized: false } // Required by GCP
    });

    try {
        await client.connect();

        const currentVec = [
            Number((currentFear / 100.0).toFixed(4)),
            Number(currentReturn.toFixed(4)),
            Number(currentVolatility.toFixed(4)),
            Number((currentDominance / 100.0).toFixed(4))
        ];
        const vecStr = `[${currentVec.join(',')}]`;

        const query = `
            SELECT date, fear_greed_score, asset_return_1d, outcome_label, outcome_return_48h,
                   context_vector <-> $1 AS distance
            FROM market_history
            WHERE coin = $2
            ORDER BY distance ASC
            LIMIT $3;
        `;

        const res = await client.query(query, [vecStr, coin, limit]);

        let contextPrompt = "[HISTORICAL MARKET PATTERNS (LONG-TERM MEMORY)]\n";
        contextPrompt += `The current market vector is highly similar to the following historical periods from the 100GB Kaggle dataset:\n`;
        
        for (const row of res.rows) {
            let dateStr = "Unknown Date";
            if (row.date) {
                try {
                    dateStr = new Date(row.date).toISOString().split('T')[0];
                } catch(e) {}
            }
            const fear = row.fear_greed_score;
            const outcome = row.outcome_label;
            const ret48h = row.outcome_return_48h;
            
            const sign = ret48h > 0 ? "+" : "";
            contextPrompt += `- On ${dateStr} (Fear: ${fear.toFixed(1)}), the market context was almost identical. `;
            contextPrompt += `In the 48 hours that followed, the market experienced a ${outcome} (${sign}${(ret48h * 100).toFixed(2)}%).\n`;
        }
        
        contextPrompt += "INSTRUCTION: Use these historical precedents to predict if the current setup is a trap or a real breakout. Do not bet against strong historical statistical patterns.\n";
        
        return contextPrompt;
    } catch (err) {
        console.error("RAG Query Error:", err);
        return "[HISTORICAL MARKET PATTERNS (LONG-TERM MEMORY)]\nDatabase unavailable.";
    } finally {
        try {
            await client.end();
        } catch(e) {}
    }
}

module.exports = { getMostSimilarHistoricalDays };
