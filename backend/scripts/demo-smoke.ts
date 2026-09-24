// End-to-end smoke test of the 90-second demo against a running backend (default http://localhost:3001) on a
// local/testnet deployment. Exits non-zero on the first failed check.
//   npm run smoke            (backend must be running: npm start)
import assert from "node:assert/strict";

const API = process.env.API_URL ?? "http://localhost:3001";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
let step = 0;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const ok = async (method: string, path: string, body?: unknown) => {
  const r = await call(method, path, body);
  assert.ok(r.status < 300, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const check = (label: string, extra = "") => console.log(`✔ ${String(++step).padStart(2)} ${label}${extra ? `  — ${extra}` : ""}`);

async function balanceOf(token: string, who: string): Promise<bigint> {
  const data = "0x70a08231" + who.slice(2).toLowerCase().padStart(64, "0");
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: token, data }, "latest"] }) });
  return BigInt(((await res.json()) as any).result);
}
const riskOf = async (sym: string) => (await ok("GET", "/api/risk")).assets.find((a: any) => a.symbol === sym);

const health = await ok("GET", "/api/health");
assert.equal(health.ok, true);
assert.notEqual(health.chainId, 4663, "smoke test is testnet/local only");
check("health", `chain ${health.chainId}, block ${health.block}, engine ${health.riskEngineImpl}`);
const cfg = await ok("GET", "/api/config");
const token = (s: string) => cfg.assets.find((a: any) => a.symbol === s).token;

// make sure no scenario from an earlier run is active
await ok("POST", "/api/risk/simulate", { symbol: "AAPL", scenario: "RESET" });

// 1. faucet (1/day: a repeat run today gets 429, which is fine if the account is funded)
const f = await call("POST", "/api/faucet", {});
assert.ok(f.status === 200 || f.status === 429, JSON.stringify(f.body));
let acct = await ok("GET", "/api/account");
assert.ok(Number(acct.usdg.balance) >= 120, `account needs USDG, has ${acct.usdg.balance}`);
check("faucet", f.status === 200 ? `+${f.body.amount} USDG tx ${f.body.txHash.slice(0, 10)}…` : "already used today; account funded");

// 2. deposit $100
const savedBefore = Number(acct.savings.valueUsd);
const d = await ok("POST", "/api/deposit", { amount: "100" });
acct = await ok("GET", "/api/account");
assert.ok(Number(acct.savings.valueUsd) >= savedBefore + 99.99, `savings ${acct.savings.valueUsd}`);
check("deposit $100", `shares ${d.shares}, savings $${acct.savings.valueUsd}, tx ${d.txHash.slice(0, 10)}…`);

// 3. laptop goal
const { goal } = await ok("POST", "/api/goals/preview", { text: "Save $500 for my laptop by December 15." });
assert.deepEqual([goal.name, goal.targetAmount, goal.maxDailySpend, goal.maxStockAllocationBps, goal.allowedAssets.join()], ["Laptop", "500", "50", 3000, "USDG,QQQ,NVDA"]);
const g = await ok("POST", "/api/goals", { goal });
const goals = await ok("GET", "/api/goals");
assert.ok(goals.some((x: any) => x.goalId === g.goalId && x.active && x.name === "Laptop"));
check("create laptop goal", `goal #${g.goalId}, session key ${g.sessionKey}, expires ${g.expiresAt}`);

// 4. chat: Send Sarah $5 of QQQ
const sarah = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const before = await balanceOf(token("QQQ"), sarah);
const c1 = await ok("POST", "/api/chat", { message: "Send Sarah $5 of QQQ." });
assert.equal(c1.intent.action, "SEND");
assert.ok(c1.actionId, JSON.stringify(c1));
assert.equal(c1.card.policyCheck.ok, true);
assert.equal(c1.card.recipient.viaClaimLink, false);
const x1 = await ok("POST", "/api/chat/confirm", { actionId: c1.actionId });
assert.equal(x1.status, "executed", JSON.stringify(x1));
const after = await balanceOf(token("QQQ"), sarah);
assert.ok(after - before > 0n);
check(`chat "Send Sarah $5 of QQQ."`, `${c1.reply} → ${x1.txHashes.length} agent txs, Sarah +${c1.card.amount} QQQ`);

// 5. risk: AAPL NORMAL, borrowing on, 60% LTV
let aapl = await riskOf("AAPL");
assert.deepEqual([aapl.stateName, aapl.borrowingAllowed, aapl.maxLtvBps], ["NORMAL", true, 6000]);
check("AAPL NORMAL", "borrowing enabled, max LTV 60%");

