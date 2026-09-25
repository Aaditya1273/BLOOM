// Role separation for a Bloom deployment. Idempotent: every step checks onchain state first, so it can be re-run.
//
//   deployer         deployment only; ends with NO role on any contract
//   admin            owner / DEFAULT_ADMIN_ROLE everywhere (configuration + emergency controls). Multisig-ready:
//                    Ownable2Step transfers stay pending until the admin (e.g. a Safe) calls acceptOwnership().
//   reporter         BloomRiskEngine reporter allowlist only
//   claimAuthority   BloomClaims claim authorization only
//   faucet           (testnet) MockUSDG MINTER_ROLE only
//   mockOracle       (testnet) FEED_ADMIN_ROLE on mock feeds + sequencer, CORP_ACTION_ROLE on mock Stock Tokens
const { ethers } = require("hardhat");

const ZERO = ethers.ZeroHash;
const role = (name) => ethers.id(name);
const ROLES = { MINTER: role("MINTER_ROLE"), FEED_ADMIN: role("FEED_ADMIN_ROLE"), CORP_ACTION: role("CORP_ACTION_ROLE"), GUARDIAN: role("GUARDIAN_ROLE"), STRATEGIST: role("STRATEGIST_ROLE") };

async function send(log, label, txPromise) {
  const tx = await txPromise;
  await tx.wait();
  log(`  ✓ ${label}  ${tx.hash}`);
}

/**
 * @param dep   parsed deployments/<network>.json
 * @param s     { deployer: Signer, admin: string, adminSigner?: Signer, reporter: string, claimAuthority: string,
 *                faucet?: string, mockOracle?: string, log? }
 * @returns list of pending actions the admin must still perform (e.g. acceptOwnership from a multisig)
 */
async function handOverRoles(dep, s) {
  const log = s.log ?? (() => {});
  const d = s.deployer;
  const me = await d.getAddress();
  const pending = [];
  const C = dep.contracts;
  const at = (name, address) => ethers.getContractAt(name, address, d);

  // ── risk engine: reporter allowlist, then ownership ──
  const engine = await at("BloomRiskEngineEVM", C.BloomRiskEngine); // same ABI as the Stylus engine
  if (!(await engine.isReporter(s.reporter))) await send(log, `engine.setReporter(${s.reporter}, true)`, engine.setReporter(s.reporter, true));
  if (s.reporter.toLowerCase() !== me.toLowerCase() && (await engine.isReporter(me))) await send(log, "engine: remove deployer as reporter", engine.setReporter(me, false));

  // ── claims: claim authority before ownership moves ──
  const claims = await at("BloomClaims", C.BloomClaims);
  if ((await claims.claimAuthority()).toLowerCase() !== s.claimAuthority.toLowerCase()) {
    await send(log, `claims.setClaimAuthority(${s.claimAuthority})`, claims.setClaimAuthority(s.claimAuthority));
  }

  // ── Ownable2Step contracts ──
  for (const [name, address] of [["BloomRiskEngineEVM", C.BloomRiskEngine], ["BloomAssetRegistry", C.BloomAssetRegistry], ["StockRouter", C.StockRouter], ["BloomClaims", C.BloomClaims]]) {
    const c = await at(name, address);
    const owner = await c.owner();
    if (owner.toLowerCase() === s.admin.toLowerCase()) continue;
    if (owner.toLowerCase() !== me.toLowerCase()) throw new Error(`${name} owned by ${owner}, neither deployer nor admin`);
    if ((await c.pendingOwner()).toLowerCase() !== s.admin.toLowerCase()) await send(log, `${name}.transferOwnership(admin)`, c.transferOwnership(s.admin));
    if (s.adminSigner) await send(log, `${name}.acceptOwnership() by admin`, c.connect(s.adminSigner).acceptOwnership());
    else pending.push(`${name} (${address}).acceptOwnership() from the admin`);
  }

  // ── AccessControl: grant to the new holders first, renounce the deployer last ──
  async function moveRoles(name, address, grants) {
    const c = await at(name, address);
    for (const [r, to] of grants) if (to && !(await c.hasRole(r, to))) await send(log, `${name} grant ${roleName(r)} -> ${to}`, c.grantRole(r, to));
    const ordered = [...new Set(grants.map(([r]) => r))].sort((a, b) => (a === ZERO) - (b === ZERO)); // DEFAULT_ADMIN last
    for (const r of ordered) {
      const keep = grants.some(([gr, to]) => gr === r && to && to.toLowerCase() === me.toLowerCase()); // never drop a role the caller should hold
      if (!keep && (await c.hasRole(r, me))) await send(log, `${name} deployer renounces ${roleName(r)}`, c.renounceRole(r, me));
    }
  }
  const roleName = (r) => Object.entries({ DEFAULT_ADMIN: ZERO, ...ROLES }).find(([, v]) => v === r)?.[0] ?? r;

  await moveRoles("BloomVault", C.BloomVault, [[ROLES.GUARDIAN, s.admin], [ROLES.STRATEGIST, s.admin], [ZERO, s.admin]]);

  // ── testnet mocks ──
  if (C.MockUSDG) await moveRoles("MockUSDG", C.MockUSDG, [[ROLES.MINTER, s.faucet], [ZERO, s.admin]]);
  if (C.MockSequencerUptimeFeed) await moveRoles("MockSequencerUptimeFeed", C.MockSequencerUptimeFeed, [[ROLES.FEED_ADMIN, s.mockOracle], [ZERO, s.admin]]);
  for (const [sym, a] of Object.entries(dep.assets)) {
    if (a.kind !== "STOCK_TOKEN" || dep.mode !== "testnet-mocks") continue;
    await moveRoles(`MockStockToken`, a.token, [[ROLES.CORP_ACTION, s.mockOracle], [ROLES.MINTER, s.admin], [ZERO, s.admin]]);
    await moveRoles(`MockAggregatorV3`, a.feed, [[ROLES.FEED_ADMIN, s.mockOracle], [ZERO, s.admin]]);
    log(`  · ${sym} token + feed roles separated`);
  }
  for (const name of ["MockLendingAdapter", "MockSwapVenue"]) {
    if (!C[name]) continue;
    const c = await at(name, C[name]);
    if ((await c.owner()).toLowerCase() === me.toLowerCase()) await send(log, `${name}.transferOwnership(admin)`, c.transferOwnership(s.admin));
  }
  return pending;
}

