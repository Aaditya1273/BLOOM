// Seven tiny lessons, one per day, with a streak counter. Rewards are "Sponsored learning rewards":
// a small testnet USDG mint from the demo sponsor key — not a sustainable yield or income.
import { jsonStore } from "./store.ts";

type Lesson = { id: string; title: string; body: string; quiz: { question: string; options: string[]; answerIndex: number } };

export const LESSONS: Lesson[] = [
  {
    id: "what-is-spy",
    title: "What is SPY?",
    body: "SPY is an exchange-traded fund that tracks the S&P 500, an index of about 500 large US companies. The SPY Robinhood Stock Token gives you economic exposure to SPY's price on Robinhood Chain. It is a token, not a share: you do not get shareholder voting rights.",
    quiz: { question: "What does SPY track?", options: ["The S&P 500 index", "The price of gold", "A single tech company"], answerIndex: 0 },
  },
  {
    id: "what-is-diversification",
    title: "What is diversification?",
    body: "Diversification means spreading money across different assets so one bad outcome hurts less. Holding savings in USDG plus a small slice of a broad fund like SPY is more diversified than putting everything into one company. It reduces risk; it does not remove it.",
    quiz: { question: "Diversification…", options: ["Guarantees profits", "Reduces the impact of any single asset falling", "Means buying only one stock"], answerIndex: 1 },
  },
  {
    id: "what-is-a-trading-halt",
    title: "What is a trading halt?",
    body: "An exchange can pause trading in a stock, for example before major news. During a halt there is no reliable market price. Bloom's risk engine reads signed halt reports and, while an asset is halted, stops the Bloom Agent from moving it and pauses borrowing against it.",
    quiz: { question: "During a halt, Bloom…", options: ["Keeps lending at full value", "Pauses agent actions and borrowing for that asset", "Sells the asset immediately"], answerIndex: 1 },
  },
  {
    id: "what-is-collateral",
    title: "What is collateral?",
    body: "Collateral is something you pledge so you can borrow. If you pledge $100 of a Stock Token at a 60% max loan-to-value, you can borrow up to $60 of USDG. If the collateral's value falls too far, it can be sold to repay the loan, so borrowing adds risk.",
    quiz: { question: "With $100 of collateral at 60% max LTV you can borrow up to…", options: ["$160", "$100", "$60"], answerIndex: 2 },
  },
  {
    id: "what-is-usdg",
    title: "What is USDG?",
    body: "USDG is a US-dollar stablecoin issued by Paxos and designed to stay worth $1. On Bloom it is the base currency for saving and sending. On testnet, Bloom uses a mock USDG with no real value.",
    quiz: { question: "USDG is designed to be worth…", options: ["$1", "Whatever the market decides each day", "One share of SPY"], answerIndex: 0 },
  },
  {
    id: "what-is-an-oracle",
    title: "What is an oracle?",
    body: "Blockchains can't see stock prices on their own. An oracle publishes prices onchain, for example Chainlink price feeds. Bloom checks that the oracle price is fresh and close to a signed reference price before trusting it.",
    quiz: { question: "An oracle…", options: ["Brings offchain prices onchain", "Mines new tokens", "Stores your password"], answerIndex: 0 },
  },
  {
    id: "why-borrowing-paused",
    title: "Why can borrowing be paused?",
    body: "Lending against a price you can't trust is dangerous. Bloom pauses new borrowing and liquidations when a Stock Token is halted, its price is stale or deviates, a corporate action is being processed, or the network sequencer is down. This protects borrowers from being liquidated at a bad price.",
    quiz: { question: "Bloom pauses borrowing when…", options: ["The price can't be trusted", "It's the weekend", "You have too much USDG"], answerIndex: 0 },
  },
];

export const REWARD = { amount: "0.10", label: "Sponsored learning rewards" };

type Streak = { days: number; lastDay: string | null; lastLessonAt: string | null; completed: string[] };
const store = jsonStore<Record<string, Streak>>("streaks", {});
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const yesterday = () => day(new Date(Date.now() - 86_400_000));

export function streakOf(owner: string) {
  const s = store.get()[owner.toLowerCase()];
  const completedToday = s?.lastDay === day();
  const alive = s && (completedToday || s.lastDay === yesterday());
  return { days: alive ? s.days : 0, lastLessonAt: s?.lastLessonAt ?? null, completedToday: Boolean(completedToday) };
}

export function todayLessonId(owner: string): string {
  const s = store.get()[owner.toLowerCase()];
  if (s?.lastDay === day()) return s.completed[s.completed.length - 1];
  return LESSONS[(s?.completed.length ?? 0) % LESSONS.length].id;
}

export function publicLessons() {
  return LESSONS.map(({ quiz: { answerIndex, ...q }, ...l }) => ({ ...l, quiz: q }));
}

/** Returns whether the answer is correct and whether this completion earns today's reward. */
export function completeLesson(owner: string, lessonId: string, answerIndex: number) {
  const lesson = LESSONS.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const correct = lesson.quiz.answerIndex === answerIndex;
  const k = owner.toLowerCase();
  const already = store.get()[k]?.lastDay === day();
  if (correct && !already) {
    store.update((d) => {
      const s = d[k] ?? { days: 0, lastDay: null, lastLessonAt: null, completed: [] };
      s.days = s.lastDay === yesterday() ? s.days + 1 : 1;
      s.lastDay = day();
      s.lastLessonAt = new Date().toISOString();
      s.completed.push(lessonId);
      d[k] = s;
    });
  }
  return { correct, rewarded: correct && !already, streak: streakOf(owner) };
}
