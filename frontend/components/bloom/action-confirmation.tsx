"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import type { ActionCard, ClaimSecret, ConfirmResult } from "@/lib/types";
import { errorMessage, kindFromConfirm, kindFromError, num, riskName, shortDate, shortHash, usd, type ResultKind } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWalletSign } from "@/hooks/use-wallet-sign";
import { BloomButton } from "./button";
import { ActionResult, Details } from "./states";
import { RiskState } from "./risk";
import { limitsText, strategyText } from "./goal-card";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-[15px]">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function CheckRow({ label, ok, message }: { label: string; ok: boolean; message?: string }) {
  return (
    <Row label={label}>
      <span className="inline-flex items-center gap-1.5 font-medium">
        {ok ? <ShieldCheck className="size-4 text-success" /> : <ShieldAlert className="size-4 text-danger" />}
        <span className={ok ? "text-success-text" : "text-danger-text"}>{ok ? "Passed" : "Not passed"}</span>
      </span>
      {!ok && message && <span className="mt-0.5 block text-sm text-muted">{message}</span>}
    </Row>
  );
}

function CopyField({ label, value, mono, big }: { label: string; value: string; mono?: boolean; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-control border border-line bg-cream p-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{label}</p>
        <p className={cn("truncate", mono && "font-mono", big ? "text-2xl font-semibold tracking-[0.3em]" : "text-sm")}>{value}</p>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-chip bg-surface px-3 text-sm font-medium shadow-sm hover:bg-sunken"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Claim link and code are separate fields; the code is never in the URL. */
export function ClaimShare({ claim }: { claim: ClaimSecret }) {
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/claim/${encodeURIComponent(claim.claimId)}`;
  return (
    <div className="mt-4 space-y-2">
      <CopyField label="Claim link" value={url} />
      <CopyField label="6-digit code" value={claim.code} mono big />
      <p className="text-sm text-muted">
        <span className="font-medium text-ink">Share the code separately</span>, for example by text message. It&apos;s shown only once. The
        link expires {shortDate(claim.expiresAt)}.
      </p>
    </div>
  );
}

const SUCCESS: Record<ActionCard["kind"], { button: string; title: string }> = {
  send: { button: "Sent", title: "Sent successfully." },
  goal: { button: "Done", title: "Your goal is on autopilot." },
  deposit: { button: "Saved", title: "Saved successfully." },
  invest: { button: "Done", title: "Invested successfully." },
  risk: { button: "Done", title: "Done." },
};

function Headline({ card }: { card: ActionCard }) {
  if (card.kind === "goal" && card.goal) {
    return (
      <>
        <p className="display text-4xl">{usd(card.goal.targetAmount, 0)}</p>
        <p className="mt-1.5 text-sm text-muted">
          for {card.goal.name} by {shortDate(card.goal.deadline)}
        </p>
      </>
    );
  }
  const stock = card.asset && card.asset !== "USDG";
  return (
    <>
      <p className="display text-4xl">
        {usd(card.amountUsd ?? card.amount)}
        {stock && <span className="text-2xl text-ink/45"> of {card.asset}</span>}
      </p>
      {stock && card.amount && (
        <p className="tabular mt-1.5 text-sm text-muted">
          ≈ {num(card.amount, 6)} {card.asset}
        </p>
      )}
      {card.kind === "deposit" && <p className="mt-1.5 text-sm text-muted">into USDG savings</p>}
    </>
  );
}

/**
 * Review → confirm → result for anything Bloom will do on your behalf.
 * `interactive=false` renders a static illustration (used on /welcome).
 */
export function ActionConfirmation({
  card,
  actionId,
  headline,
  interactive = true,
}: {
  card: ActionCard;
  actionId?: string;
  headline: string;
  interactive?: boolean;
}) {
  const [state, setState] = useState<{ kind: ResultKind; message?: string; result?: ConfirmResult } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { complete } = useWalletSign();
  useEffect(() => {
    if (state && state.kind !== "pending") ref.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state]);
  const pending = state?.kind === "pending";
  const succeeded = state?.kind === "success";
  const settled = cancelled || (state && !pending);

  if (card.kind === "risk") {
    return (
      <div className="max-w-md">
        <RiskState state={riskName(card.riskCheck?.state)} reason={card.riskCheck?.message} size="sm" />
      </div>
    );
  }

  async function confirm() {
    if (!actionId) return;
    setState({ kind: "pending" });
    try {
      const r = await api.confirm(actionId);
      if (r.status === "sign_required" && r.sign) {
        // goals are owner actions: your wallet signs them (the agent never can)
        const signed = (await complete({ sign: r.sign }))!;
        const done = { ...r, status: "executed" as const, txHashes: signed.txHashes, goalId: signed.goalId, message: "Goal created and on autopilot, within your rules." };
        setState({ kind: kindFromConfirm(done), message: done.message, result: done });
        return;
      }
      setState({ kind: kindFromConfirm(r), message: r.message, result: r });
    } catch (e) {
      setState({ kind: kindFromError(e), message: errorMessage(e) });
    }
  }

  const r = card.recipient;
  const network = card.network ?? "Robinhood Chain";
  const testnet = /testnet/i.test(network);
  const checksOk = (card.policyCheck?.ok ?? true) && (card.riskCheck?.ok ?? true);
  const meta = SUCCESS[card.kind];

  return (
    <div ref={ref} className="w-full max-w-md scroll-mb-48 rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
      {/* When a check fails, the rows explain why; keep the headline to its first sentence. */}
      <p className="text-[15px] font-medium text-pretty">{checksOk ? headline : headline.split(/(?<=\.)\s/)[0]}</p>
      <div className="mt-5">
        <Headline card={card} />
      </div>

      <dl className="mt-5 divide-y divide-line border-t border-line">
        {r && (
          <Row label="To">
            {r.name}
            <span className="block text-sm text-muted">{r.viaClaimLink ? "via a claim link" : r.address ? shortHash(r.address) : ""}</span>
          </Row>
        )}
        {card.kind === "goal" && card.goal && (
          <>
            <Row label="Strategy">{strategyText(card.goal.allowedAssets, card.goal.maxStockAllocationBps)}</Row>
            <Row label="Limits">{limitsText(card.goal.maxDailySpend, card.goal.maxStockAllocationBps)}</Row>
          </>
        )}
        <Row label="Network">
          Robinhood Chain{testnet && <span className="text-muted"> · Testnet</span>}
        </Row>
        {card.riskCheck && <CheckRow label="Risk check" ok={card.riskCheck.ok} message={card.riskCheck.message} />}
        {card.policyCheck && <CheckRow label="Policy check" ok={card.policyCheck.ok} message={card.policyCheck.message} />}
      </dl>

      {card.steps && card.steps.length > 0 && (
        <Details summary="What Bloom will do" className="mt-2">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink/80">
            {card.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="text-xs">Network: {network}</p>
        </Details>
      )}

      {state && !pending && !succeeded && (
        <ActionResult kind={state.kind} message={state.message} txHashes={state.result?.txHashes} className="mt-5" />
      )}
      {succeeded && (
        <div className="mt-5" role="status" aria-live="polite">
          <p className="font-medium">{meta.title}</p>
          {state.result?.claim && <ClaimShare claim={state.result.claim} />}
          <Details txHashes={state.result?.txHashes} className="mt-3" />
        </div>
      )}
      {cancelled && <p className="mt-5 text-sm text-muted">Cancelled. Nothing was sent.</p>}

      {actionId && (!settled || succeeded) && (
        <div className="mt-5 flex flex-wrap gap-2">
          <BloomButton
            className="flex-1"
            onClick={interactive ? confirm : undefined}
            loading={pending}
            success={succeeded && meta.button}
          >
            {pending ? "Confirming…" : card.kind === "goal" ? "Put your goal on autopilot" : "Confirm"}
          </BloomButton>
          {!succeeded && (
            <BloomButton variant="secondary" disabled={pending} onClick={() => setCancelled(true)} icon={<X />}>
              Cancel
            </BloomButton>
          )}
        </div>
      )}
      {!actionId && !checksOk && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-muted">Nothing will move until this is resolved.</p>
          {card.policyCheck?.reason === "NO_ACTIVE_POLICY" && (
            <BloomButton href="/agent" variant="secondary" size="sm">
              Create a goal
            </BloomButton>
          )}
        </div>
      )}
    </div>
  );
}
