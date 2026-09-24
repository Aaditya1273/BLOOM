"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Elevated surface. Enters with a subtle fade/rise once. */
export function BloomCard({
  className,
  children,
  delay = 0,
  as = "div",
  tone = "surface",
  id,
  "aria-label": ariaLabel,
}: {
  className?: string;
  children: ReactNode;
  delay?: number;
  as?: "div" | "section" | "article" | "li";
  tone?: "surface" | "flat" | "brand";
  id?: string;
  "aria-label"?: string;
}) {
  const M = motion[as];
  return (
    <M
      id={id}
      aria-label={ariaLabel}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay }}
      className={cn(
        "rounded-card p-5 sm:p-6",
        tone === "surface" && "border border-line bg-surface shadow-sm",
        tone === "flat" && "border border-line bg-surface",
        tone === "brand" && "bg-pink-soft",
        className,
      )}
    >
      {children}
    </M>
  );
}

export function SectionHeader({ title, action, id, className }: { title: string; action?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-baseline justify-between gap-4", className)}>
      <h2 id={id} className="text-lg font-semibold tracking-[-0.015em]">
        {title}
      </h2>
      {action}
    </div>
  );
}

export function PageHero({ eyebrow, title, subtitle, action }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-6 sm:mb-12">
      <div className="max-w-2xl">
        {eyebrow && <p className="mb-3 text-sm font-medium text-muted">{eyebrow}</p>}
        <h1 className="text-[2rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-muted text-balance">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Thin progress bar. Fills gently once. */
export function Progress({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} className={cn("h-1.5 overflow-hidden rounded-full bg-sunken", className)}>
      <motion.div
        className="h-full rounded-full bg-pink-strong"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(v, v > 0 ? 2 : 0)}%` }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
      />
    </div>
  );
}
