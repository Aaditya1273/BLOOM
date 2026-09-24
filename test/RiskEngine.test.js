const { expect } = require("chai");
const { ethers } = require("hardhat");
const { load, E18, S, time } = require("./fixtures");
const { signReport } = require("../scripts/lib/system");
const vectors = require("./vectors/risk-vectors.json");

describe("Risk engine — shared specification vectors (RiskLib)", function () {
  let harness;
  before(async () => {
    harness = await (await ethers.getContractFactory("RiskLibHarness")).deploy();
  });

  for (const v of vectors.cases) {
    it(v.name, async () => {
      const i = v.input;
      const [state, price] = await harness.classify({
        now_: i.now, configured: i.configured, isStockToken: i.isStockToken, heartbeat: i.heartbeat, deviationBps: i.deviationBps,
        sequencerRequired: i.sequencerRequired, sequencerOk: i.sequencerOk, sequencerAnswer: i.sequencerAnswer,
        sequencerStartedAt: i.sequencerStartedAt, sequencerGrace: i.sequencerGrace,
        feedOk: i.feedOk, roundId: i.roundId, answer: i.answer, updatedAt: i.updatedAt, answeredInRound: i.answeredInRound,
        feedDecimals: i.feedDecimals, hasReport: i.hasReport, reportObservedAt: i.reportObservedAt, maxReportAge: i.maxReportAge,
        halted: i.halted, reportCorpActionPaused: i.reportCorpActionPaused, reportMultiplier: i.reportMultiplier,
        referencePrice: i.referencePrice, tokenOk: i.tokenOk, tokenOraclePaused: i.tokenOraclePaused, tokenMultiplier: i.tokenMultiplier,
      });
      expect(Number(state)).to.equal(v.expected.state);
      expect(price.toString()).to.equal(v.expected.price);
    });
  }

  it("EIP-712 vector: digest and signer match the Stylus test vector", async () => {
    const e = vectors.eip712;
    const recovered = ethers.verifyTypedData(e.domain, { MarketReport: [
      { name: "asset", type: "address" }, { name: "halted", type: "bool" }, { name: "corporateActionPaused", type: "bool" },
      { name: "uiMultiplier", type: "uint256" }, { name: "referencePrice", type: "uint256" },
      { name: "observedAt", type: "uint64" }, { name: "nonce", type: "uint64" }] }, e.message, e.signature);
    expect(recovered).to.equal(e.signer);
  });
});

