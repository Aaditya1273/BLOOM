// Accounts, portfolio, owner-signed actions (demo owner, testnet only), faucet and goals.
import { Contract, encodeBytes32String, decodeBytes32String, getAddress, isAddress, parseUnits } from "ethers";
import {
  ABI, IFACE, USDG, addr, agentKey, assetBySymbol, assetByToken, c, demoOwner, erc20, fail, fmt, minter,
  provider, requireTestnet, sendTx, stocks, usd,
} from "./ctx.ts";
import { riskOf } from "./risk.ts";
import { streakOf } from "./learn.ts";
import { jsonStore } from "./store.ts";
import { recordSnapshot } from "./history.ts";

export function resolveOwner(owner?: string): string {
  if (owner) {
    if (!isAddress(owner)) fail(400, "BAD_REQUEST", "owner must be an address.");
    return getAddress(owner);
  }
  if (!demoOwner) return fail(400, "BAD_REQUEST", "owner is required (no demo owner on this network).");
  return demoOwner.address;
}

/** True when the backend holds the owner's key (the demo owner on testnet/local). */
export const isDemoOwner = (owner: string) => Boolean(demoOwner) && owner.toLowerCase() === demoOwner!.address.toLowerCase();

/**
 * Transactions a connected wallet must sign itself. The backend never holds user keys: for wallet owners it returns the
 * exact calls (to its own BloomAccount or to BloomPolicy) and the frontend submits them with the user's wallet.
 */
export type SignRequest = {
  sign: { chainId: number; label: string; txs: { to: string; data: string; value: "0" }[]; next?: "activate-goal" };
};
// ponytail: owner actions (backend-signed or wallet-signed) are testnet-only until mainnet is deployed and reviewed.
const signRequest = (label: string, txs: { to: string; data: string }[], next?: "activate-goal"): SignRequest => ({
  sign: { chainId: Number(chainIdOf()), label, txs: txs.map((t) => ({ ...t, value: "0" as const })), ...(next ? { next } : {}) },
});
const chainIdOf = () => provider._network?.chainId ?? 0n;

/** Owner calls wrapped into a single BloomAccount.execute / executeBatch transaction for the wallet to sign. */
function accountTx(account: string, calls: Call[]) {
  const data = calls.length === 1
    ? IFACE.account.encodeFunctionData("execute", [calls[0].target, 0, calls[0].data])
    : IFACE.account.encodeFunctionData("executeBatch", [calls]);
  return { to: account, data };
}

/** Owner actions need a key the backend holds: only the demo owner on testnet/local. */
function ownerSigner(owner: string) {
  requireTestnet("Owner-signed actions");
  if (!demoOwner || owner.toLowerCase() !== demoOwner.address.toLowerCase()) {
    fail(403, "BAD_REQUEST", "The backend can only sign for the demo owner. Connect a wallet to act for other owners.");
  }
  return demoOwner!;
}

export const accountAddress = async (owner: string): Promise<string> => c.factory.accountAddress(owner, 0);

export async function ensureAccount(owner: string): Promise<string> {
  const account = await accountAddress(owner);
  if ((await provider.getCode(account)) === "0x") {
    // BloomAccountFactory.createAccount is permissionless and binds the account to `owner`; a sponsor may pay the gas.
    const s = isDemoOwner(owner) ? ownerSigner(owner) : minter;
    if (!s) fail(400, "BAD_REQUEST", "Your Bloom wallet isn't set up yet and no sponsor key is configured on this network.");
    await sendTx(s!, "createAccount", () => (c.factory.connect(s!) as Contract).createAccount(owner, 0));
  }
  return account;
}

type Call = { target: string; value: bigint; data: string };
export async function ownerExec(owner: string, label: string, calls: Call[]) {
  const s = ownerSigner(owner);
  const account = await ensureAccount(owner);
  const acc = new Contract(account, ABI.account, s);
  return sendTx(s, label, () => (calls.length === 1 ? acc.execute(calls[0].target, 0, calls[0].data) : acc.executeBatch(calls)));
}

