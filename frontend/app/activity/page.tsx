"use client";

import { Clock3 } from "lucide-react";
import { api } from "@/lib/api";
import { useQuery } from "@/hooks/use-api";
import { dayLabel } from "@/lib/format";
import type { ActivityItem } from "@/lib/types";
import { BloomCard, PageHero } from "@/components/bloom/card";
import { TransactionRow } from "@/components/bloom/transaction-row";
import { EmptyState, ErrorState, Skeleton } from "@/components/bloom/states";

function group(items: ActivityItem[]) {
  const out: { label: string; items: ActivityItem[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.timestamp);
    const last = out.at(-1);
    if (last?.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

// "ActionExecuted" fires once per agent step (approvals, swaps, sends); the meaningful
// events (Sent, Bought, Saved…) are already listed, so the step markers are hidden.
const visible = (items: ActivityItem[]) => items.filter((a) => a.type !== "ActionExecuted");

export default function ActivityPage() {
  const { data: raw, error, loading, reload } = useQuery(api.activity, 15000);
  const data = raw && visible(raw);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHero eyebrow="Activity" title="Everything that happened." subtitle="Your saves, sends, goals and every time Bloom paused something to protect you." />
      {error != null && !data && <ErrorState error={error} onRetry={reload} className="mb-4" />}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      ) : data && data.length === 0 ? (
        <EmptyState icon={<Clock3 />} title="Nothing here yet">
          Saves, sends, goals and risk events will show up here as they happen.
        </EmptyState>
      ) : data ? (
        <div className="space-y-8">
          {group(data).map((g, i) => (
            <section key={g.label} aria-labelledby={`day-${i}`}>
              <h2 id={`day-${i}`} className="mb-2 text-sm font-medium text-muted">
                {g.label}
              </h2>
              <BloomCard className="py-1 sm:py-1" delay={Math.min(i, 4) * 0.04}>
                <ul className="divide-y divide-line">
                  {g.items.map((a, j) => (
                    <TransactionRow key={`${a.txHash}-${j}`} item={a} />
                  ))}
                </ul>
              </BloomCard>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
