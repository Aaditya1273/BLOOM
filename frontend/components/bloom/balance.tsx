"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EASE } from "./card";

/** Number that eases to its new value (instant with reduced motion). */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, format);
  const reduce = useReducedMotion();
  useEffect(() => {
    const c = animate(mv, value, { duration: reduce ? 0 : 0.7, ease: EASE });
    return () => c.stop();
  }, [mv, value, reduce]);
  return <motion.span>{text}</motion.span>;
}

const toCents = (n: number) => Math.round(Math.abs(n) * 100);
const dollars = (n: number) => "$" + Math.floor(toCents(n) / 100).toLocaleString("en-US");
const cents = (n: number) => "." + String(toCents(n) % 100).padStart(2, "0");

/** The big balance: whole dollars in ink, cents quieter. */
export function BloomBalance({
  value,
  label,
  size = "xl",
  children,
  className,
}: {
  value: number;
  label?: ReactNode;
  size?: "lg" | "xl";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <p className="text-sm font-medium text-muted">{label}</p>}
      <p
        className={cn(
          "display mt-2",
          size === "xl" ? "text-[3.25rem] sm:text-7xl" : "text-[2.5rem] sm:text-5xl",
        )}
        aria-label={`$${value.toFixed(2)}`}
      >
        <AnimatedNumber value={value} format={dollars} />
        <span className="text-ink/35">
          <AnimatedNumber value={value} format={cents} />
        </span>
      </p>
      {children}
    </div>
  );
}
