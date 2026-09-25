// Bloom Agent: message -> typed intent -> validator -> plan (typed steps built here, never by the AI)
// -> BloomPolicy.preview per step -> user confirms -> session key executes each step via BloomAccount.executeByAgent.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, decodeBytes32String, getAddress, id as keccakId, parseUnits } from "ethers";
import {
  ABI, IFACE, NETWORK_NAME, USDG, addr, agentKey, assetBySymbol, assets, c, erc20, fail, fmt, provider, sendTx, usd, ROOT,
} from "./ctx.ts";
import { accountAddress, accountView, createGoal, type GoalInput } from "./account.ts";
import { riskAll, riskOf, STATE_ADJ, STATE_REASON, type StateName } from "./risk.ts";
import { forgetClaim, newClaimSecret } from "./claims.ts";
import { llmIntent, parseIntent, type Intent } from "./intent.ts";

type Step = { label: string; target: string; data: string; symbol: string; buy?: boolean };
type Pending = {
  owner: string; kind: "send" | "goal" | "invest" | "deposit"; steps: Step[]; createdAt: number;
  goal?: GoalInput; claim?: { claimId: string; code: string; expiresAt: number }; summary: string;
};
// ponytail: in-memory pending actions (10 min TTL); lost on restart, which just means "ask again".
const pending = new Map<string, Pending>();
const TTL_MS = 10 * 60_000;
const CLAIM_TTL_SEC = 7 * 86_400;

type Contact = { name: string; address: string };
export function contacts(): Contact[] {
  try {
    return JSON.parse(readFileSync(join(ROOT, "backend", "data", "contacts.json"), "utf8") /* seed config, not runtime data */).contacts;
  } catch {
    return [];
  }
}

const symbols = () => assets.map((a) => a.symbol);

// ─── plain English for policy rejections ───
async function goalLimits(account: string) {
  if (!agentKey) return null;
  const gid: bigint = await c.policy.goalOfAgent(account, agentKey.address);
  if (gid === 0n) return null;
  const [g] = await c.policy.getGoal(gid);
  return { perTx: usd(BigInt(g.maxPerTxUsd)), daily: usd(BigInt(g.dailyCapUsd)) };
}

export async function explainReason(reason: string, symbol: string, account: string): Promise<{ message: string; stateName?: StateName }> {
  const lim = await goalLimits(account);
  switch (reason) {
    case "ASSET_RISK_BLOCKED": {
      const a = assetBySymbol(symbol);
      const stateName = a && a.kind === "STOCK_TOKEN" ? (await riskOf(a)).stateName : undefined;
      const adj = stateName && stateName !== "NORMAL" ? STATE_ADJ[stateName] : "blocked";
      return { message: `I didn't execute this action because ${symbol} entered a ${adj}-risk state.`, stateName };
    }
    case "NO_ACTIVE_POLICY": return { message: "The Bloom Agent has no active goal on this account yet. Create a goal first so the agent has rules to act under." };
    case "POLICY_EXPIRED": return { message: "Your goal's agent permission has expired. Create or renew a goal to let the agent act again." };
    case "POLICY_NOT_YET_VALID": return { message: "Your goal's agent permission isn't active yet." };
    case "PER_TX_CAP_EXCEEDED": return { message: `I didn't execute this because it is above your goal's ${lim ? `$${lim.perTx} ` : ""}per-transaction limit.` };
    case "DAILY_CAP_EXCEEDED": return { message: `I didn't execute this because it would exceed your goal's ${lim ? `$${lim.daily} ` : ""}daily limit.` };
    case "ASSET_NOT_ALLOWED": return { message: `I didn't execute this because ${symbol} isn't in your goal's allowed assets.` };
    case "TARGET_NOT_ALLOWED": case "SELECTOR_NOT_ALLOWED": case "SPENDER_NOT_ALLOWED": case "RECEIVER_NOT_ALLOWED":
      return { message: "I didn't execute this because it's outside what your goal lets the agent do." };
    default: return { message: `I didn't execute this action (${reason}).` };
  }
}

