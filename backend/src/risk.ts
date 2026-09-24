// Risk engine reads + plain-English explanations.
import { Contract } from "ethers";
import { ABI, assetBySymbol, c, fail, fmt, provider, stocks, usd, type AssetInfo } from "./ctx.ts";

export const STATE_NAMES = ["NORMAL", "HALTED", "STALE", "DEVIATION", "CORP_ACTION_PAUSED", "SEQUENCER_DOWN", "INVALID_PRICE", "UNSUPPORTED"] as const;
export type StateName = (typeof STATE_NAMES)[number];

export const STATE_REASON: Record<StateName, string> = {
  NORMAL: "Within Bloom's risk policy.",
  HALTED: "Equity market trading halt detected.",
  STALE: "Oracle price is older than its heartbeat.",
  DEVIATION: "Oracle price deviates more than 5% from the reference price.",
  CORP_ACTION_PAUSED: "Corporate action in progress; oracle paused.",
  SEQUENCER_DOWN: "L2 sequencer is down or in its grace period.",
  INVALID_PRICE: "The oracle returned an invalid price.",
  UNSUPPORTED: "This asset is not supported by Bloom's risk engine.",
};
/** "…because QQQ entered a halted-risk state." */
export const STATE_ADJ: Record<StateName, string> = {
  NORMAL: "normal", HALTED: "halted", STALE: "stale-price", DEVIATION: "price-deviation",
  CORP_ACTION_PAUSED: "corporate-action", SEQUENCER_DOWN: "sequencer-down", INVALID_PRICE: "invalid-price", UNSUPPORTED: "unsupported",
};

export async function sequencerStatus() {
  const required: boolean = await c.engine.sequencerRequired();
  if (!required || !c.seq) return { up: true, required, sinceSec: null as number | null };
  const [, answer, startedAt] = await c.seq.latestRoundData();
  const now = (await provider.getBlock("latest"))!.timestamp;
  return { up: BigInt(answer) === 0n, required, sinceSec: now - Number(startedAt) };
}

export async function riskOf(a: AssetInfo) {
  const [risk, report, cfg, block] = await Promise.all([
    c.engine.getRisk(a.token), c.engine.getReport(a.token), c.engine.getAssetConfig(a.token), provider.getBlock("latest"),
  ]);
  const now = block!.timestamp;
  const state = Number(risk.state);
  const stateName = STATE_NAMES[state] ?? "UNSUPPORTED";
  let feedPrice = 0n, updatedAt = 0;
  if (cfg.feed && cfg.feed !== "0x0000000000000000000000000000000000000000") {
    try {
      const [, answer, , upd] = await new Contract(cfg.feed, ABI.feed, provider).latestRoundData();
      feedPrice = BigInt(answer) > 0n ? BigInt(answer) * 10n ** (18n - BigInt(cfg.feedDecimals)) : 0n;
      updatedAt = Number(upd);
    } catch { /* feed unreadable => INVALID_PRICE state already covers it */ }
  }
  let oraclePaused = false, uiMultiplier = 10n ** 18n;
  try {
    const t = new Contract(a.token, ABI.stock, provider);
    [oraclePaused, uiMultiplier] = await Promise.all([t.oraclePaused(), t.uiMultiplier()]);
  } catch { /* not a stock-token surface */ }
  const ref = BigInt(report.referencePrice);
  const diff = feedPrice > ref ? feedPrice - ref : ref - feedPrice;
  const hasReport = BigInt(report.nonce) !== 0n;
  return {
    symbol: a.symbol,
    token: a.token,
    priceUsd: usd(BigInt(risk.price) || feedPrice),
    priceTrusted: BigInt(risk.price) !== 0n,
    price1e18: BigInt(risk.price),
    oracleUpdatedAt: updatedAt,
    oracleAgeSec: updatedAt ? Math.max(0, now - updatedAt) : null,
    halted: Boolean(report.halted),
    corporateActionPaused: Boolean(report.corporateActionPaused) || Boolean(oraclePaused),
    uiMultiplier: fmt(BigInt(uiMultiplier), 18),
    deviationBps: ref > 0n && feedPrice > 0n ? Number((diff * 10_000n) / ref) : null,
    referencePriceUsd: ref > 0n ? usd(ref) : null,
    state,
    stateName,
    borrowingAllowed: Boolean(risk.borrowingAllowed),
    liquidationAllowed: Boolean(risk.liquidationAllowed),
    maxLtvBps: Number(risk.maxLtvBps),
    reason: state === 0 ? STATE_REASON.NORMAL : `${STATE_REASON[stateName]} Borrowing paused because the asset is currently outside Bloom's risk policy.`,
    lastReport: hasReport ? { observedAt: Number(report.observedAt), nonce: Number(report.nonce) } : null,
  };
}
export type AssetRisk = Awaited<ReturnType<typeof riskOf>>;

export async function riskAll() {
  const [sequencer, list] = await Promise.all([sequencerStatus(), Promise.all(stocks.map(riskOf))]);
  return { sequencer, assets: list.map(({ price1e18, priceTrusted, ...r }) => r) };
}

export function stockBySymbol(symbol: string): AssetInfo {
  const a = assetBySymbol(symbol);
  if (!a || a.kind !== "STOCK_TOKEN") return fail(400, "UNSUPPORTED_ASSET", `${symbol} is not a supported Robinhood Stock Token here.`);
  return a;
}

export async function borrowCheck(symbol: string) {
  const r = await riskOf(stockBySymbol(symbol));
  const message = r.borrowingAllowed
    ? `Borrowing against ${r.symbol} is enabled, up to ${r.maxLtvBps / 100}% of its value.`
    : `Borrowing against ${r.symbol} is paused: ${STATE_REASON[r.stateName]} Bloom sets max LTV to 0 and pauses liquidations until the asset is back to NORMAL.`;
  return { borrowingAllowed: r.borrowingAllowed, maxLtvBps: r.maxLtvBps, state: r.state, stateName: r.stateName, message };
}
