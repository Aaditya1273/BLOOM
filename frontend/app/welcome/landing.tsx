"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  ArrowRight,
  Bot,
  Check,
  Cpu,
  KeyRound,
  PiggyBank,
  RotateCcw,
  Send,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { BloomLogo } from "@/components/bloom/logo";
import { buttonClass } from "@/components/bloom/button";
import { EASE } from "@/components/bloom/card";
import { RiskState } from "@/components/bloom/risk";
import { ChatMessage } from "@/components/bloom/chat-message";
import { ActionConfirmation } from "@/components/bloom/action-confirmation";
import { Petals } from "@/components/bloom/petals";
import type { ActionCard, RiskStateName } from "@/lib/types";
import { cn } from "@/lib/utils";

const CONTAINER = "mx-auto w-full max-w-[1200px] px-5 sm:px-8 lg:px-12";

/* ───────────────────────────── navigation ───────────────────────────── */

const NAV_LINKS = [
  ["#how", "How it works"],
  ["#risk", "Risk controls"],
  ["#agent", "Agent"],
  ["#tech", "Technology"],
] as const;

/** Full-width and transparent over the hero; morphs into a floating cream pill once the page scrolls. */
function LandingNav() {
  const { scrollY } = useScroll();
  const [floating, setFloating] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setFloating(y > 40));
  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 px-3 transition-[padding] duration-500 ease-bloom sm:px-5", floating ? "pt-3" : "pt-0")}>
      <nav
        aria-label="Landing"
        className={cn(
          "mx-auto flex items-center justify-between gap-4 border transition-[max-width,height,padding,border-radius,background-color,border-color,box-shadow] duration-500 ease-bloom",
          floating
            ? "h-14 max-w-[940px] rounded-[28px] border-line bg-surface/88 pr-2 pl-5 shadow-[0_10px_40px_rgba(17,17,17,0.08)] backdrop-blur-xl backdrop-saturate-150"
            : "h-16 max-w-[1200px] rounded-[0px] border-transparent bg-transparent px-2 sm:px-5 lg:px-9",
        )}
      >
        <Link href="/welcome" aria-label="Bloom home" className="rounded-chip">
          <BloomLogo size={floating ? 26 : 30} animate />
        </Link>
        <div className="hidden items-center gap-0.5 md:flex">
          {NAV_LINKS.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-full px-3.5 py-1.5 text-sm text-ink/70 transition-colors duration-200 hover:bg-pink-soft/70 hover:text-ink"
            >
              {label}
            </a>
          ))}
        </div>
        <Link href="/" className={buttonClass("primary", "sm", floating ? "rounded-full" : undefined)}>
          Try Bloom <ArrowRight />
        </Link>
      </nav>
    </header>
  );
}

/* ───────────────────────────── hero ───────────────────────────── */

const HEADLINE = ["The", "wallet", "where", "dollars", "become", "assets", "and", "actions."];

function Swash({ delay }: { delay: number }) {
  return (
    <svg aria-hidden viewBox="0 0 200 14" preserveAspectRatio="none" className="absolute -bottom-1 left-0 h-[0.28em] w-full overflow-visible">
      <motion.path
        d="M2 9 C 50 2, 120 2, 198 7"
        fill="none"
        stroke="var(--bloom-pink)"
        strokeWidth="5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, delay, ease: EASE }}
      />
    </svg>
  );
}