/** Every (contract, role) the given address still holds. Used to prove the deployer holds nothing afterwards. */
async function rolesHeldBy(dep, who) {
  const C = dep.contracts;
  const held = [];
  const ro = (name, a) => ethers.getContractAt(name, a);
  for (const [name, a] of [["BloomRiskEngineEVM", C.BloomRiskEngine], ["BloomAssetRegistry", C.BloomAssetRegistry], ["StockRouter", C.StockRouter], ["BloomClaims", C.BloomClaims]]) {
    const c = await ro(name, a);
    if ((await c.owner()).toLowerCase() === who.toLowerCase()) held.push(`${name}.owner`);
  }
  const engine = await ro("BloomRiskEngineEVM", C.BloomRiskEngine);
  if (await engine.isReporter(who)) held.push("BloomRiskEngine.reporter");
  if ((await (await ro("BloomClaims", C.BloomClaims)).claimAuthority()).toLowerCase() === who.toLowerCase()) held.push("BloomClaims.claimAuthority");
  const ac = [["BloomVault", C.BloomVault, [ZERO, ROLES.GUARDIAN, ROLES.STRATEGIST]]];
  if (C.MockUSDG) ac.push(["MockUSDG", C.MockUSDG, [ZERO, ROLES.MINTER]]);
  if (C.MockSequencerUptimeFeed) ac.push(["MockSequencerUptimeFeed", C.MockSequencerUptimeFeed, [ZERO, ROLES.FEED_ADMIN]]);
  if (dep.mode === "testnet-mocks") {
    for (const [sym, a] of Object.entries(dep.assets)) {
      if (a.kind !== "STOCK_TOKEN") continue;
      ac.push([`MockStockToken(${sym})`, a.token, [ZERO, ROLES.MINTER, ROLES.CORP_ACTION]]);
      ac.push([`MockAggregatorV3(${sym})`, a.feed, [ZERO, ROLES.FEED_ADMIN]]);
    }
  }
  for (const [label, a, roles] of ac) {
    const c = await ethers.getContractAt("MockUSDG", a); // any AccessControl ABI works for hasRole
    for (const r of roles) if (await c.hasRole(r, who)) held.push(`${label}.${r === ZERO ? "DEFAULT_ADMIN" : Object.keys(ROLES).find((k) => ROLES[k] === r)}`);
  }
  for (const name of ["MockLendingAdapter", "MockSwapVenue"]) {
    if (C[name] && (await (await ro(name, C[name])).owner()).toLowerCase() === who.toLowerCase()) held.push(`${name}.owner`);
  }
  return held;
}

module.exports = { handOverRoles, rolesHeldBy, ROLES };