async function previewSteps(account: string, steps: Step[]) {
  if (!agentKey) return { ok: false, reason: "NO_AGENT_KEY", message: "No agent session key is configured." };
  for (const s of steps) {
    const [ok, reasonRaw] = await c.policy.preview(account, agentKey.address, s.target, 0, s.data);
    if (!ok) {
      const reason = decodeBytes32String(reasonRaw);
      const e = await explainReason(reason, s.symbol, account);
      return { ok: false, reason, message: e.message, stateName: e.stateName };
    }
  }
  return { ok: true, message: "Within your goal's rules." };
}

async function riskCheck(symbol: string) {
  const a = assetBySymbol(symbol);
  if (!a || a.kind !== "STOCK_TOKEN") return { ok: true, state: "NORMAL", message: `${symbol} is a stable asset.` };
  const r = await riskOf(a);
  return { ok: r.state === 0, state: r.stateName, stateId: r.state, message: r.state === 0 ? `${symbol} is trading normally.` : `${symbol}: ${STATE_REASON[r.stateName]}` };
}

const enc = {
  approve: (spender: string, amount: bigint) => IFACE.usdg.encodeFunctionData("approve", [spender, amount]),
};

/** Token amount (base units) for `usd18` dollars at `price1e18`. */
const tokenFor = (usd18: bigint, price: bigint, decimals: number) => (usd18 * 10n ** BigInt(decimals)) / price;

async function planSend(owner: string, account: string, i: Extract<Intent, { action: "SEND" }>, actionId: string) {
  const a = assetBySymbol(i.symbol) ?? fail(400, "UNSUPPORTED_ASSET", `${i.symbol} is not supported.`);
  const contact = contacts().find((x) => x.name.toLowerCase() === i.recipientName.toLowerCase());
  const usd18 = parseUnits(i.amountUsd, 18);
  const steps: Step[] = [];
  let amount: bigint;
  if (a.kind === "STABLE") {
    amount = parseUnits(i.amountUsd, a.decimals);
  } else {
    const r = await riskOf(a);
    const [, answer] = await new Contract(a.feed!, ABI.feed, provider).latestRoundData();
    const price = r.price1e18 || BigInt(answer) * 10n ** 10n; // display-only fallback; policy re-prices onchain
    amount = tokenFor(usd18, price, a.decimals);
    const bal: bigint = await erc20(a.token).balanceOf(account);
    if (bal < amount && r.state === 0 && c.venue) {
      // buy the Stock Token first with a 2% USDG buffer (dust stays in the account); minOut = exact amount to send
      const usdgIn = (parseUnits(i.amountUsd, USDG.decimals) * 102n) / 100n;
      const deadline = BigInt((await provider.getBlock("latest"))!.timestamp + 900);
      steps.push({ label: `Approve $${fmt(usdgIn, USDG.decimals, 2)} USDG for the swap`, target: USDG.token, data: enc.approve(addr.StockRouter, usdgIn), symbol: a.symbol, buy: true });
      steps.push({ label: `Buy ${fmt(amount, a.decimals, 6)} ${a.symbol}`, target: addr.StockRouter, symbol: a.symbol, buy: true,
        data: IFACE.router.encodeFunctionData("swap", [addr.MockSwapVenue, USDG.token, a.token, usdgIn, amount, deadline]) });
    }
  }
  const pretty = `${fmt(amount, a.decimals, a.kind === "STABLE" ? 2 : 6)} ${a.symbol}`;
  let claim: Pending["claim"];
  if (contact) {
    steps.push({ label: `Approve ${pretty} for Bloom's router`, target: a.token, data: enc.approve(addr.StockRouter, amount), symbol: a.symbol });
    steps.push({ label: `Send ${pretty} to ${contact.name}`, target: addr.StockRouter, symbol: a.symbol,
      data: IFACE.router.encodeFunctionData("send", [a.token, getAddress(contact.address), amount, keccakId(`chat:${actionId}`)]) });
  } else {
    const { claimId, code } = newClaimSecret();
    const expiresAt = (await provider.getBlock("latest"))!.timestamp + CLAIM_TTL_SEC;
    claim = { claimId, code, expiresAt };
    steps.push({ label: `Approve ${pretty} for a claim link`, target: a.token, data: enc.approve(addr.BloomClaims, amount), symbol: a.symbol });
    steps.push({ label: `Lock ${pretty} in a claim link for ${i.recipientName}`, target: addr.BloomClaims, symbol: a.symbol,
      data: IFACE.claims.encodeFunctionData("createClaim", [claimId, a.token, amount, "0x0000000000000000000000000000000000000000", expiresAt]) });
  }
  const [policyCheck, rc] = await Promise.all([previewSteps(account, steps), riskCheck(a.symbol)]);
  const card = {
    kind: "send", asset: a.symbol, amount: fmt(amount, a.decimals, a.kind === "STABLE" ? 2 : 6), amountUsd: i.amountUsd,
    recipient: { name: contact?.name ?? i.recipientName, address: contact?.address, viaClaimLink: !contact },
    network: NETWORK_NAME, policyCheck, riskCheck: rc, steps: steps.map((s) => s.label),
  };
  const who = contact ? contact.name : `${i.recipientName} (via a claim link, since they're not in your contacts)`;
  const summary = `send $${i.amountUsd} of ${a.symbol} to ${who}`;
  return { card, steps, claim, summary, ok: policyCheck.ok && rc.ok };
}