/** Handwritten margin note with a hand-drawn arrow pointing back at the primary CTA (desktop only). */
function HandNote() {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, delay: 2.1, ease: EASE }}
      className="pointer-events-none absolute top-1/2 left-full hidden w-56 -translate-y-[85%] pl-4 text-left lg:block"
    >
      <p className="-rotate-6 font-script text-[1.7rem] leading-tight text-ink/75">
        it&apos;s on testnet,
        <br />
        go on, try it
      </p>
      <svg viewBox="0 0 120 60" className="mt-1 -ml-2 h-12 w-28 overflow-visible text-pink-strong">
        <motion.path
          d="M110 6 C 88 34, 52 48, 12 40"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, delay: 2.4, ease: EASE }}
        />
        <motion.path
          d="M22 30 L 11 40 L 24 47"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 3.2 }}
        />
      </svg>
    </motion.div>
  );
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "16%"]);
  const bgScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.12]);
  const textY = useTransform(scrollYProgress, [0, 1], ["0px", reduce ? "0px" : "-90px"]);
  const fade = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  return (
    <section ref={ref} aria-labelledby="hero-title" className="relative isolate min-h-[100svh] overflow-hidden">
      {/* background: slow settle-in zoom on load, parallax on scroll */}
      <motion.div aria-hidden style={{ y: bgY, scale: bgScale }} className="absolute inset-0 -z-20">
        <motion.div
          className="absolute inset-0"
          initial={{ scale: reduce ? 1 : 1.14, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 2.6, ease: EASE }}
        >
          <Image
            src="/landing/hero.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[62%_50%]"
          />
        </motion.div>
      </motion.div>
      {/* legibility: a soft cream halo behind the centred text, fading into the page at the bottom */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_62%_58%_at_50%_48%,var(--bloom-cream)_0%,color-mix(in_oklab,var(--bloom-cream)_78%,transparent)_45%,transparent_78%)]"
      />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-cream to-transparent" />
      <Petals count={18} className="-z-10" />

      <div className={cn(CONTAINER, "flex min-h-[100svh] items-center justify-center pt-24 pb-24")}>
        <motion.div style={{ y: textY, opacity: fade }} className="mx-auto flex max-w-[920px] flex-col items-center text-center">
          <h1 id="hero-title" className="text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[5rem]">
            {HEADLINE.map((w, i) => {
              const accent = w === "assets" || w === "actions.";
              const script = w === "become";
              const delay = 0.35 + i * 0.07;
              return (
                <span key={i} className={cn("inline-block pb-[0.1em] align-bottom", !script && "overflow-hidden")}>
                  <motion.span
                    className={cn(
                      "relative inline-block",
                      script && "px-[0.06em] font-script text-[1.12em] leading-none font-semibold tracking-normal text-pink-strong",
                    )}
                    initial={script ? { opacity: 0, rotate: -8, scale: 0.8 } : { y: reduce ? 0 : "105%", opacity: reduce ? 0 : 1 }}
                    animate={script ? { opacity: 1, rotate: -4, scale: 1 } : { y: 0, opacity: 1 }}
                    transition={{ duration: script ? 1 : 0.8, delay, ease: EASE }}
                  >
                    {w}
                    {accent && <Swash delay={delay + 0.55} />}
                  </motion.span>
                  {i < HEADLINE.length - 1 && "\u00a0"}
                </span>
              );
            })}
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.0, ease: EASE }}
            className="mt-7 max-w-xl text-lg leading-relaxed text-ink/70 sm:text-xl"
          >
            Save in USDG. Send Robinhood Stock Tokens. Let your agent act under your rules.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.15, ease: EASE }}
            className="relative mt-9 flex flex-wrap justify-center gap-3"
          >
            <Link href="/" className={buttonClass("primary", "lg", "group")}>
              Try Bloom <ArrowRight className="transition-transform duration-300 group-hover:translate-x-0.5" />
            </Link>
            <a href="#how" className={buttonClass("secondary", "lg", "bg-surface/80 backdrop-blur")}>
              See how it works
            </a>
            <HandNote />
          </motion.div>
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.4 }}
            className="mt-9 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-ink/70"
          >
            {["Policy checked", "Risk checked", "Onchain confirmation"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-success-text" /> {t}
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </div>

      <a href="#story" aria-label="Scroll to learn more" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 sm:block">
        <span className="flex h-10 w-6 justify-center rounded-full border border-ink/25 pt-2">
          <span className="bloom-scroll-cue block h-2 w-1 rounded-full bg-ink/60" />
        </span>
      </a>
    </section>
  );
}

/* ───────────────────────────── marquee ───────────────────────────── */

const MARQUEE = [
  "Save in USDG",
  "Robinhood Stock Tokens",
  "Policy checked",
  "Risk checked",
  "Halt-aware",
  "Stylus risk engine",
  "Claim links",
  "Goals on autopilot",
  "Onchain confirmation",
];

