import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PillTone = "ok" | "bad" | "brand" | "neutral";

const TONE: Record<PillTone, { pill: string; dot: string }> = {
  ok: { pill: "bg-success-soft text-success-text", dot: "bg-success" },
  bad: { pill: "bg-danger-soft text-danger-text", dot: "bg-danger" },
  brand: { pill: "bg-pink-soft text-ink", dot: "bg-pink-strong" },
  neutral: { pill: "bg-sunken text-ink", dot: "bg-muted" },
};

/** Small status label. Always text + dot/icon, never color alone. */
export function StatusPill({ tone = "neutral", icon, children, className }: { tone?: PillTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5", TONE[tone].pill, className)}>
      {icon ?? <span aria-hidden className={cn("size-1.5 rounded-full", TONE[tone].dot)} />}
      {children}
    </span>
  );
}