export const parseUsdg = (amount: string) => {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount) || /^0+(\.0+)?$/.test(amount)) fail(400, "BAD_REQUEST", "amount must be a positive decimal string with up to 6 decimals.");
  return parseUnits(amount, USDG.decimals);
};
const USD_SCALE = 10n ** BigInt(18 - USDG.decimals);

async function requireUsdg(account: string, amount: bigint) {
  const bal: bigint = await erc20(USDG.token).balanceOf(account);
  if (bal < amount) fail(400, "INSUFFICIENT_BALANCE", `Not enough USDG: you have ${fmt(bal, USDG.decimals)} and need ${fmt(amount, USDG.decimals)}.`);
}

// ─── portfolio ───
export async function accountView(owner: string) {
  const account = await accountAddress(owner);
  const deployed = (await provider.getCode(account)) !== "0x";
  const usdgBal: bigint = await erc20(USDG.token).balanceOf(account);
  const shares: bigint = await c.vault.balanceOf(account);
  const savingsAssets: bigint = shares ? await c.vault.convertToAssets(shares) : 0n;
  const apyBps = c.adapter ? Number(await c.adapter.aprBps()) : 0;
  const stockRows = await Promise.all(stocks.map(async (s) => {
    const [bal, r] = await Promise.all([erc20(s.token).balanceOf(account) as Promise<bigint>, riskOf(s)]);
    const value = r.price1e18 ? (bal * r.price1e18) / 10n ** BigInt(s.decimals) : 0n;
    return { symbol: s.symbol, balance: fmt(bal, s.decimals, 6), priceUsd: r.priceUsd, valueUsd: usd(value), riskState: r.stateName, state: r.state, value };
  }));
  const savingsUsd = savingsAssets * USD_SCALE;
  const total = usdgBal * USD_SCALE + savingsUsd + stockRows.reduce((a, r) => a + r.value, 0n);
  const prices = Object.fromEntries(stockRows.map((r) => [r.symbol, Number(r.priceUsd)]));
  recordSnapshot(owner, Number(usd(total)), prices);
  return {
    owner, account, deployed,
    usdg: { balance: fmt(usdgBal, USDG.decimals), valueUsd: usd(usdgBal * USD_SCALE) },
    savings: {
      shares: fmt(shares, Number(await c.vault.decimals())),
      valueUsd: usd(savingsUsd),
      apyBps,
      // estimate: one day of the adapter's APR on the current position
      earnedTodayUsd: usd((savingsUsd * BigInt(apyBps)) / 10_000n / 365n),
    },
    stocks: stockRows.map(({ value, ...r }) => r),
    totalUsd: usd(total),
    streak: streakOf(owner),
  };
}

// ─── faucet (TESTNET_DEMO_ONLY: authenticated wallet, own account only, fixed amount, 1/day/wallet, global daily cap) ───
const faucetStore = jsonStore<Record<string, number>>("faucet", {});
export const FAUCET_AMOUNT = "1000";
const FAUCET_DAILY_CAP = Number(process.env.FAUCET_DAILY_CAP ?? 100);
const DAY_MS = 86_400_000;
export async function faucet(owner: string) {
  requireTestnet("The faucet");
  if (!minter) fail(503, "INTERNAL", "No faucet key configured (FAUCET_PRIVATE_KEY).");
  const k = owner.toLowerCase();
  const now = Date.now();
  const all = faucetStore.get();
  if (now - (all[k] ?? 0) < DAY_MS) fail(429, "RATE_LIMITED", "Faucet already used today for this wallet. Try again tomorrow.");
  const today = Object.entries(all).filter(([w, t]) => !w.startsWith("_") && now - t < DAY_MS).length;
  if (today >= FAUCET_DAILY_CAP) fail(429, "RATE_LIMITED", "The testnet faucet reached today's limit. Try again tomorrow.");
  faucetStore.update((d) => { d[k] = now; }); // reserve before the tx so parallel requests can't double-mint
  try {
    const account = await ensureAccount(owner); // mints only into the caller's own Bloom account
    const usdg = new Contract(USDG.token, ABI.usdg, minter);
    const rc = await sendTx(minter!, "faucet mint", () => usdg.mint(account, parseUnits(FAUCET_AMOUNT, USDG.decimals)));
    return { txHash: rc.hash, amount: FAUCET_AMOUNT };
  } catch (e) {
    faucetStore.update((d) => { delete d[k]; }); // release the reservation if the mint failed
    throw e;
  }
}