function Marquee() {
  const row = [...MARQUEE, ...MARQUEE];
  return (
    <div aria-label="What Bloom offers" className="bloom-marquee-wrap relative overflow-hidden border-y border-line bg-surface/60 py-4">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-cream to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-cream to-transparent" />
      <ul className="bloom-marquee flex w-max gap-10">
        {row.map((t, i) => (
          <li key={i} aria-hidden={i >= MARQUEE.length} className="flex items-center gap-10 text-sm font-medium whitespace-nowrap text-ink/70">
            {t}
            <span aria-hidden className="size-1.5 rounded-full bg-pink" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── scroll-lit statement ───────────────────────────── */

const STATEMENT =
  "Dollars sit in one app, investments in another, and automation usually means handing someone the keys. Bloom keeps them in one wallet, and lets an agent help only within rules you set.";

function Word({ children, progress, range }: { children: string; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.18, 1]);
  return (
    <motion.span style={{ opacity }} className="inline">
      {children}{" "}
    </motion.span>
  );
}

function Statement() {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });
  const words = STATEMENT.split(" ");
  return (
    <section id="story" aria-labelledby="story-h" className={cn(CONTAINER, "scroll-mt-20 py-24 sm:py-32")}>
      <p id="story-h" className="text-sm font-medium text-muted">
        The problem
      </p>
      <p ref={ref} className="mt-5 max-w-4xl text-3xl leading-[1.2] font-semibold tracking-[-0.03em] sm:text-[2.6rem]">
        {reduce
          ? STATEMENT
          : words.map((w, i) => (
              <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>
                {w}
              </Word>
            ))}
      </p>
      <motion.p
        initial={{ opacity: 0, y: 10, rotate: -3 }}
        whileInView={{ opacity: 1, y: 0, rotate: -3 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.9, delay: 0.2, ease: EASE }}
        className="mt-8 origin-left font-script text-4xl text-pink-strong sm:text-5xl"
      >
        so we made Bloom.
      </motion.p>
    </section>
  );
}

/* ───────────────────────────── how it works ───────────────────────────── */

const STEPS = [
  { icon: PiggyBank, title: "Save", body: "Hold dollars as USDG and earn on what you set aside." },
  { icon: TrendingUp, title: "Own", body: "Get economic exposure to Robinhood Stock Tokens like QQQ and NVDA, from a few dollars." },
  { icon: Send, title: "Send", body: "Send dollars or Stock Tokens to a friend, even one without a wallet, with a link and a separate code." },
  { icon: Bot, title: "Automate", body: "Give the Bloom Agent a goal. It acts for you only inside the limits you choose." },
  { icon: ShieldCheck, title: "Protected", body: "Equity-aware risk controls pause actions when a market isn't behaving normally." },
];

function Reveal({ children, className, delay = 0, y = 28 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.75, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function HowItWorks() {
  const list = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: list, offset: ["start 0.75", "end 0.55"] });
  return (
    <section id="how" aria-labelledby="how-h" className={cn(CONTAINER, "scroll-mt-20 border-t border-line py-24 sm:py-32")}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-sm font-medium text-muted">How it works</p>
          <h2 id="how-h" className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            Five steps, <span className="font-script text-[1.15em] font-semibold tracking-normal text-pink-strong">one</span> wallet.
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
            Everything a dollar can do, from saving to automating, in one calm place.
          </p>
          <Reveal className="relative mt-10 hidden w-[78%] lg:block" delay={0.1}>
            <div className="bloom-sway -ml-4" style={{ ["--origin" as string]: "8% 8%" }}>
              <Image src="/landing/cherry2.webp" alt="" width={786} height={726} sizes="480px" className="h-auto w-full" />
            </div>
          </Reveal>
        </div>

        <ol ref={list} className="relative space-y-4">
          <div aria-hidden className="absolute top-6 bottom-6 left-[27px] w-px bg-line" />
          <motion.div aria-hidden style={{ scaleY: scrollYProgress }} className="absolute top-6 bottom-6 left-[27px] w-px origin-top bg-pink-strong" />
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 0.05} className="group relative flex gap-5 rounded-card border border-line bg-surface p-5 shadow-sm transition-shadow duration-300 hover:shadow-md sm:p-6">
                <span className="relative z-10 grid size-14 shrink-0 place-items-center rounded-2xl bg-pink-soft transition-transform duration-300 group-hover:scale-105">
                  <s.icon className="size-6 text-ink" />
                </span>
                <div>
                  <p className="text-xs font-medium tracking-wider text-muted tabular uppercase">Step {i + 1}</p>
                  <p className="mt-1 text-xl font-semibold tracking-[-0.02em]">{s.title}</p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{s.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────────── risk engine ───────────────────────────── */

const CYCLE: { state: RiskStateName; symbol: string; reason: string; halt: boolean; borrowing: boolean; ltv: string; oracle: string }[] = [
  { state: "NORMAL", symbol: "AAPL", reason: "Within Bloom's risk policy.", halt: false, borrowing: true, ltv: "60%", oracle: "Fresh · 8s" },
  { state: "HALTED", symbol: "AAPL", reason: "Equity market trading halt detected.", halt: true, borrowing: false, ltv: "0%", oracle: "Fresh · 6s" },
  { state: "NORMAL", symbol: "AAPL", reason: "Trading resumed. Back within policy.", halt: false, borrowing: true, ltv: "60%", oracle: "Fresh · 4s" },
  { state: "STALE", symbol: "NVDA", reason: "Oracle price is older than its heartbeat.", halt: false, borrowing: false, ltv: "0%", oracle: "Stale · 1h 2m" },
];

function RiskCycle() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-120px" });
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % CYCLE.length), 2800);
    return () => clearInterval(id);
  }, [inView, reduce]);
  const s = CYCLE[i];
  const metric = (label: string, value: string, bad: boolean) => (
    <div className="rounded-control bg-sunken/70 px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={value}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          className={cn("mt-0.5 font-semibold tabular", bad && "text-danger-text")}
        >
          {value}
        </motion.p>
      </AnimatePresence>
    </div>
  );
  return (
    <div ref={ref} className="rounded-card border border-line bg-surface p-5 shadow-md sm:p-6" aria-live="polite">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">Robinhood Stock Token</p>
        <div className="flex gap-1" aria-hidden>
          {CYCLE.map((_, n) => (
            <span key={n} className={cn("h-1 w-5 rounded-full transition-colors duration-300", n === i ? "bg-pink-strong" : "bg-line")} />
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={i} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.35, ease: EASE }}>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.02em]">{s.symbol}</p>
          <RiskState state={s.state} reason={s.reason} size="sm" className="mt-4" />
        </motion.div>
      </AnimatePresence>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metric("Oracle", s.oracle, s.state === "STALE")}
        {metric("Trading halt", s.halt ? "Yes" : "No", s.halt)}
        {metric("Borrowing", s.borrowing ? "Enabled" : "Disabled", !s.borrowing)}
        {metric("Max LTV", s.ltv, !s.borrowing)}
      </div>
    </div>
  );
}

