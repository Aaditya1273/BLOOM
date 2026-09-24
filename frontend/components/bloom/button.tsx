import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const VARIANT = {
  primary: "bg-ink text-surface hover:bg-ink/88 disabled:bg-ink/40",
  brand: "bg-pink text-ink hover:bg-pink-strong disabled:opacity-50",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-sunken/60 disabled:opacity-50",
  quiet: "bg-sunken/70 text-ink hover:bg-sunken disabled:opacity-50",
  ghost: "text-ink hover:bg-sunken/70 disabled:opacity-50",
} as const;

const SIZE = {
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-chip",
  md: "h-11 px-5 text-[15px] gap-2 rounded-control",
  lg: "h-13 px-6 text-base gap-2 rounded-control",
} as const;

export type BloomButtonProps = {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /**
   * Success label. When set, the signature blossom ripple plays once from the
   * button and the label becomes "✓ {success}". The button is then inert.
   */
  success?: string | false | null;
  href?: string;
  icon?: ReactNode;
} & ComponentProps<"button">;

export function buttonClass(variant: keyof typeof VARIANT = "primary", size: keyof typeof SIZE = "md", className?: string) {
  return cn(
    "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,transform,opacity] duration-200 ease-bloom active:scale-[0.98] disabled:pointer-events-none [&_svg]:size-[1.1em] [&_svg]:shrink-0",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export function BloomButton({
  variant = "primary",
  size = "md",
  loading,
  success,
  href,
  icon,
  className,
  children,
  disabled,
  ...props
}: BloomButtonProps) {
  const cls = buttonClass(variant, size, cn(success && "bloom-success pointer-events-none", className));
  const body = success ? (
    <>
      <span aria-hidden className="bloom-ripple" />
      <span className="relative inline-flex items-center gap-1.5">
        <Check strokeWidth={2.5} /> {success}
      </span>
    </>
  ) : (
    <span className="relative inline-flex items-center gap-[inherit]">
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-disabled={success ? true : undefined}
      {...props}
      onClick={success ? undefined : props.onClick}
    >
      {body}
    </button>
  );
}
