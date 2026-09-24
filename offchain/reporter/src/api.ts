// Robinhood Stock Token public API (no auth). Every response is validated with zod; nothing is trusted blindly.
import { z } from "zod";

export const RH_API = process.env.RH_API_BASE ?? "https://api.robinhood.com/rhj";

const decimalStr = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const deployment = z.object({ contractAddress: address, chainId: z.number().int().positive() });
const symbol = z.string().regex(/^[A-Z0-9.]{1,12}$/);

export const QuoteSchema = z.object({
  tokenSymbol: symbol,
  deployments: z.array(deployment),
  bid: decimalStr,
  ask: decimalStr,
  isTradingHalt: z.boolean(),
  generatedAt: z.iso.datetime({ offset: true }),
  tokenBid: decimalStr.optional(),
  tokenAsk: decimalStr.optional(),
});
export const PricesResponse = z.object({ quotes: z.array(QuoteSchema).min(1) });

export const AssetSchema = z.object({
  tokenSymbol: symbol,
  deployments: z.array(deployment),
  currentMultiplier: decimalStr,
  pendingMultiplier: z.union([decimalStr, z.literal("")]).optional(),
  pendingMultiplierEffectiveTime: z.string().optional(),
  status: z.string(),
});
export const AssetsResponse = z.object({ assets: z.array(AssetSchema) });

export const CorpActionSchema = z.object({
  type: z.string(),
  status: z.string(),
  tokenSymbol: symbol,
  processDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }).optional(),
});
export const CorpActionsResponse = z.object({ corpActions: z.array(CorpActionSchema) });

export type Quote = z.infer<typeof QuoteSchema>;
export type ApiAsset = z.infer<typeof AssetSchema>;
export type CorpAction = z.infer<typeof CorpActionSchema>;

async function getJson(path: string, timeoutMs = 10_000): Promise<unknown> {
  const res = await fetch(`${RH_API}${path}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Robinhood API ${path} -> HTTP ${res.status}`);
  return res.json();
}

export async function fetchQuote(sym: string): Promise<Quote> {
  if (!/^[A-Z0-9.]{1,12}$/.test(sym)) throw new Error(`bad symbol ${sym}`);
  const { quotes } = PricesResponse.parse(await getJson(`/prices/${sym}`));
  const q = quotes.find((x) => x.tokenSymbol === sym);
  if (!q) throw new Error(`Robinhood API returned no quote for ${sym}`);
  return q;
}

export async function fetchAssets(): Promise<ApiAsset[]> {
  return AssetsResponse.parse(await getJson("/assets")).assets;
}

export async function fetchCorporateActions(): Promise<CorpAction[]> {
  return CorpActionsResponse.parse(await getJson("/corporate-actions")).corpActions;
}
