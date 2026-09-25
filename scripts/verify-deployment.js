// Read-only integrity check of a deployment against its manifest (no transactions, no keys needed).
//   npx hardhat run scripts/verify-deployment.js --network robinhoodTestnet
// Checks: chain id, code at every manifest address, which roles each configured role address holds, that the
// retired deployer holds none, and which session key the active goals use.
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { rolesHeldBy } = require("./lib/roles");

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "robinhood-testnet.json"), "utf8"));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  let bad = 0;
  const check = (ok, label) => { console.log(`${ok ? "✓" : "✗"} ${label}`); if (!ok) bad++; };

  check(chainId === 46630 && dep.chainId === 46630, `chain ${chainId} (manifest ${dep.chainId})`);
  check(dep.contracts.BloomRiskEngine.toLowerCase() === "0xc464c03bfe7efa388457b8b392454b99fa18b124", `risk engine ${dep.contracts.BloomRiskEngine} (${dep.riskEngineImpl})`);

  const addrs = { ...dep.contracts };
  for (const [sym, a] of Object.entries(dep.assets)) { addrs[`${sym} token`] = a.token; if (a.feed) addrs[`${sym} feed`] = a.feed; }
  for (const [name, a] of Object.entries(addrs)) check((await ethers.provider.getCode(a)).length > 2, `code at ${name} ${a}`);

  const factory = await ethers.getContractAt("BloomAccountFactory", dep.contracts.BloomAccountFactory);
  const impl = await factory.accountImplementation().catch(() => null);
  if (impl) check((await ethers.provider.getCode(impl)).length > 2, `BloomAccount implementation ${impl}`);

  console.log("\nroles held onchain:");
  const r = dep.roles;
  for (const [role, a] of Object.entries(r)) {
    const who = a.split(" ")[0];
    const held = await rolesHeldBy(dep, who);
    console.log(`  ${role.padEnd(15)} ${who}: ${held.length ? held.join(", ") : "(none)"}`);
    if (role === "deployer") check(held.length === 0, "retired deployer holds no role");
  }
  const engine = await ethers.getContractAt("BloomRiskEngineEVM", dep.contracts.BloomRiskEngine);
  check((await engine.owner()) === ethers.getAddress(r.admin), "risk engine owner = ADMIN");
  check(await engine.isReporter(r.reporter), "REPORTER is an allowlisted reporter");

  console.log("\ngoals (session key):");
  const policy = await ethers.getContractAt("BloomPolicy", dep.contracts.BloomPolicy);
  const now = Math.floor(Date.now() / 1000);
  for (let id = 1; ; id++) {
    let g;
    try { [g] = await policy.getGoal(id); } catch { break; }
    if (g.account === ethers.ZeroAddress) break;
    if (!g.active || Number(g.deadline) <= now) continue;
    const current = g.agent === ethers.getAddress(r.agent);
    console.log(`  #${id} active, agent ${g.agent}${current ? " (current AGENT)" : " (NOT current: retired key)"}, expires ${new Date(Number(g.deadline) * 1000).toISOString()}`);
  }
  console.log(bad ? `\n${bad} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
  if (bad) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
