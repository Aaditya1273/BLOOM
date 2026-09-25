"use client";

import { ArrowDown, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import type { RiskAsset, RiskSnapshot } from "@/lib/types";
import { MAINNET_CHAIN_ID, useConfig, useQuery } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { age, pct, RISK_LABEL, usd } from "@/lib/format";
import { BloomCard, PageHero, SectionHeader } from "@/components/bloom/card";
import { RiskMetric, RiskState } from "@/components/bloom/risk";
import { DemoControls } from "@/components/bloom/demo-controls";
import { StatusPill } from "@/components/bloom/status-pill";
import { ErrorState, Skeleton } from "@/components/bloom/states";
import { cn } from "@/lib/utils";

const ORDER = ["AAPL", "SPY", "NVDA", "QQQ"];
const sortAssets = (a: RiskAsset[]) => [...a].sort((x, y) => (ORDER.indexOf(x.symbol) + 1 || 99) - (ORDER.indexOf(y.symbol) + 1 || 99));

function sequencerText(s: RiskSnapshot["sequencer"]) {
  if (!s.required) return "Not configured";
  return s.up ? "Available" : "Down";
}

function FeaturedAsset({ a, seq }: { a: RiskAsset; seq: RiskSnapshot["sequencer"] }) {
  const stale = a.stateName === "STALE";
  return (
    <BloomCard as="article" className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12" aria-label={`${a.symbol} risk`}>
      <div className="min-w-0">
        <p className="text-sm text-muted">Robinhood Stock Token</p>
        <div className="mt-1 flex items-baseline gap-3">
          <h2 className="text-3xl font-semibold tracking-[-0.03em]">{a.symbol}</h2>
          <p className="display text-3xl text-ink/80">{usd(a.priceUsd)}</p>
        </div>
        <RiskState state={a.stateName} reason={a.reason} className="mt-6" />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 divide-line sm:grid-cols-3 lg:grid-cols-2 [&>div]:border-b [&>div]:border-line">
        <RiskMetric label="Oracle" value={stale ? "Stale" : "Fresh"} bad={stale} hint={`Updated ${age(a.oracleAgeSec)} ago`} />
        <RiskMetric label="Trading halt" value={a.halted ? "Yes" : "No"} bad={a.halted} />
        <RiskMetric label="Corporate action" value={a.corporateActionPaused ? "Yes" : "No"} bad={a.corporateActionPaused} />
        <RiskMetric label="Deviation" value={pct(a.deviationBps, 2)} bad={a.stateName === "DEVIATION"} hint={`Reference ${usd(a.referencePriceUsd)}`} />
        <RiskMetric label="Sequencer" value={sequencerText(seq)} bad={seq.required && !seq.up} />
        <RiskMetric label="Borrowing" value={a.borrowingAllowed ? "Enabled" : "Disabled"} bad={!a.borrowingAllowed} />
        <RiskMetric label="Max LTV" value={pct(a.maxLtvBps)} bad={a.maxLtvBps === 0} />
        <RiskMetric label="Liquidation" value={a.liquidationAllowed ? "Allowed" : "Paused"} bad={!a.liquidationAllowed} />
      </dl>
    </BloomCard>
  );
}

function AssetLine({ a }: { a: RiskAsset }) {
  const normal = a.stateName === "NORMAL";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[100px_minmax(0,1fr)_140px_120px]">
      <div>
        <p className="font-semibold">{a.symbol}</p>
        <p className="tabular text-sm text-muted">{usd(a.priceUsd)}</p>
      </div>
      <div className="justify-self-end sm:justify-self-start">
        <StatusPill tone={normal ? "ok" : "bad"}>{normal ? "Normal" : RISK_LABEL[a.stateName]}</StatusPill>
      </div>
      <p className={cn("text-sm", !a.borrowingAllowed ? "text-danger-text" : "text-muted")}>
        Borrowing {a.borrowingAllowed ? "enabled" : "disabled"}
      </p>
      <p className="tabular text-right text-sm text-muted sm:text-left">Max LTV {pct(a.maxLtvBps)}</p>
      {!normal && <p className="col-span-full text-sm text-ink/75">{a.reason}</p>}
    </li>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="grid place-items-center text-muted">
      <ArrowDown className="size-4 lg:hidden" />
      <ArrowRight className="hidden size-4 lg:block" />
    </span>
  );
}