async function planDeposit(account: string, usdAmount: string) {
  const amount = parseUnits(usdAmount, USDG.decimals);
  return [
    { label: `Approve $${usdAmount} USDG for the savings vault`, target: USDG.token, data: enc.approve(addr.BloomVault, amount), symbol: "USDG" },
    { label: `Save $${usdAmount} in USDG savings`, target: addr.BloomVault, data: IFACE.vault.encodeFunctionData("deposit", [amount, account]), symbol: "USDG" },
  ];
}

async function planInvest(account: string, usdAmount: string) {
  const total = parseUnits(usdAmount, USDG.decimals);
  const save = (total * 70n) / 100n;
  const buy = total - save;
  const steps = await planDeposit(account, fmt(save, USDG.decimals));
  const qqq = assetBySymbol("QQQ");
  if (qqq && c.venue && buy > 0n) {
    const quote: bigint = await c.venue.quote(USDG.token, qqq.token, buy).catch(() => 0n);
    const deadline = BigInt((await provider.getBlock("latest"))!.timestamp + 900);
    steps.push({ label: `Approve $${fmt(buy, USDG.decimals)} USDG for the swap`, target: USDG.token, data: enc.approve(addr.StockRouter, buy), symbol: "USDG" });
    steps.push({ label: `Buy $${fmt(buy, USDG.decimals)} of QQQ`, target: addr.StockRouter, symbol: "QQQ",
      data: IFACE.router.encodeFunctionData("swap", [addr.MockSwapVenue, USDG.token, qqq.token, buy, quote ? (quote * 99n) / 100n : 1n, deadline]) });
  }
  return steps;
}

async function explainBorrow(account: string, symbol?: string) {
  const risk = await riskAll();
  const list = symbol ? risk.assets.filter((a) => a.symbol === symbol) : risk.assets;
  const blocked = list.filter((a) => !a.borrowingAllowed);
  const health = await c.vault.accountHealth(account);
  let reply: string;
  if (!risk.sequencer.up) reply = "Borrowing is paused for every asset because the network sequencer is down or in its grace period.";
  else if (blocked.length === 0) reply = `Borrowing is enabled right now: ${list.map((a) => a.symbol).join(", ")} ${list.length === 1 ? "is" : "are"} NORMAL, with a max loan-to-value of ${list[0].maxLtvBps / 100}%.`;
  else reply = `Borrowing is paused for ${blocked.map((a) => `${a.symbol} (${STATE_REASON[a.stateName as StateName]})`).join("; ")}. Bloom sets max LTV to 0 and pauses liquidations while an asset is outside its risk policy, so nobody is liquidated at an untrusted price.`;
  if (!health.allowed) reply += " Your own borrowing is currently blocked because one of your collateral assets is outside NORMAL.";
  const first = blocked[0] ?? list[0];
  return { reply, card: { kind: "risk", asset: first?.symbol, riskCheck: { ok: blocked.length === 0 && risk.sequencer.up, state: first?.stateName, message: first?.reason } } };
}