describe("BloomRiskEngineEVM — onchain behaviour", function () {
  it("starts NORMAL with 60% max LTV and borrowing enabled", async () => {
    const { engine, stocks } = await load();
    const r = await engine.getRisk(stocks.AAPL.token.target);
    expect(r.state).to.equal(S.NORMAL);
    expect(r.maxLtvBps).to.equal(6000);
    expect(r.borrowingAllowed).to.equal(true);
    expect(r.liquidationAllowed).to.equal(true);
    expect(r.price).to.equal(ethers.parseUnits("212.41", 18));
  });

  it("HALT report -> HALTED (LTV 0, borrowing + liquidation disabled) -> recovery -> NORMAL, with events", async () => {
    const { engine, stocks, report } = await load();
    const aapl = stocks.AAPL.token.target;
    await expect(report("AAPL", { halted: true }))
      .to.emit(engine, "HaltUpdated")
      .and.to.emit(engine, "RiskStateChanged").withArgs(aapl, S.NORMAL, S.HALTED);
    const r = await engine.getRisk(aapl);
    expect([r.state, r.maxLtvBps, r.borrowingAllowed, r.liquidationAllowed]).to.deep.equal([BigInt(S.HALTED), 0n, false, false]);
    expect(r.price).to.be.gt(0); // price still displayed during a halt
    await expect(report("AAPL", { halted: false })).to.emit(engine, "RiskStateChanged").withArgs(aapl, S.HALTED, S.NORMAL);
  });

  it("stale feed -> STALE", async () => {
    const { engine, stocks, stateOf } = await load();
    const now = await time.latest();
    await stocks.AAPL.feed.updateAnswerAt(21241000000n, now - 3601);
    expect(await stateOf("AAPL")).to.equal(S.STALE);
    await expect(engine.refresh(stocks.AAPL.token.target)).to.emit(engine, "RiskStateChanged");
  });

  it("market report older than maxReportAge -> STALE (no silent NORMAL)", async () => {
    const { stocks, stateOf } = await load();
    await time.increase(3601);
    await stocks.AAPL.feed.updateAnswer(21241000000n); // price fresh, report stale
    expect(await stateOf("AAPL")).to.equal(S.STALE);
  });

  it("oracle vs reference deviation > 5% -> DEVIATION", async () => {
    const { stocks, stateOf } = await load();
    await stocks.AAPL.feed.updateAnswer(23000000000n); // +8.3% vs signed reference 212.41
    expect(await stateOf("AAPL")).to.equal(S.DEVIATION);
  });

  it("token oraclePaused() -> CORP_ACTION_PAUSED; uiMultiplier mismatch -> CORP_ACTION_PAUSED", async () => {
    const { stocks, stateOf, report } = await load();
    await stocks.QQQ.token.setOraclePaused(true);
    expect(await stateOf("QQQ")).to.equal(S.CORP_ACTION_PAUSED);
    await stocks.QQQ.token.setOraclePaused(false);
    expect(await stateOf("QQQ")).to.equal(S.NORMAL);
    await stocks.QQQ.token.setUIMultiplier(2n * E18); // split processed onchain, report still says 1.0
    expect(await stateOf("QQQ")).to.equal(S.CORP_ACTION_PAUSED);
    await report("QQQ", { uiMultiplier: 2n * E18 });
    expect(await stateOf("QQQ")).to.equal(S.NORMAL);
  });

  it("sequencer down and grace period -> SEQUENCER_DOWN, price hidden", async () => {
    const { engine, sequencer, stocks, stateOf } = await load();
    await sequencer.setStatus(true, 0);
    expect(await stateOf("NVDA")).to.equal(S.SEQUENCER_DOWN);
    expect((await engine.getRisk(stocks.NVDA.token.target)).price).to.equal(0);
    await expect(engine.refresh(stocks.NVDA.token.target)).to.emit(engine, "SequencerStateChanged").withArgs(false);
    await sequencer.setStatus(false, 0); // back up, but inside 60s grace
    expect(await stateOf("NVDA")).to.equal(S.SEQUENCER_DOWN);
    await time.increase(61);
    await stocks.NVDA.feed.updateAnswer(18120000000n);
    expect(await stateOf("NVDA")).to.equal(S.NORMAL);
  });

  it("invalid price (zero / negative / incomplete round) -> INVALID_PRICE", async () => {
    const { stocks, stateOf } = await load();
    const now = await time.latest();
    await stocks.SPY.feed.setRoundDataUnchecked(5, 0, now, now, 5);
    expect(await stateOf("SPY")).to.equal(S.INVALID_PRICE);
    await stocks.SPY.feed.setRoundDataUnchecked(5, -1, now, now, 5);
    expect(await stateOf("SPY")).to.equal(S.INVALID_PRICE);
    await stocks.SPY.feed.setRoundDataUnchecked(6, 64650000000n, now, now, 5);
    expect(await stateOf("SPY")).to.equal(S.INVALID_PRICE);
  });

  it("unknown asset -> UNSUPPORTED", async () => {
    const { engine, attacker } = await load();
    expect((await engine.getRisk(attacker.address)).state).to.equal(S.UNSUPPORTED);
  });

  describe("report authentication", function () {
    it("rejects unauthorized reporter", async () => {
      const { engine, report, attacker } = await load();
      await expect(report("AAPL", { halted: true }, attacker)).to.be.revertedWithCustomError(engine, "UnauthorizedReporter");
    });

    it("rejects replayed nonce and duplicate report", async () => {
      const { engine, stocks, reporter, chainId } = await load();
      const now = BigInt(await time.latest());
      const r = { asset: stocks.AAPL.token.target, halted: true, corporateActionPaused: false, uiMultiplier: E18,
        referencePrice: 212410000000000000000n, observedAt: now, nonce: 1000n };
      const sig = await signReport(reporter, engine.target, chainId, r);
      const args = [r.asset, r.halted, r.corporateActionPaused, r.uiMultiplier, r.referencePrice, r.observedAt, r.nonce, sig];
      await engine.submitReport(...args);
      await expect(engine.submitReport(...args)).to.be.revertedWithCustomError(engine, "ReplayedNonce");
    });

    it("rejects signature bound to another chain id", async () => {
      const { engine, stocks, reporter } = await load();
      const now = BigInt(await time.latest());
      const r = { asset: stocks.AAPL.token.target, halted: true, corporateActionPaused: false, uiMultiplier: E18,
        referencePrice: 212410000000000000000n, observedAt: now, nonce: 999n };
      const sig = await signReport(reporter, engine.target, 4663, r); // mainnet chain id
      await expect(engine.submitReport(r.asset, r.halted, false, E18, r.referencePrice, now, 999n, sig))
        .to.be.revertedWithCustomError(engine, "UnauthorizedReporter"); // recovers a different address
    });

    it("rejects signature bound to another engine contract", async () => {
      const { engine, stocks, reporter, chainId, admin } = await load();
      const other = await (await ethers.getContractFactory("BloomRiskEngineEVM")).deploy(admin.address, 3600);
      const now = BigInt(await time.latest());
      const r = { asset: stocks.AAPL.token.target, halted: true, corporateActionPaused: false, uiMultiplier: E18,
        referencePrice: 212410000000000000000n, observedAt: now, nonce: 999n };
      const sig = await signReport(reporter, other.target, chainId, r);
      await expect(engine.submitReport(r.asset, true, false, E18, r.referencePrice, now, 999n, sig))
        .to.be.revertedWithCustomError(engine, "UnauthorizedReporter");
    });

    it("rejects tampered fields (signature over halted=false submitted as halted=true)", async () => {
      const { engine, stocks, reporter, chainId } = await load();
      const now = BigInt(await time.latest());
      const r = { asset: stocks.AAPL.token.target, halted: false, corporateActionPaused: false, uiMultiplier: E18,
        referencePrice: 212410000000000000000n, observedAt: now, nonce: 999n };
      const sig = await signReport(reporter, engine.target, chainId, r);
      await expect(engine.submitReport(r.asset, true, false, E18, r.referencePrice, now, 999n, sig))
        .to.be.revertedWithCustomError(engine, "UnauthorizedReporter");
    });

    it("rejects malformed and high-s (malleable) signatures", async () => {
      const { engine, stocks, reporter, chainId } = await load();
      const now = BigInt(await time.latest());
      const r = { asset: stocks.AAPL.token.target, halted: true, corporateActionPaused: false, uiMultiplier: E18,
        referencePrice: 212410000000000000000n, observedAt: now, nonce: 999n };
      const sig = ethers.Signature.from(await signReport(reporter, engine.target, chainId, r));
      const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
      const highS = ethers.concat([sig.r, ethers.toBeHex(N - BigInt(sig.s), 32), sig.v === 27 ? "0x1c" : "0x1b"]);
      await expect(engine.submitReport(r.asset, true, false, E18, r.referencePrice, now, 999n, highS))
        .to.be.revertedWithCustomError(engine, "InvalidSignature");
      await expect(engine.submitReport(r.asset, true, false, E18, r.referencePrice, now, 999n, "0x1234"))
        .to.be.revertedWithCustomError(engine, "InvalidSignature");
    });

    it("rejects future, stale and out-of-order reports", async () => {
      const { engine, report } = await load();
      const now = BigInt(await time.latest());
      await expect(report("AAPL", { observedAt: now + 100n })).to.be.revertedWithCustomError(engine, "ReportFromFuture");
      await expect(report("AAPL", { observedAt: now - 4000n })).to.be.revertedWithCustomError(engine, "StaleReport");
      await expect(report("AAPL", { observedAt: now - 100n })).to.be.revertedWithCustomError(engine, "OutOfOrderReport");
    });

    it("rejects reports for unconfigured assets and absurd reference prices", async () => {
      const { engine, report, attacker, reporter, chainId } = await load();
      await expect(report("AAPL", { referencePrice: 10n ** 37n })).to.be.revertedWithCustomError(engine, "InvalidReferencePrice");
      const now = BigInt(await time.latest());
      const r = { asset: attacker.address, halted: false, corporateActionPaused: false, uiMultiplier: E18, referencePrice: 1n, observedAt: now, nonce: 1n };
      const sig = await signReport(reporter, engine.target, chainId, r);
      await expect(engine.submitReport(r.asset, false, false, E18, 1n, now, 1n, sig)).to.be.revertedWithCustomError(engine, "AssetNotConfigured");
    });

    it("revoked reporter can no longer report", async () => {
      const { engine, report, reporter } = await load();
      await expect(engine.setReporter(reporter.address, false)).to.emit(engine, "ReporterUpdated").withArgs(reporter.address, false);
      await expect(report("AAPL")).to.be.revertedWithCustomError(engine, "UnauthorizedReporter");
    });
  });

  describe("admin access control", function () {
    it("non-owner cannot configure assets, reporters, sequencer or report age", async () => {
      const { engine, attacker, stocks } = await load();
      const e = engine.connect(attacker);
      await expect(e.setReporter(attacker.address, true)).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
      await expect(e.setAssetConfig(stocks.AAPL.token.target, stocks.AAPL.feed.target, 1, 1, 1, true, true))
        .to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
      await expect(e.setSequencerConfig(attacker.address, 0, false)).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
      await expect(e.setMaxReportAge(1)).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    });

    it("validates config bounds (LTV cap, deviation, heartbeat, zero feed)", async () => {
      const { engine, stocks } = await load();
      const { token, feed } = stocks.AAPL;
      await expect(engine.setAssetConfig(token.target, feed.target, 3600, 500, 8001, true, true)).to.be.revertedWithCustomError(engine, "InvalidConfig");
      await expect(engine.setAssetConfig(token.target, feed.target, 3600, 0, 6000, true, true)).to.be.revertedWithCustomError(engine, "InvalidConfig");
      await expect(engine.setAssetConfig(token.target, feed.target, 0, 500, 6000, true, true)).to.be.revertedWithCustomError(engine, "InvalidConfig");
      await expect(engine.setAssetConfig(token.target, ethers.ZeroAddress, 3600, 500, 6000, true, true)).to.be.revertedWithCustomError(engine, "ZeroAddress");
      await expect(engine.setSequencerConfig(ethers.ZeroAddress, 0, true)).to.be.revertedWithCustomError(engine, "ZeroAddress");
    });

    it("ownership transfer is two-step", async () => {
      const { engine, admin, alice } = await load();
      await engine.transferOwnership(alice.address);
      expect(await engine.owner()).to.equal(admin.address);
      await engine.connect(alice).acceptOwnership();
      expect(await engine.owner()).to.equal(alice.address);
    });

    it("disabled asset -> UNSUPPORTED (default deny)", async () => {
      const { engine, stocks, stateOf } = await load();
      const { token, feed } = stocks.AAPL;
      await engine.setAssetConfig(token.target, feed.target, 3600, 500, 6000, true, false);
      expect(await stateOf("AAPL")).to.equal(S.UNSUPPORTED);
    });
  });
});
