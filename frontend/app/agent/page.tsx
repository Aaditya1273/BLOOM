"use client";

import { useState } from "react";
import { ArrowRightLeft, PauseCircle, PiggyBank, Send, Target } from "lucide-react";
import { api } from "@/lib/api";
import type { GoalCreated, GoalParams } from "@/lib/types";
import { useConfig, useQuery } from "@/hooks/use-api";
import { errorMessage, kindFromError, pct, shortDate, shortHash, type ResultKind } from "@/lib/format";
import { BloomCard, PageHero, SectionHeader } from "@/components/bloom/card";
import { BloomButton } from "@/components/bloom/button";
import { GoalCard, limitsText, strategyText } from "@/components/bloom/goal-card";
import { ActionResult, Details, EmptyState, ErrorState, Skeleton } from "@/components/bloom/states";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-control border border-line bg-cream px-3.5 text-[15px] outline-none transition-colors focus:border-ink disabled:opacity-60";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function GoalEditor({ initial, onActivated }: { initial: GoalParams; onActivated: () => void }) {
  const config = useConfig();
  const [g, setG] = useState<GoalParams>(initial);
  const [result, setResult] = useState<{ kind: ResultKind; message?: string; created?: GoalCreated } | null>(null);
  const set = <K extends keyof GoalParams>(k: K, v: GoalParams[K]) => setG((p) => ({ ...p, [k]: v }));
  const stockOptions = Array.from(
    new Set([...(config?.assets.filter((a) => a.kind === "STOCK_TOKEN").map((a) => a.symbol) ?? []), ...initial.allowedAssets.filter((a) => a !== "USDG")]),
  );
  const pending = result?.kind === "pending";
  const done = result?.kind === "success";

  async function activate() {
    setResult({ kind: "pending" });
    try {
      const r = await api.createGoal(g);
      setResult({ kind: "success", created: r });
      onActivated();
    } catch (e) {
      setResult({ kind: kindFromError(e), message: errorMessage(e) });
    }
  }

  return (
    <div className="mt-6 border-t border-line pt-6">
      <p className="text-sm font-medium text-muted">Review your goal</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Goal">
          <input className={input} value={g.name} onChange={(e) => set("name", e.target.value)} disabled={done} />
        </Field>
        <Field label="Target (USDG)">
          <input className={cn(input, "tabular")} inputMode="decimal" value={g.targetAmount} onChange={(e) => set("targetAmount", e.target.value.replace(/[^0-9.]/g, ""))} disabled={done} />
        </Field>
        <Field label="Deadline">
          <input
            type="date"
            className={input}
            value={g.deadline.slice(0, 10)}
            onChange={(e) => e.target.value && set("deadline", new Date(`${e.target.value}T23:59:59Z`).toISOString())}
            disabled={done}
          />
        </Field>
        <Field label="Daily limit (USDG)">
          <input className={cn(input, "tabular")} inputMode="decimal" value={g.maxDailySpend} onChange={(e) => set("maxDailySpend", e.target.value.replace(/[^0-9.]/g, ""))} disabled={done} />
        </Field>
      </div>
      <div className="mt-5">
        <Field label={`Stock Tokens: up to ${pct(g.maxStockAllocationBps)}`}>
          <input
            type="range"
            min={0}
            max={10000}
            step={500}
            value={g.maxStockAllocationBps}
            onChange={(e) => set("maxStockAllocationBps", Number(e.target.value))}
            className="mt-1 w-full accent-[var(--bloom-ink)]"
            disabled={done}
          />
        </Field>
      </div>
      <fieldset className="mt-4" disabled={done}>
        <legend className="mb-2 text-sm font-medium">Approved Stock Tokens</legend>
        <div className="flex flex-wrap gap-2">
          {stockOptions.map((a) => {
            const on = g.allowedAssets.includes(a);
            return (
              <label
                key={a}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-chip border px-3 text-sm transition-colors",
                  on ? "border-ink bg-surface font-medium" : "border-line text-muted hover:border-line-strong",
                )}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--bloom-ink)]"
                  checked={on}
                  onChange={() => set("allowedAssets", on ? g.allowedAssets.filter((x) => x !== a) : [...g.allowedAssets, a])}
                />
                {a}
              </label>
            );
          })}
        </div>
      </fieldset>

      <dl className="mt-6 space-y-2 rounded-control bg-pink-soft p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-x-4">
          <dt className="font-medium">Strategy</dt>
          <dd>{strategyText(g.allowedAssets, g.maxStockAllocationBps)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4">
          <dt className="font-medium">Limits</dt>
          <dd>{limitsText(g.maxDailySpend, g.maxStockAllocationBps)}</dd>
        </div>
      </dl>

      {result && result.kind !== "pending" && result.kind !== "success" && <ActionResult kind={result.kind} message={result.message} className="mt-4" />}
      {done && result.created && (
        <p className="mt-4 text-sm" role="status">
          <span className="font-medium">Your goal is on autopilot.</span> The Bloom Agent can act until {shortDate(result.created.expiresAt)}, only within these limits.
        </p>
      )}

      <BloomButton size="lg" className="mt-5 w-full" loading={pending} success={done && "Done"} onClick={activate}>
        {pending ? "Setting up…" : "Put your goal on autopilot"}
      </BloomButton>

      <Details summary="Advanced permissions" className="mt-4">
        <p>
          You sign this once from your Bloom wallet. It records the goal onchain and gives the Bloom Agent a limited session key: it can only
          use approved assets, can&apos;t exceed {g.maxPerTx ? `$${g.maxPerTx} per action or ` : ""}${g.maxDailySpend} per day, and expires at the deadline.
        </p>
        {result?.created && (
          <div className="flex justify-between gap-3">
            <span className="text-xs">Session key</span>
            <span className="font-mono text-xs text-ink">{shortHash(result.created.sessionKey)}</span>
          </div>
        )}
      </Details>
      {result?.created && <Details txHashes={result.created.txHashes} className="mt-2" />}
    </div>
  );
}

