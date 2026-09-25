// API authorization matrix (runs against a mainnet-shaped fixture with an unreachable RPC: no chain access needed).
// Covers: unauthenticated mutation, user vs admin routes, forged owner fields, faucet on mainnet, rate limiting, CORS,
// mainnet key loading and key separation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet, makeError, type BaseWallet } from "ethers";

const admin = Wallet.createRandom();
const shared = Wallet.createRandom().privateKey;
process.env.BLOOM_DEPLOYMENT = "../backend/test/fixtures/mainnet-deployment";
process.env.RPC_URL = "http://127.0.0.1:1"; // never contacted by these routes
process.env.BLOOM_DATA_DIR = mkdtempSync(join(tmpdir(), "bloom-"));
process.env.FRONTEND_ORIGIN = "https://bloom.example";
process.env.ADMIN_ADDRESSES = admin.address;
process.env.DEMO_OWNER_PRIVATE_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"; // must be ignored on mainnet
process.env.REPORTER_PRIVATE_KEY = shared; // deliberately shared with the claim authority -> key separation must fail
process.env.CLAIM_AUTHORITY_PRIVATE_KEY = shared;
const { createApp } = await import("../src/app.ts");
const ctx = await import("../src/ctx.ts");

async function withServer(fn: (call: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any; headers: Headers }>) => Promise<void>) {
  const server = createApp(null).listen(0);
  const port = (server.address() as any).port;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

async function login(call: any, w: BaseWallet) {
  const n = await call("GET", `/api/auth/nonce?wallet=${w.address}`);
  assert.equal(n.status, 200);
  const sig = await w.signTypedData(n.body.domain, n.body.types, n.body.message);
  const v = await call("POST", "/api/auth/verify", { message: n.body.message, signature: sig });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.wallet, w.address);
  assert.equal(JSON.stringify(v.body).includes(sig), false, "signature must not be echoed");
  return { Authorization: `Bearer ${v.body.token}`, role: v.body.role };
}

const MUTATING: [string, unknown][] = [
  ["/api/faucet", {}],
  ["/api/deposit", { amount: "1" }],
  ["/api/invest", { amount: "1" }],
  ["/api/goals/preview", { text: "Save $500 for my laptop by December 15." }],
  ["/api/goals", { goal: {} }],
  ["/api/goals/activate", { txHash: "0x" + "11".repeat(32) }],
  ["/api/goals/1/revoke", {}],
  ["/api/chat", { message: "Send Sarah $5 of QQQ." }],
  ["/api/chat/confirm", { actionId: "x" }],
  ["/api/risk/simulate", { symbol: "AAPL", scenario: "HALT" }],
  ["/api/claims/0x" + "11".repeat(32) + "/redeem", { code: "123456" }],
  ["/api/learn/complete", { lessonId: "1", answerIndex: 0 }],
];

test("mainnet: demo owner / faucet / mock-oracle keys are never loaded", () => {
  assert.equal(ctx.MAINNET, true);
  assert.equal(ctx.demoOwner, null);
  assert.equal(ctx.minter, null);
  assert.equal(ctx.keys.feedAdmin, undefined);
});

test("key separation: two roles sharing one key is refused", () => {
  assert.throws(() => ctx.assertKeySeparation(), /share one key/);
});

test("unauthenticated API cannot mutate state (401 on every state-changing endpoint)", async () => {
  await withServer(async (call) => {
    for (const [path, body] of MUTATING) {
      const r = await call("POST", path, body);
      assert.equal(r.status, 401, path);
      assert.equal(r.body.error.code, "UNAUTHORIZED", path);
    }
    for (const path of ["/api/account", "/api/goals", "/api/activity", "/api/account/history", "/api/learn", "/api/auth/me"]) {
      assert.equal((await call("GET", path)).status, 401, path);
    }
    // a forged/unknown bearer token is the same as none
    assert.equal((await call("POST", "/api/deposit", { amount: "1" }, { Authorization: "Bearer " + "A".repeat(43) })).status, 401);
  });
});

