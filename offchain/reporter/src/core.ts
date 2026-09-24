// Pure reporter logic: exact decimal parsing, price normalisation, observedAt clamping, nonce sequencing,
// canonical-address checks, corporate-action detection and EIP-712 signing. No I/O here (unit-tested).
import { TypedDataEncoder, type Signer } from "ethers";
import type { ApiAsset, CorpAction, Quote } from "./api.ts";

export const E18 = 10n ** 18n;

export const REPORT_TYPES = {
  MarketReport: [
    { name: "asset", type: "address" },
    { name: "halted", type: "bool" },
    { name: "corporateActionPaused", type: "bool" },
    { name: "uiMultiplier", type: "uint256" },
    { name: "referencePrice", type: "uint256" },
    { name: "observedAt", type: "uint64" },
    { name: "nonce", type: "uint64" },
  ],
};

export type MarketReport = {
  asset: string;
  halted: boolean;
  corporateActionPaused: boolean;
  uiMultiplier: bigint;
  referencePrice: bigint;
  observedAt: bigint;
  nonce: bigint;
};

/** Exact decimal string -> fixed-point bigint (default 1e18). Digits beyond `decimals` are truncated. No floats. */
export function parseDecimal(s: string, decimals = 18): bigint {
  if (typeof s !== "string" || !/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid decimal string: ${JSON.stringify(s)}`);
  const [int, frac = ""] = s.split(".");
  return BigInt(int) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Per-token reference price (1e18 USD): mid of tokenBid/tokenAsk, else (bid+ask)/2 * currentMultiplier. */
export function referencePriceOf(q: Quote, currentMultiplier?: string): bigint {
  if (q.tokenBid && q.tokenAsk) {
    const tb = parseDecimal(q.tokenBid);
    const ta = parseDecimal(q.tokenAsk);
    if (tb > 0n && ta >= tb) return (tb + ta) / 2n;
  }
  const bid = parseDecimal(q.bid);
  const ask = parseDecimal(q.ask);
  if (bid === 0n || ask < bid) throw new Error(`${q.tokenSymbol}: invalid bid/ask ${q.bid}/${q.ask}`);
  if (!currentMultiplier) throw new Error(`${q.tokenSymbol}: no token bid/ask and no multiplier`);
  return ((bid + ask) / 2n) * parseDecimal(currentMultiplier) / E18;
}

/** observedAt = min(generatedAt, latest block time), never below the previous report (engine rejects out-of-order). */
export function clampObservedAt(generatedAtSec: bigint | null, blockTs: bigint, prevObservedAt: bigint): bigint {
  let t = generatedAtSec === null || generatedAtSec > blockTs ? blockTs : generatedAtSec;
  if (t < prevObservedAt) t = prevObservedAt;
  return t;
}

export const isoToSec = (iso: string): bigint => BigInt(Math.floor(Date.parse(iso) / 1000));

export const nextNonce = (prevNonce: bigint): bigint => prevNonce + 1n;

/** Pending multiplier effective within `windowSec`, or a corporate action being processed within the window. */
export function corporateActionPaused(
  symbol: string,
  asset: ApiAsset | undefined,
  actions: CorpAction[],
  nowSec: number,
  windowSec: number,
): boolean {
  if (asset?.pendingMultiplier && asset.pendingMultiplier !== asset.currentMultiplier) {
    const eff = asset.pendingMultiplierEffectiveTime ? Date.parse(asset.pendingMultiplierEffectiveTime) / 1000 : NaN;
    if (!Number.isFinite(eff) || eff - nowSec <= windowSec) return true; // unknown effective time => fail closed
  }
  return actions.some((a) => {
    if (a.tokenSymbol !== symbol || !/PROCESSING|IN_PROGRESS/.test(a.status)) return false;
    // Dividends are announced weeks ahead as IN_PROGRESS; only pause when the process date is inside the window.
    if (!a.processDate) return true;
    const t = Date.UTC(a.processDate.year, a.processDate.month - 1, a.processDate.day) / 1000;
    return t - nowSec <= windowSec && nowSec - t <= 86400;
  });
}

/** Production: every configured canonical address must be exactly the API deployment for `chainId`. Throws otherwise. */
export function verifyCanonical(expected: { symbol: string; address: string }[], apiAssets: ApiAsset[], chainId = 4663): void {
  for (const e of expected) {
    const a = apiAssets.find((x) => x.tokenSymbol === e.symbol);
    const dep = a?.deployments.find((d) => d.chainId === chainId);
    if (!dep) throw new Error(`canonical check failed: ${e.symbol} has no chain ${chainId} deployment in the Robinhood API`);
    if (dep.contractAddress.toLowerCase() !== e.address.toLowerCase()) {
      throw new Error(`canonical check failed: ${e.symbol} config ${e.address} != API ${dep.contractAddress}`);
    }
  }
}

export const reportDomain = (engine: string, chainId: bigint | number) => ({
  name: "BloomRiskEngine",
  version: "1",
  chainId,
  verifyingContract: engine,
});

export function reportDigest(engine: string, chainId: bigint | number, r: MarketReport): string {
  return TypedDataEncoder.hash(reportDomain(engine, chainId), REPORT_TYPES, r);
}

export function signMarketReport(signer: Signer, engine: string, chainId: bigint | number, r: MarketReport): Promise<string> {
  return signer.signTypedData(reportDomain(engine, chainId), REPORT_TYPES, r);
}
