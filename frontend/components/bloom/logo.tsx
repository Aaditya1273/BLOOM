import { cn } from "@/lib/utils";

/*
 * The Bloom mark: a "B" drawn as one stem and two crossing petals.
 * Where the petals overlap they deepen (multiply), which is the "bloom".
 * Hand-authored on a 32×32 grid; mirrors app/icon.svg.
 */
export const PETAL_TOP = "M12 17.2C10.9 10.2 13.4 4 18.6 3.6c3.5-.3 5.3 2.4 4.5 5.4-1 3.8-5.6 6.9-11.1 8.2Z";
export const PETAL_BOTTOM = "M12 11c6.6.4 13.5 3.5 13.6 9.8.1 4.6-3.6 7.8-8.4 7.6-3.8-.2-5.9-4.4-5.2-17.4Z";
export const STEM = "M10.4 3c1.7 0 2.5 1.6 2.5 3.6v18.8c0 2-.8 3.6-2.5 3.6S7.9 27.4 7.9 25.4V6.6C7.9 4.6 8.7 3 10.4 3Z";

export type LogoVariant = "color" | "ink" | "mono" | "on-dark";

const FILLS: Record<LogoVariant, { stem: string; top: string; bottom: string; opacity: number; blend: "multiply" | "screen" | "normal" }> = {
  color: { stem: "var(--bloom-ink)", top: "var(--bloom-pink)", bottom: "var(--bloom-pink-strong)", opacity: 0.92, blend: "multiply" },
  ink: { stem: "var(--bloom-ink)", top: "var(--bloom-ink)", bottom: "var(--bloom-ink)", opacity: 0.5, blend: "normal" },
  mono: { stem: "currentColor", top: "currentColor", bottom: "currentColor", opacity: 0.5, blend: "normal" },
  "on-dark": { stem: "var(--bloom-surface)", top: "var(--bloom-pink)", bottom: "var(--bloom-pink-strong)", opacity: 0.9, blend: "screen" },
};

/** Compact mark for nav, mobile and avatars. `animate` opens the petals once on load (reduced-motion safe). */
export function BloomMark({
  size = 28,
  variant = "color",
  animate = false,
  className,
}: {
  size?: number;
  variant?: LogoVariant;
  animate?: boolean;
  className?: string;
}) {
  if (variant === "color") {
    // Brand artwork (public/brand/bloom-mark.webp); the SVG paths remain for ink / mono / on-dark renderings.
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset, sized explicitly
      <img
        src="/brand/bloom-mark.webp"
        alt=""
        aria-hidden
        width={Math.round(size * 0.88)}
        height={size}
        decoding="async"
        className={cn("shrink-0 object-contain", animate && "bloom-mark-in", className)}
        style={{ width: Math.round(size * 0.88), height: size }}
      />
    );
  }
  const f = FILLS[variant];
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
      className={cn("shrink-0", animate && "bloom-logo-animate", className)}
    >
      <g>
        <path className="bloom-petal" d={PETAL_TOP} fill={f.top} fillOpacity={f.opacity} />
        <path className="bloom-petal" d={PETAL_BOTTOM} fill={f.bottom} fillOpacity={f.opacity} style={{ mixBlendMode: f.blend }} />
        <path className="bloom-petal" d={STEM} fill={f.stem} />
      </g>
    </svg>
  );
}

/** Mark + wordmark. */
export function BloomLogo({
  size = 28,
  variant = "color",
  animate = false,
  wordmark = true,
  className,
}: {
  size?: number;
  variant?: LogoVariant;
  animate?: boolean;
  wordmark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-[-0.03em]",
        variant === "on-dark" ? "text-surface" : "text-ink",
        className,
      )}
    >
      <BloomMark size={size} variant={variant} animate={animate} />
      {wordmark && (
        <span style={{ fontSize: Math.round(size * 0.72) }} className="leading-none">
          Bloom
        </span>
      )}
    </span>
  );
}
