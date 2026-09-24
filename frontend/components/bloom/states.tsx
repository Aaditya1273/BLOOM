"use client";

import { motion } from "framer-motion";
import { AlertCircle, ArrowUpRight, CheckCircle2, ChevronDown, Loader2, RotateCw, ShieldAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { RESULT_META, errorMessage, shortHash, type ResultKind } from "@/lib/format";
import { useConfig } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { EASE } from "./card";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bloom-skeleton rounded-control bg-sunken", className)} />;
}

/** Calm empty state: one sentence and (optionally) one action. */
export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-1 rounded-card border border-dashed border-line-strong px-5 py-6", className)}>
      {icon && <div className="mb-2 text-muted [&_svg]:size-5">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Friendly failed-load state; offline gets its own copy. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const offline = error instanceof ApiError && error.code === "NETWORK";
  const Icon = offline ? WifiOff : AlertCircle;
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-card border border-line bg-surface p-4 text-sm", className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-ink" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{offline ? "Bloom can't connect right now" : "This didn't load"}</p>
        <p className="mt-0.5 text-muted">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 rounded-chip bg-sunken px-3 py-1.5 text-xs font-medium hover:bg-line-strong">
          <RotateCw className="size-3" /> Retry
        </button>
      )}
    </div>
  );
}

export function TxHash({ hash }: { hash: string }) {
  const config = useConfig();
  if (!config?.explorer) return <span className="font-mono text-xs break-all">{hash}</span>;
  return (
    <a href={`${config.explorer.replace(/\/$/, "")}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-xs underline decoration-line-strong underline-offset-2 hover:decoration-ink">
      {shortHash(hash)}
      <ArrowUpRight className="size-3" />
    </a>
  );
}

/** Technical detail lives behind a disclosure. Monospace only here. */
export function Details({ summary = "View transaction details", txHashes = [], children, className }: { summary?: string; txHashes?: string[]; children?: ReactNode; className?: string }) {
  if (!txHashes.length && !children) return null;
  return (
    <details className={cn("group text-sm", className)}>
      <summary className="inline-flex items-center gap-1 rounded-chip text-muted hover:text-ink">
        {summary}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-2 rounded-control bg-sunken/60 p-3 text-muted">
        {children}
        {txHashes.map((h, i) => (
          <div key={h} className="flex items-center justify-between gap-3">
            <span className="text-xs">{txHashes.length > 1 ? `Transaction ${i + 1}` : "Transaction"}</span>
            <span className="min-w-0 text-ink">
              <TxHash hash={h} />
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/** One component for every action outcome, showing the backend's plain-English message. */
export function ActionResult({
  kind,
  message,
  txHashes = [],
  title,
  className,
  children,
}: {
  kind: ResultKind;
  message?: string;
  txHashes?: string[];
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const meta = RESULT_META[kind];
  const tone = meta.tone;
  const Icon = tone === "pending" ? Loader2 : tone === "ok" ? CheckCircle2 : tone === "bad" ? ShieldAlert : AlertCircle;
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      className={cn(
        "rounded-control p-4 text-sm",
        tone === "bad" ? "bg-danger-soft" : tone === "ok" ? "bg-success-soft" : "bg-sunken/70",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "mt-0.5 size-[18px] shrink-0",
            tone === "pending" && "animate-spin text-muted",
            tone === "ok" && "text-success",
            tone === "bad" && "text-danger",
            tone === "neutral" && "text-ink",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", tone === "bad" && "text-danger-text", tone === "ok" && "text-success-text")}>{title ?? meta.title}</p>
          {message && <p className="mt-0.5 text-ink/75 text-pretty">{message}</p>}
          {children}
          {txHashes.length > 0 && <Details txHashes={txHashes} className="mt-3" />}
        </div>
      </div>
    </motion.div>
  );
}
