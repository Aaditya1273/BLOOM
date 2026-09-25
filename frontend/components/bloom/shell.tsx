"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MotionConfig } from "framer-motion";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Clock3, House, LogOut, MessageCircle, ShieldCheck, Sparkles, Target, TriangleAlert, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Toaster } from "sonner";
import { api, setApiOwner } from "@/lib/api";
import { useQuery } from "@/hooks/use-api";
import { shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BloomLogo, BloomMark } from "./logo";
import { buttonClass } from "./button";

export const NAV = [
  { href: "/home", label: "Home", icon: House },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/agent", label: "Goals", icon: Target },
  { href: "/risk", label: "Risk", icon: ShieldCheck },
  { href: "/activity", label: "Activity", icon: Clock3 },
];

const isActive = (pathname: string, href: string) => pathname.startsWith(href);
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

/** Connected-wallet chip (RainbowKit). Addresses and network live in the popover, not up front. */
function WalletChip() {
  const [open, setOpen] = useState(false);
  const { disconnect } = useDisconnect();
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted || !account || !chain) {
          return (
            <button type="button" onClick={openConnectModal} className={buttonClass("secondary", "sm")}>
              <Wallet /> Connect wallet
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button type="button" onClick={openChainModal} className={buttonClass("secondary", "sm", "border-danger/40 text-danger-text")}>
              <TriangleAlert /> Switch network
            </button>
          );
        }
        return (
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger
              aria-label="Wallet and network"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-1 text-sm font-medium transition-colors hover:border-line-strong"
            >
              <span className="grid size-8 place-items-center rounded-full bg-pink-soft">
                <BloomMark size={18} />
              </span>
              <span className="tabular">{account.displayName}</span>
              <ChevronDown className="size-3.5 text-muted" />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={8}
                collisionPadding={16}
                className="z-50 w-72 rounded-card border border-line bg-surface p-4 shadow-md outline-none"
              >
                <p className="text-xs text-muted">Connected with RainbowKit</p>
                <p className="mt-0.5 font-medium tabular">{account.displayName}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {chain.name}
                  {account.displayBalance ? ` · ${account.displayBalance}` : ""}
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
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      openAccountModal();
                    }}
                    className="flex items-center gap-2 rounded-chip px-2 py-2 text-left hover:bg-sunken/70"
                  >
                    <Wallet className="size-4" /> Manage wallet
                  </button>
                  <Link onClick={() => setOpen(false)} href="/" className="rounded-chip px-2 py-2 hover:bg-sunken/70">
                    How Bloom works
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      disconnect();
                    }}
                    className="flex items-center gap-2 rounded-chip px-2 py-2 text-left text-danger-text hover:bg-danger-soft"
                  >
                    <LogOut className="size-4" /> Disconnect
                  </button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        );
      }}
    </ConnectButton.Custom>
  );
}

function AppTopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/85 backdrop-blur-xl">
      <div className={cn("mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4", PAGE_X)}>
        <Link href="/home" aria-label="Bloom home" className="rounded-chip">
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
          <WalletChip />
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

/** Minimal chrome for public claim links (no wallet needed to open one). */
function PublicTopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/85 backdrop-blur-xl">
      <div className={cn("mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4", PAGE_X)}>
        <Link href="/" aria-label="Bloom" className="rounded-chip">
          <BloomLogo size={28} animate />
        </Link>
        <Link href="/" className="text-sm text-muted hover:text-ink">
          What is Bloom?
        </Link>
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
        <Link href="/" className="shrink-0 font-medium text-ink underline-offset-4 hover:underline">
          How Bloom works
        </Link>
      </div>
    </footer>
  );
}

/** Shown on app routes while the wallet reconnects after a reload. */
function GateLoading() {
  return (
    <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-sm text-muted">
        <BloomMark size={36} animate />
        Opening your Bloom wallet…
      </div>
    </div>
  );
}

/**
 * Wallet gate. The landing page ("/") and claim links are public; every app route needs a connected wallet.
 * The connected address is the owner for every API call. Disconnecting returns to the landing page.
 */
function useWalletGate(appRoute: boolean) {
  const { address, status } = useAccount();
  const router = useRouter();
  // set synchronously so the first queries of child screens already act for this wallet
  setApiOwner(status === "connected" ? address : undefined);
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client mount flag (wallet state is client-only)
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (appRoute && mounted && status === "disconnected") router.replace("/");
  }, [appRoute, mounted, status, router]);
  return mounted && status === "connected";
}

export function BloomShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const landing = pathname === "/";
  const claim = pathname.startsWith("/claim");
  const appRoute = !landing && !claim;
  const chat = pathname.startsWith("/chat");
  const unlocked = useWalletGate(appRoute);
  return (
    <MotionConfig reducedMotion="user">
      {/* the landing page renders its own transparent-over-hero navigation */}
      {landing ? null : claim ? <PublicTopBar /> : <AppTopBar />}
      <main className={cn("w-full flex-1", landing ? "" : cn("mx-auto max-w-[1200px] pt-8 sm:pt-12", PAGE_X))}>
        {appRoute && !unlocked ? <GateLoading /> : children}
      </main>
      {!chat && <Footer withTabs={appRoute} />}
      {appRoute && <BottomTabs />}
      <Toaster
        position="top-center"
        toastOptions={{
          className: "!rounded-control !border-line !bg-surface !text-ink !shadow-md !font-sans",
        }}
      />
    </MotionConfig>
  );
}