async function explainRisk(account: string, symbol?: string) {
  const risk = await riskAll();
  const a = risk.assets.find((x) => x.symbol === (symbol ?? "QQQ")) ?? risk.assets[0];
  const token = assetBySymbol(a.symbol)!;
  const [held, posted] = await Promise.all([erc20(token.token).balanceOf(account), c.vault.collateralOf(account, token.token)]) as [bigint, bigint];
  const parts = [
    `${a.symbol} is ${a.stateName === "NORMAL" ? "in a NORMAL risk state" : `in ${a.stateName} state: ${STATE_REASON[a.stateName as StateName]}`}.`,
    `Oracle price $${a.priceUsd}${a.oracleAgeSec !== null ? `, updated ${a.oracleAgeSec}s ago` : ""}${a.deviationBps !== null ? `, ${(a.deviationBps / 100).toFixed(2)}% from the signed reference price` : ""}.`,
    a.borrowingAllowed ? `You could borrow up to ${a.maxLtvBps / 100}% of its value.` : "Borrowing against it is paused (max LTV 0) and liquidations are paused too.",
    posted > 0n ? `You have ${fmt(posted, 18, 6)} ${a.symbol} posted as collateral.` : held > 0n ? `You hold ${fmt(held, 18, 6)} ${a.symbol} but haven't posted it as collateral.` : `You don't hold any ${a.symbol} right now.`,
    "Robinhood Stock Tokens give economic exposure to the underlying price; they can fall in value.",
  ];
  return { reply: parts.join(" "), card: { kind: "risk", asset: a.symbol, riskCheck: { ok: a.state === 0, state: a.stateName, message: a.reason } } };
}

export async function chat(owner: string, message: string) {
  let intent = parseIntent(message, symbols());
  if (intent.action === "UNKNOWN") intent = (await llmIntent(message, symbols())) ?? intent;
  const account = await accountAddress(owner);
  const actionId = randomUUID();
  const remember = (p: Omit<Pending, "createdAt" | "owner">) => pending.set(actionId, { ...p, owner, createdAt: Date.now() });

  switch (intent.action) {
    case "SEND": {
      const p = await planSend(owner, account, intent, actionId);
      if (!p.ok) {
        if (p.claim) forgetClaim(p.claim.claimId);
        const why = !p.card.policyCheck.ok ? p.card.policyCheck.message : p.card.riskCheck.message;
        return { reply: `I can't ${p.summary} right now. ${why}`, intent, card: p.card };
      }
      remember({ kind: "send", steps: p.steps, claim: p.claim, summary: p.summary });
      return { reply: `Ready to ${p.summary}.`, intent, card: p.card, actionId };
    }
    case "CREATE_GOAL": {
      const { action, ...goal } = intent;
      remember({ kind: "goal", steps: [], goal, summary: `create the ${goal.name} goal` });
      return {
        reply: `Ready to create "${goal.name}": save $${goal.targetAmount} USDG by ${goal.deadline.slice(0, 10)}. The agent may spend at most $${goal.maxDailySpend}/day, keep Stock Tokens under ${goal.maxStockAllocationBps / 100}%, and only use ${goal.allowedAssets.join(", ")}.`,
        intent,
        card: { kind: "goal", asset: "USDG", amount: goal.targetAmount, amountUsd: goal.targetAmount, goal, network: NETWORK_NAME,
          policyCheck: { ok: true, message: "You sign this yourself; it sets the rules the agent must follow." }, riskCheck: { ok: true, state: "NORMAL", message: "USDG is a stable asset." } },
        actionId,
      };
    }
    case "INVEST":
    case "DEPOSIT": {
      const steps = intent.action === "INVEST" ? await planInvest(account, intent.amountUsd) : await planDeposit(account, intent.amountUsd);
      const [policyCheck, rc] = await Promise.all([previewSteps(account, steps), intent.action === "INVEST" ? riskCheck("QQQ") : riskCheck("USDG")]);
      const kind = intent.action === "INVEST" ? "invest" : "deposit";
      const summary = intent.action === "INVEST" ? `move $${intent.amountUsd} into your conservative portfolio (70% USDG savings, 30% QQQ)` : `save $${intent.amountUsd} in USDG savings`;
      const card = { kind, asset: kind === "invest" ? "QQQ" : "USDG", amount: intent.amountUsd, amountUsd: intent.amountUsd, network: NETWORK_NAME, policyCheck, riskCheck: rc, steps: steps.map((s) => s.label) };
      if (!policyCheck.ok || !rc.ok) {
        return { reply: `I can't ${summary} through the agent. ${!rc.ok ? rc.message : policyCheck.message} You can still do it yourself from the ${kind === "invest" ? "Invest" : "Save"} screen.`, intent, card };
      }
      remember({ kind, steps, summary });
      return { reply: `Ready to ${summary}.`, intent, card, actionId };
    }
    case "EXPLAIN_BORROW": return { intent, ...(await explainBorrow(account, intent.symbol)) };
    case "EXPLAIN_RISK": return { intent, ...(await explainRisk(account, intent.symbol)) };
    case "BALANCE": {
      const v = await accountView(owner);
      const stocksHeld = v.stocks.filter((s) => Number(s.balance) > 0).map((s) => `${s.balance} ${s.symbol} ($${s.valueUsd})`);
      return { intent, reply: `You have $${v.totalUsd} in total: $${v.usdg.valueUsd} USDG, $${v.savings.valueUsd} in savings${stocksHeld.length ? `, and ${stocksHeld.join(", ")}` : ""}.` };
    }
    default:
      return { intent, reply: 'I can help you save, send, invest and understand risk. Try "Save $500 for my laptop by December 15.", "Send Sarah $5 of QQQ.", or "Show me why borrowing is disabled."' };
  }
}