test("user cannot run admin risk simulations or mint on mainnet; owner fields cannot impersonate", async () => {
  await withServer(async (call) => {
    const u = await login(call, Wallet.createRandom());
    assert.equal(u.role, "user");
    const sim = await call("POST", "/api/risk/simulate", { symbol: "AAPL", scenario: "HALT" }, u);
    assert.equal(sim.status, 403);
    assert.equal(sim.body.error.code, "FORBIDDEN");
    const f = await call("POST", "/api/faucet", {}, u);
    assert.equal(f.status, 403);
    assert.equal(f.body.error.code, "TESTNET_ONLY");
    const victim = Wallet.createRandom().address;
    const imp = await call("POST", "/api/deposit", { owner: victim, amount: "1" }, u);
    assert.equal(imp.status, 403);
    assert.equal(imp.body.error.code, "FORBIDDEN");
    const impQ = await call("GET", `/api/account?owner=${victim}`, undefined, u);
    assert.equal(impQ.status, 403);
    const claim = await call("POST", "/api/claims/0x" + "11".repeat(32) + "/redeem", { recipient: victim, code: "123456" }, u);
    assert.equal(claim.status, 403, "claims are paid to the signed-in wallet only");
  });
});

test("admin passes the admin gate (then the mainnet guard applies)", async () => {
  await withServer(async (call) => {
    const a = await login(call, admin);
    assert.equal(a.role, "admin");
    const sim = await call("POST", "/api/risk/simulate", { symbol: "AAPL", scenario: "HALT" }, a);
    assert.equal(sim.status, 403);
    assert.equal(sim.body.error.code, "TESTNET_ONLY");
  });
});

test("replayed sign-in over HTTP is rejected", async () => {
  await withServer(async (call) => {
    const w = Wallet.createRandom();
    const n = await call("GET", `/api/auth/nonce?wallet=${w.address}`);
    const sig = await w.signTypedData(n.body.domain, n.body.types, n.body.message);
    assert.equal((await call("POST", "/api/auth/verify", { message: n.body.message, signature: sig })).status, 200);
    const again = await call("POST", "/api/auth/verify", { message: n.body.message, signature: sig });
    assert.equal(again.status, 401);
    assert.equal(again.body.error.details.reason, "REPLAYED_NONCE");
  });
});

test("rate limiting returns 429 with Retry-After", async () => {
  await withServer(async (call) => {
    let last;
    for (let i = 0; i < 11; i++) last = await call("POST", "/api/auth/verify", { message: {}, signature: "0x" + "11".repeat(65) });
    assert.equal(last!.status, 429);
    assert.equal(last!.body.error.code, "RATE_LIMITED");
    assert.ok(Number(last!.headers.get("retry-after")) > 0);
  });
});

test("CORS only allows the configured frontend origin", async () => {
  await withServer(async (call) => {
    const good = await call("GET", "/api/config", undefined, { Origin: "https://bloom.example" });
    assert.equal(good.headers.get("access-control-allow-origin"), "https://bloom.example");
    const evil = await call("GET", "/api/config", undefined, { Origin: "https://evil.example" });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
  });
});

test("a stalled receipt fails fast as 504 pending (and frees the key's lock)", async () => {
  const w = Wallet.createRandom();
  const stalled = async () => ({ hash: "0x" + "ab".repeat(32), wait: async () => { throw makeError("timeout", "TIMEOUT"); } });
  await assert.rejects(ctx.sendTx(w as any, "agent send", stalled), (e: any) => e.status === 504 && e.details.pending === true && e.details.txHash.startsWith("0xab"));
  // the lock is released: the next send for the same key runs
  const rc = await ctx.sendTx(w as any, "next", async () => ({ hash: "0x01", wait: async () => ({ status: 1 }) }));
  assert.equal(rc.status, 1);
});