// ─── deposit / invest (owner-signed) ───
const depositCalls = (account: string, amount: bigint): Call[] => [
  { target: USDG.token, value: 0n, data: IFACE.usdg.encodeFunctionData("approve", [addr.BloomVault, amount]) },
  { target: addr.BloomVault, value: 0n, data: IFACE.vault.encodeFunctionData("deposit", [amount, account]) },
];

export async function deposit(owner: string, amountStr: string): Promise<{ txHash: string; shares: string } | SignRequest> {
  requireTestnet("Deposits from this app");
  const amount = parseUsdg(amountStr);
  if (!isDemoOwner(owner)) {
    const account = await ensureAccount(owner);
    await requireUsdg(account, amount);
    return signRequest(`Save $${fmt(amount, USDG.decimals)} in USDG savings`, [accountTx(account, depositCalls(account, amount))]);
  }
  ownerSigner(owner); // refuse early (mainnet) before any chain reads
  const account = await ensureAccount(owner);
  await requireUsdg(account, amount);
  const before: bigint = await c.vault.balanceOf(account);
  const rc = await ownerExec(owner, "deposit", depositCalls(account, amount));
  const after: bigint = await c.vault.balanceOf(account);
  return { txHash: rc.hash, shares: fmt(after - before, Number(await c.vault.decimals())) };
}

export const DEFAULT_ALLOCATION = [{ symbol: "SAVINGS", bps: 7000 }, { symbol: "QQQ", bps: 3000 }];

export async function swapCalls(account: string, symbol: string, usdgAmount: bigint) {
  const s = assetBySymbol(symbol);
  if (!s || s.kind !== "STOCK_TOKEN") return fail(400, "UNSUPPORTED_ASSET", `${symbol} is not a supported Stock Token.`);
  if (!c.venue) return fail(400, "UNSUPPORTED_ASSET", "No approved swap venue on this network.");
  const r = await riskOf(s);
  if (r.state !== 0) fail(409, "RISK_BLOCKED", `${s.symbol} is in ${r.stateName} state: ${r.reason}`, { symbol: s.symbol, state: r.state, stateName: r.stateName });
  const quote: bigint = await c.venue.quote(USDG.token, s.token, usdgAmount);
  const minOut = (quote * 99n) / 100n; // 1% slippage bound
  const deadline = BigInt((await provider.getBlock("latest"))!.timestamp + 600);
  return [
    { target: USDG.token, value: 0n, data: IFACE.usdg.encodeFunctionData("approve", [addr.StockRouter, usdgAmount]) },
    { target: addr.StockRouter, value: 0n, data: IFACE.router.encodeFunctionData("swap", [addr.MockSwapVenue, USDG.token, s.token, usdgAmount, minOut, deadline]) },
  ];
}