function HowItWorks({ engine }: { engine?: string }) {
  const inputs = ["Oracle price", "Trading halts", "Corporate actions", "Price freshness", "Deviation", "Sequencer uptime"];
  return (
    <section aria-labelledby="how-heading" className="mt-16">
      <SectionHeader id="how-heading" title="How it works" />
      <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_auto_minmax(0,0.8fr)_auto_minmax(0,0.8fr)]">
        <ul className="flex flex-wrap gap-2">
          {inputs.map((i) => (
            <li key={i} className="rounded-chip border border-line bg-surface px-3 py-1.5 text-sm">
              {i}
            </li>
          ))}
        </ul>
        <Arrow />
        <div className="rounded-control bg-ink px-4 py-3 text-surface">
          <p className="font-medium">Bloom Risk Engine</p>
          <p className="text-sm text-surface/70">{engine === "stylus" ? "Arbitrum Stylus" : engine ? "EVM reference build" : "Onchain"}</p>
        </div>
        <Arrow />
        <div className="rounded-control border border-line bg-surface px-4 py-3">
          <p className="font-medium">Risk state</p>
          <p className="text-sm text-muted">Normal or paused</p>
        </div>
        <Arrow />
        <div className="rounded-control border border-line bg-surface px-4 py-3">
          <p className="font-medium">Vault &amp; agent</p>
          <p className="text-sm text-muted">Allow or pause</p>
        </div>
      </div>
      <p className="mt-10 max-w-2xl text-2xl font-semibold tracking-[-0.025em] text-balance">
        Bloom doesn&apos;t replace the price oracle. It adds equity-specific risk interpretation around it.
      </p>
    </section>
  );
}

export default function RiskPage() {
  const { role } = useAuth();
  const risk = useQuery(api.risk, 3000);
  const health = useQuery(api.health);
  const config = useConfig();
  const assets = risk.data ? sortAssets(risk.data.assets) : [];
  const seq = risk.data?.sequencer;
  const [featured, ...rest] = assets;

  return (
    <div>
      <PageHero
        eyebrow="Risk"
        title="Equity-aware risk controls."
        subtitle="Bloom checks market conditions before allowing collateral-based actions."
        action={
          seq && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <span aria-hidden className="size-1.5 rounded-full bg-success" /> Live · checks every 3 seconds
            </p>
          )
        }
      />

      {risk.error != null && !risk.data && <ErrorState error={risk.error} onRetry={risk.reload} className="mb-6" />}

      {/* admin-only: the backend enforces this too (403 for non-admin sessions) */}
      {role === "admin" && config && config.chainId !== MAINNET_CHAIN_ID && assets.length > 0 && (
        <DemoControls symbols={assets.map((a) => a.symbol)} onDone={risk.reload} />
      )}

      {risk.loading ? (
        <div className="space-y-4">
          <Skeleton className="h-80 rounded-card" />
          <Skeleton className="h-48 rounded-card" />
        </div>
      ) : featured && seq ? (
        <div className="space-y-6">
          <FeaturedAsset a={featured} seq={seq} />
          {rest.length > 0 && (
            <BloomCard className="py-1 sm:py-1" delay={0.05} aria-label="Other assets">
              <ul className="divide-y divide-line">
                {rest.map((a) => (
                  <AssetLine key={a.symbol} a={a} />
                ))}
              </ul>
            </BloomCard>
          )}
        </div>
      ) : null}

      <HowItWorks engine={health.data?.riskEngineImpl} />
    </div>
  );
}
