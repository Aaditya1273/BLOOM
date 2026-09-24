"use client";

import { ArrowDownLeft, ArrowUpRight, Link2, PauseCircle, PiggyBank, Repeat, ShieldAlert, ShieldCheck, Sparkles, Target, type LucideIcon } from "lucide-react";
import type { ActivityItem, RiskStateName } from "@/lib/types";
import { clockTime, num, RISK_PHRASE, riskName, shortHash, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Details } from "./states";

type Friendly = { icon: LucideIcon; title: string; sub?: string; amount?: string; tone?: "risk" | "ok" };

const POLICY_REASON: Record<string, string> = {
  ASSET_RISK_BLOCKED: "the asset was outside your risk policy",
  PER_TX_CAP_EXCEEDED: "it was above your per-action limit",
  DAILY_CAP_EXCEEDED: "it would exceed your daily limit",
  ASSET_NOT_ALLOWED: "the asset isn't approved for this goal",
  POLICY_EXPIRED: "the goal's permission had expired",
  NO_ACTIVE_POLICY: "there was no active goal",
};

/** "0.006746 QQQ" → { n, sym } */
const tokenAmt = (s: string) => {
  const m = s.match(/([\d.,]+)\s+([A-Z]+)/);
  return m ? { n: Number(m[1].replace(/,/g, "")), sym: m[2] } : null;
};
const fmtAmt = (a: { n: number; sym: string } | null) => (a ? (a.sym === "USDG" ? usd(a.n) : `${num(a.n, 6)} ${a.sym}`) : undefined);

/** Map backend activity types to plain language. Unknown types fall back to the backend title. */
export function describe(a: ActivityItem): Friendly {
  const d = a.detail ?? "";
  switch (a.type) {
    case "Deposit": {
      const amt = tokenAmt(d);
      return { icon: PiggyBank, title: "Saved to savings", amount: fmtAmt(amt) };
    }
    case "Sent": {
      const [what, to] = d.split(" to ");
      const amt = tokenAmt(what);
      const who = a.counterpartyName ?? (to ? shortHash(to) : undefined);
      return {
        icon: ArrowUpRight,
        title: a.counterpartyName ? `Sent ${amt?.sym ?? "tokens"} to ${a.counterpartyName}` : `Sent ${amt?.sym ?? "tokens"}`,
        sub: who && !a.counterpartyName ? `To ${who}` : undefined,
        amount: fmtAmt(amt) && `−${fmtAmt(amt)}`,
      };
    }
    case "Swapped": {
      const [inS, outS] = d.split("→").map((x) => tokenAmt(x));
      return { icon: Repeat, title: outS ? `Bought ${outS.sym}` : "Exchanged", sub: inS ? `Paid ${fmtAmt(inS)}` : undefined, amount: fmtAmt(outS) && `+${fmtAmt(outS)}` };
    }
    case "ClaimCreated": {
      const amt = tokenAmt(d);
      return { icon: Link2, title: `Sent ${amt?.sym ?? "tokens"} with a claim link`, amount: fmtAmt(amt) && `−${fmtAmt(amt)}` };
    }
    case "ClaimClaimed": {
      const [what, by] = d.split(" by ");
      return { icon: ArrowDownLeft, title: "Claim link was redeemed", sub: by ? `By ${shortHash(by)}` : undefined, amount: fmtAmt(tokenAmt(what)) };
    }
    case "GoalCreated":
      return { icon: Target, title: "Created a goal" };
    case "GoalActivated":
      return { icon: Sparkles, title: "Put a goal on autopilot", sub: "Bloom Agent switched on" };
    case "ActionExecuted":
      return { icon: Sparkles, title: "Bloom Agent completed an action", tone: "ok" };
    case "ActionRejected": {
      const why = POLICY_REASON[d.trim()];
      return { icon: PauseCircle, title: "Bloom paused an action", sub: why ? `Because ${why}` : d || undefined, tone: "risk" };
    }
    case "RiskStateChanged": {
      const m = d.match(/^(\w+):\s*(\w+)\s*→\s*(\w+)/);
      if (m) {
        const to = riskName(m[3]) as RiskStateName;
        return to === "NORMAL"
          ? { icon: ShieldCheck, title: `${m[1]} returned to normal`, tone: "ok" }
          : { icon: ShieldAlert, title: `${m[1]} entered ${RISK_PHRASE[to]}`, sub: "Bloom paused borrowing and agent actions for it", tone: "risk" };
      }
      return { icon: ShieldCheck, title: a.title, sub: d };
    }
    case "BorrowBlocked":
      return { icon: ShieldAlert, title: "Bloom paused borrowing", sub: d, tone: "risk" };
    default:
      return { icon: Repeat, title: a.title, sub: d || undefined };
  }
}

export function TransactionRow({ item }: { item: ActivityItem }) {
  const f = describe(item);
  return (
    <li className="py-4">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full",
            f.tone === "risk" ? "bg-danger-soft text-danger" : f.tone === "ok" ? "bg-success-soft text-success" : "bg-sunken text-ink",
          )}
        >
          <f.icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-medium text-pretty">{f.title}</p>
            {f.amount && <p className="tabular shrink-0 text-right font-medium">{f.amount}</p>}
          </div>
          <p className="text-sm text-muted">
            {clockTime(item.timestamp)}
            {f.sub && <> · {f.sub}</>}
          </p>
          {item.txHash && <Details summary="Details" txHashes={[item.txHash]} className="mt-1.5" />}
        </div>
      </div>
    </li>
  );
}