export async function confirm(owner: string, actionId: string) {
  const p = pending.get(actionId);
  if (!p || p.owner.toLowerCase() !== owner.toLowerCase() || Date.now() - p.createdAt > TTL_MS) {
    return fail(404, "NOT_FOUND", "That action has expired or doesn't exist. Ask me again.");
  }
  pending.delete(actionId); // single use
  if (p.kind === "goal") {
    const r = await createGoal(owner, p.goal!);
    // wallet owners sign the goal themselves: hand the prepared transactions back to the frontend
    if ("sign" in r) return { status: "sign_required", ...r, message: "Confirm the goal in your wallet to put it on autopilot." };
    return { status: "executed", txHashes: r.txHashes, message: `Goal created. The agent can act for you until ${r.expiresAt.slice(0, 10)}, within your rules.`, goalId: r.goalId };
  }
  const agent = agentKey ?? fail(503, "INTERNAL", "No agent session key configured.");
  const account = await accountAddress(owner);
  const acc = new Contract(account, ABI.account, agent);
  const txHashes: string[] = [];
  // Re-plan at confirm time: if a Stock Token left NORMAL since the preview, its buy steps can't succeed, so skip
  // them and let the policy reject the action itself onchain (ActionRejected), instead of a venue revert.
  const notNormal = new Set<string>();
  for (const sym of new Set(p.steps.filter((s) => s.buy).map((s) => s.symbol))) {
    const a = assetBySymbol(sym);
    if (a?.kind === "STOCK_TOKEN" && (await riskOf(a)).state !== 0) notNormal.add(sym);
  }
  for (const s of p.steps.filter((x) => !(x.buy && notNormal.has(x.symbol)))) {
    let rc;
    try {
      rc = await sendTx(agent, `agent: ${s.label}`, () => acc.executeByAgent(agent.address, s.target, s.data));
    } catch (e) {
      if (p.claim) forgetClaim(p.claim.claimId);
      const reason = (e as any)?.details?.reason ?? (e as Error).message;
      return { status: "reverted", txHashes, reason, message: `The transaction reverted onchain at "${s.label}" (${reason}). Nothing after that step ran.` };
    }
    txHashes.push(rc.hash);
    const rejected = rc.logs.filter((l: any) => l.address.toLowerCase() === account.toLowerCase())
      .map((l: any) => { try { return IFACE.account.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "ActionRejected");
    if (rejected) {
      if (p.claim) forgetClaim(p.claim.claimId);
      const policyReason = decodeBytes32String(rejected.args.reason);
      const e = await explainReason(policyReason, s.symbol, account);
      return { status: "rejected", txHashes, reason: e.stateName ?? policyReason, policyReason, stateName: e.stateName, message: e.message };
    }
  }
  const out: Record<string, unknown> = { status: "executed", txHashes, message: `Done: ${p.summary}.` };
  if (p.claim) {
    out.claim = { claimId: p.claim.claimId, url: `/claim/${p.claim.claimId}`, code: p.claim.code, expiresAt: new Date(p.claim.expiresAt * 1000).toISOString() };
    out.message = `Done: ${p.summary}. Share the link and, separately, the 6-digit code. The code is shown only once.`;
  }
  return out;
}
