// Key / role separation: after handOverRoles the deployer holds nothing and every role can only do its own job.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { systemFixture, usd, E18 } = require("./fixtures");
const { handOverRoles, rolesHeldBy, ROLES } = require("../scripts/lib/roles");
const { signReport } = require("../scripts/lib/system");

const f2vault = (out) => ({ hasRole: async (r, a) => (await ethers.getContractAt("BloomVault", out.contracts.BloomVault)).hasRole(r, a) });

async function separated() {
  const f = await systemFixture();
  const s = await ethers.getSigners();
  const r = { deployer: s[0], reporter: s[1], claimAuthority: s[2], admin: s[8], faucet: s[9], mockOracle: s[10], agent: s[11] };
  const pending = await handOverRoles(f.out, {
    deployer: r.deployer, adminSigner: r.admin, admin: r.admin.address, reporter: r.reporter.address,
    claimAuthority: r.claimAuthority.address, faucet: r.faucet.address, mockOracle: r.mockOracle.address,
  });
  return { ...f, r, pending };
}

describe("Role separation (deployer / admin / reporter / agent / claim authority / faucet / mock oracle)", function () {
  it("deployer ends with no role on any contract; admin owns configuration", async () => {
    const { out, r, pending, engine, vault, registry, router, claims } = await loadFixture(separated);
    expect(pending).to.deep.equal([]);
    expect(await rolesHeldBy(out, r.deployer.address)).to.deep.equal([]);
    for (const c of [engine, registry, router, claims]) expect(await c.owner()).to.equal(r.admin.address);
    expect(await vault.hasRole(ethers.ZeroHash, r.admin.address)).to.equal(true);
    expect(await claims.claimAuthority()).to.equal(r.claimAuthority.address);
    expect(await engine.isReporter(r.reporter.address)).to.equal(true);
  });

  it("handover is idempotent (safe to re-run)", async () => {
    const { out, r } = await loadFixture(separated);
    // deployer no longer owns anything: re-running must not throw for already-moved roles it can see
    const again = await handOverRoles(out, {
      deployer: r.admin, adminSigner: r.admin, admin: r.admin.address, reporter: r.reporter.address,
      claimAuthority: r.claimAuthority.address, faucet: r.faucet.address, mockOracle: r.mockOracle.address,
    });
    expect(again).to.deep.equal([]);
    // the admin must still hold every admin role after a re-run
    expect(await f2vault(out).hasRole(ethers.ZeroHash, r.admin.address)).to.equal(true);
    expect(await (await ethers.getContractAt("MockUSDG", out.contracts.MockUSDG)).hasRole(ethers.ZeroHash, r.admin.address)).to.equal(true);
    expect(await (await ethers.getContractAt("BloomRiskEngineEVM", out.contracts.BloomRiskEngine)).owner()).to.equal(r.admin.address);
  });

  it("each role signs correctly for its own job", async () => {
    const { r, usdg, stocks, engine, vault, chainId, report } = await loadFixture(separated);
    await expect(usdg.connect(r.faucet).mint(r.faucet.address, usd(1))).to.not.be.reverted; // faucet: mint
    await expect(stocks.AAPL.feed.connect(r.mockOracle).updateAnswer(21000000000n)).to.not.be.reverted; // oracle: feed
    await expect(stocks.AAPL.token.connect(r.mockOracle).setOraclePaused(false)).to.not.be.reverted; // oracle: corp action
    await expect(report("AAPL")).to.not.be.reverted; // reporter: signed market report
    await expect(vault.connect(r.admin).pause()).to.emit(vault, "EmergencyPaused"); // admin: emergency control
    await vault.connect(r.admin).unpause();
    await expect(engine.connect(r.admin).setMaxReportAge(3600)).to.not.be.reverted; // admin: configuration
    void chainId;
  });

  it("old deployer key is powerless", async () => {
    const { r, usdg, stocks, engine, vault, claims } = await loadFixture(separated);
    const d = r.deployer;
    await expect(usdg.connect(d).mint(d.address, 1)).to.be.revertedWithCustomError(usdg, "AccessControlUnauthorizedAccount");
    await expect(stocks.AAPL.feed.connect(d).updateAnswer(1)).to.be.revertedWithCustomError(stocks.AAPL.feed, "AccessControlUnauthorizedAccount");
    await expect(engine.connect(d).setReporter(d.address, true)).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    await expect(vault.connect(d).pause()).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    await expect(claims.connect(d).setClaimAuthority(d.address)).to.be.revertedWithCustomError(claims, "OwnableUnauthorizedAccount");
  });

  it("reporter cannot act as admin", async () => {
    const { r, engine, vault, stocks } = await loadFixture(separated);
    const e = engine.connect(r.reporter);
    await expect(e.setReporter(r.reporter.address, true)).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    await expect(e.setAssetConfig(stocks.AAPL.token.target, stocks.AAPL.feed.target, 1, 1, 1, true, true)).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    await expect(e.setSequencerConfig(ethers.ZeroAddress, 0, false)).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    await expect(vault.connect(r.reporter).pause()).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    await expect(stocks.AAPL.feed.connect(r.reporter).updateAnswer(1)).to.be.revertedWithCustomError(stocks.AAPL.feed, "AccessControlUnauthorizedAccount");
  });

  it("agent cannot act as admin", async () => {
    const { r, engine, vault, registry, router } = await loadFixture(separated);
    await expect(engine.connect(r.agent).setMaxReportAge(1)).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    await expect(vault.connect(r.agent).setRiskEngine(r.agent.address)).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    await expect(registry.connect(r.agent).setEnabled(ethers.ZeroAddress, false)).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    await expect(router.connect(r.agent).setVenue(r.agent.address, true)).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
  });

  it("claim authority cannot act as reporter (wrong signer rejected)", async () => {
    const { r, engine, stocks, chainId } = await loadFixture(separated);
    const now = BigInt(await time.latest());
    const rep = { asset: stocks.AAPL.token.target, halted: true, corporateActionPaused: false, uiMultiplier: E18,
      referencePrice: 212410000000000000000n, observedAt: now, nonce: 9_999n };
    const sig = await signReport(r.claimAuthority, engine.target, chainId, rep);
    await expect(engine.submitReport(rep.asset, true, false, E18, rep.referencePrice, now, 9_999n, sig))
      .to.be.revertedWithCustomError(engine, "UnauthorizedReporter").withArgs(r.claimAuthority.address);
  });

  it("multisig-ready: without the admin key, ownership waits for acceptOwnership by the admin", async () => {
    const f = await systemFixture();
    const s = await ethers.getSigners();
    const safe = s[12];
    const pending = await handOverRoles(f.out, {
      deployer: s[0], admin: safe.address, reporter: s[1].address, claimAuthority: s[2].address, faucet: s[9].address, mockOracle: s[10].address,
    });
    expect(pending.length).to.equal(4);
    expect(await f.engine.pendingOwner()).to.equal(safe.address);
    await f.engine.connect(safe).acceptOwnership();
    expect(await f.engine.owner()).to.equal(safe.address);
    expect(await f.vault.hasRole(ROLES.GUARDIAN, safe.address)).to.equal(true);
  });
});
