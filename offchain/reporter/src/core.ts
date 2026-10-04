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

// ─── Market session (24/5) ───
// Stock tokens trade 24/5: the week opens Sunday 8 PM ET and closes Friday 8 PM ET; an NYSE holiday closes the
// 24 h from 8 PM ET the evening before. While closed there is no primary-market price discovery, so the reporter
// signs `halted = true`: the engine (unchanged) then sets max LTV to 0, pauses borrowing AND liquidations, and the
// agent policy (NORMAL-only) refuses to act. Repayment stays open. After a closure, a reopen grace window keeps the
// guard on so the first post-gap prints cannot trigger liquidations.
// ponytail: holiday list is hard-coded (NYSE 2026–2027 full closures); extend yearly or source from a calendar API.
const NYSE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type MarketSession = { state: "OPEN" | "CLOSED" | "REOPENING"; reason: string; reopensAt: string | null };

/** ET wall clock shifted +4 h, as a UTC Date: a "session day" then runs 00:00–24:00 (= 8 PM ET to 8 PM ET). */
function sessionClock(nowMs: number): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour + 4, +p.minute));
}
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const closedDay = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6 || NYSE_HOLIDAYS.has(dayKey(d));

export function marketSession(nowMs: number, reopenGraceMin = 30): MarketSession {
  const t = sessionClock(nowMs);
  const day = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const prev = new Date(day.getTime() - 86_400_000);
  if (closedDay(day)) {
    const open = new Date(day);
    while (closedDay(open)) open.setUTCDate(open.getUTCDate() + 1);
    const eve = new Date(open.getTime() - 86_400_000); // the session opens at 8 PM ET the evening before
    const why = NYSE_HOLIDAYS.has(dayKey(day)) ? "US market holiday" : "weekend";
    return { state: "CLOSED", reason: `Market closed (${why}): no live reference price.`, reopensAt: `${DAY[eve.getUTCDay()]} ${dayKey(eve).slice(5)} 8:00 PM ET` };
  }
  const minsIn = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (closedDay(prev) && minsIn < reopenGraceMin) {
    return { state: "REOPENING", reason: `Market just reopened: ${reopenGraceMin}-minute grace before borrowing and liquidations resume.`, reopensAt: null };
  }
  return { state: "OPEN", reason: "Market open (24/5 session).", reopensAt: null };
}

/** MARKET_SESSION_GUARD=false disables the session guard (halts, staleness, deviation etc. still apply). */
export const sessionGuardEnabled = () => (process.env.MARKET_SESSION_GUARD ?? "true").trim().toLowerCase() !== "false";
export const reopenGraceMin = () => Number(process.env.REOPEN_GRACE_MIN || 30);
