import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Boxes, Cpu, KeyRound, PiggyBank, ShieldCheck, DollarSign, TrendingUp } from "lucide-react";
import { BloomLogo } from "@/components/bloom/logo";
import { buttonClass } from "@/components/bloom/button";
import { BloomBalance } from "@/components/bloom/balance";
import { AssetRow } from "@/components/bloom/asset-row";
import { Progress } from "@/components/bloom/card";
import { RiskState } from "@/components/bloom/risk";
import { ChatMessage } from "@/components/bloom/chat-message";
import { ActionConfirmation } from "@/components/bloom/action-confirmation";
import type { ActionCard } from "@/lib/types";

export const metadata: Metadata = {
  title: "How Bloom works",
  description: "The wallet where dollars become assets and actions.",
};

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

const STEPS = [
  { n: 1, title: "Save", body: "Hold dollars as USDG and earn on what you set aside." },
  { n: 2, title: "Own", body: "Get economic exposure to Robinhood Stock Tokens like QQQ and NVDA, from a few dollars." },
  { n: 3, title: "Send", body: "Send dollars or Stock Tokens to a friend, even one without a wallet, with a link and a separate code." },
  { n: 4, title: "Automate", body: "Give the Bloom Agent a goal. It acts for you only inside the limits you choose." },
  { n: 5, title: "Protected", body: "Equity-aware risk controls pause actions when a market isn't behaving normally." },
];

const TECH = [
  { icon: Boxes, title: "Built on Robinhood Chain", body: "An Arbitrum-based network designed for tokenized real-world assets." },
  { icon: Cpu, title: "Arbitrum Stylus risk engine", body: "Risk interpretation written in Rust and run onchain via Stylus." },
  { icon: KeyRound, title: "Account abstraction", body: "Your Bloom wallet is a smart account; the agent uses a limited session key." },
  { icon: ShieldCheck, title: "Onchain risk controls", body: "Limits and risk checks are enforced by contracts, not just by the app." },
];

/** A static illustration of the wallet, built from the real components with sample figures. */
function ProductMock() {
  return (
    <figure className="relative mx-auto w-full max-w-[400px]">
      <div aria-hidden inert className="rounded-[28px] border border-line bg-surface p-6 shadow-md">
        <div className="flex items-center justify-between">
          <BloomLogo size={22} />
          <span className="size-8 rounded-full bg-pink-soft" />
        </div>
        <p className="mt-6 text-lg font-semibold tracking-[-0.02em]">Good morning.</p>
        <BloomBalance className="mt-4" size="lg" label="Total balance · USDG" value={2480.12}>
          <p className="mt-2 text-sm text-muted">Earning 4.5% on savings</p>
        </BloomBalance>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <span className={buttonClass("primary", "sm")}>
            <ArrowDownToLine /> Save
          </span>
          <span className={buttonClass("secondary", "sm")}>
            <ArrowUpRight /> Send
          </span>
          <span className={buttonClass("secondary", "sm")}>
            <TrendingUp /> Invest
          </span>
        </div>
        <ul className="mt-4 divide-y divide-line">
          <AssetRow symbol="USDG" brand icon={<DollarSign />} name="Cash" detail="1,180.00 USDG" valueUsd={1180} allocation={48} />
          <AssetRow symbol="SAVE" brand icon={<PiggyBank />} name="Savings" detail="Earning 4.5% APY" valueUsd={1000} allocation={40} />
          <AssetRow symbol="QQQ" name="QQQ" detail="0.4048 QQQ" valueUsd={300.12} allocation={12} />
        </ul>
        <div className="mt-3 rounded-control bg-pink-soft p-4">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Laptop</span>
            <span className="tabular">$310 of $500</span>
          </div>
          <Progress value={62} label="Laptop goal" className="mt-2.5 bg-surface" />
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">Product illustration with sample figures.</figcaption>
    </figure>
  );
}

