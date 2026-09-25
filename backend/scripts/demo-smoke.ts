// End-to-end smoke test of the 90-second demo against a running backend (default http://localhost:3001) on a
// local/testnet deployment. Exits non-zero on the first failed check.
//   npm run smoke            (backend must be running: npm start)
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Wallet, type BaseWallet } from "ethers";

const API = process.env.API_URL ?? "http://localhost:3001";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local"), quiet: true });
// the chain the backend is on (read from the backend below); never read a testnet address from a local node or vice versa
const LOCAL = (process.env.BLOOM_DEPLOYMENT ?? "localhost") === "localhost";
const RPC = process.env.RPC_URL ?? (LOCAL ? "http://127.0.0.1:8545" : process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com");
let step = 0;

// Everything goes through wallet sign-in. The demo owner acts as the user; the admin wallet runs risk simulations.
// Local chain: public Hardhat dev keys (#5 demo owner, #0 admin). Testnet: DEMO_OWNER / ADMIN keys from .env.local.
const HH_DEMO = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const HH_ADMIN = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const tokens: Record<string, string> = {};
async function login(as: string, w: BaseWallet) {
  const n = await (await fetch(`${API}/api/auth/nonce?wallet=${w.address}`)).json() as any;
  const signature = await w.signTypedData(n.domain, n.types, n.message);
  const v = await fetch(`${API}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: n.message, signature }) });
  const b = await v.json() as any;
  assert.equal(v.status, 200, JSON.stringify(b));
  tokens[as] = b.token;
  return b;
}

async function call(method: string, path: string, body?: unknown, as: string | null = path.startsWith("/api/risk/simulate") ? "admin" : "user") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as && tokens[as]) headers.Authorization = `Bearer ${tokens[as]}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
const rpcChain = Number(((await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).json()) as any).result);
assert.equal(rpcChain, health.chainId, `RPC_URL is chain ${rpcChain} but the backend is on ${health.chainId}`);
check("health", `chain ${health.chainId}, block ${health.block}, engine ${health.riskEngineImpl}`);

// 0. auth lockdown: no session -> 401; a normal user cannot run admin simulations
const local = health.chainId === 31337;
const demoKey = local ? HH_DEMO : process.env.DEMO_OWNER_PRIVATE_KEY;
const adminKey = local ? HH_ADMIN : process.env.ADMIN_PRIVATE_KEY;
assert.ok(demoKey && adminKey, "testnet smoke needs DEMO_OWNER_PRIVATE_KEY and ADMIN_PRIVATE_KEY");
assert.equal((await call("POST", "/api/deposit", { amount: "1" }, null)).status, 401);
const u = await login("user", new Wallet(demoKey!));
const a = await login("admin", new Wallet(adminKey!));
assert.equal(a.role, "admin");
const denied = await call("POST", "/api/risk/simulate", { symbol: "AAPL", scenario: "HALT" }, "user");
assert.equal(denied.status, u.role === "admin" ? 200 : 403);
check("auth lockdown", `unauthenticated -> 401, user simulate -> ${denied.status}, signed in ${u.wallet.slice(0, 10)}… + admin`);
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
const { goal } = await ok("POST", "/api/goals/preview", { text: "Save $500 for my laptop." });
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
// Jamie signs in with their own wallet; the claim is paid to that signed-in wallet only
const jamieWallet = Wallet.createRandom();
await login("jamie", jamieWallet);
const jamie = jamieWallet.address;
const wrong = await call("POST", `/api/claims/${x2.claim.claimId}/redeem`, { code: x2.claim.code === "000000" ? "111111" : "000000" }, "jamie");
assert.equal(wrong.status, 400);
const jBefore = await balanceOf(token("NVDA"), jamie);
const red = (await call("POST", `/api/claims/${x2.claim.claimId}/redeem`, { code: x2.claim.code }, "jamie")).body;
assert.ok(red.txHash, JSON.stringify(red));
assert.ok((await balanceOf(token("NVDA"), jamie)) > jBefore);
assert.equal((await ok("GET", `/api/claims/${x2.claim.claimId}`)).status, "CLAIMED");
const again = await call("POST", `/api/claims/${x2.claim.claimId}/redeem`, { code: x2.claim.code }, "jamie");
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
