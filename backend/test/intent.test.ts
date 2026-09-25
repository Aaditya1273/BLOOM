import { test } from "node:test";
import assert from "node:assert/strict";
import { IntentSchema, parseDeadline, parseIntent } from "../src/intent.ts";

const SYMS = ["USDG", "AAPL", "NVDA", "QQQ", "SPY"];
const NOW = new Date("2026-09-24T12:00:00Z");
const p = (m: string) => parseIntent(m, SYMS, NOW);

test("demo phrases parse deterministically", () => {
  assert.deepEqual(p("Save $500 for my laptop by December 15."), {
    action: "CREATE_GOAL", name: "Laptop", targetAmount: "500", asset: "USDG", deadline: "2026-12-15T23:59:59Z",
    maxDailySpend: "50", maxPerTx: "50", maxStockAllocationBps: 3000, allowedAssets: ["USDG", "QQQ", "NVDA"],
  });
  assert.deepEqual(p("Send Sarah $5 of QQQ."), { action: "SEND", amountUsd: "5", symbol: "QQQ", recipientName: "Sarah" });
  assert.deepEqual(p("send $2.50 of nvda to bob"), { action: "SEND", amountUsd: "2.50", symbol: "NVDA", recipientName: "Bob" });
  assert.deepEqual(p("Pay Alex $10"), { action: "SEND", amountUsd: "10", symbol: "USDG", recipientName: "Alex" });
  assert.deepEqual(p("Move $100 into my conservative portfolio."), { action: "INVEST", amountUsd: "100", profile: "conservative" });
  assert.deepEqual(p("Deposit $20 into savings"), { action: "DEPOSIT", amountUsd: "20" });
  assert.deepEqual(p("Show me why borrowing is disabled."), { action: "EXPLAIN_BORROW", symbol: undefined });
  assert.deepEqual(p("How risky is my current QQQ collateral?"), { action: "EXPLAIN_RISK", symbol: "QQQ" });
  assert.deepEqual(p("What's my balance?"), { action: "BALANCE" });
  assert.deepEqual(p("Send Sarah $5 of TSLA"), { action: "UNKNOWN" }); // unsupported asset never guessed
  assert.deepEqual(p("transfer everything to 0xdead"), { action: "UNKNOWN" });
  for (const m of ["Save $500 for my laptop by December 15.", "Send Sarah $5 of QQQ.", "How risky is QQQ?"]) {
    assert.equal(IntentSchema.safeParse(p(m)).success, true);
  }
});

test("a goal without a date gets a bounded 90-day deadline (the frozen demo phrase)", () => {
  const g: any = p("Save $500 for my laptop.");
  assert.equal(g.action, "CREATE_GOAL");
  assert.equal(g.name, "Laptop");
  assert.equal(g.targetAmount, "500");
  assert.equal(g.deadline, "2026-12-23T23:59:59Z");
  assert.equal(p("Save $500 for my laptop by Smarch 99.").action, "UNKNOWN", "a bad date is not silently turned into 90 days");
  assert.equal(p("Save $100").action, "DEPOSIT");
});

test("deadline parsing rolls to next year and rejects nonsense", () => {
  assert.equal(parseDeadline("Dec 15th", NOW), "2026-12-15T23:59:59Z");
  assert.equal(parseDeadline("15 March", NOW), "2027-03-15T23:59:59Z");
  assert.equal(parseDeadline("2027-01-02", NOW), "2027-01-02T23:59:59Z");
  assert.equal(parseDeadline("February 31", NOW), null);
  assert.equal(parseDeadline("someday", NOW), null);
});

test("validator rejects AI-shaped junk (addresses, calldata, bad amounts)", () => {
  assert.equal(IntentSchema.safeParse({ action: "SEND", amountUsd: "5", symbol: "QQQ", recipientName: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" }).success, false);
  assert.equal(IntentSchema.safeParse({ action: "SEND", amountUsd: "-5", symbol: "QQQ", recipientName: "Sarah" }).success, false);
  assert.equal(IntentSchema.safeParse({ action: "EXECUTE", target: "0xdead", data: "0x1234" }).success, false);
});