function RiskSection() {
  return (
    <section id="risk" aria-labelledby="risk-h" className="relative scroll-mt-20 overflow-hidden border-t border-line py-24 sm:py-32">
      <div className={cn(CONTAINER, "grid items-center gap-14 lg:grid-cols-2 lg:gap-20")}>
        <Reveal className="relative order-2 lg:order-1">
          <div className="relative isolate overflow-hidden rounded-[28px] bg-gradient-to-b from-pink-soft to-surface p-6 sm:p-10">
            <div aria-hidden className="absolute -top-24 -right-24 -z-10 size-72 rounded-full bg-pink/40 blur-3xl" />
            <Petals count={9} />
            <div className="bloom-sway mx-auto max-w-[460px]" style={{ ["--origin" as string]: "12% 100%", ["--sway-from" as string]: "-0.8deg", ["--sway-to" as string]: "1.2deg" }}>
              <Image src="/landing/cherry3.webp" alt="" width={758} height={659} sizes="(min-width: 1024px) 460px, 90vw" className="h-auto w-full" />
            </div>
            <p className="mt-4 text-center text-sm text-ink/70">Rooted in market reality, not just a price.</p>
          </div>
        </Reveal>
        <div className="order-1 lg:order-2">
          <Reveal>
            <p className="text-sm font-medium text-muted">Equity-aware risk controls</p>
            <h2 id="risk-h" className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
              Bloom checks the market before your money moves.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted">
              Markets close, trading halts, companies split. Bloom reads those signals alongside the price oracle and pauses borrowing and agent
              actions when an asset isn&apos;t in a normal state.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-8">
            <RiskCycle />
            <p className="mt-3 text-xs text-muted">
              Illustration of the risk states.{" "}
              <Link href="/risk" className="font-medium text-ink underline-offset-4 hover:underline">
                See the live version
              </Link>
              .
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── agent ───────────────────────────── */

const SAMPLE_SEND: ActionCard = {
  kind: "send",
  asset: "QQQ",
  amount: "0.0067",
  amountUsd: "5",
  recipient: { name: "Sarah", viaClaimLink: false },
  network: "Robinhood Chain",
  riskCheck: { ok: true, state: "NORMAL", message: "" },
  policyCheck: { ok: true, message: "" },
};

function TypingDots() {
  return (
    <span className="inline-flex gap-1 rounded-2xl bg-surface px-4 py-3 shadow-sm" aria-label="Bloom is typing">
      {[0, 1, 2].map((d) => (
        <motion.span
          key={d}
          className="size-1.5 rounded-full bg-muted"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: d * 0.18 }}
        />
      ))}
    </span>
  );
}

function AgentDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const reduce = useReducedMotion();
  const [animStep, setStep] = useState(0);
  // reduced motion: show the finished conversation immediately (replays remount this component via `key`)
  const step = reduce && inView ? 4 : animStep;
  useEffect(() => {
    if (!inView || reduce) return;
    const t = [setTimeout(() => setStep(1), 300), setTimeout(() => setStep(2), 1100), setTimeout(() => setStep(3), 2100), setTimeout(() => setStep(4), 3900)];
    return () => t.forEach(clearTimeout);
  }, [inView, reduce]);
  const pop = { initial: { opacity: 0, y: 14, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.45, ease: EASE } };
  return (
    <div ref={ref} inert aria-label="Example conversation" className="relative min-h-[520px] space-y-5 rounded-[28px] border border-line bg-sunken/50 p-5 sm:p-7">
      <AnimatePresence>
        {step >= 1 && (
          <motion.div key="u" {...pop}>
            <ChatMessage role="user">Send Sarah $5 of QQQ.</ChatMessage>
          </motion.div>
        )}
        {step === 2 && (
          <motion.div key="t" {...pop} exit={{ opacity: 0 }}>
            <TypingDots />
          </motion.div>
        )}
        {step >= 3 && (
          <motion.div key="c" {...pop}>
            <ChatMessage role="assistant">
              <ActionConfirmation card={SAMPLE_SEND} actionId="illustration" headline="Ready to send $5 of QQQ to Sarah." interactive={false} />
            </ChatMessage>
          </motion.div>
        )}
        {step >= 4 && (
          <motion.div key="s" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: EASE }} className="relative ml-11">
            <p className="relative inline-flex items-center gap-2 rounded-control bg-success-soft px-4 py-3 text-sm font-medium text-success-text">
              <span aria-hidden className="bloom-ripple" />
              <span className="relative inline-flex items-center gap-2">
                <Check className="size-4" /> Sent successfully.
              </span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentSection() {
  const [run, setRun] = useState(0);
  return (
    <section id="agent" aria-labelledby="agent-h" className={cn(CONTAINER, "scroll-mt-20 border-t border-line py-24 sm:py-32")}>
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal>
          <p className="text-sm font-medium text-muted">Bloom Agent</p>
          <h2 id="agent-h" className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            Ask in plain words. Confirm before anything moves.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Tell Bloom what you want. It prepares the action, checks it against your goal&apos;s limits and the risk engine, and waits for you.
          </p>
          <ul className="mt-8 space-y-3">
            {["Save toward goals", "Send supported assets", "Pause when risk conditions change", "Turn it off any time"].map((t, i) => (
              <motion.li
                key={t}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.15 + i * 0.08, ease: EASE }}
                className="flex items-center gap-3 text-[15px]"
              >
                <span className="grid size-6 place-items-center rounded-full bg-pink-soft">
                  <Check className="size-3.5" />
                </span>
                {t}
              </motion.li>
            ))}
          </ul>
          <button type="button" onClick={() => setRun((n) => n + 1)} className={buttonClass("ghost", "sm", "mt-8 -ml-3")}>
            <RotateCcw /> Replay the conversation
          </button>
        </Reveal>
        <AgentDemo key={run} />
      </div>
    </section>
  );
}

/* ───────────────────────────── technology ───────────────────────────── */