function GoalComposer({ onActivated }: { onActivated: () => void }) {
  const [text, setText] = useState("Save $500 for my laptop by December 15.");
  const [preview, setPreview] = useState<{ goal: GoalParams; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function doPreview(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.previewGoal(text);
      setPreview({ goal: r.goal, key: Date.now() });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BloomCard id="new-goal" aria-label="Create a goal">
      <form onSubmit={doPreview}>
        <label htmlFor="goal-text" className="text-sm font-medium text-muted">
          What are you saving for?
        </label>
        <textarea
          id="goal-text"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-2 w-full resize-none bg-transparent text-xl leading-snug font-medium tracking-[-0.02em] outline-none placeholder:text-muted"
          placeholder="Save $500 for my laptop by December 15."
        />
        <div className="mt-3 flex justify-end">
          <BloomButton type="submit" variant={preview ? "secondary" : "primary"} loading={busy} disabled={!text.trim()}>
            {preview ? "Preview again" : "Preview"}
          </BloomButton>
        </div>
      </form>
      {error != null && <ActionResult kind={kindFromError(error)} message={errorMessage(error)} className="mt-4" />}
      {preview && <GoalEditor key={preview.key} initial={preview.goal} onActivated={onActivated} />}
    </BloomCard>
  );
}

const CAN_DO = [
  { icon: PiggyBank, title: "Save toward goals", body: "Moves USDG into savings, within your daily limit." },
  { icon: ArrowRightLeft, title: "Move approved assets", body: "Only the Stock Tokens you approve, within your allocation." },
  { icon: Send, title: "Send supported assets", body: "Always asks you to confirm before anything is sent." },
  { icon: PauseCircle, title: "Pause when risk changes", body: "Stops automatically if an asset leaves its normal risk state." },
];

export default function GoalsPage() {
  const goals = useQuery(api.goals);
  const list = goals.data ?? [];

  return (
    <div>
      <PageHero
        eyebrow="Goals"
        title="Your money, working toward your goals."
        subtitle="Describe a goal in plain words. Bloom turns it into limits the agent can never exceed, and you can turn it off at any time."
      />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-12">
        <section aria-labelledby="goals-heading" className="min-w-0">
          <SectionHeader id="goals-heading" title="Your goals" />
          {goals.loading ? (
            <Skeleton className="h-72 rounded-card" />
          ) : goals.error ? (
            <ErrorState error={goals.error} onRetry={goals.reload} />
          ) : list.length === 0 ? (
            <EmptyState icon={<Target />} title="No goals yet">
              Start with something you&apos;re saving for. You&apos;ll review every limit before it goes live.
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {[...list]
                .sort((a, b) => Number(b.active) - Number(a.active))
                .map((g, i) => (
                  <GoalCard key={String(g.goalId)} goal={g} onRevoked={goals.reload} delay={i * 0.05} />
                ))}
            </div>
          )}
        </section>

        <div className="min-w-0 space-y-10">
          <section aria-labelledby="create-heading">
            <SectionHeader id="create-heading" title="Create a goal" />
            <GoalComposer onActivated={goals.reload} />
          </section>
          <section aria-labelledby="can-heading">
            <SectionHeader id="can-heading" title="What Bloom can do" />
            <ul className="space-y-5">
              {CAN_DO.map((c) => (
                <li key={c.title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken">
                    <c.icon className="size-[18px]" />
                  </span>
                  <div>
                    <p className="font-medium">{c.title}</p>
                    <p className="text-sm text-muted">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
