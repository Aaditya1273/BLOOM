"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { RiskStateName } from "@/lib/types";
import { RISK_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EASE } from "./card";

/**
 * The risk verdict. NORMAL is quiet green; every other state is red with a text
 * label and the backend's plain-English reason. Transitions smoothly between states.
 */
export function RiskState({ state, reason, size = "lg", className }: { state: RiskStateName; reason?: string; size?: "lg" | "sm"; className?: string }) {
  const normal = state === "NORMAL";
  const Icon = normal ? ShieldCheck : ShieldAlert;
  return (
    <div className={cn("relative", className)} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={state}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.28, ease: EASE }}
          className={cn(
            "rounded-control",
            size === "lg" ? "p-5" : "p-3.5",
            normal ? "bg-success-soft" : "bg-danger-soft",
          )}
        >
          <div className="flex items-center gap-2.5">
            <Icon className={cn("shrink-0", size === "lg" ? "size-6" : "size-4", normal ? "text-success" : "text-danger")} />
            <p
              className={cn(
                "font-semibold tracking-[-0.02em]",
                size === "lg" ? "text-2xl sm:text-[1.75rem]" : "text-base",
                normal ? "text-success-text" : "text-danger-text",
              )}
            >
              {normal ? "Normal" : RISK_LABEL[state]}
            </p>
          </div>
          {reason && <p className={cn("mt-2 text-ink/75 text-pretty", size === "lg" ? "text-[15px]" : "text-sm")}>{reason}</p>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** One risk input. Bad values get an icon and red text, never color alone. */
export function RiskMetric({ label, value, bad, hint }: { label: string; value: ReactNode; bad?: boolean; hint?: ReactNode }) {
  return (
    <div className="min-w-0 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cn("tabular mt-0.5 flex items-center gap-1.5 font-medium transition-colors", bad && "text-danger-text")}>
        {bad && <AlertTriangle className="size-4 shrink-0 text-danger" aria-label="Attention" />}
        {value}
      </dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}
