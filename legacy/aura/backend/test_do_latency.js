require('dotenv').config();
const { ChatOpenAI } = require("@langchain/openai");
const { performance } = require('perf_hooks');

const apiKey = process.env.DO_API_KEY;

if (!apiKey) {
    console.error("❌ DO_API_KEY est introuvable. Ajoutez-le dans votre fichier .env.");
    process.exit(1);
}

// Liste des modèles à tester, triée par ordre croissant de prix d'input
const models = [
    { id: "openai-gpt-5-nano", name: "GPT-5 Nano", costIn: 0.05, costOut: 0.40 },
    { id: "openai-gpt-oss-20b", name: "GPT OSS 20B", costIn: 0.05, costOut: 0.45 },
    { id: "openai-gpt-oss-120b", name: "GPT OSS 120B", costIn: 0.10, costOut: 0.70 },
    { id: "deepseek-4-flash", name: "DeepSeek V4 Flash", costIn: 0.14, costOut: 0.28 },
    { id: "openai-gpt-4o-mini", name: "GPT-4o Mini", costIn: 0.15, costOut: 0.60 },
    { id: "gemma-4-31B-it", name: "Gemma 4 31B", costIn: 0.18, costOut: 0.50 },
    { id: "openai-gpt-5.4-nano", name: "GPT-5.4 Nano", costIn: 0.20, costOut: 1.25 },
    { id: "mistral-3-14B", name: "Mistral 3 14B", costIn: 0.20, costOut: 0.20 },
    { id: "nemotron-nano-12b-v2-vl", name: "Nemotron Nano 12B", costIn: 0.20, costOut: 0.60 },
    { id: "minimax-m2.5", name: "MiniMax M2.5", costIn: 0.21, costOut: 0.84 },
    { id: "arcee-trinity-large-thinking", name: "Arcee Trinity", costIn: 0.25, costOut: 0.90 },
    { id: "llama-4-maverick", name: "Llama 4 Maverick", costIn: 0.25, costOut: 0.87 },
    { id: "alibaba-qwen3-32b", name: "Qwen3 32B", costIn: 0.25, costOut: 0.55 },
    { id: "openai-gpt-5-mini", name: "GPT-5 Mini", costIn: 0.25, costOut: 2.00 },
    { id: "nvidia-nemotron-3-super-120b", name: "Nemotron 3 Super", costIn: 0.30, costOut: 0.65 },
    { id: "kimi-k2.5", name: "Kimi K2.5", costIn: 0.35, costOut: 1.89 },
    { id: "deepseek-3.2", name: "DeepSeek 3.2", costIn: 0.42, costOut: 1.36 },
    { id: "qwen3-coder-flash", name: "Qwen3 Coder Flash", costIn: 0.45, costOut: 1.70 },
    { id: "nemotron-3-nano-omni", name: "Nemotron 3 Nano", costIn: 0.50, costOut: 0.90 },
    { id: "qwen3.5-397b-a17b", name: "Qwen 3.5 397B", costIn: 0.55, costOut: 3.50 },
    { id: "llama3.3-70b-instruct", name: "Llama 3.3 70B", costIn: 0.65, costOut: 0.65 }
];

const testPrompt = `
You are a trading agent. A user wants to swap 1 ETH for AMZN.
The current price of ETH is $3000, and AMZN is $150.
Provide ONLY a raw JSON response exactly in this format:
{"action":"SWAP", "token_in":"ETH", "token_out":"AMZN", "amount_in": 1, "expected_out": 20}
Do not include any explanation or markdown formatting like \`\`\`json.
`;

async function testLatency() {
    console.log("================================================");
    console.log("🚀 Benchmark de Latence des Modèles DigitalOcean");
    console.log("================================================");
    console.log("Prompt utilisé (Taille : ~75 mots) : test de réponse JSON courte.\\n");

    const results = [];

    for (const model of models) {
        console.log(`Test du modèle : ${model.name} (${model.id})...`);
        
        const llm = new ChatOpenAI({
            apiKey: apiKey,
            modelName: model.id,
            temperature: 0,
            configuration: {
                baseURL: "https://inference.do-ai.run/v1",
            },
        });

        const start = performance.now();
        let success = false;
        let answer = "";
        let errorMsg = "";

        try {
            const response = await llm.invoke([{ role: "user", content: testPrompt }]);
            answer = response.content;
            success = true;
        } catch (error) {
            errorMsg = error.message;
        }
        
        const end = performance.now();
        const latencyMs = Math.round(end - start);

        // Validation JSON basique
        let isValidJSON = false;
        if (success) {
            try {
                JSON.parse(answer.trim());
                isValidJSON = true;
            } catch (e) {
                isValidJSON = false;
            }
        }

        results.push({
            "Modèle": model.name,
            "Latence (ms)": success ? latencyMs : "Erreur",
            "JSON Valide": success ? (isValidJSON ? "✅ Oui" : "❌ Non") : "-",
            "Coût In ($/M)": model.costIn,
            "Coût Out ($/M)": model.costOut,
            "ID": model.id
        });

        if (!success) {
            console.log(`❌ Échec (${latencyMs}ms) : ${errorMsg.split('\n')[0]}`);
        } else {
            console.log(`✅ Succès (${latencyMs}ms) | JSON: ${isValidJSON}`);
        }
    }

    console.log("\n================================================");
    console.log("📊 RÉSULTATS DU BENCHMARK");
    console.log("================================================");
    console.table(results);
    console.log("\n💡 Conseil pour l'Arène IA :");
    console.log("- Pour le 'Degen' (Rapide/Fréquent) : Choisissez un modèle < 500ms et < $0.10/M (ex: openai-gpt-5-nano ou deepseek-4-flash)");
    console.log("- Pour le 'Conservateur' (Fiable) : Choisissez un modèle qui sort toujours du JSON Valide avec un prix modéré (ex: mistral-3-14B ou alibaba-qwen3-32b)");
    console.log("- Pour le 'Macro' (Complexe/Occasionnel) : Llama 3.3 70B ou GPT-5 Mini.");
}

testLatency();
