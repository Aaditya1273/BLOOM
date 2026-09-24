const { expect } = require("chai");
const { ethers } = require("hardhat");
const { load, usd, S, time, E18 } = require("./fixtures");
const { sym, KIND } = require("../scripts/lib/system");

const Q = (n) => ethers.parseUnits(String(n), 18);

async function funded() {
  const f = await load();
  const { usdg, vault, stocks, alice, bob, carol } = f;
  for (const u of [alice, bob, carol]) {
    await usdg.mint(u.address, usd(100000));
    await usdg.connect(u).approve(vault.target, ethers.MaxUint256);
    for (const s of Object.values(stocks)) {
      await s.token.mint(u.address, Q(100));
      await s.token.connect(u).approve(vault.target, ethers.MaxUint256);
    }
  }
  return f;
}

describe("BloomVault — ERC-4626 savings safety", function () {
  it("first deposit mints shares 1:1e6 (virtual offset) and round-trips exactly", async () => {
    const { vault, alice, usdg } = await funded();
    await expect(vault.connect(alice).deposit(usd(100), alice.address)).to.emit(vault, "Deposit");
    expect(await vault.balanceOf(alice.address)).to.equal(usd(100) * 10n ** 6n);
    expect(await vault.decimals()).to.equal(12);
    const before = await usdg.balanceOf(alice.address);
    await vault.connect(alice).redeem(await vault.balanceOf(alice.address), alice.address, alice.address);
    expect(await usdg.balanceOf(alice.address) - before).to.equal(usd(100));
  });

  it("zero deposit / mint / withdraw / redeem revert", async () => {
    const { vault, alice } = await funded();
    await expect(vault.connect(alice).deposit(0, alice.address)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    await expect(vault.connect(alice).mint(0, alice.address)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    await expect(vault.connect(alice).withdraw(0, alice.address, alice.address)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    await expect(vault.connect(alice).redeem(0, alice.address, alice.address)).to.be.revertedWithCustomError(vault, "ZeroAmount");
  });

  it("first-depositor inflation / donation attack is unprofitable and victim keeps ~all funds", async () => {
    const { vault, usdg, attacker, alice } = await funded();
    await usdg.mint(attacker.address, usd(20000));
    await usdg.connect(attacker).approve(vault.target, ethers.MaxUint256);
    // attacker deposits 1 wei of USDG, then donates 10,000 USDG directly
    await vault.connect(attacker).deposit(1, attacker.address);
    await usdg.connect(attacker).transfer(vault.target, usd(10000));
    // victim deposits 1,000 USDG
    await vault.connect(alice).deposit(usd(1000), alice.address);
    expect(await vault.balanceOf(alice.address)).to.be.gt(0);
    const aliceAssets = await vault.convertToAssets(await vault.balanceOf(alice.address));
    expect(aliceAssets).to.be.gte(usd(1000) * 999n / 1000n); // loses < 0.1%
    const attackerAssets = await vault.convertToAssets(await vault.balanceOf(attacker.address));
    expect(attackerAssets).to.be.lt(usd(10000)); // attacker cannot recover the donation
  });

  it("empty vault conversions and max withdraw/redeem are consistent", async () => {
    const { vault, alice } = await funded();
    expect(await vault.totalAssets()).to.equal(0);
    expect(await vault.convertToShares(usd(1))).to.equal(usd(1) * 10n ** 6n);
    expect(await vault.maxWithdraw(alice.address)).to.equal(0);
    await vault.connect(alice).deposit(usd(500), alice.address);
    expect(await vault.maxWithdraw(alice.address)).to.equal(usd(500));
    expect(await vault.maxRedeem(alice.address)).to.equal(await vault.balanceOf(alice.address));
  });

  it("partial withdraw leaves correct accounting; rounding never favours the user", async () => {
    const { vault, alice, bob } = await funded();
    await vault.connect(alice).deposit(usd(333), alice.address);
    await vault.connect(bob).deposit(777, bob.address); // odd wei amounts
    await vault.connect(alice).withdraw(usd(111), alice.address, alice.address);
    expect(await vault.maxWithdraw(alice.address)).to.equal(usd(222));
    // previewWithdraw rounds shares UP, previewRedeem rounds assets DOWN
    const shares = await vault.previewWithdraw(1);
    expect(await vault.previewRedeem(shares)).to.be.gte(1);
    expect(await vault.previewRedeem(shares - 1n)).to.be.lt(1);
    expect(await vault.totalAssets()).to.equal(usd(222) + 777n);
  });

  it("withdraw cannot exceed liquidity lent out to borrowers", async () => {
    const { vault, alice, bob, stocks } = await funded();
    await vault.connect(alice).deposit(usd(1000), alice.address);
    await vault.connect(bob).depositCollateral(stocks.QQQ.token.target, Q(10)); // $5,713
    await vault.connect(bob).borrow(usd(900));
    expect(await vault.availableLiquidity()).to.equal(usd(100));
    expect(await vault.maxWithdraw(alice.address)).to.equal(usd(100));
    await expect(vault.connect(alice).withdraw(usd(101), alice.address, alice.address))
      .to.be.revertedWithCustomError(vault, "ERC4626ExceededMaxWithdraw");
    expect(await vault.totalAssets()).to.equal(usd(1000)); // debt still counts as an asset
  });

  it("idle USDG allocated to the lending adapter is recalled on withdraw; yield accrues from funded reserve", async () => {
    const { vault, adapter, usdg, alice, admin } = await funded();
    await vault.connect(alice).deposit(usd(1000), alice.address);
    await vault.connect(admin).allocate(usd(800));
    expect(await vault.totalAssets()).to.equal(usd(1000));
    await usdg.mint(admin.address, usd(100));
    await usdg.approve(adapter.target, usd(100));
    await adapter.fundYield(usd(100));
    await time.increase(365 * 24 * 3600);
    expect(await vault.totalAssets()).to.be.closeTo(usd(1036), usd(1)); // 4.5% APR on 800
    const all = await vault.maxWithdraw(alice.address);
    await vault.connect(alice).withdraw(all, alice.address, alice.address);
    expect(all).to.be.gt(usd(1035));
  });

  it("rejects adapters bound to another vault/asset and only strategist can allocate", async () => {
    const { vault, usdg, attacker, admin } = await funded();
    const bad = await (await ethers.getContractFactory("MockLendingAdapter")).deploy(usdg.target, attacker.address, 100, admin.address);
    await vault.setAdapter(ethers.ZeroAddress).catch(() => {}); // current adapter is empty, may be replaced
    await expect(vault.setAdapter(bad.target)).to.be.revertedWithCustomError(vault, "BadAdapter");
    await expect(vault.connect(attacker).allocate(1)).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
  });

  it("rejects fee-on-transfer assets (balance-delta check)", async () => {
    const { admin, registry: _r } = await funded();
    const fot = await (await ethers.getContractFactory("FeeOnTransferToken")).deploy(6);
    const registry = await (await ethers.getContractFactory("BloomAssetRegistry")).deploy(admin.address, 31337);
    await registry.registerAsset(sym("USDG"), fot.target, ethers.ZeroAddress, 6, KIND.STABLE);
    const engine = await (await ethers.getContractFactory("BloomRiskEngineEVM")).deploy(admin.address, 3600);
    const v = await (await ethers.getContractFactory("BloomVault")).deploy(fot.target, registry.target, engine.target, admin.address);
    await fot.mint(admin.address, usd(100));
    await fot.approve(v.target, usd(100));
    await expect(v.deposit(usd(100), admin.address)).to.be.revertedWithCustomError(v, "TransferAmountMismatch");
  });

  it("vault asset must be the registry's canonical stable asset", async () => {
    const { registry, stocks, engine, admin } = await funded();
    const F = await ethers.getContractFactory("BloomVault");
    await expect(F.deploy(stocks.AAPL.token.target, registry.target, engine.target, admin.address))
      .to.be.revertedWithCustomError(registry, "WrongAssetKind");
  });

  it("emergency pause: guardian pauses, deposits/withdrawals/borrows stop, repay still works, only admin unpauses", async () => {
    const { vault, alice, bob, stocks, admin, attacker } = await funded();
    await vault.connect(alice).deposit(usd(1000), alice.address);
    await vault.connect(bob).depositCollateral(stocks.QQQ.token.target, Q(1));
    await vault.connect(bob).borrow(usd(100));
    await expect(vault.connect(attacker).pause()).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    await expect(vault.pause()).to.emit(vault, "EmergencyPaused").withArgs(admin.address);
    expect(await vault.maxDeposit(alice.address)).to.equal(0);
    await expect(vault.connect(alice).deposit(1, alice.address)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    await expect(vault.connect(alice).withdraw(1, alice.address, alice.address)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    await expect(vault.connect(bob).borrow(1)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    await expect(vault.connect(bob).withdrawCollateral(stocks.QQQ.token.target, 1)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    await vault.connect(bob).repay(bob.address, usd(100));
    await vault.connect(bob).withdrawCollateral(stocks.QQQ.token.target, Q(1)); // debt-free exit allowed while paused
    await expect(vault.connect(attacker).unpause()).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    await vault.unpause();
  });
});

describe("BloomVault — risk-gated borrowing", function () {
  async function borrower() {
    const f = await funded();
    await f.vault.connect(f.alice).deposit(usd(50000), f.alice.address);
    await f.vault.connect(f.bob).depositCollateral(f.stocks.AAPL.token.target, Q(10)); // $2,124.10
    return f;
  }

  it("NORMAL: borrow up to 60% LTV, BorrowApproved", async () => {
    const { vault, bob } = await borrower();
    const [ok,,, cap] = await vault.accountHealth(bob.address);
    expect(ok).to.equal(true);
    expect(cap).to.equal(Q(2124.1) * 6000n / 10000n);
    await expect(vault.connect(bob).borrow(usd(1274))).to.emit(vault, "BorrowApproved");
    await expect(vault.connect(bob).borrow(usd(1))).to.emit(vault, "BorrowBlocked"); // 1275 > 1274.46
  });

  const blockers = {
    HALTED: async (f) => f.report("AAPL", { halted: true }),
    STALE: async (f) => f.stocks.AAPL.feed.updateAnswerAt(21241000000n, (await time.latest()) - 4000),
    DEVIATION: async (f) => f.stocks.AAPL.feed.updateAnswer(25000000000n),
    CORP_ACTION_PAUSED: async (f) => f.stocks.AAPL.token.setOraclePaused(true),
    SEQUENCER_DOWN: async (f) => f.sequencer.setStatus(true, 0),
    INVALID_PRICE: async (f) => { const t = await time.latest(); await f.stocks.AAPL.feed.setRoundDataUnchecked(9, 0, t, t, 9); },
  };

  for (const [name, apply] of Object.entries(blockers)) {
    it(`${name}: borrowing blocked (BorrowBlocked event, no funds move), LTV 0`, async () => {
      const f = await borrower();
      const { vault, bob, usdg, stocks, engine } = f;
      await apply(f);
      const r = await engine.getRisk(stocks.AAPL.token.target);
      expect(r.state).to.equal(S[name]);
      expect(r.maxLtvBps).to.equal(0);
      const before = await usdg.balanceOf(bob.address);
      await expect(vault.connect(bob).borrow(usd(10)))
        .to.emit(vault, "BorrowBlocked")
        .withArgs(bob.address, usd(10), stocks.AAPL.token.target, S[name], ethers.encodeBytes32String("RISK_STATE"));
      expect(await usdg.balanceOf(bob.address)).to.equal(before);
      expect(await vault.debtOf(bob.address)).to.equal(0);
    });
  }

  it("one blocked collateral asset blocks the whole account (no partial trust)", async () => {
    const f = await borrower();
    await f.vault.connect(f.bob).depositCollateral(f.stocks.NVDA.token.target, Q(10));
    await f.report("NVDA", { halted: true });
    await expect(f.vault.connect(f.bob).borrow(usd(10))).to.emit(f.vault, "BorrowBlocked");
  });

  it("recovery to NORMAL re-enables borrowing", async () => {
    const f = await borrower();
    await f.report("AAPL", { halted: true });
    await expect(f.vault.connect(f.bob).borrow(usd(10))).to.emit(f.vault, "BorrowBlocked");
    await f.report("AAPL", { halted: false });
    await expect(f.vault.connect(f.bob).borrow(usd(10))).to.emit(f.vault, "BorrowApproved");
  });

  it("no collateral -> BorrowBlocked(NO_COLLATERAL)", async () => {
    const { vault, carol } = await funded();
    await expect(vault.connect(carol).borrow(usd(1)))
      .to.emit(vault, "BorrowBlocked")
      .withArgs(carol.address, usd(1), ethers.ZeroAddress, 0, ethers.encodeBytes32String("NO_COLLATERAL"));
  });

  it("collateral withdrawal with debt requires NORMAL state and health", async () => {
    const f = await borrower();
    const { vault, bob, stocks } = f;
    await vault.connect(bob).borrow(usd(1000));
    await expect(vault.connect(bob).withdrawCollateral(stocks.AAPL.token.target, Q(5))).to.be.revertedWithCustomError(vault, "Unhealthy");
    await vault.connect(bob).withdrawCollateral(stocks.AAPL.token.target, Q(1)); // still healthy
    await f.report("AAPL", { halted: true });
    await expect(vault.connect(bob).withdrawCollateral(stocks.AAPL.token.target, 1)).to.be.revertedWithCustomError(vault, "Unhealthy");
  });

  it("rejects unregistered / spoofed collateral with the same symbol", async () => {
    const { vault, bob, admin } = await borrower();
    const spoof = await (await ethers.getContractFactory("MockStockToken")).deploy("Apple", "AAPL", admin.address);
    await expect(vault.connect(bob).depositCollateral(spoof.target, 1)).to.be.reverted;
  });

  it("reentrancy through a malicious registered token is blocked by the guard", async () => {
    const f = await funded();
    const { admin, registry, engine, vault, bob } = f;
    const re = await (await ethers.getContractFactory("ReentrantToken")).deploy();
    const feed = await (await ethers.getContractFactory("MockAggregatorV3")).deploy(8, "RE", 100e8, admin.address);
    await registry.registerAsset(sym("RE"), re.target, feed.target, 18, KIND.STOCK_TOKEN);
    await engine.setAssetConfig(re.target, feed.target, 3600, 500, 6000, false, true);
    await re.mint(bob.address, Q(10));
    await re.connect(bob).approve(vault.target, ethers.MaxUint256);
    await re.arm(vault.target);
    await expect(vault.connect(bob).depositCollateral(re.target, Q(1))).to.be.revertedWithCustomError(vault, "ReentrancyGuardReentrantCall");
  });
});

describe("BloomVault — liquidation & protected mode", function () {
  async function underwater() {
    const f = await funded();
    const { vault, alice, bob, stocks } = f;
    await vault.connect(alice).deposit(usd(50000), alice.address);
    await vault.connect(bob).depositCollateral(stocks.AAPL.token.target, Q(10)); // $2,124.10
    await vault.connect(bob).borrow(usd(1270));
    // price -25%: $159.31. threshold = 75% => 1194.8 < 1270 debt
    await stocks.AAPL.feed.updateAnswer(15931000000n);
    await f.report("AAPL"); // fresh reference at new price
    return f;
  }

  it("healthy position cannot be liquidated", async () => {
    const f = await funded();
    await f.vault.connect(f.alice).deposit(usd(5000), f.alice.address);
    await f.vault.connect(f.bob).depositCollateral(f.stocks.AAPL.token.target, Q(10));
    await f.vault.connect(f.bob).borrow(usd(100));
    await expect(f.vault.connect(f.carol).liquidate(f.bob.address, f.stocks.AAPL.token.target, usd(50)))
      .to.be.revertedWithCustomError(f.vault, "NotLiquidatable");
  });

  it("liquidates with close factor and 5% bonus", async () => {
    const { vault, bob, carol, stocks } = await underwater();
    await expect(vault.connect(carol).liquidate(bob.address, stocks.AAPL.token.target, usd(700)))
      .to.be.revertedWithCustomError(vault, "ExceedsCloseFactor");
    const before = await stocks.AAPL.token.balanceOf(carol.address);
    await expect(vault.connect(carol).liquidate(bob.address, stocks.AAPL.token.target, usd(600))).to.emit(vault, "Liquidated");
    const seized = (await stocks.AAPL.token.balanceOf(carol.address)) - before;
    expect(seized).to.equal(Q(600) * 10500n / 10000n * 10n ** 18n / Q(159.31));
    expect(await vault.debtOf(bob.address)).to.equal(usd(670));
  });

  it("protected mode: liquidation paused while the collateral is HALTED / STALE / CORP_ACTION_PAUSED", async () => {
    const f = await underwater();
    const { vault, bob, carol, stocks } = f;
    await f.report("AAPL", { halted: true });
    await expect(vault.connect(carol).liquidate(bob.address, stocks.AAPL.token.target, usd(100)))
      .to.be.revertedWithCustomError(vault, "LiquidationPaused").withArgs(stocks.AAPL.token.target, S.HALTED);
    await f.report("AAPL", { halted: false });
    await stocks.AAPL.token.setOraclePaused(true);
    await expect(vault.connect(carol).liquidate(bob.address, stocks.AAPL.token.target, usd(100)))
      .to.be.revertedWithCustomError(vault, "LiquidationPaused");
  });

  it("bad debt can be written off only after collateral is exhausted", async () => {
    const f = await funded();
    const { vault, alice, bob, carol, stocks, admin } = f;
    await vault.connect(alice).deposit(usd(5000), alice.address);
    await vault.connect(bob).depositCollateral(stocks.AAPL.token.target, Q(1)); // $212.41
    await vault.connect(bob).borrow(usd(127));
    await stocks.AAPL.feed.updateAnswer(5000000000n); // $50
    await f.report("AAPL");
    await expect(vault.writeOffBadDebt(bob.address)).to.be.revertedWithCustomError(vault, "HasCollateral");
    await vault.connect(carol).liquidate(bob.address, stocks.AAPL.token.target, usd(63)); // seizes all ($66.15 > $50)
    expect(await vault.collateralOf(bob.address, stocks.AAPL.token.target)).to.equal(0);
    const debt = await vault.debtOf(bob.address);
    await expect(vault.connect(admin).writeOffBadDebt(bob.address)).to.emit(vault, "BadDebtWrittenOff").withArgs(bob.address, debt);
    expect(await vault.totalDebt()).to.equal(0);
  });
});
