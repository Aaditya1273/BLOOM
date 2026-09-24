import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    if (!prompt) return NextResponse.json({ error: "No prompt provided" }, { status: 400 });

    const API_KEY = process.env.DO_API_KEY;

    if (!API_KEY) {
      return NextResponse.json({ response: "Simulated Action (No API Key). You asked to: " + prompt, action: {} }, { status: 200 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("https://inference.do-ai.run/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "deepseek-3.2",
          messages: [
            {
              role: "system",
              content: "You are an AI Trading Copilot for Aura Perps DEX. Your job is to extract trading intent from the user's prompt. Supported assets are BTC, ETH, AMZN, TSLA, AMD, NFLX, PLTR. The AI agent manages Stop Loss and Take Profit autonomously off-chain. Output strictly JSON with 'action' (must be exactly 'open_position'), 'asset' (e.g. 'BTC-PERP', 'AMZN-PERP'), 'isLong' (boolean), 'collateral' (number in USD, the actual amount the user provides, not the leveraged size), 'leverage' (number), 'takeProfit' (string/number, optional), 'stopLoss' (string/number, optional), and a 'message' describing what you will do (including acknowledging the TP/SL config if requested). Be concise. Output ONLY valid JSON, no markdown formatting."
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.1,
        })
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const err = await response.text();
        console.error("AI API Error:", err);
        return NextResponse.json({ error: "Failed to reach AI API" }, { status: 500 });
      }

      const data = await response.json();
      const resultContent = data.choices[0].message.content;

      let p;
      try {
        const cleaned = resultContent.replace(/```json/g, "").replace(/```/g, "").replace(/^[^{]*/, "").replace(/[^}]*$/, "").trim();
        p = JSON.parse(cleaned);
      } catch (parseErr) {
        console.error("Failed to parse AI output:", resultContent);
        return NextResponse.json({ error: "Invalid AI response format" }, { status: 500 });
      }

      console.log(`[NLP Agent] Prompt: "${prompt}" -> ${p.action} ${p.asset || ""}`);

      return NextResponse.json(p);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return NextResponse.json({ error: "AI response timed out. Please try again." }, { status: 504 });
      }
      throw err;
    }

  } catch (error) {
    console.error("API Route Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}