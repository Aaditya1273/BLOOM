import { ApiError } from "./api";
import { RISK_STATE_NAMES, type ConfirmResult, type RiskStateName } from "./types";

export function usd(value: string | number | undefined, digits = 2): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function num(value: string | number | undefined, maxDigits = 4): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { maximumFractionDigits: maxDigits });
}

export const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

/** Accepts unix seconds, unix ms, or an ISO string. */
export function toDate(t: number | string | null | undefined): Date | null {
  if (t === null || t === undefined || t === "") return null;
  if (typeof t === "number" || /^\d+$/.test(t)) {
    const n = Number(t);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function shortDate(t: number | string | null | undefined): string {
  const d = toDate(t);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
}

export function age(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

export const pct = (bps: number, digits = 0) => `${(bps / 100).toFixed(digits)}%`;

export function riskName(s: number | string | undefined): RiskStateName {
  if (typeof s === "number") return RISK_STATE_NAMES[s] ?? "UNSUPPORTED";
  if (s && /^\d+$/.test(s)) return RISK_STATE_NAMES[Number(s)] ?? "UNSUPPORTED";
  return (RISK_STATE_NAMES as readonly string[]).includes(s ?? "") ? (s as RiskStateName) : "UNSUPPORTED";
}

/** ok = state is fine; bad = risk (red is reserved for risk); neutral = anything else. */
export type Tone = "ok" | "bad" | "neutral";

/** Plain-English, lower-case phrase for a non-normal risk state ("QQQ entered a halted state"). */
export const RISK_PHRASE: Record<RiskStateName, string> = {
  NORMAL: "normal",
  HALTED: "a halted state",
  STALE: "a stale-price state",
  DEVIATION: "a price-deviation state",
  CORP_ACTION_PAUSED: "a corporate-action pause",
  SEQUENCER_DOWN: "a sequencer-down state",
  INVALID_PRICE: "an invalid-price state",
  UNSUPPORTED: "an unsupported state",
};

export const RISK_LABEL: Record<RiskStateName, string> = {
  NORMAL: "Normal",
  HALTED: "Trading halt",
  STALE: "Stale price",
  DEVIATION: "Price deviation",
  CORP_ACTION_PAUSED: "Corporate action",
  SEQUENCER_DOWN: "Sequencer down",
  INVALID_PRICE: "Invalid price",
  UNSUPPORTED: "Unsupported",
};

// ── Action result states

export type ResultKind =
  | "pending"
  | "success"
  | "rejected"
  | "reverted"
  | "unsupported"
  | "insufficient"
  | "risk_blocked"
  | "stale"
  | "halted"
  | "testnet_only"
  | "invalid"
  | "error";

export const RESULT_META: Record<ResultKind, { title: string; tone: Tone | "pending" }> = {
  pending: { title: "Working on it…", tone: "pending" },
  success: { title: "Done", tone: "ok" },
  rejected: { title: "Bloom paused this action", tone: "neutral" },
  reverted: { title: "This didn't go through", tone: "neutral" },
  unsupported: { title: "That asset isn't supported", tone: "neutral" },
  insufficient: { title: "Not enough balance", tone: "neutral" },
  risk_blocked: { title: "Bloom paused this action", tone: "bad" },
  stale: { title: "Bloom paused this action", tone: "bad" },
  halted: { title: "Bloom paused this action", tone: "bad" },
  testnet_only: { title: "Available on testnet only", tone: "neutral" },
  invalid: { title: "Please check and try again", tone: "neutral" },
  error: { title: "Something went wrong", tone: "neutral" },
};

function classifyText(text: string, fallback: ResultKind): ResultKind {
  if (/halt/i.test(text)) return "halted";
  if (/stale|older than its heartbeat/i.test(text)) return "stale";
  if (/unsupported/i.test(text)) return "unsupported";
  if (/insufficient/i.test(text)) return "insufficient";
  if (/risk|deviation|sequencer|corporate/i.test(text)) return "risk_blocked";
  if (/revert/i.test(text)) return "reverted";
  return fallback;
}

export function kindFromError(e: unknown): ResultKind {
  if (!(e instanceof ApiError)) return "error";
  switch (e.code) {
    case "POLICY_REJECTED":
      return "rejected";
    case "UNSUPPORTED_ASSET":
      return "unsupported";
    case "INSUFFICIENT_BALANCE":
      return "insufficient";
    case "RISK_BLOCKED":
      return classifyText(`${String(e.details?.stateName ?? "")} ${e.message}`, "risk_blocked");
    case "CHAIN_ERROR":
      return classifyText(e.message, "reverted");
    case "TESTNET_ONLY":
      return "testnet_only";
    case "BAD_REQUEST":
    case "NOT_FOUND":
      return "invalid";
    default:
      return "error";
  }
}

export function kindFromConfirm(r: ConfirmResult): ResultKind {
  if (r.status === "executed") return "success";
  if (r.status === "reverted") return "reverted";
  return classifyText(`${r.reason ?? ""} ${r.message}`, "rejected");
}

export function errorMessage(e: unknown): string {
  // wallet (viem/wagmi) errors carry a shortMessage; map the common ones to plain English
  const raw = String((e as { shortMessage?: string })?.shortMessage ?? (e instanceof Error ? e.message : ""));
  if (/user rejected|user denied|rejected the request/i.test(raw)) return "You cancelled the request in your wallet.";
  if (/insufficient funds/i.test(raw)) return "Your wallet needs a little testnet ETH on Robinhood Chain for gas.";
  if (/chain mismatch|does not match the target chain|switch chain/i.test(raw)) return "Switch your wallet to Robinhood Chain Testnet and try again.";
  if (/timed out while waiting for transaction/i.test(raw)) return "Your transaction was sent but isn't confirmed yet. Check Activity in a minute before trying again.";
  return raw || "Something went wrong. Please try again.";
}

/** Accepts unix seconds, ms or ISO. "Today" / "Yesterday" / "Sep 21" / "Sep 21, 2025". */
export function dayLabel(t: number | string | null | undefined, now = new Date()): string {
  const d = toDate(t);
  if (!d) return "Earlier";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

export function clockTime(t: number | string | null | undefined): string {
  const d = toDate(t);
  return d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
}

/** "12 days", "3 hours" … for honest window labels. */
export function windowLabel(sec: number | null | undefined): string {
  if (!sec || sec < 3600) return "today";
  if (sec >= 25 * 86400) return "this month";
  if (sec >= 2 * 86400) return `in the last ${Math.round(sec / 86400)} days`;
  return "in the last day";
}

export const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
