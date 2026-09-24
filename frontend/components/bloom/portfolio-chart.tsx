"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { usd } from "@/lib/format";
import type { History } from "@/lib/types";

function when(t: number) {
  return new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Editorial balance line: thin stroke, soft pink fade, no grid. */
export function PortfolioChart({ points, height = 140 }: { points: History["points"]; height?: number }) {
  const distinct = new Set(points.map((p) => p.t)).size;
  if (distinct < 2) {
    return (
      <div style={{ height }} className="relative flex items-end">
        <div aria-hidden className="absolute inset-x-0 bottom-8 border-t border-dashed border-line-strong" />
        <p className="relative text-sm text-muted">Your balance history will appear here.</p>
      </div>
    );
  }
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure aria-label={`Total balance from ${when(first.t)} (${usd(first.totalUsd)}) to now (${usd(last.totalUsd)})`}>
      <div style={{ height }} className="-mx-1">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
          <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="bloom-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--bloom-pink)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--bloom-pink)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
            <Tooltip
              cursor={{ stroke: "var(--bloom-border-strong)", strokeWidth: 1 }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-chip border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                    <p className="tabular font-medium">{usd(payload[0].payload.totalUsd)}</p>
                    <p className="text-muted">{when(payload[0].payload.t)}</p>
                  </div>
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="totalUsd"
              stroke="var(--bloom-ink)"
              strokeWidth={1.5}
              fill="url(#bloom-area)"
              isAnimationActive={false}
              activeDot={{ r: 3.5, fill: "var(--bloom-pink-strong)", stroke: "var(--bloom-surface)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex justify-between text-xs text-muted">
        <span>{new Date(first.t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <span>Now</span>
      </figcaption>
    </figure>
  );
}
