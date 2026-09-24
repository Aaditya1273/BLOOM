"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig } from "framer-motion";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Clock3, House, MessageCircle, ShieldCheck, Sparkles, Target } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { api } from "@/lib/api";
import { useConfig, useQuery, MAINNET_CHAIN_ID } from "@/hooks/use-api";
import { shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BloomLogo, BloomMark } from "./logo";
import { buttonClass } from "./button";

export const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/agent", label: "Goals", icon: Target },
  { href: "/risk", label: "Risk", icon: ShieldCheck },
  { href: "/activity", label: "Activity", icon: Clock3 },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
const PAGE_X = "px-5 sm:px-8 lg:px-12";

function WalletDetails() {
  const { data: acct } = useQuery(api.account);
  const health = useQuery(api.health).data;
  return (
    <dl className="space-y-1.5 text-xs">
      {[
        ["Bloom wallet", acct ? shortHash(acct.account) : "…"],
        ["Owner", acct ? shortHash(acct.owner) : "…"],
        ["Chain ID", health ? String(health.chainId) : "…"],
        ["Risk engine", health ? (health.riskEngineImpl === "stylus" ? "Arbitrum Stylus" : "EVM reference") : "…"],
      ].map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt className="text-muted">{k}</dt>
          <dd className={v.startsWith("0x") ? "font-mono" : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Wallet/profile chip. Network and addresses live in the popover, not up front. */
function ProfileChip() {
  const config = useConfig();
  const [open, setOpen] = useState(false);
  const testnet = config?.chainId !== MAINNET_CHAIN_ID;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Account and network"
        className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-1 text-sm font-medium transition-colors hover:border-line-strong"
      >
        <span className="grid size-8 place-items-center rounded-full bg-pink-soft">
          <BloomMark size={18} />
        </span>
        <span className="hidden lg:inline">Demo account</span>
        <ChevronDown className="size-3.5 text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-72 rounded-card border border-line bg-surface p-4 shadow-md outline-none"
        >
          <p className="font-medium">Demo account</p>
          <p className="mt-0.5 text-sm text-muted">
            Robinhood Chain{testnet ? " · Testnet" : ""}
          </p>
          <details className="group mt-3 rounded-control bg-sunken/60 p-3">
            <summary className="flex items-center justify-between text-xs font-medium">
              Details <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3">
              <WalletDetails />
            </div>
          </details>
          <div className="mt-3 grid gap-1 text-sm">
            <Link onClick={() => setOpen(false)} href="/welcome" className="rounded-chip px-2 py-2 hover:bg-sunken/70">
              How Bloom works
            </Link>
            <Link onClick={() => setOpen(false)} href="/activity" className="rounded-chip px-2 py-2 hover:bg-sunken/70">
              Activity
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AppTopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/85 backdrop-blur-xl">
      <div className={cn("mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4", PAGE_X)}>
        <Link href="/" aria-label="Bloom home" className="rounded-chip">
          <BloomLogo size={28} animate />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((t) => {
            const active = isActive(pathname, t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-chip px-3.5 py-2 text-[15px] transition-colors",
                  active ? "font-medium text-ink" : "text-muted hover:text-ink",
                )}
              >
                {t.label}
                {active && <span aria-hidden className="absolute inset-x-3.5 -bottom-[13px] h-0.5 rounded-full bg-pink-strong" />}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/chat" className={buttonClass("primary", "sm", "hidden md:inline-flex")}>
            <Sparkles /> Ask Bloom
          </Link>
          <ProfileChip />
        </div>
      </div>
    </header>
  );
}

function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cream/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-xs", active ? "font-medium text-ink" : "text-muted")}
            >
              <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-pink-soft")}>
                <t.icon className="size-5" strokeWidth={active ? 2.1 : 1.7} />
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Minimal chrome for the public story page and claim links. */
function PublicTopBar({ welcome }: { welcome: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/85 backdrop-blur-xl">
      <div className={cn("mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4", PAGE_X)}>
        <Link href={welcome ? "/welcome" : "/"} aria-label="Bloom" className="rounded-chip">
          <BloomLogo size={28} animate />
        </Link>
        {welcome ? (
          <div className="flex items-center gap-2">
            <a href="#how" className={buttonClass("ghost", "sm", "hidden sm:inline-flex")}>
              How it works
            </a>
            <Link href="/" className={buttonClass("primary", "sm")}>
              Try Bloom
            </Link>
          </div>
        ) : (
          <Link href="/welcome" className="text-sm text-muted hover:text-ink">
            What is Bloom?
          </Link>
        )}
      </div>
    </header>
  );
}

function Footer({ withTabs }: { withTabs: boolean }) {
  return (
    <footer className={cn("mx-auto w-full max-w-[1200px] pt-16", PAGE_X, withTabs ? "pb-28 md:pb-12" : "pb-12")}>
      <div className="flex flex-col gap-4 border-t border-line pt-6 text-xs leading-relaxed text-muted sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl">
          Testnet demo with mock assets. Not investment advice. Robinhood Stock Tokens provide economic exposure to the
          underlying equity, not ownership of shares; availability is jurisdiction-dependent.
        </p>
        <Link href="/welcome" className="shrink-0 font-medium text-ink underline-offset-4 hover:underline">
          How Bloom works
        </Link>
      </div>
    </footer>
  );
}

export function BloomShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const welcome = pathname.startsWith("/welcome");
  const isPublic = welcome || pathname.startsWith("/claim");
  const chat = pathname.startsWith("/chat");
  return (
    <MotionConfig reducedMotion="user">
      {/* the landing page renders its own transparent-over-hero navigation */}
      {welcome ? null : isPublic ? <PublicTopBar welcome={false} /> : <AppTopBar />}
      <main className={cn("w-full flex-1", welcome ? "" : cn("mx-auto max-w-[1200px] pt-8 sm:pt-12", PAGE_X))}>{children}</main>
      {!chat && <Footer withTabs={!isPublic} />}
      {!isPublic && <BottomTabs />}
      <Toaster
        position="top-center"
        toastOptions={{
          className: "!rounded-control !border-line !bg-surface !text-ink !shadow-md !font-sans",
        }}
      />
    </MotionConfig>
  );
}
