"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import type { Scenario } from "@/lib/types";
import { errorMessage, RISK_LABEL } from "@/lib/format";
import { BloomButton } from "./button";
import { StatusPill } from "./status-pill";

const SCENARIOS: { s: Scenario; label: string }[] = [
  { s: "HALT", label: "Simulate halt" },
  { s: "STALE", label: "Simulate stale price" },
  { s: "DEVIATION", label: "Simulate deviation" },
  { s: "CORP_ACTION", label: "Simulate corporate action" },
  { s: "SEQUENCER_DOWN", label: "Simulate sequencer down" },
];

/** Developer/demo tool. Sends real testnet transactions to the mock feeds. Hidden on mainnet by the caller. */
export function DemoControls({ symbols, onDone }: { symbols: string[]; onDone: () => void }) {
  const [symbol, setSymbol] = useState(symbols[0] ?? "AAPL");
  const [busy, setBusy] = useState<Scenario | null>(null);
  const [done, setDone] = useState<Scenario | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(s: Scenario) {
    setBusy(s);
    setDone(null);
    setStatus(null);
    try {
      const r = await api.simulate(symbol, s);
      setDone(s);
      setStatus({ ok: true, text: `${symbol} is now: ${RISK_LABEL[r.stateName] ?? r.stateName}.` });
      setTimeout(() => setDone((d) => (d === s ? null : d)), 1800);
      onDone();
    } catch (e) {
      setStatus({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="sim-heading" className="mb-8 rounded-card border border-dashed border-line-strong p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 id="sim-heading" className="text-sm font-semibold">
            Risk simulation
          </h2>
          <StatusPill tone="neutral">Demo mode</StatusPill>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Asset
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="h-9 rounded-chip border border-line-strong bg-surface px-3 text-sm font-medium text-ink"
          >
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {SCENARIOS.map(({ s, label }) => (
          <BloomButton key={s} variant="secondary" size="sm" disabled={busy !== null} loading={busy === s} success={done === s && "Done"} onClick={() => run(s)}>
            {label}
          </BloomButton>
        ))}
        <BloomButton variant="quiet" size="sm" disabled={busy !== null} loading={busy === "RESET"} success={done === "RESET" && "Reset"} icon={<RotateCcw />} onClick={() => run("RESET")}>
          Reset
        </BloomButton>
      </div>
      <p className="mt-3 min-h-5 text-sm text-muted" role="status">
        {status ? status.text : "Each action sends real testnet transactions to Bloom's mock feeds."}
      </p>
    </section>
  );
}
