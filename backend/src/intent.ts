// Natural language -> typed intent. Deterministic rules first (no LLM needed for the demo phrases); optional
// OpenAI-compatible fallback whose JSON goes through the SAME zod validator. The model never supplies
// addresses or calldata: recipients are names resolved from contacts, assets are symbols from the registry.
import { z } from "zod";

const money = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/);
const sym = z.string().regex(/^[A-Z]{1,6}$/);
const name = z.string().regex(/^[A-Za-z][A-Za-z .'-]{0,30}$/);

export const IntentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SEND"), amountUsd: money, symbol: sym, recipientName: name }),
  z.object({
    action: z.literal("CREATE_GOAL"), name, targetAmount: money, asset: z.literal("USDG"), deadline: z.iso.datetime(),
    maxDailySpend: money, maxPerTx: money, maxStockAllocationBps: z.number().int().min(0).max(10_000),
    allowedAssets: z.array(sym).min(1).max(8),
  }),
  z.object({ action: z.literal("INVEST"), amountUsd: money, profile: z.enum(["conservative"]) }),
  z.object({ action: z.literal("DEPOSIT"), amountUsd: money }),
  z.object({ action: z.literal("EXPLAIN_RISK"), symbol: sym.optional() }),
  z.object({ action: z.literal("EXPLAIN_BORROW"), symbol: sym.optional() }),
  z.object({ action: z.literal("BALANCE") }),
  z.object({ action: z.literal("UNKNOWN") }),
]);
export type Intent = z.infer<typeof IntentSchema>;

export const GOAL_DEFAULTS = { maxDailySpend: "50", maxPerTx: "50", maxStockAllocationBps: 3000, allowedAssets: ["USDG", "QQQ", "NVDA"] };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const amt = (s: string) => s.replace(/,/g, "").replace(/\.$/, "");
const title = (s: string) => s.trim().replace(/^(my|a|an|the)\s+/i, "").replace(/^\w/, (x) => x.toUpperCase());

