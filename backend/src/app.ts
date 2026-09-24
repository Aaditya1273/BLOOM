// HTTP API (docs/API.md). Every input is validated with zod; errors share one shape.
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { Contract, parseUnits } from "ethers";
import { z } from "zod";
import {
  ABI, ApiError, EXPLORER, LOCAL, MAINNET, USDG, addr, assets, chainId, deployment, demoOwner, fail, log, minter, provider,
  requireTestnet, sendTx,
} from "./ctx.ts";
import { accountAddress, accountView, createGoal, deposit, ensureAccount, faucet, invest, listGoals, resolveOwner, revokeGoal } from "./account.ts";
import { borrowCheck, riskAll, riskOf, stockBySymbol } from "./risk.ts";
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

export function createApp(reporter: Reporter | null) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    const t = Date.now();
    res.on("finish", () => log.info("http", { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t }));
    next();
  });

  // ─── system ───
  app.get("/api/health", async (_req, res) => {
    res.json({ ok: true, chainId, network: deployment.network ?? String(chainId), block: await provider.getBlockNumber(),
      riskEngineImpl: deployment.riskEngineImpl ?? "evm-reference", demoMode: !MAINNET && Boolean(demoOwner),
      reporter: reporter ? { mode: reporter.mode, activeScenarios: reporter.activeScenarios() } : null });
  });
  app.get("/api/config", (_req, res) => {
    res.json({ chainId, explorer: EXPLORER, contracts: deployment.contracts,
      assets: assets.map((a) => ({ symbol: a.symbol, token: a.token, decimals: a.decimals, kind: a.kind })),
      demoOwner: demoOwner?.address ?? null });
  });

  // ─── account ───
  app.get("/api/account", async (req, res) => {
    res.json(await accountView(resolveOwner(parse(ownerQ, req.query).owner)));
  });
  app.get("/api/account/history", async (req, res) => {
    const owner = resolveOwner(parse(ownerQ, req.query).owner);
    const v = await accountView(owner);
    res.json(historyView(owner, { totalUsd: Number(v.totalUsd), prices: Object.fromEntries(v.stocks.map((s) => [s.symbol, Number(s.priceUsd)])) }));
  });
  app.post("/api/faucet", async (req, res) => {
    res.json(await faucet(resolveOwner(parse(ownerQ, req.body).owner)));
  });
  app.post("/api/deposit", async (req, res) => {
    const b = parse(ownerQ.extend({ amount: money }), req.body);
    res.json(await deposit(resolveOwner(b.owner), b.amount));
  });
  app.post("/api/invest", async (req, res) => {
    const b = parse(ownerQ.extend({ amount: money, allocation: z.array(z.object({ symbol: sym, bps: z.number().int().min(0).max(10_000) })).max(8).optional() }), req.body);
    res.json(await invest(resolveOwner(b.owner), b.amount, b.allocation));
  });

  // ─── goals ───
  app.post("/api/goals/preview", async (req, res) => {
    const b = parse(ownerQ.extend({ text: z.string().min(1).max(500) }), req.body);
    const symbols = assets.map((a) => a.symbol);
    let i = parseIntent(b.text, symbols);
    if (i.action !== "CREATE_GOAL") i = (await llmIntent(b.text, symbols)) ?? i;
    if (i.action !== "CREATE_GOAL") fail(400, "BAD_REQUEST", 'I couldn\'t read a goal from that. Try "Save $500 for my laptop by December 15."');
    const { action, ...goal } = i as Extract<typeof i, { action: "CREATE_GOAL" }>;
    res.json({ goal });
  });
  app.post("/api/goals", async (req, res) => {
    const b = parse(ownerQ.extend({ goal: GoalSchema }), req.body);
    res.json(await createGoal(resolveOwner(b.owner), b.goal));
  });
  app.get("/api/goals", async (req, res) => {
    res.json(await listGoals(resolveOwner(parse(ownerQ, req.query).owner)));
  });
  app.post("/api/goals/:id/revoke", async (req, res) => {
    const id = parse(z.string().regex(/^\d{1,9}$/), req.params.id);
    res.json(await revokeGoal(resolveOwner(parse(ownerQ, req.body).owner), id));
  });

  // ─── chat ───
  app.post("/api/chat", async (req, res) => {
    const b = parse(ownerQ.extend({ message: z.string().min(1).max(500) }), req.body);
    res.json(await chat(resolveOwner(b.owner), b.message));
  });
  app.post("/api/chat/confirm", async (req, res) => {
    const b = parse(ownerQ.extend({ actionId: z.uuid() }), req.body);
    res.json(await confirm(resolveOwner(b.owner), b.actionId));
  });

  // ─── risk ───
  app.get("/api/risk", async (_req, res) => {
    res.json(await riskAll());
  });
  app.post("/api/risk/simulate", async (req, res) => {
    requireTestnet("Risk simulation");
    const b = parse(z.object({ symbol: sym, scenario: z.enum(["HALT", "STALE", "DEVIATION", "CORP_ACTION", "SEQUENCER_DOWN", "RESET"]) }), req.body);
    const a = stockBySymbol(b.symbol);
    if (!reporter) fail(503, "INTERNAL", "Reporter is not configured (REPORTER_PRIVATE_KEY / FEED_ADMIN_PRIVATE_KEY).");
    let txHashes: string[];
    try {
      txHashes = await reporter!.simulate(a.symbol, b.scenario as Scenario);
    } catch (e) {
      return fail(502, "CHAIN_ERROR", `Simulation failed: ${(e as Error).message}`);
    }
    const r = await riskOf(a);
    res.json({ txHashes, state: r.state, stateName: r.stateName });
  });
  app.get("/api/risk/borrow-check", async (req, res) => {
    const q = parse(ownerQ.extend({ symbol: sym.default("AAPL") }), req.query);
    res.json(await borrowCheck(q.symbol));
  });

  // ─── claims ───
  const claimId = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid claim id");
  app.get("/api/claims/:claimId", async (req, res) => {
    res.json(await getClaim(parse(claimId, req.params.claimId)));
  });
  app.post("/api/claims/:claimId/redeem", async (req, res) => {
    const b = parse(z.object({ recipient: addrStr, code: z.string().regex(/^\d{6}$/, "must be 6 digits") }), req.body);
    res.json(await redeemClaim(parse(claimId, req.params.claimId), b.recipient, b.code));
  });

  // ─── learning ───
  app.get("/api/learn", (req, res) => {
    const owner = resolveOwner(parse(ownerQ, req.query).owner);
    const s = streakOf(owner);
    res.json({ lessons: publicLessons(), todayLessonId: todayLessonId(owner), streak: { days: s.days, completedToday: s.completedToday }, rewardLabel: REWARD.label });
  });
  app.post("/api/learn/complete", async (req, res) => {
    const b = parse(ownerQ.extend({ lessonId: z.string().min(1).max(64), answerIndex: z.number().int().min(0).max(9) }), req.body);
    const owner = resolveOwner(b.owner);
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
  app.get("/api/activity", async (req, res) => {
    res.json(await activity(resolveOwner(parse(ownerQ, req.query).owner)));
  });

  // ─── ERC-8004 agent metadata (registration file) ───
  app.get("/api/agent/metadata", (_req, res) => {
    const base = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
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
    log.error("unhandled", { error: err });
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
  });
  return app;
}