function Counter({ to, label }: { to: number; label: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [animated, setN] = useState(0);
  const n = reduce ? to : animated;
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, to, { duration: 1.4, ease: EASE, onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [inView, reduce, to]);
  return (
    <div>
      <p ref={ref} className="text-5xl font-semibold tracking-[-0.04em] tabular sm:text-6xl">
        {n}
      </p>
      <p className="mt-2 text-sm text-muted">{label}</p>
    </div>
  );
}

const TECH = [
  { icon: null, title: "Built on Robinhood Chain", body: "An Arbitrum-based network designed for tokenized real-world assets." },
  { icon: Cpu, title: "Arbitrum Stylus risk engine", body: "Risk interpretation written in Rust and run onchain via Stylus." },
  { icon: KeyRound, title: "Account abstraction", body: "Your Bloom wallet is a smart account; the agent uses a limited, expiring session key." },
  { icon: ShieldCheck, title: "Onchain risk controls", body: "Limits and risk checks are enforced by contracts, not just by the app." },
];

function TechSection() {
  return (
    <section id="tech" aria-labelledby="tech-h" className="relative scroll-mt-20 overflow-hidden border-t border-line py-24 sm:py-32">
      <div className={CONTAINER}>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_auto]">
          <Reveal>
            <p className="text-sm font-medium text-muted">Technology</p>
            <h2 id="tech-h" className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl">
              Warm on the surface.
              <br />
              Serious underneath.
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="mx-auto lg:mx-0">
            <motion.div whileHover={{ rotateY: 18, rotateX: -6, scale: 1.04 }} transition={{ type: "spring", stiffness: 140, damping: 14 }} style={{ perspective: 800 }} className="bloom-float">
              <Image src="/landing/arb-coin.webp" alt="Arbitrum" width={446} height={440} sizes="220px" className="h-auto w-44 drop-shadow-[0_24px_40px_rgba(17,17,17,0.18)] sm:w-52" />
            </motion.div>
          </Reveal>
        </div>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TECH.map((t, i) => (
            <li key={t.title}>
              <Reveal delay={i * 0.08} className="h-full rounded-card border border-line bg-surface p-6 shadow-sm transition-transform duration-300 hover:-translate-y-1">
                {t.icon ? (
                  <t.icon className="size-6" />
                ) : (
                  <Image src="/landing/arbitrum.webp" alt="" width={205} height={231} className="h-6 w-auto" />
                )}
                <p className="mt-5 font-semibold">{t.title}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>

        <div className="mt-16 grid grid-cols-2 gap-10 border-t border-line pt-12 sm:grid-cols-4">
          <Counter to={8} label="risk states, default-deny" />
          <Counter to={43} label="shared risk-spec vectors" />
          <Counter to={131} label="contract tests passing" />
          <Counter to={0} label="mock assets on mainnet" />
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── closing CTA ───────────────────────────── */

function ClosingCta() {
  return (
    <section aria-labelledby="cta-h" className={cn(CONTAINER, "pb-8")}>
      <Reveal className="relative isolate overflow-hidden rounded-[32px] px-6 py-16 [clip-path:inset(0_round_32px)] sm:px-14 sm:py-24">
        <Image src="/landing/hero-sm.webp" alt="" fill sizes="(min-width: 1200px) 1100px, 100vw" className="-z-20 object-cover object-[70%_60%]" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-cream via-cream/85 to-cream/30" />
        <Petals count={10} className="-z-10" />
        <div
          aria-hidden
          className="bloom-sway pointer-events-none absolute -top-4 -right-10 hidden w-[420px] sm:block"
          style={{ ["--origin" as string]: "100% 0%", ["--sway-from" as string]: "1deg", ["--sway-to" as string]: "-2deg" }}
        >
          <Image src="/landing/cherry1.webp" alt="" width={579} height={288} sizes="420px" className="h-auto w-full -scale-x-100" />
        </div>
        <h2 id="cta-h" className="max-w-xl text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-[3.25rem]">
          Let your dollars{" "}
          <span className="inline-block -rotate-3 font-script text-[1.2em] font-semibold tracking-normal text-pink-strong">bloom.</span>
        </h2>
        <p className="mt-4 max-w-lg text-lg text-ink/75">The demo runs on testnet with mock assets, so you can try every flow safely.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className={buttonClass("primary", "lg", "group")}>
            Try Bloom <ArrowRight className="transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
          <Link href="/risk" className={buttonClass("secondary", "lg", "bg-surface/80 backdrop-blur")}>
            Explore risk controls
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

export function Landing() {
  return (
    <>
      <LandingNav />
      <Hero />
      <Marquee />
      <Statement />
      <HowItWorks />
      <RiskSection />
      <AgentSection />
      <TechSection />
      <ClosingCta />
    </>
  );
}
