"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, DollarSign, Droplets, PiggyBank, Target, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { MAINNET_CHAIN_ID, useConfig, useQuery } from "@/hooks/use-api";
import { errorMessage, num, pct, RISK_LABEL, riskName, signedUsd, usd, windowLabel } from "@/lib/format";
import type { Account } from "@/lib/types";
import { AmountDialog } from "@/components/bloom/amount-dialog";
import { LessonCard } from "@/components/bloom/lesson-card";
import { BloomBalance } from "@/components/bloom/balance";
import { BloomButton } from "@/components/bloom/button";
import { BloomCard, SectionHeader } from "@/components/bloom/card";
import { AssetRow } from "@/components/bloom/asset-row";
import { PortfolioChart } from "@/components/bloom/portfolio-chart";
import { GoalSummary } from "@/components/bloom/goal-card";
import { AgentCard } from "@/components/bloom/agent-card";
import { StatusPill } from "@/components/bloom/status-pill";
import { EmptyState, ErrorState, Skeleton } from "@/components/bloom/states";

const noop = () => () => {};
function useGreeting() {
  const hour = useSyncExternalStore(noop, () => new Date().getHours(), () => null);
  if (hour === null) return "Welcome back.";
  return hour < 5 ? "Good evening." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

function FaucetCard({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<{ busy?: boolean; ok?: string; error?: string }>({});
  async function run() {
    setState({ busy: true });
    try {
      const r = await api.faucet();
      setState({ ok: `Added ${num(r.amount)} USDG` });
      onDone();
    } catch (e) {
      setState({ error: errorMessage(e) });
    }
  }
  return (
    <BloomCard tone="flat" delay={0.2} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Droplets className="mt-0.5 size-4 shrink-0 text-muted" />
        <div>
          <p className="text-sm font-medium">Get test USDG</p>
          <p className="text-sm text-muted" role={state.error ? "alert" : undefined}>
            {state.error ?? "Testnet only. 1,000 mock USDG, once a day."}
          </p>
        </div>
      </div>
      <BloomButton variant="secondary" size="sm" loading={state.busy} success={state.ok} onClick={run}>
        Get test USDG
      </BloomButton>
    </BloomCard>
  );
}

function YourMoney({ acct, changes }: { acct: Account; changes?: Record<string, { changeBps: number | null }> }) {
  const total = Math.max(0.0001, Number(acct.totalUsd));
  const held = acct.stocks.filter((s) => Number(s.balance) > 0);
  const share = (v: string | number) => (Number(v) / total) * 100;
  return (
    <ul className="divide-y divide-line">
      <AssetRow symbol="USDG" brand icon={<DollarSign />} name="Cash" detail={`${num(acct.usdg.balance, 2)} USDG`} valueUsd={Number(acct.usdg.valueUsd)} allocation={share(acct.usdg.valueUsd)} />
      <AssetRow
        symbol="SAVE"
        brand
        icon={<PiggyBank />}
        name="Savings"
        detail={
          acct.savings.apyBps > 0
            ? `Earning ${pct(acct.savings.apyBps, 1)} APY${Number(acct.savings.earnedTodayUsd) > 0 ? ` · +${usd(acct.savings.earnedTodayUsd)} today` : ""}`
            : "USDG savings"
        }
        valueUsd={Number(acct.savings.valueUsd)}
        allocation={share(acct.savings.valueUsd)}
      />
      {held.map((s) => {
        const risk = riskName(s.riskState);
        return (
          <AssetRow
            key={s.symbol}
            symbol={s.symbol}
            name={s.symbol}
            detail={`${num(s.balance, 6)} ${s.symbol} · ${usd(s.priceUsd)}`}
            valueUsd={Number(s.valueUsd)}
            allocation={share(s.valueUsd)}
            movementBps={changes?.[s.symbol]?.changeBps}
            note={risk !== "NORMAL" && <StatusPill tone="bad">Risk: {RISK_LABEL[risk]}</StatusPill>}
          />
        );
      })}
      {held.length === 0 && (
        <li className="flex items-center justify-between gap-4 py-4 text-sm">
          <span className="text-muted">No Robinhood Stock Tokens yet.</span>
          <Link href="/chat?q=Send%20Sarah%20%245%20of%20QQQ." className="shrink-0 font-medium underline-offset-4 hover:underline">
            Explore
          </Link>
        </li>
      )}
    </ul>
  );
}

export default function HomePage() {
  const greeting = useGreeting();
  const config = useConfig();
  const account = useQuery(api.account);
  const history = useQuery(api.history);
  const goals = useQuery(api.goals);
  const [dialog, setDialog] = useState<"save" | "invest" | null>(null);
  const acct = account.data;
  const h = history.data;
  const activeGoal = goals.data?.find((g) => g.active);

  function refresh() {
    void account.reload();
    void history.reload();
    void goals.reload();
  }

  const change = h?.windowChangeUsd;
  const secondary =
    change !== null && change !== undefined && Math.abs(change) >= 0.005 ? (
      <>
        <span className="tabular font-medium text-ink">{signedUsd(change)}</span> change in total value {windowLabel(h?.windowSinceSec)}
      </>
    ) : acct && acct.savings.apyBps > 0 ? (
      <>Earning {pct(acct.savings.apyBps, 1)} on savings</>
    ) : null;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-14">
      <div className="min-w-0 space-y-10">
        <section aria-labelledby="balance-heading">
          <h1 id="balance-heading" className="text-2xl font-semibold tracking-[-0.025em]">
            {greeting}
          </h1>
          {account.loading ? (
            <div className="mt-8 space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-16 w-72" />
              <Skeleton className="h-4 w-56" />
            </div>
          ) : account.error || !acct ? (
            <ErrorState error={account.error} onRetry={account.reload} className="mt-8" />
          ) : (
            <>
              <BloomBalance className="mt-8" label="Total balance · USDG" value={Number(acct.totalUsd)}>
                {secondary && <p className="mt-3 text-[15px] text-muted">{secondary}</p>}
              </BloomBalance>
              <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {[
                  ["Cash", acct.usdg.valueUsd],
                  ["Savings", acct.savings.valueUsd],
                  ["Stock Tokens", acct.stocks.reduce((a, s) => a + Number(s.valueUsd), 0)],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex gap-1.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className="tabular font-medium">{usd(v)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <div className="mt-8 grid grid-cols-3 gap-2 sm:flex sm:gap-3">
            <BloomButton onClick={() => setDialog("save")} icon={<ArrowDownToLine />} className="max-sm:px-2">
              Save
            </BloomButton>
            <BloomButton variant="secondary" href={`/chat?q=${encodeURIComponent("Send Sarah $5 of QQQ.")}`} className="max-sm:px-2">
              <ArrowUpRight /> Send
            </BloomButton>
            <BloomButton variant="secondary" onClick={() => setDialog("invest")} icon={<TrendingUp />} className="max-sm:px-2">
              Invest
            </BloomButton>
          </div>
        </section>

        <section aria-label="Balance history">
          <p className="mb-2 text-sm font-medium text-muted">Balance history</p>
          {history.loading ? <Skeleton className="h-36" /> : <PortfolioChart points={h?.points ?? []} />}
        </section>

        <section aria-labelledby="money-heading">
          <SectionHeader id="money-heading" title="Your money" />
          <BloomCard className="py-1 sm:py-1" delay={0.05}>
            {account.loading ? (
              <div className="space-y-3 py-4">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : acct ? (
              <YourMoney acct={acct} changes={h?.assetChanges} />
            ) : (
              <p className="py-5 text-sm text-muted">Your balances will show here once Bloom connects.</p>
            )}
          </BloomCard>
        </section>
      </div>

      <aside className="min-w-0 space-y-6">
        <section aria-labelledby="goals-heading">
          <SectionHeader
            id="goals-heading"
            title="Your goals"
            action={
              <Link href="/agent" className="text-sm text-muted hover:text-ink">
                See all
              </Link>
            }
          />
          {goals.loading ? (
            <Skeleton className="h-28 rounded-card" />
          ) : goals.error ? (
            <p className="rounded-card border border-line px-5 py-6 text-sm text-muted">Your goals will show here once Bloom connects.</p>
          ) : goals.data?.some((g) => g.active) ? (
            <BloomCard className="py-1 sm:py-1" delay={0.1}>
              <ul className="divide-y divide-line">
                {goals.data
                  .filter((g) => g.active)
                  .slice(0, 3)
                  .map((g) => (
                    <GoalSummary key={String(g.goalId)} goal={g} />
                  ))}
              </ul>
            </BloomCard>
          ) : (
            <EmptyState
              icon={<Target />}
              title="No goals yet"
              action={
                <BloomButton href="/agent" variant="secondary" size="sm">
                  Create a goal <ArrowRight />
                </BloomButton>
              }
            >
              Tell Bloom what you&apos;re saving for, like a laptop or a trip.
            </EmptyState>
          )}
        </section>

        <AgentCard goal={activeGoal} delay={0.15} />
        {config?.chainId !== MAINNET_CHAIN_ID && <FaucetCard onDone={refresh} />}
        <LessonCard onComplete={refresh} delay={0.25} />
      </aside>

      <AmountDialog
        open={dialog === "save"}
        onOpenChange={(o) => setDialog(o ? "save" : null)}
        title="Save"
        description="Move USDG from cash into Bloom savings."
        cta="Save"
        successLabel="Saved"
        available={acct ? usd(acct.usdg.valueUsd) : undefined}
        onSubmit={async (amount) => {
          const r = await api.deposit(amount);
          return { txHashes: [r.txHash], message: `${usd(amount)} is now in savings.` };
        }}
        onDone={refresh}
      />
      <AmountDialog
        open={dialog === "invest"}
        onOpenChange={(o) => setDialog(o ? "invest" : null)}
        title="Invest"
        description="A conservative mix: 70% savings, 30% QQQ Stock Token."
        cta="Invest"
        available={acct ? usd(acct.usdg.valueUsd) : undefined}
        note="Robinhood Stock Tokens give economic exposure to the underlying price and can fall in value. Availability is jurisdiction-dependent."
        onSubmit={async (amount) => {
          const r = await api.invest(amount);
          return {
            txHashes: r.steps.map((s) => s.txHash).filter(Boolean),
            message: `Invested ${usd(amount)} across savings and QQQ.`,
          };
        }}
        onDone={refresh}
      />
    </div>
  );
}