export async function invest(owner: string, amountStr: string, allocation = DEFAULT_ALLOCATION): Promise<{ steps: { label: string; txHash: string; status: string }[] } | SignRequest> {
  requireTestnet("Investing from this app");
  const amount = parseUsdg(amountStr);
  if (allocation.reduce((a, x) => a + x.bps, 0) !== 10_000) fail(400, "BAD_REQUEST", "allocation bps must sum to 10000.");
  if (!isDemoOwner(owner)) {
    const account = await ensureAccount(owner);
    await requireUsdg(account, amount);
    const calls: Call[] = [];
    for (const part of allocation) {
      const amt = (amount * BigInt(part.bps)) / 10_000n;
      if (amt === 0n) continue;
      calls.push(...(part.symbol === "SAVINGS" || part.symbol === "USDG" ? depositCalls(account, amt) : await swapCalls(account, part.symbol, amt)));
    }
    return signRequest(`Invest $${fmt(amount, USDG.decimals)}`, [accountTx(account, calls)]);
  }
  ownerSigner(owner);
  const account = await ensureAccount(owner);
  await requireUsdg(account, amount);
  const steps: { label: string; txHash: string; status: string }[] = [];
  for (const part of allocation) {
    const amt = (amount * BigInt(part.bps)) / 10_000n;
    if (amt === 0n) continue;
    if (part.symbol === "SAVINGS" || part.symbol === "USDG") {
      const rc = await ownerExec(owner, "deposit", depositCalls(account, amt));
      steps.push({ label: `Save $${fmt(amt, USDG.decimals)} in USDG savings`, txHash: rc.hash, status: "confirmed" });
    } else {
      const rc = await ownerExec(owner, `buy ${part.symbol}`, await swapCalls(account, part.symbol, amt));
      steps.push({ label: `Buy $${fmt(amt, USDG.decimals)} of ${part.symbol}`, txHash: rc.hash, status: "confirmed" });
    }
  }
  return { steps };
}

// ─── goals ───
export type GoalInput = {
  name: string; targetAmount: string; asset: "USDG"; deadline: string; maxDailySpend: string; maxPerTx: string;
  maxStockAllocationBps: number; allowedAssets: string[];
};

function goalParams(g: GoalInput, deadline: number) {
  return {
    name: encodeBytes32String(g.name.slice(0, 31)),
    targetAmount: parseUnits(g.targetAmount, USDG.decimals),
    deadline,
    maxPerTxUsd: parseUnits(g.maxPerTx, 18),
    dailyCapUsd: parseUnits(g.maxDailySpend, 18),
    maxStockAllocationBps: g.maxStockAllocationBps,
    allowedAssets: g.allowedAssets.map((sym) => assetBySymbol(sym)?.token ?? fail(400, "UNSUPPORTED_ASSET", `${sym} is not supported.`)),
  };
}