/** "December 15", "Dec 15th", "15 December", "2026-12-15" -> end of that day (UTC), rolling to next year if past. */
export function parseDeadline(text: string, now: Date): string | null {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  let y: number | undefined, m: number, d: number;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const md = t.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/);
  const dm = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:,?\s+(\d{4}))?$/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
  else if (md) [m, d, y] = [MONTHS.indexOf(md[1].slice(0, 3)), Number(md[2]), md[3] ? Number(md[3]) : undefined];
  else if (dm) [d, m, y] = [Number(dm[1]), MONTHS.indexOf(dm[2].slice(0, 3)), dm[3] ? Number(dm[3]) : undefined];
  else return null;
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  let year = y ?? now.getUTCFullYear();
  let at = Date.UTC(year, m, d, 23, 59, 59);
  if (y === undefined && at <= now.getTime()) at = Date.UTC(++year, m, d, 23, 59, 59);
  const dt = new Date(at);
  if (dt.getUTCDate() !== d) return null; // e.g. Feb 31
  return dt.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parseIntent(message: string, symbols: string[], now = new Date()): Intent {
  const text = message.trim().replace(/\s+/g, " ");
  const S = new Set(symbols.map((s) => s.toUpperCase()));
  const symIn = (s: string) => { const u = s.toUpperCase(); return S.has(u) ? u : undefined; };
  const findSym = () => text.match(/\b[A-Za-z]{2,6}\b/g)?.map(symIn).find((s) => s && s !== "USDG");
  let m: RegExpMatchArray | null;

  // "Send Sarah $5 of QQQ." / "Send $5 of QQQ to Sarah" / "Pay Alex $10"
  if ((m = text.match(/^(?:send|pay|give)\s+([A-Za-z][A-Za-z'-]*)\s+\$([\d,]+(?:\.\d+)?)(?:\s+(?:of|in|worth of)\s+([A-Za-z]+))?[.!]?$/i))
    || (m = text.match(/^(?:send|pay|give)\s+\$([\d,]+(?:\.\d+)?)(?:\s+(?:of|in|worth of)\s+([A-Za-z]+))?\s+to\s+([A-Za-z][A-Za-z'-]*)[.!]?$/i))) {
    const [who, dollars, asset] = /^\$?[\d,]/.test(m[1]) ? [m[3], m[1], m[2]] : [m[1], m[2], m[3]];
    const symbol = asset ? symIn(asset) : "USDG";
    if (symbol) return { action: "SEND", amountUsd: amt(dollars), symbol, recipientName: title(who) };
  }
  // "Move $100 into my conservative portfolio."
  if ((m = text.match(/^(?:move|put|invest)\s+\$([\d,]+(?:\.\d+)?)\s+(?:into|in|to)\s+(?:my\s+)?(?:conservative\s+)?portfolio[.!]?$/i))) {
    return { action: "INVEST", amountUsd: amt(m[1]), profile: "conservative" };
  }
  // "Deposit $20" / "Move $20 into savings"
  if ((m = text.match(/^(?:deposit|save|move|put)\s+\$([\d,]+(?:\.\d+)?)(?:\s+(?:into|in|to)\s+(?:my\s+)?savings)?[.!]?$/i))) {
    return { action: "DEPOSIT", amountUsd: amt(m[1]) };
  }
  // "Save $500 for my laptop by December 15."
  if ((m = text.match(/^(?:save|saving)\s+\$([\d,]+(?:\.\d+)?)\s+(?:for\s+(.+?)\s+)?(?:by|before)\s+(.+?)[.!]?$/i))) {
    const deadline = parseDeadline(m[3], now);
    if (deadline) {
      return { action: "CREATE_GOAL", name: m[2] ? title(m[2]).slice(0, 31) : "Savings goal", targetAmount: amt(m[1]), asset: "USDG", deadline, ...GOAL_DEFAULTS };
    }
  }
  if (/\bborrow(ing)?\b/i.test(text)) return { action: "EXPLAIN_BORROW", symbol: findSym() };
  if (/\b(risk|risky|safe|halt(ed)?|collateral)\b/i.test(text)) return { action: "EXPLAIN_RISK", symbol: findSym() };
  if (/\b(balance|how much do i have|portfolio worth|net worth)\b/i.test(text)) return { action: "BALANCE" };
  return { action: "UNKNOWN" };
}

/** Optional LLM fallback (OpenAI-compatible). Returns null if not configured or output is invalid. */
export async function llmIntent(message: string, symbols: string[], now = new Date()): Promise<Intent | null> {
  const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = process.env;
  if (!AI_BASE_URL || !AI_API_KEY || !AI_MODEL) return null;
  const system = `You convert a wallet user's message into JSON. Today is ${now.toISOString().slice(0, 10)}.
Allowed symbols: ${symbols.join(", ")}. Output ONLY one JSON object, one of:
{"action":"SEND","amountUsd":"5","symbol":"QQQ","recipientName":"Sarah"}
{"action":"CREATE_GOAL","name":"Laptop","targetAmount":"500","deadline":"2026-12-15T23:59:59Z"}
{"action":"INVEST","amountUsd":"100","profile":"conservative"}
{"action":"DEPOSIT","amountUsd":"20"}
{"action":"EXPLAIN_RISK","symbol":"QQQ"} {"action":"EXPLAIN_BORROW"} {"action":"BALANCE"} {"action":"UNKNOWN"}
Never output addresses or calldata.`;
  try {
    const res = await fetch(`${AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({ model: AI_MODEL, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: message.slice(0, 500) }] }),
    });
    if (!res.ok) return null;
    const content: string = (await res.json())?.choices?.[0]?.message?.content ?? "";
    const raw = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
    if (raw?.action === "CREATE_GOAL") Object.assign(raw, { ...GOAL_DEFAULTS, ...raw, asset: "USDG" });
    const parsed = IntentSchema.safeParse(raw);
    if (!parsed.success) return null;
    const i = parsed.data;
    if ("symbol" in i && i.symbol && !symbols.includes(i.symbol)) return null;
    return i;
  } catch {
    return null;
  }
}
