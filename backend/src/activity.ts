// Activity feed built from onchain events for one smart account.
import { zeroPadValue, type Log } from "ethers";
import { IFACE, USDG, addr, assetByToken, fmt, provider } from "./ctx.ts";
import { STATE_NAMES } from "./risk.ts";
import { accountAddress } from "./account.ts";
import { contacts } from "./agent.ts";

const LOOKBACK = Number(process.env.ACTIVITY_LOOKBACK_BLOCKS ?? 50_000);
const tsCache = new Map<number, number>();
const amt = (token: string, v: bigint) => { const a = assetByToken(token); return `${fmt(v, a?.decimals ?? 18, 6)} ${a?.symbol ?? "tokens"}`; };

type Q = { address: string; iface: keyof typeof IFACE; event: string; topics: (string | null)[] };

export async function activity(owner: string, limit = 50) {
  const account = await accountAddress(owner);
  const acc = zeroPadValue(account, 32);
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - LOOKBACK);
  const t = (i: keyof typeof IFACE, e: string) => IFACE[i].getEvent(e)!.topicHash;
  const queries: Q[] = [
    { address: addr.BloomVault, iface: "vault", event: "Deposit", topics: [t("vault", "Deposit"), null, acc] },
    { address: addr.BloomVault, iface: "vault", event: "BorrowBlocked", topics: [t("vault", "BorrowBlocked"), acc] },
    { address: addr.StockRouter, iface: "router", event: "Sent", topics: [t("router", "Sent"), acc] },
    { address: addr.StockRouter, iface: "router", event: "Swapped", topics: [t("router", "Swapped"), acc] },
    { address: addr.BloomClaims, iface: "claims", event: "ClaimCreated", topics: [t("claims", "ClaimCreated"), null, acc] },
    { address: addr.BloomPolicy, iface: "policy", event: "GoalCreated", topics: [t("policy", "GoalCreated"), null, acc] },
    { address: addr.BloomPolicy, iface: "policy", event: "GoalActivated", topics: [t("policy", "GoalActivated"), null, acc] },
    { address: account, iface: "account", event: "ActionExecuted", topics: [t("account", "ActionExecuted")] },
    { address: account, iface: "account", event: "ActionRejected", topics: [t("account", "ActionRejected")] },
    { address: addr.BloomRiskEngine, iface: "engine", event: "RiskStateChanged", topics: [t("engine", "RiskStateChanged")] },
  ];
  const results = await Promise.all(queries.map(async (q) => {
    const logs: Log[] = await provider.getLogs({ address: q.address, topics: q.topics, fromBlock, toBlock: latest }).catch(() => []);
    return logs.map((l) => ({ q, l, ev: IFACE[q.iface].parseLog(l)! }));
  }));
  // claims made by this account that were later claimed
  const created = results.flat().filter((x) => x.ev.name === "ClaimCreated").map((x) => x.ev.args.claimId as string);
  const claimed = created.length
    ? await provider.getLogs({ address: addr.BloomClaims, topics: [t("claims", "ClaimClaimed"), created], fromBlock, toBlock: latest }).catch(() => [])
    : [];
  const all = [...results.flat(), ...claimed.map((l) => ({ q: queries[4], l, ev: IFACE.claims.parseLog(l)! }))];

  const items = all.map(({ l, ev }) => {
    const a = ev.args;
    let title = ev.name, detail = "";
    let counterpartyName: string | undefined;
    switch (ev.name) {
      case "Deposit": title = "Saved in USDG savings"; detail = `${fmt(a.assets, USDG.decimals, 2)} USDG`; break;
      case "BorrowBlocked": title = "Borrow blocked"; detail = `${assetByToken(a.asset)?.symbol ?? a.asset} is ${STATE_NAMES[Number(a.riskState)]}`; break;
      case "Sent":
        counterpartyName = contacts().find((x) => x.address.toLowerCase() === String(a.to).toLowerCase())?.name;
        title = counterpartyName ? `Sent to ${counterpartyName}` : "Sent";
        detail = `${amt(a.token, a.amount)} to ${a.to}`;
        break;
      case "Swapped": title = "Bought / sold"; detail = `${amt(a.tokenIn, a.amountIn)} → ${amt(a.tokenOut, a.amountOut)}`; break;
      case "ClaimCreated": title = "Claim link created"; detail = amt(a.token, a.amount); break;
      case "ClaimClaimed": title = "Claim link redeemed"; detail = `${amt(a.token, a.amount)} by ${a.recipient}`; break;
      case "GoalCreated": title = "Goal created"; detail = `Goal #${a.goalId}`; break;
      case "GoalActivated": title = "Bloom Agent activated"; detail = `Goal #${a.goalId}, session key ${a.agent}`; break;
      case "ActionExecuted": title = "Agent action executed"; detail = `Goal #${a.goalId}`; break;
      case "ActionRejected": title = "Agent action rejected by policy"; detail = Buffer.from(a.reason.slice(2), "hex").toString().replace(/\0+$/, ""); break;
      case "RiskStateChanged": title = "Risk state changed"; detail = `${assetByToken(a.asset)?.symbol ?? a.asset}: ${STATE_NAMES[Number(a.previousState)]} → ${STATE_NAMES[Number(a.newState)]}`; break;
    }
    return { type: ev.name, title, detail, counterpartyName, txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.index, timestamp: 0 };
  });
  items.sort((x, y) => y.blockNumber - x.blockNumber || y.logIndex - x.logIndex);
  const top = items.slice(0, limit);
  for (const it of top) {
    if (!tsCache.has(it.blockNumber)) tsCache.set(it.blockNumber, (await provider.getBlock(it.blockNumber))!.timestamp);
    it.timestamp = tsCache.get(it.blockNumber)!;
  }
  return top.map(({ logIndex, ...r }) => r);
}
