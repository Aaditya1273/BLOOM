import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/*
 * Drifting cherry-blossom petals. Pure CSS (see .bloom-petal-fall in globals.css), deterministic layout so server and
 * client render identically, hidden entirely under prefers-reduced-motion.
 */
const PETAL = "M12 1.5c4.4 2.6 7.4 7 7.4 11.6 0 4.4-3.3 7.4-7.4 7.4s-7.4-3-7.4-7.4C4.6 8.5 7.6 4.1 12 1.5Z";

// golden-ratio spacing gives an even but organic-looking spread without randomness
const frac = (n: number) => n - Math.floor(n);

export function Petals({ count = 16, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {Array.from({ length: count }, (_, i) => {
        const r1 = frac(i * 0.618034);
        const r2 = frac(i * 0.414214 + 0.3);
        const r3 = frac(i * 0.732051 + 0.7);
        const size = 10 + Math.round(r2 * 14);
        const style = {
          "--x": `${Math.round(r1 * 100)}%`,
          "--drift": `${Math.round((r2 - 0.3) * 260)}px`,
          "--spin": `${Math.round((r3 - 0.5) * 720)}deg`,
          "--dur": `${(11 + r3 * 9).toFixed(1)}s`,
          "--delay": `${(-r2 * 20).toFixed(1)}s`,
          "--o": (0.55 + r1 * 0.4).toFixed(2),
        } as CSSProperties;
        return (
          <span key={i} className="bloom-petal-fall" style={style}>
            <svg width={size} height={size} viewBox="0 0 24 24" style={{ filter: r3 > 0.75 ? "blur(1px)" : undefined }}>
              <defs>
                <linearGradient id={`petal-${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="var(--bloom-pink-soft)" />
                  <stop offset="1" stopColor={r1 > 0.5 ? "var(--bloom-pink-strong)" : "var(--bloom-pink)"} />
                </linearGradient>
              </defs>
              <path d={PETAL} fill={`url(#petal-${i})`} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}
