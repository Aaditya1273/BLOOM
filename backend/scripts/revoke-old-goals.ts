// Audits every BloomPolicy goal and finds those bound to a session key other than the current AGENT key (e.g. the
// retired single deployer key). Read-only by default; with --apply it revokes stale ACTIVE goals whose account owner is
// a key this operator holds (DEMO_OWNER). Anything else is reported for its owner to revoke in the app.
//   BLOOM_DEPLOYMENT=robinhood-testnet node scripts/revoke-old-goals.ts [--apply]
import { Contract, Wallet, decodeBytes32String } from "ethers";
import { ABI, addr, agentKey, demoOwner, provider, sendTx } from "../src/ctx.ts";

const APPLY = process.argv.includes("--apply");
if (!agentKey) throw new Error("AGENT_PRIVATE_KEY is not configured");
const agent = agentKey;
const policy = new Contract(addr.BloomPolicy, ABI.policy, provider);
const ownerOf = new Map<string, string>();
const now = Math.floor(Date.now() / 1000);
const rows: any[] = [];

for (let id = 1; ; id++) {
  let g: any;
  try {
    [g] = await policy.getGoal(id);
  } catch {
    break;
  }
  if (g.account === "0x0000000000000000000000000000000000000000") break;
  if (!ownerOf.has(g.account)) ownerOf.set(g.account, await new Contract(g.account, ABI.account, provider).owner());
  const stale = g.agent !== "0x0000000000000000000000000000000000000000" && g.agent.toLowerCase() !== agent.address.toLowerCase();
  rows.push({ id, account: g.account, owner: ownerOf.get(g.account), agent: g.agent, name: decodeBytes32String(g.name), active: g.active, expired: Number(g.deadline) <= now, stale });
}

console.log(`${rows.length} goals; current AGENT ${agent.address}`);
for (const r of rows) console.log(`#${r.id} ${r.name.padEnd(8)} active=${r.active} stale=${r.stale} agent=${r.agent.slice(0, 10)} owner=${r.owner.slice(0, 10)}`);

const targets = rows.filter((r) => r.stale && r.active && !r.expired);
console.log(`\nactive goals on a non-current session key: ${targets.length}`);
for (const r of targets) {
  const mine = demoOwner && r.owner.toLowerCase() === demoOwner.address.toLowerCase() ? demoOwner : null;
  if (!mine) {
    console.log(`  #${r.id}: owner ${r.owner} must revoke it in the app (key not held here)`);
    continue;
  }
  if (!APPLY) {
    console.log(`  #${r.id}: would revoke as ${mine.address} (run with --apply)`);
    continue;
  }
  const rc = await sendTx(mine as Wallet, `revokeGoal #${r.id}`, () => (policy.connect(mine) as any).revokeGoal(r.id));
  console.log(`  #${r.id}: revoked, tx ${rc.hash}`);
}

// the retired key must have no live authority on any account
const live: string[] = [];
for (const r of rows.filter((x) => x.stale)) {
  const [g] = await policy.getGoal(r.id);
  if (g.active && Number(g.deadline) > now) live.push(`#${r.id}`);
}
console.log(live.length ? `\nSTILL ACTIVE on a stale key: ${live.join(", ")}` : "\nno active goal uses a stale session key");
