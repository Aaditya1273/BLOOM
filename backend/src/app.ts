// HTTP API (docs/API.md). Every input is validated with zod; errors share one shape.
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { Contract, ZeroHash, getAddress, isAddress, parseUnits } from "ethers";
import { z } from "zod";
import {
  ABI, ApiError, EXPLORER, LOCAL, MAINNET, RPC_URL, USDG, addr, assets, c, chainId, deployment, fail, log, minter, provider,
  isRpcFailure, requireTestnet, sendTx,
} from "./ctx.ts";
import { AuthError, createAuth } from "./auth.ts";
import { rateLimit } from "./ratelimit.ts";
import { accountAddress, accountView, createGoal, deposit, ensureAccount, faucet, invest, listGoals, prepareGoalActivation, revokeGoal } from "./account.ts";
import { borrowCheck, invalidateRisk, riskAll, riskOf, stockBySymbol } from "./risk.ts";
import { chat, confirm } from "./agent.ts";
import { getClaim, redeemClaim } from "./claims.ts";
import { completeLesson, publicLessons, REWARD, streakOf, todayLessonId } from "./learn.ts";
import { activity } from "./activity.ts";
import { historyView } from "./history.ts";
import { parseIntent, GOAL_DEFAULTS, llmIntent } from "./intent.ts";
import type { Reporter, Scenario } from "../../offchain/reporter/src/index.ts";

const addrStr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an address");
const money = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "must be a decimal string like \"100\" or \"5.25\"");
const ownerQ = z.object({ owner: addrStr.optional() });
const sym = z.string().regex(/^[A-Za-z]{1,6}$/).transform((s) => s.toUpperCase());

const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data ?? {});
  if (!r.success) fail(400, "BAD_REQUEST", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data!;
};

const GoalSchema = z.object({
  name: z.string().min(1).max(31),
  targetAmount: money,
  asset: z.literal("USDG").default("USDG"),
  deadline: z.iso.datetime({ offset: true }),
  maxDailySpend: money.default(GOAL_DEFAULTS.maxDailySpend),
  maxPerTx: money.default(GOAL_DEFAULTS.maxPerTx),
  maxStockAllocationBps: z.number().int().min(0).max(10_000).default(GOAL_DEFAULTS.maxStockAllocationBps),
  allowedAssets: z.array(sym).min(1).max(8).default(GOAL_DEFAULTS.allowedAssets),
});

const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean);
/** The origin wallet sign-ins are bound to (cross-domain replay protection). */
export const AUTH_URI = process.env.AUTH_URI ?? FRONTEND_ORIGINS[0];
/** Extra admin wallets (comma-separated). Holders of DEFAULT_ADMIN_ROLE on BloomVault are always admins. */
const ADMIN_ADDRESSES = (process.env.ADMIN_ADDRESSES ?? "").split(",").map((a) => a.trim()).filter((a) => isAddress(a)).map((a) => getAddress(a));

/** Admin = configured admin wallet or the onchain BloomVault DEFAULT_ADMIN_ROLE holder. Checked on every admin call. */
async function isAdmin(wallet: string): Promise<boolean> {
  if (ADMIN_ADDRESSES.includes(getAddress(wallet))) return true;
  try {
    return Boolean(await c.vault.hasRole(ZeroHash, wallet));
  } catch {
    return false;
  }
}

