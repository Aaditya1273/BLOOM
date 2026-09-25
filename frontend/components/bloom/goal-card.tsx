"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { isSignRequest, type Goal } from "@/lib/types";
import { useWalletSign } from "@/hooks/use-wallet-sign";
import { errorMessage, pct, shortDate, shortHash, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BloomCard, Progress } from "./card";
import { StatusPill } from "./status-pill";
import { BloomButton } from "./button";

/** Readable allocation derived only from what the policy allows — no invented splits. */
export function strategyText(allowedAssets: string[], maxStockAllocationBps: number) {
  const stocks = allowedAssets.filter((a) => a !== "USDG");
  if (maxStockAllocationBps <= 0 || stocks.length === 0) return "Savings in USDG only";
  return `Up to ${pct(maxStockAllocationBps)} in ${stocks.join(", ")} · rest in USDG`;
}

export function limitsText(maxDailySpend: string, maxStockAllocationBps: number) {
  return `${usd(maxDailySpend, Number(maxDailySpend) % 1 ? 2 : 0)}/day · ${pct(maxStockAllocationBps)} max in Stock Tokens`;
}

export const goalProgress = (g: Pick<Goal, "progressUsd" | "targetAmount">) =>
  Math.min(100, (Number(g.progressUsd) / Math.max(1, Number(g.targetAmount))) * 100);

/** Compact goal line for Home. */
export function GoalSummary({ goal }: { goal: Goal }) {
  const p = goalProgress(goal);
  return (
    <li className="py-4">
      <Link href="/agent" className="block rounded-chip">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-medium">{goal.name}</p>
          <p className="tabular text-sm text-muted">{Math.floor(p)}%</p>
        </div>
        <p className="tabular mt-0.5 text-sm text-muted">
          {usd(goal.progressUsd)} of {usd(goal.targetAmount, 0)}
        </p>
        <Progress value={p} label={`${goal.name} progress`} className="mt-3" />
      </Link>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-3 sm:grid-cols-[120px_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function GoalCard({ goal, onRevoked, delay }: { goal: Goal; onRevoked?: () => void; delay?: number }) {
  const [busy, setBusy] = useState(false);
  const { complete } = useWalletSign();
  const p = goalProgress(goal);

  async function revoke() {
    setBusy(true);
    try {
      const r = await api.revokeGoal(goal.goalId);
      if (isSignRequest(r)) await complete(r); // your wallet signs revokeGoal
      toast.success("Autopilot turned off", { description: `${goal.name} will no longer be managed by the Bloom Agent.` });
      onRevoked?.();
    } catch (e) {
      toast.error("Couldn't turn off autopilot", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BloomCard as="article" delay={delay} className={cn(!goal.active && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold tracking-[-0.02em]">{goal.name}</h3>
          <p className="mt-0.5 text-sm text-muted">Target {usd(goal.targetAmount, 0)} by {shortDate(goal.deadline)}</p>
        </div>
        {goal.active ? <StatusPill tone="brand">Active</StatusPill> : <StatusPill>Off</StatusPill>}
      </div>

      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Saved</p>
          <p className="display mt-1 text-4xl">{usd(goal.progressUsd)}</p>
        </div>
        <p className="tabular pb-1 text-sm text-muted">{p.toFixed(p > 0 && p < 1 ? 1 : 0)}%</p>
      </div>
      <Progress value={p} label={`${goal.name} progress`} className="mt-4" />

      <dl className="mt-5 divide-y divide-line border-t border-line">
        <Row label="Strategy">{strategyText(goal.allowedAssets, goal.maxStockAllocationBps)}</Row>
        <Row label="Limits">{limitsText(goal.maxDailySpend, goal.maxStockAllocationBps)}</Row>
        <Row label="Today">
          <span className="tabular">{usd(goal.spentTodayUsd)}</span> <span className="text-muted">of {usd(goal.maxDailySpend)} daily limit used</span>
        </Row>
      </dl>

      <details className="group mt-2 text-sm">
        <summary className="inline-flex items-center gap-1 py-2 text-muted hover:text-ink">
          Advanced permissions <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 space-y-2 rounded-control bg-sunken/60 p-4 text-muted">
          <p>
            The Bloom Agent acts through a limited session key on your Bloom wallet. The rules above are enforced onchain; the key can&apos;t
            move more than them, and it expires at the deadline.
          </p>
          <div className="flex justify-between gap-3">
            <span>Agent session key</span>
            <span className="font-mono text-xs text-ink">{shortHash(goal.agent)}</span>
          </div>
          {goal.maxPerTx && (
            <div className="flex justify-between gap-3">
              <span>Per-action limit</span>
              <span className="tabular text-ink">{usd(goal.maxPerTx)}</span>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span>Goal ID</span>
            <span className="font-mono text-xs text-ink">{String(goal.goalId)}</span>
          </div>
          {goal.active && (
            <BloomButton variant="secondary" size="sm" className="mt-2" loading={busy} onClick={revoke}>
              Turn off autopilot
            </BloomButton>
          )}
        </div>
      </details>
    </BloomCard>
  );
}