// 6. HALT -> HALTED, LTV 0
const h = await ok("POST", "/api/risk/simulate", { symbol: "AAPL", scenario: "HALT" });
assert.equal(h.stateName, "HALTED");
aapl = await riskOf("AAPL");
assert.deepEqual([aapl.stateName, aapl.borrowingAllowed, aapl.maxLtvBps], ["HALTED", false, 0]);
const bc = await ok("GET", "/api/risk/borrow-check?symbol=AAPL");
assert.equal(bc.borrowingAllowed, false);
check("simulate HALT", `AAPL HALTED, LTV 0 — "${bc.message}"`);

// 7. RESET -> NORMAL
const r = await ok("POST", "/api/risk/simulate", { symbol: "AAPL", scenario: "RESET" });
assert.equal(r.stateName, "NORMAL");
aapl = await riskOf("AAPL");
assert.deepEqual([aapl.stateName, aapl.maxLtvBps], ["NORMAL", 6000]);
check("RESET", "AAPL back to NORMAL, LTV 60%");

// 8. unknown recipient -> claim link -> redeem
const c2 = await ok("POST", "/api/chat", { message: "Send Jamie $2 of NVDA." });
assert.equal(c2.card.recipient.viaClaimLink, true);
const x2 = await ok("POST", "/api/chat/confirm", { actionId: c2.actionId });
assert.equal(x2.status, "executed", JSON.stringify(x2));
assert.match(x2.claim.code, /^\d{6}$/);
assert.equal(x2.claim.url, `/claim/${x2.claim.claimId}`);
const cl = await ok("GET", `/api/claims/${x2.claim.claimId}`);
assert.equal(cl.status, "OPEN");
assert.equal(JSON.stringify(cl).includes(x2.claim.code), false, "claim view must not leak the code");
const jamie = "0x000000000000000000000000000000000000dEaD";
const wrong = await call("POST", `/api/claims/${x2.claim.claimId}/redeem`, { recipient: jamie, code: x2.claim.code === "000000" ? "111111" : "000000" });
assert.equal(wrong.status, 400);
const jBefore = await balanceOf(token("NVDA"), jamie);
const red = await ok("POST", `/api/claims/${x2.claim.claimId}/redeem`, { recipient: jamie, code: x2.claim.code });
assert.ok((await balanceOf(token("NVDA"), jamie)) > jBefore);
assert.equal((await ok("GET", `/api/claims/${x2.claim.claimId}`)).status, "CLAIMED");
const again = await call("POST", `/api/claims/${x2.claim.claimId}/redeem`, { recipient: jamie, code: x2.claim.code });
assert.equal(again.status, 400);
check("claim link for unknown recipient", `wrong code rejected, redeemed tx ${red.txHash.slice(0, 10)}…, double-claim rejected`);

// 9. halted asset: confirmed-then-halted send is rejected onchain by BloomPolicy, in plain English
const c3 = await ok("POST", "/api/chat", { message: "Send Sarah $3 of QQQ." });
assert.ok(c3.actionId);
await ok("POST", "/api/risk/simulate", { symbol: "QQQ", scenario: "HALT" });
const x3 = await ok("POST", "/api/chat/confirm", { actionId: c3.actionId });
assert.equal(x3.status, "rejected", JSON.stringify(x3));
assert.equal(x3.message, "I didn't execute this action because QQQ entered a halted-risk state.");
assert.equal(x3.reason, "HALTED");
const c4 = await ok("POST", "/api/chat", { message: "Send Sarah $3 of QQQ." });
assert.equal(c4.actionId, undefined);
assert.equal(c4.card.policyCheck.ok, false);
check("halted-asset send rejected", `"${x3.message}" (policy: ${x3.policyReason}, tx ${x3.txHashes.at(-1).slice(0, 10)}…)`);
await ok("POST", "/api/risk/simulate", { symbol: "QQQ", scenario: "RESET" });
assert.equal((await riskOf("QQQ")).stateName, "NORMAL");

// 10. explanations, learning, activity
const e1 = await ok("POST", "/api/chat", { message: "Show me why borrowing is disabled." });
const e2 = await ok("POST", "/api/chat", { message: "How risky is my current QQQ collateral?" });
assert.equal(e1.intent.action, "EXPLAIN_BORROW");
assert.equal(e2.intent.action, "EXPLAIN_RISK");
const learn = await ok("GET", "/api/learn");
assert.equal(learn.lessons.length, 7);
assert.equal(learn.lessons[0].quiz.answerIndex, undefined);
const act = await ok("GET", "/api/activity");
assert.ok(act.some((a: any) => a.type === "Sent") && act.some((a: any) => a.type === "ActionRejected"));
check("explain / learn / activity", `${act.length} activity items; "${e1.reply.slice(0, 80)}…"`);

// 11. validation + error shape
const bad = await call("POST", "/api/deposit", { amount: "-5" });
assert.equal(bad.status, 400);
assert.equal(bad.body.error.code, "BAD_REQUEST");
check("input validation", bad.body.error.message);

console.log(`\nSMOKE OK — ${step} checks passed`);