export async function createGoal(owner: string, g: GoalInput) {
  requireTestnet("Creating goals from this app");
  if (!agentKey) fail(503, "INTERNAL", "No agent session key configured.");
  const deadline = Math.floor(Date.parse(g.deadline) / 1000);
  const now = (await provider.getBlock("latest"))!.timestamp;
  if (!(deadline > now)) fail(400, "BAD_REQUEST", "The goal deadline must be in the future.");
  if (!isDemoOwner(owner)) {
    // wallet owner: sign [revoke previous goal of this agent] + createGoal, then POST /api/goals/activate with the tx hash
    const account = await ensureAccount(owner);
    const txs: { to: string; data: string }[] = [];
    const prev: bigint = await c.policy.goalOfAgent(account, agentKey!.address);
    if (prev !== 0n) txs.push({ to: addr.BloomPolicy, data: IFACE.policy.encodeFunctionData("revokeGoal", [prev]) });
    txs.push({ to: addr.BloomPolicy, data: IFACE.policy.encodeFunctionData("createGoal", [account, goalParams(g, deadline)]) });
    return signRequest(`Create goal “${g.name}”`, txs, "activate-goal");
  }
  const s = ownerSigner(owner);
  const account = await ensureAccount(owner);
  const params = goalParams(g, deadline);
  const policy = c.policy.connect(s) as Contract;
  const txHashes: string[] = [];
  // one active goal per session key: revoke the previous one first
  const prev: bigint = await c.policy.goalOfAgent(account, agentKey!.address);
  if (prev !== 0n) txHashes.push((await sendTx(s, "revokeGoal", () => policy.revokeGoal(prev))).hash);
  const rc = await sendTx(s, "createGoal", () => policy.createGoal(account, params));
  txHashes.push(rc.hash);
  const ev = rc.logs.map((l: any) => { try { return IFACE.policy.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "GoalCreated");
  const goalId = BigInt(ev!.args.goalId);
  txHashes.push((await sendTx(s, "activateGoal", () => policy.activateGoal(goalId, agentKey!.address))).hash);
  return { goalId: goalId.toString(), txHashes, sessionKey: agentKey!.address, expiresAt: new Date(deadline * 1000).toISOString() };
}

export async function listGoals(owner: string) {
  const account = await accountAddress(owner);
  const count = Number(await c.policy.goalCount());
  const shares: bigint = await c.vault.balanceOf(account);
  const savedUsd = (shares ? ((await c.vault.convertToAssets(shares)) as bigint) : 0n) * USD_SCALE;
  const out = [];
  for (let id = 1; id <= count; id++) {
    const [g, assetsList] = await c.policy.getGoal(id);
    if (g.account.toLowerCase() !== account.toLowerCase()) continue;
    out.push({
      goalId: String(id),
      name: decodeBytes32String(g.name),
      targetAmount: fmt(BigInt(g.targetAmount), USDG.decimals),
      progressUsd: usd(savedUsd),
      deadline: new Date(Number(g.deadline) * 1000).toISOString(),
      maxDailySpend: usd(BigInt(g.dailyCapUsd)),
      maxPerTx: usd(BigInt(g.maxPerTxUsd)),
      spentTodayUsd: usd(BigInt(await c.policy.spentToday(id))),
      maxStockAllocationBps: Number(g.maxStockAllocationBps),
      allowedAssets: (assetsList as string[]).map((t) => assetByToken(t)?.symbol ?? t),
      active: Boolean(g.active),
      agent: g.agent,
    });
  }
  return out;
}

/** Wallet owners: after the createGoal tx is mined, return the activateGoal tx binding the agent session key. */
export async function prepareGoalActivation(owner: string, txHash: string) {
  requireTestnet("Activating goals from this app");
  if (!agentKey) fail(503, "INTERNAL", "No agent session key configured.");
  const rc = await provider.getTransactionReceipt(txHash);
  if (!rc || rc.status !== 1) fail(400, "BAD_REQUEST", "That goal transaction isn't confirmed yet.");
  const account = (await accountAddress(owner)).toLowerCase();
  const ev = rc!.logs
    .filter((l) => l.address.toLowerCase() === addr.BloomPolicy.toLowerCase())
    .map((l) => { try { return IFACE.policy.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "GoalCreated" && String(e.args.account).toLowerCase() === account);
  if (!ev) fail(400, "BAD_REQUEST", "No goal for this wallet was created in that transaction.");
  const goalId = BigInt(ev!.args.goalId);
  return {
    goalId: goalId.toString(),
    sessionKey: agentKey!.address,
    ...signRequest("Put your goal on autopilot", [{ to: addr.BloomPolicy, data: IFACE.policy.encodeFunctionData("activateGoal", [goalId, agentKey!.address]) }]),
  };
}

export async function revokeGoal(owner: string, goalId: string) {
  requireTestnet("Changing goals from this app");
  if (!/^\d+$/.test(goalId)) fail(400, "BAD_REQUEST", "goal id must be a number.");
  const [g] = await c.policy.getGoal(goalId);
  if (g.account.toLowerCase() !== (await accountAddress(owner)).toLowerCase()) fail(404, "NOT_FOUND", "Goal not found for this owner.");
  if (!isDemoOwner(owner)) {
    return signRequest("Turn off autopilot", [{ to: addr.BloomPolicy, data: IFACE.policy.encodeFunctionData("revokeGoal", [goalId]) }]);
  }
  const s = ownerSigner(owner);
  const rc = await sendTx(s, "revokeGoal", () => (c.policy.connect(s) as Contract).revokeGoal(goalId));
  return { txHash: rc.hash };
}