/** Security-relevant events. Never pass tokens, signatures, keys or claim codes here. */
const audit = (event: string, fields: Record<string, unknown> = {}) => log.info("audit", { event, ...fields });
// identical concurrent reads for one wallet share one chain read (the public RPC throttles bursts); nothing is kept after
// the read settles, so a read after a write is always fresh
const inflight = new Map<string, Promise<any>>();
function coalesce<T>(key: string, read: () => Promise<T>): Promise<T> {
  let p = inflight.get(key);
  if (!p) {
    p = read().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

export function createApp(reporter: Reporter | null) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.use(cors({ origin: FRONTEND_ORIGINS, allowedHeaders: ["Content-Type", "Authorization"], methods: ["GET", "POST"] }));
  app.use(express.json({ limit: "32kb" }));

  // ─── authentication: the wallet comes ONLY from a verified session token ───
  const auth = createAuth({ chainId, uri: AUTH_URI });
  app.use((req, res, next) => {
    const s = auth.sessionFromHeader(req.headers.authorization);
    if (s) res.locals.wallet = s.wallet;
    next();
  });
  const user = (req: Request, res: Response, next: NextFunction) => {
    const wallet = res.locals.wallet as string | undefined;
    if (!wallet) fail(401, "UNAUTHORIZED", "Sign in with your wallet to continue.");
    // identity is never taken from the request: a supplied `owner` must match the signed-in wallet
    const claimed = (req.body as { owner?: unknown } | undefined)?.owner ?? req.query.owner;
    if (claimed !== undefined && String(claimed).toLowerCase() !== wallet!.toLowerCase()) {
      fail(403, "FORBIDDEN", "owner does not match the signed-in wallet.");
    }
    next();
  };
  const admin = async (req: Request, res: Response, next: NextFunction) => {
    user(req, res, () => undefined);
    const wallet = res.locals.wallet as string;
    if (!(await isAdmin(wallet))) {
      audit("admin.denied", { wallet, path: req.path });
      fail(403, "FORBIDDEN", "This action is only available to Bloom admins.");
    }
    next();
  };
  const me = (res: Response) => res.locals.wallet as string;
  const rl = {
    global: rateLimit("global", { windowSec: 60, max: 300 }),
    nonce: rateLimit("auth-nonce", { windowSec: 60, max: 20 }),
    verify: rateLimit("auth-verify", { windowSec: 60, max: 10 }),
    read: rateLimit("read", { windowSec: 60, max: 120 }),
    history: rateLimit("history", { windowSec: 60, max: 60 }),
    write: rateLimit("write", { windowSec: 60, max: 30 }),
    chat: rateLimit("chat", { windowSec: 60, max: 30 }),
    faucet: rateLimit("faucet", { windowSec: 3600, max: 3 }),
    claimRead: rateLimit("claim-read", { windowSec: 60, max: 60 }),
    claim: rateLimit("claim-redeem", { windowSec: 600, max: 10 }),
    admin: rateLimit("admin", { windowSec: 60, max: 30 }),
  };
  app.use("/api", rl.global);
  app.use((req, res, next) => {
    const t = Date.now();
    res.on("finish", () => log.info("http", { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t }));
    next();
  });

  // ─── system ───
  app.get("/api/health", async (_req, res) => {
    // safe operational info only: no keys, no addresses of backend signers, no env values
    res.json({ ok: true, chainId, network: deployment.network ?? String(chainId), block: await provider.getBlockNumber(),
      riskEngineImpl: deployment.riskEngineImpl ?? "evm-reference",
      reporter: reporter ? { mode: reporter.mode, activeScenarios: reporter.activeScenarios() } : null });
  });
  app.get("/api/health/chain", async (_req, res) => {
    const started = Date.now();
    try {
      const [rpcChainId, block] = await Promise.all([provider.send("eth_chainId", []), provider.getBlock("latest")]);
      res.json({
        ok: Number(rpcChainId) === chainId,
        chainId,
        rpcChainId: Number(rpcChainId),
        rpcReachable: true,
        rpcLatencyMs: Date.now() - started,
        latestBlock: block?.number ?? null,
        latestBlockTime: block?.timestamp ?? null,
        riskEngine: { address: addr.BloomRiskEngine, impl: deployment.riskEngineImpl ?? "evm-reference" },
        rpcHost: (() => { try { return new URL(RPC_URL!).host; } catch { return null; } })(),
      });
    } catch {
      res.status(503).json({ ok: false, chainId, rpcReachable: false, rpcLatencyMs: Date.now() - started });
    }
  });
  app.get("/api/config", (_req, res) => {
    res.json({ chainId, explorer: EXPLORER, contracts: deployment.contracts,
      assets: assets.map((a) => ({ symbol: a.symbol, token: a.token, decimals: a.decimals, kind: a.kind })),
    });
  });

  // ─── auth ───
  app.get("/api/auth/nonce", rl.nonce, (req, res) => {
    const q = parse(z.object({ wallet: addrStr }), req.query);
    try {
      res.json(auth.issueChallenge(q.wallet));
    } catch (e) {
      if (e instanceof AuthError) fail(400, "BAD_REQUEST", e.message);
      throw e;
    }
  });
  app.post("/api/auth/verify", rl.verify, async (req, res) => {
    const b = parse(z.object({ message: z.record(z.string(), z.unknown()), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65-byte signature") }), req.body);
    let wallet: string;
    try {
      wallet = auth.verifyLogin(b.message as never, b.signature);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      audit("auth.failure", { reason: e.code, claimedWallet: typeof b.message.wallet === "string" ? b.message.wallet : undefined, ip: req.ip });
      return fail(401, "UNAUTHORIZED", e.message, { reason: e.code });
    }
    const session = auth.createSession(wallet);
    const role = (await isAdmin(wallet)) ? "admin" : "user";
    audit("auth.success", { wallet, role, ip: req.ip });
    res.json({ token: session.token, wallet, role, expiresAt: session.expiresAt });
  });
  app.get("/api/auth/me", user, async (_req, res) => {
    res.json({ wallet: me(res), role: (await isAdmin(me(res))) ? "admin" : "user" });
  });
  app.post("/api/auth/logout", (req, res) => {
    auth.revoke(req.headers.authorization);
    res.json({ ok: true });
  });

  // ─── account ───
  app.get("/api/account", user, rl.read, async (req, res) => {
    res.json(await coalesce(`account:${me(res)}`, () => accountView(me(res))));
  });
  app.get("/api/account/history", user, rl.history, async (req, res) => {
    const owner = me(res);
    const v = await coalesce(`account:${owner}`, () => accountView(owner));
    res.json(historyView(owner, { totalUsd: Number(v.totalUsd), prices: Object.fromEntries(v.stocks.map((s) => [s.symbol, Number(s.priceUsd)])) }));
  });
  app.post("/api/faucet", user, rl.faucet, async (req, res) => {
    const r = await faucet(me(res));
    audit("faucet.mint", { wallet: me(res), amount: r.amount, txHash: r.txHash });
    res.json(r);
  });
  app.post("/api/deposit", user, rl.write, async (req, res) => {
    const b = parse(ownerQ.extend({ amount: money }), req.body);
    res.json(await deposit(me(res), b.amount));
  });
  app.post("/api/invest", user, rl.write, async (req, res) => {
    const b = parse(ownerQ.extend({ amount: money, allocation: z.array(z.object({ symbol: sym, bps: z.number().int().min(0).max(10_000) })).max(8).optional() }), req.body);
    res.json(await invest(me(res), b.amount, b.allocation));
  });

  // ─── goals ───
  app.post("/api/goals/preview", user, rl.chat, async (req, res) => {
    const b = parse(ownerQ.extend({ text: z.string().min(1).max(500) }), req.body);
    const symbols = assets.map((a) => a.symbol);
    let i = parseIntent(b.text, symbols);
    if (i.action !== "CREATE_GOAL") i = (await llmIntent(b.text, symbols)) ?? i;
    if (i.action !== "CREATE_GOAL") fail(400, "BAD_REQUEST", 'I couldn\'t read a goal from that. Try "Save $500 for my laptop by December 15."');
    const { action, ...goal } = i as Extract<typeof i, { action: "CREATE_GOAL" }>;
    res.json({ goal });
  });
  app.post("/api/goals", user, rl.write, async (req, res) => {
    const b = parse(ownerQ.extend({ goal: GoalSchema }), req.body);
    res.json(await createGoal(me(res), b.goal));
  });
  // wallet owners: after the createGoal tx is mined, get the activateGoal tx to sign
  app.post("/api/goals/activate", user, rl.write, async (req, res) => {
    const b = parse(ownerQ.extend({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }), req.body);
    res.json(await prepareGoalActivation(me(res), b.txHash));
  });
  app.get("/api/goals", user, rl.read, async (req, res) => {
    res.json(await coalesce(`goals:${me(res)}`, () => listGoals(me(res))));
  });
  app.post("/api/goals/:id/revoke", user, rl.write, async (req, res) => {
    const id = parse(z.string().regex(/^\d{1,9}$/), req.params.id);
    res.json(await revokeGoal(me(res), id));
  });

  // ─── chat ───
  app.post("/api/chat", user, rl.chat, async (req, res) => {
    const b = parse(ownerQ.extend({ message: z.string().min(1).max(500) }), req.body);
    res.json(await chat(me(res), b.message));
  });
  app.post("/api/chat/confirm", user, rl.write, async (req, res) => {
    const b = parse(ownerQ.extend({ actionId: z.uuid() }), req.body);
    const r = await confirm(me(res), b.actionId);
    audit("agent.execution", { wallet: me(res), actionId: b.actionId, status: r.status, txHashes: (r as { txHashes?: string[] }).txHashes,
      claimCreated: Boolean((r as { claim?: unknown }).claim) || undefined });
    res.json(r);
  });

  // ─── risk ───
  app.get("/api/risk", async (_req, res) => {
    res.json(await riskAll());
  });
  app.post("/api/risk/simulate", admin, rl.admin, async (req, res) => {
    requireTestnet("Risk simulation");
    const b = parse(z.object({ symbol: sym, scenario: z.enum(["HALT", "STALE", "DEVIATION", "CORP_ACTION", "SEQUENCER_DOWN", "RESET"]) }), req.body);
    const a = stockBySymbol(b.symbol);
    if (!reporter) fail(503, "INTERNAL", "Reporter is not configured (REPORTER_PRIVATE_KEY / MOCK_ORACLE_PRIVATE_KEY).");
    let txHashes: string[];
    try {
      txHashes = await reporter!.simulate(a.symbol, b.scenario as Scenario);
    } catch (e) {
      audit("admin.risk_simulation", { wallet: me(res), symbol: a.symbol, scenario: b.scenario, ok: false });
      return fail(502, "CHAIN_ERROR", `Simulation failed: ${(e as Error).message}`);
    }
    invalidateRisk();
    const r = await riskOf(a);
    audit("admin.risk_simulation", { wallet: me(res), symbol: a.symbol, scenario: b.scenario, ok: true, state: r.stateName, txHashes });
    res.json({ txHashes, state: r.state, stateName: r.stateName });
  });
  app.get("/api/risk/borrow-check", user, rl.read, async (req, res) => {
    const q = parse(ownerQ.extend({ symbol: sym.default("AAPL") }), req.query);
    res.json(await borrowCheck(q.symbol));
  });

  // ─── claims ───
  const claimId = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid claim id");
  app.get("/api/claims/:claimId", rl.claimRead, async (req, res) => {
    res.json(await getClaim(parse(claimId, req.params.claimId)));
  });
  app.post("/api/claims/:claimId/redeem", user, rl.claim, async (req, res) => {
    // the recipient is the signed-in wallet; a supplied recipient must match it
    const b = parse(z.object({ recipient: addrStr.optional(), code: z.string().regex(/^\d{6}$/, "must be 6 digits") }), req.body);
    if (b.recipient && b.recipient.toLowerCase() !== me(res).toLowerCase()) fail(403, "FORBIDDEN", "Claims are paid to the signed-in wallet.");
    const id = parse(claimId, req.params.claimId);
    try {
      const r = await redeemClaim(id, me(res), b.code);
      audit("claim.redeemed", { wallet: me(res), claimId: id, txHash: r.txHash });
      res.json(r);
    } catch (e) {
      audit("claim.redeem_failed", { wallet: me(res), claimId: id, reason: (e as Error).message });
      throw e;
    }
  });

  // ─── learning ───
  app.get("/api/learn", user, rl.read, (req, res) => {
    const owner = me(res);
    const s = streakOf(owner);
    res.json({ lessons: publicLessons(), todayLessonId: todayLessonId(owner), streak: { days: s.days, completedToday: s.completedToday }, rewardLabel: REWARD.label });
  });
  app.post("/api/learn/complete", user, rl.write, async (req, res) => {
    const b = parse(ownerQ.extend({ lessonId: z.string().min(1).max(64), answerIndex: z.number().int().min(0).max(9) }), req.body);
    const owner = me(res);
    const r = completeLesson(owner, b.lessonId, b.answerIndex) ?? fail(404, "NOT_FOUND", "Unknown lesson.");
    let reward: (typeof REWARD & { txHash?: string }) | null = null;
    if (r.rewarded && !MAINNET && minter) {
      // Sponsored learning reward: a small testnet USDG mint from the sponsor key. Best effort, never blocks the lesson.
      try {
        const account = await ensureAccount(owner).catch(() => accountAddress(owner));
        const rc = await sendTx(minter, "learning reward", () => new Contract(USDG.token, ABI.usdg, minter).mint(account, parseUnits(REWARD.amount, USDG.decimals)));
        reward = { ...REWARD, txHash: rc.hash };
      } catch (e) {
        log.warn("learning reward failed", { error: e });
      }
    }
    res.json({ correct: r.correct, streak: { days: r.streak.days, completedToday: r.streak.completedToday }, reward });
  });

  // ─── activity ───
  app.get("/api/activity", user, rl.history, async (req, res) => {
    res.json(await coalesce(`activity:${me(res)}`, () => activity(me(res))));
  });

  // ─── ERC-8004 agent metadata (registration file) ───
  app.get("/api/agent/metadata", (req, res) => {
    // the public URL this API is served at (behind a proxy, set TRUST_PROXY so the scheme is right)
    const base = (process.env.PUBLIC_API_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    res.json({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Bloom Agent",
      description: "Consumer-finance agent on Robinhood Chain. Acts only through a policy-bound session key on the user's BloomAccount: capped amounts, allowlisted assets, and it refuses to move Robinhood Stock Tokens outside a NORMAL risk state.",
      services: [{ name: "web", endpoint: `${base}/api/chat` }],
      registrations: process.env.ERC8004_AGENT_ID && process.env.ERC8004_IDENTITY_REGISTRY
        ? [{ agentId: Number(process.env.ERC8004_AGENT_ID), agentRegistry: `eip155:${chainId}:${process.env.ERC8004_IDENTITY_REGISTRY}` }]
        : [],
      supportedTrust: [],
      bloom: { chainId, policy: addr.BloomPolicy, sessionKeyModel: "BloomAccount.executeByAgent", local: LOCAL },
    });
  });

  app.use("/api", (_req, _res) => fail(404, "NOT_FOUND", "No such endpoint."));

  // ─── errors (consistent shape, no stack traces or secrets) ───
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
      return;
    }
    if ((err as any)?.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Body must be valid JSON." } });
      return;
    }
    if (isRpcFailure(err)) {
      log.warn("rpc unavailable", { path: _req.path, error: (err as Error)?.message?.slice(0, 160) });
      res.status(503).json({ error: { code: "CHAIN_ERROR", message: "Robinhood Chain is busy or unreachable right now. Please try again in a moment." } });
      return;
    }
    log.error("unhandled", { error: err });
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
  });
  return app;
}
