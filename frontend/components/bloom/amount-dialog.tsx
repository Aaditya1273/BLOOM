"use client";

import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, kindFromError, type ResultKind } from "@/lib/format";
import { ActionResult } from "./states";
import { BloomButton } from "./button";

export interface AmountOutcome {
  txHashes: string[];
  message: string;
}

const PRESETS = ["25", "50", "100"];

/** Amount → confirm → result. Used for Save and Invest. */
export function AmountDialog({
  open,
  onOpenChange,
  title,
  description,
  cta,
  successLabel = "Done",
  defaultAmount = "50",
  available,
  note,
  onSubmit,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  cta: string;
  successLabel?: string;
  defaultAmount?: string;
  available?: string;
  note?: ReactNode;
  onSubmit: (amount: string) => Promise<AmountOutcome>;
  onDone?: () => void;
}) {
  const [amount, setAmount] = useState(defaultAmount);
  const [result, setResult] = useState<{ kind: ResultKind; message?: string; txHashes?: string[] } | null>(null);
  const valid = Number(amount) > 0;
  const pending = result?.kind === "pending";
  const done = result?.kind === "success";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending || done) return;
    setResult({ kind: "pending", message: "Waiting for onchain confirmation…" });
    try {
      const r = await onSubmit(amount);
      setResult({ kind: "success", ...r });
      onDone?.();
    } catch (err) {
      setResult({ kind: kindFromError(err), message: errorMessage(err) });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setResult(null);
      }}
    >
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <form onSubmit={submit} className="mt-6 space-y-5">
          <label className="block">
            <span className="text-sm font-medium text-muted">Amount</span>
            <div className="mt-2 flex items-baseline gap-1 rounded-control border border-line bg-cream px-4 py-3 focus-within:border-ink">
              <span className="display text-4xl text-muted">$</span>
              <input
                inputMode="decimal"
                autoFocus
                aria-label="Amount in US dollars"
                value={amount}
                disabled={done}
                onChange={(e) => {
                  setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                  if (result && !pending) setResult(null);
                }}
                className="display w-full min-w-0 bg-transparent text-4xl outline-none"
              />
            </div>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={done}
                onClick={() => setAmount(p)}
                className="tabular rounded-chip border border-line px-3 py-1.5 text-sm hover:border-line-strong aria-pressed:border-ink"
                aria-pressed={amount === p}
              >
                ${p}
              </button>
            ))}
            {available && <span className="ml-auto text-sm text-muted">Available {available}</span>}
          </div>
          {note && <p className="text-sm text-muted">{note}</p>}
          {result && result.kind !== "pending" && <ActionResult kind={result.kind} message={result.message} txHashes={result.txHashes} />}
          {done ? (
            <div className="grid grid-cols-2 gap-2">
              <BloomButton type="button" variant="primary" success={successLabel} />
              <BloomButton type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </BloomButton>
            </div>
          ) : (
            <BloomButton type="submit" size="lg" className="w-full" disabled={!valid} loading={pending}>
              {pending ? "Confirming…" : cta}
            </BloomButton>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