function Section({ id, eyebrow, title, children, className }: { id?: string; eyebrow: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${eyebrow}-h`} className={`scroll-mt-24 border-t border-line py-16 sm:py-24 ${className ?? ""}`}>
      <p className="text-sm font-medium text-muted">{eyebrow}</p>
      <h2 id={`${eyebrow}-h`} className="mt-3 max-w-2xl text-3xl leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-[2.5rem]">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function WelcomePage() {
  return (
    <div>
      <section className="grid items-center gap-12 py-12 sm:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <BloomLogo size={40} animate />
          <h1 className="mt-8 text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[4.25rem]">
            The wallet where dollars become assets and actions.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted">
            Save in USDG. Send Robinhood Stock Tokens. Let your agent act under your rules.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/" className={buttonClass("primary", "lg")}>
              Try Bloom <ArrowRight />
            </Link>
            <a href="#how" className={buttonClass("secondary", "lg")}>
              See how it works
            </a>
          </div>
        </div>
        <ProductMock />
      </section>

      <Section eyebrow="The problem" title="Saving is easy. Doing something with it isn't.">
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
          Dollars sit in one app, investments in another, and automation usually means handing someone the keys. Bloom keeps them in one
          wallet, and lets an agent help only within rules you set.
        </p>
      </Section>

      <Section id="how" eyebrow="How it works" title="Five steps, one wallet.">
        <ol className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="grid size-9 place-items-center rounded-full bg-pink-soft text-sm font-semibold tabular">{s.n}</span>
              <p className="mt-4 text-lg font-semibold tracking-[-0.015em]">{s.title}</p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Risk engine" title="Bloom checks the market before your money moves.">
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-2">
          <div className="space-y-4 text-lg leading-relaxed text-muted">
            <p>
              Stock prices aren&apos;t like crypto prices. Markets close, trading halts, companies split. Bloom reads those signals alongside the
              price oracle and decides whether an asset is in a normal state.
            </p>
            <p>When it isn&apos;t, Bloom pauses agent actions and borrowing for that asset, and tells you why in plain words.</p>
            <Link href="/risk" className="inline-flex items-center gap-1 text-base font-medium text-ink underline-offset-4 hover:underline">
              See the live risk page <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="space-y-3" aria-label="Example risk states">
            <RiskState state="NORMAL" reason="AAPL · Within Bloom's risk policy." size="sm" />
            <RiskState state="HALTED" reason="QQQ · Equity market trading halt detected. Borrowing and agent actions are paused." size="sm" />
            <RiskState state="STALE" reason="NVDA · Oracle price is older than its heartbeat." size="sm" />
          </div>
        </div>
      </Section>

      <Section eyebrow="Bloom Agent" title="Ask in plain words. Confirm before anything moves.">
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-2">
          <div className="space-y-4 text-lg leading-relaxed text-muted">
            <p>Tell Bloom what you want. It prepares the action, checks it against your goal&apos;s limits and the risk engine, and waits for you.</p>
            <p>Goals run on autopilot with a limited permission that expires. You can turn it off at any time.</p>
          </div>
          <div inert aria-label="Example conversation" className="space-y-5">
            <ChatMessage role="user">Send Sarah $5 of QQQ.</ChatMessage>
            <ChatMessage role="assistant">
              <ActionConfirmation card={SAMPLE_SEND} actionId="illustration" headline="Ready to send $5 of QQQ to Sarah." interactive={false} />
            </ChatMessage>
          </div>
        </div>
      </Section>

      <Section eyebrow="Technology" title="Serious underneath.">
        <ul className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {TECH.map((t) => (
            <li key={t.title}>
              <t.icon className="size-5" />
              <p className="mt-4 font-semibold">{t.title}</p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <section className="rounded-card bg-pink-soft px-6 py-12 sm:px-12 sm:py-16">
        <h2 className="max-w-xl text-3xl leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-[2.5rem]">See it for yourself.</h2>
        <p className="mt-4 max-w-lg text-lg text-ink/75">The demo runs on testnet with mock assets, so you can try every flow safely.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className={buttonClass("primary", "lg")}>
            Try Bloom <ArrowRight />
          </Link>
          <Link href="/risk" className={buttonClass("secondary", "lg")}>
            Explore risk controls
          </Link>
        </div>
      </section>
    </div>
  );
}
