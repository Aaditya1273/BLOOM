const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuraSocialTrading", () => {
  let social, aUSD;
  let owner, strategist, strategist2, follower1, follower2, follower3, attacker;

  const INITIAL = ethers.parseEther("10000");
  const DEPOSIT = ethers.parseEther("1000");
  const FEE_BPS = 1000; // 10%

  beforeEach(async () => {
    [owner, strategist, strategist2, follower1, follower2, follower3, attacker] =
      await ethers.getSigners();

    const AUSD = await ethers.getContractFactory("aUSD");
    aUSD = await AUSD.deploy();
    await aUSD.waitForDeployment();

    for (const a of [strategist, strategist2, follower1, follower2, follower3, attacker])
      await aUSD.mint(a.address, INITIAL);

    const Social = await ethers.getContractFactory("AuraSocialTrading");
    social = await Social.deploy(await aUSD.getAddress());
    await social.waitForDeployment();

    for (const a of [strategist, strategist2, follower1, follower2, follower3, attacker])
      await aUSD.connect(a).approve(await social.getAddress(), ethers.MaxUint256);
  });

  // ── DEPLOYMENT ──────────────────────────────────────────────────────────────
  describe("Deployment", () => {
    it("sets aUSD correctly", async () => {
      expect(await social.aUSD()).to.equal(await aUSD.getAddress());
    });
    it("reverts on zero aUSD address", async () => {
      const S = await ethers.getContractFactory("AuraSocialTrading");
      await expect(S.deploy(ethers.ZeroAddress)).to.be.revertedWith(
        "AuraSocialTrading: zero aUSD address"
      );
    });
    it("nextStrategyId starts at 0", async () => {
      expect(await social.nextStrategyId()).to.equal(0);
    });
    it("constants are correct", async () => {
      expect(await social.MAX_PERFORMANCE_FEE_BPS()).to.equal(2000);
      expect(await social.MAX_FOLLOWERS()).to.equal(100);
      expect(await social.MAX_LEVERAGE()).to.equal(50);
    });
  });

  // ── PUBLISH STRATEGY ────────────────────────────────────────────────────────
  describe("publishStrategy", () => {
    it("stores strategy fields correctly", async () => {
      await social.connect(strategist).publishStrategy("Alpha", "Long BTC", FEE_BPS);
      const s = await social.getStrategy(0);
      expect(s.strategist).to.equal(strategist.address);
      expect(s.name).to.equal("Alpha");
      expect(s.performanceFeeBps).to.equal(FEE_BPS);
      expect(s.isActive).to.be.true;
      expect(s.followerCount).to.equal(0);
    });
    it("emits StrategyPublished", async () => {
      await expect(social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS))
        .to.emit(social, "StrategyPublished")
        .withArgs(0, strategist.address, "Alpha", FEE_BPS);
    });
    it("increments nextStrategyId", async () => {
      await social.connect(strategist).publishStrategy("A", "d", 0);
      await social.connect(strategist).publishStrategy("B", "d", 0);
      expect(await social.nextStrategyId()).to.equal(2);
    });
    it("allows fee = 0", async () => {
      await expect(social.connect(strategist).publishStrategy("F", "d", 0)).to.not.be.reverted;
    });
    it("allows fee = 2000 (max)", async () => {
      await expect(social.connect(strategist).publishStrategy("M", "d", 2000)).to.not.be.reverted;
    });
    it("reverts if fee > 2000", async () => {
      await expect(social.connect(strategist).publishStrategy("X", "d", 2001))
        .to.be.revertedWithCustomError(social, "FeeTooHigh");
    });
    it("reverts on empty name", async () => {
      await expect(social.connect(strategist).publishStrategy("", "d", FEE_BPS))
        .to.be.revertedWith("AuraSocialTrading: empty name");
    });
    it("two strategists publish independently", async () => {
      await social.connect(strategist).publishStrategy("S1", "d", 500);
      await social.connect(strategist2).publishStrategy("S2", "d", 1000);
      expect((await social.getStrategy(0)).strategist).to.equal(strategist.address);
      expect((await social.getStrategy(1)).strategist).to.equal(strategist2.address);
    });
  });

  // ── FOLLOW ──────────────────────────────────────────────────────────────────
  describe("follow", () => {
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS);
    });
    it("transfers aUSD to contract", async () => {
      const before = await aUSD.balanceOf(follower1.address);
      await social.connect(follower1).follow(0, DEPOSIT);
      expect(await aUSD.balanceOf(follower1.address)).to.equal(before - DEPOSIT);
      expect(await aUSD.balanceOf(await social.getAddress())).to.equal(DEPOSIT);
    });
    it("records position correctly", async () => {
      await social.connect(follower1).follow(0, DEPOSIT);
      const fp = await social.getFollowerPosition(0, follower1.address);
      expect(fp.capitalDeposited).to.equal(DEPOSIT);
      expect(fp.highWaterMark).to.equal(DEPOSIT);
      expect(fp.isActive).to.be.true;
    });
    it("updates strategy counters", async () => {
      await social.connect(follower1).follow(0, DEPOSIT);
      const s = await social.getStrategy(0);
      expect(s.totalFollowerCapital).to.equal(DEPOSIT);
      expect(s.followerCount).to.equal(1);
    });
    it("emits Followed", async () => {
      await expect(social.connect(follower1).follow(0, DEPOSIT))
        .to.emit(social, "Followed")
        .withArgs(0, follower1.address, DEPOSIT);
    });
    it("adds to getFollowers list", async () => {
      await social.connect(follower1).follow(0, DEPOSIT);
      expect(await social.getFollowers(0)).to.include(follower1.address);
    });
    it("multiple followers accumulate correctly", async () => {
      await social.connect(follower1).follow(0, DEPOSIT);
      await social.connect(follower2).follow(0, DEPOSIT);
      const s = await social.getStrategy(0);
      expect(s.followerCount).to.equal(2);
      expect(s.totalFollowerCapital).to.equal(DEPOSIT * 2n);
    });
    it("reverts on zero amount", async () => {
      await expect(social.connect(follower1).follow(0, 0))
        .to.be.revertedWithCustomError(social, "ZeroAmount");
    });
    it("reverts if already following", async () => {
      await social.connect(follower1).follow(0, DEPOSIT);
      await expect(social.connect(follower1).follow(0, DEPOSIT))
        .to.be.revertedWithCustomError(social, "AlreadyFollowing");
    });
    it("reverts if strategy inactive", async () => {
      await social.connect(strategist).deactivateStrategy(0);
      await expect(social.connect(follower1).follow(0, DEPOSIT))
        .to.be.revertedWithCustomError(social, "StrategyNotActive");
    });
    it("reverts if strategy does not exist", async () => {
      await expect(social.connect(follower1).follow(99, DEPOSIT))
        .to.be.revertedWith("AuraSocialTrading: strategy not found");
    });
  });


  // ── UNFOLLOW ────────────────────────────────────────────────────────────────
  describe("unfollow", () => {
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS);
      await social.connect(follower1).follow(0, DEPOSIT);
    });
    it("returns capital to follower", async () => {
      const before = await aUSD.balanceOf(follower1.address);
      await social.connect(follower1).unfollow(0);
      expect(await aUSD.balanceOf(follower1.address)).to.equal(before + DEPOSIT);
    });
    it("clears follower position", async () => {
      await social.connect(follower1).unfollow(0);
      const fp = await social.getFollowerPosition(0, follower1.address);
      expect(fp.isActive).to.be.false;
      expect(fp.capitalDeposited).to.equal(0);
    });
    it("decrements strategy counters", async () => {
      await social.connect(follower1).unfollow(0);
      const s = await social.getStrategy(0);
      expect(s.followerCount).to.equal(0);
      expect(s.totalFollowerCapital).to.equal(0);
    });
    it("emits Unfollowed", async () => {
      await expect(social.connect(follower1).unfollow(0))
        .to.emit(social, "Unfollowed")
        .withArgs(0, follower1.address, DEPOSIT);
    });
    it("swap-and-pop preserves other followers", async () => {
      await social.connect(follower2).follow(0, DEPOSIT);
      await social.connect(follower3).follow(0, DEPOSIT);
      await social.connect(follower1).unfollow(0);
      const list = await social.getFollowers(0);
      expect(list.length).to.equal(2);
      expect(list).to.include(follower2.address);
      expect(list).to.include(follower3.address);
    });
    it("reverts if not following", async () => {
      await expect(social.connect(attacker).unfollow(0))
        .to.be.revertedWithCustomError(social, "NotFollowing");
    });
    it("works even if strategy is deactivated", async () => {
      await social.connect(strategist).deactivateStrategy(0);
      await expect(social.connect(follower1).unfollow(0)).to.not.be.reverted;
    });
    it("follower can re-follow after unfollowing", async () => {
      await social.connect(follower1).unfollow(0);
      await expect(social.connect(follower1).follow(0, DEPOSIT)).to.not.be.reverted;
    });
  });

  // ── ADD CAPITAL ─────────────────────────────────────────────────────────────
  describe("addCapital", () => {
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS);
      await social.connect(follower1).follow(0, DEPOSIT);
    });
    it("increases capitalDeposited", async () => {
      await social.connect(follower1).addCapital(0, DEPOSIT);
      const fp = await social.getFollowerPosition(0, follower1.address);
      expect(fp.capitalDeposited).to.equal(DEPOSIT * 2n);
    });
    it("increases strategy totalFollowerCapital", async () => {
      await social.connect(follower1).addCapital(0, DEPOSIT);
      expect((await social.getStrategy(0)).totalFollowerCapital).to.equal(DEPOSIT * 2n);
    });
    it("emits CapitalAdded", async () => {
      await expect(social.connect(follower1).addCapital(0, DEPOSIT))
        .to.emit(social, "CapitalAdded")
        .withArgs(0, follower1.address, DEPOSIT);
    });
    it("reverts if not following", async () => {
      await expect(social.connect(follower2).addCapital(0, DEPOSIT))
        .to.be.revertedWithCustomError(social, "NotFollowing");
    });
    it("reverts on zero amount", async () => {
      await expect(social.connect(follower1).addCapital(0, 0))
        .to.be.revertedWithCustomError(social, "ZeroAmount");
    });
  });

  // ── EXECUTE FOR FOLLOWERS ───────────────────────────────────────────────────
  describe("executeForFollowers", () => {
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS);
      await social.connect(follower1).follow(0, DEPOSIT);
      await social.connect(follower2).follow(0, DEPOSIT);
    });
    it("emits TradeExecuted with correct totalCapitalUsed", async () => {
      await expect(social.connect(strategist).executeForFollowers(0, "BTC", true, 10, 5000))
        .to.emit(social, "TradeExecuted")
        .withArgs(0, strategist.address, "BTC", true, 10, DEPOSIT, 2);
    });
    it("100% fraction uses full capital", async () => {
      const tx = await social.connect(strategist).executeForFollowers(0, "ETH", false, 1, 10000);
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l) => { try { return social.interface.parseLog(l); } catch { return null; } })
        .find((e) => e?.name === "TradeExecuted");
      expect(ev.args.totalCapitalUsed).to.equal(DEPOSIT * 2n);
    });
    it("reverts if not strategist", async () => {
      await expect(social.connect(attacker).executeForFollowers(0, "BTC", true, 10, 5000))
        .to.be.revertedWithCustomError(social, "NotStrategist");
    });
    it("reverts if strategy inactive", async () => {
      await social.connect(strategist).deactivateStrategy(0);
      await expect(social.connect(strategist).executeForFollowers(0, "BTC", true, 10, 5000))
        .to.be.revertedWithCustomError(social, "StrategyNotActive");
    });
    it("reverts if leverage = 0", async () => {
      await expect(social.connect(strategist).executeForFollowers(0, "BTC", true, 0, 5000))
        .to.be.revertedWithCustomError(social, "LeverageTooHigh");
    });
    it("reverts if leverage > 50", async () => {
      await expect(social.connect(strategist).executeForFollowers(0, "BTC", true, 51, 5000))
        .to.be.revertedWithCustomError(social, "LeverageTooHigh");
    });
    it("allows leverage = 50", async () => {
      await expect(social.connect(strategist).executeForFollowers(0, "BTC", true, 50, 5000))
        .to.not.be.reverted;
    });
    it("reverts on empty asset", async () => {
      await expect(social.connect(strategist).executeForFollowers(0, "", true, 10, 5000))
        .to.be.revertedWith("AuraSocialTrading: empty asset");
    });
    it("reverts on fraction = 0", async () => {
      await expect(social.connect(strategist).executeForFollowers(0, "BTC", true, 10, 0))
        .to.be.revertedWith("AuraSocialTrading: invalid fraction");
    });
    it("reverts on fraction > 10000", async () => {
      await expect(social.connect(strategist).executeForFollowers(0, "BTC", true, 10, 10001))
        .to.be.revertedWith("AuraSocialTrading: invalid fraction");
    });
    it("reverts if no followers", async () => {
      await social.connect(strategist2).publishStrategy("Empty", "d", 0);
      await expect(social.connect(strategist2).executeForFollowers(1, "BTC", true, 10, 5000))
        .to.be.revertedWith("AuraSocialTrading: no followers");
    });
  });


  // ── DISTRIBUTE PROFIT & FEES ────────────────────────────────────────────────
  describe("distributeProfitToFollower", () => {
    const PROFIT = ethers.parseEther("100");
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS);
      await social.connect(follower1).follow(0, DEPOSIT);
      await aUSD.mint(strategist.address, PROFIT);
    });
    it("credits net profit to follower (fee=10%)", async () => {
      await social.connect(strategist).distributeProfitToFollower(0, follower1.address, PROFIT);
      const fp = await social.getFollowerPosition(0, follower1.address);
      expect(fp.capitalDeposited).to.equal(DEPOSIT + ethers.parseEther("90"));
    });
    it("accrues correct fee to pendingFees", async () => {
      await social.connect(strategist).distributeProfitToFollower(0, follower1.address, PROFIT);
      expect(await social.pendingFees(strategist.address)).to.equal(ethers.parseEther("10"));
    });
    it("emits ProfitDistributed", async () => {
      await expect(social.connect(strategist).distributeProfitToFollower(0, follower1.address, PROFIT))
        .to.emit(social, "ProfitDistributed")
        .withArgs(0, follower1.address, ethers.parseEther("90"), ethers.parseEther("10"));
    });
    it("updates strategy totalPnl", async () => {
      await social.connect(strategist).distributeProfitToFollower(0, follower1.address, PROFIT);
      expect((await social.getStrategy(0)).totalPnl).to.equal(PROFIT);
    });
    it("high-water mark prevents double fee", async () => {
      // First: profit=100, capitalDeposited=1000, currentValue=1100, HWM set to 1100
      // fee = 10% of (1100-1000) = 10, net = 90, capitalDeposited becomes 1090
      await social.connect(strategist).distributeProfitToFollower(0, follower1.address, PROFIT);
      // Second: profit=50, capitalDeposited=1090, currentValue=1140, HWM=1100
      // gain above HWM = 1140-1100 = 40, fee = 10% of 40 = 4, total fees = 14
      await aUSD.mint(strategist.address, ethers.parseEther("50"));
      await social.connect(strategist).distributeProfitToFollower(0, follower1.address, ethers.parseEther("50"));
      expect(await social.pendingFees(strategist.address)).to.equal(ethers.parseEther("14"));
    });
    it("zero-fee strategy distributes full profit", async () => {
      await social.connect(strategist2).publishStrategy("Free", "d", 0);
      await social.connect(follower2).follow(1, DEPOSIT);
      await aUSD.mint(strategist2.address, PROFIT);
      await social.connect(strategist2).distributeProfitToFollower(1, follower2.address, PROFIT);
      expect((await social.getFollowerPosition(1, follower2.address)).capitalDeposited)
        .to.equal(DEPOSIT + PROFIT);
    });
    it("reverts if not strategist", async () => {
      await expect(social.connect(attacker).distributeProfitToFollower(0, follower1.address, PROFIT))
        .to.be.revertedWithCustomError(social, "NotStrategist");
    });
    it("reverts on zero profit", async () => {
      await expect(social.connect(strategist).distributeProfitToFollower(0, follower1.address, 0))
        .to.be.revertedWithCustomError(social, "ZeroAmount");
    });
    it("reverts if follower not active", async () => {
      await expect(social.connect(strategist).distributeProfitToFollower(0, attacker.address, PROFIT))
        .to.be.revertedWithCustomError(social, "NotFollowing");
    });
  });

  // ── CLAIM FEES ──────────────────────────────────────────────────────────────
  describe("claimFees", () => {
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS);
      await social.connect(follower1).follow(0, DEPOSIT);
      await aUSD.mint(strategist.address, ethers.parseEther("100"));
      await social.connect(strategist).distributeProfitToFollower(0, follower1.address, ethers.parseEther("100"));
    });
    it("transfers fees to strategist", async () => {
      const before = await aUSD.balanceOf(strategist.address);
      await social.connect(strategist).claimFees();
      expect(await aUSD.balanceOf(strategist.address)).to.equal(before + ethers.parseEther("10"));
    });
    it("resets pendingFees to 0", async () => {
      await social.connect(strategist).claimFees();
      expect(await social.pendingFees(strategist.address)).to.equal(0);
    });
    it("emits FeesClaimed", async () => {
      await expect(social.connect(strategist).claimFees())
        .to.emit(social, "FeesClaimed")
        .withArgs(strategist.address, ethers.parseEther("10"));
    });
    it("reverts if no fees", async () => {
      await expect(social.connect(attacker).claimFees())
        .to.be.revertedWithCustomError(social, "NoFeesToClaim");
    });
    it("cannot double-claim", async () => {
      await social.connect(strategist).claimFees();
      await expect(social.connect(strategist).claimFees())
        .to.be.revertedWithCustomError(social, "NoFeesToClaim");
    });
  });

  // ── DEACTIVATE ──────────────────────────────────────────────────────────────
  describe("deactivateStrategy", () => {
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS);
    });
    it("sets isActive to false", async () => {
      await social.connect(strategist).deactivateStrategy(0);
      expect((await social.getStrategy(0)).isActive).to.be.false;
    });
    it("emits StrategyDeactivated", async () => {
      await expect(social.connect(strategist).deactivateStrategy(0))
        .to.emit(social, "StrategyDeactivated")
        .withArgs(0, strategist.address);
    });
    it("reverts if not strategist", async () => {
      await expect(social.connect(attacker).deactivateStrategy(0))
        .to.be.revertedWithCustomError(social, "NotStrategist");
    });
  });

  // ── VIEW: getActiveStrategies ────────────────────────────────────────────────
  describe("getActiveStrategies", () => {
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("A", "d", 0);
      await social.connect(strategist).publishStrategy("B", "d", 0);
      await social.connect(strategist).publishStrategy("C", "d", 0);
      await social.connect(strategist).deactivateStrategy(1);
    });
    it("returns only active strategies", async () => {
      const [ids] = await social.getActiveStrategies(0, 10);
      expect(ids.length).to.equal(2);
      expect(ids.map(Number)).to.include(0);
      expect(ids.map(Number)).to.include(2);
    });
    it("respects limit", async () => {
      const [ids] = await social.getActiveStrategies(0, 1);
      expect(ids.length).to.equal(1);
    });
    it("returns empty when all deactivated", async () => {
      await social.connect(strategist).deactivateStrategy(0);
      await social.connect(strategist).deactivateStrategy(2);
      const [ids] = await social.getActiveStrategies(0, 10);
      expect(ids.length).to.equal(0);
    });
  });

  // ── ADVERSARIAL ─────────────────────────────────────────────────────────────
  describe("Adversarial", () => {
    beforeEach(async () => {
      await social.connect(strategist).publishStrategy("Alpha", "d", FEE_BPS);
      await social.connect(follower1).follow(0, DEPOSIT);
    });
    it("attacker cannot execute trades", async () => {
      await expect(social.connect(attacker).executeForFollowers(0, "BTC", true, 10, 5000))
        .to.be.revertedWithCustomError(social, "NotStrategist");
    });
    it("attacker cannot distribute profit", async () => {
      await expect(social.connect(attacker).distributeProfitToFollower(0, follower1.address, ethers.parseEther("100")))
        .to.be.revertedWithCustomError(social, "NotStrategist");
    });
    it("attacker cannot claim fees", async () => {
      await aUSD.mint(strategist.address, ethers.parseEther("100"));
      await social.connect(strategist).distributeProfitToFollower(0, follower1.address, ethers.parseEther("100"));
      await expect(social.connect(attacker).claimFees())
        .to.be.revertedWithCustomError(social, "NoFeesToClaim");
    });
    it("attacker cannot unfollow for another user", async () => {
      await expect(social.connect(attacker).unfollow(0))
        .to.be.revertedWithCustomError(social, "NotFollowing");
    });
    it("leverage > 50 is blocked", async () => {
      await expect(social.connect(strategist).executeForFollowers(0, "BTC", true, 51, 5000))
        .to.be.revertedWithCustomError(social, "LeverageTooHigh");
    });
    it("fee > 20% is blocked at publish", async () => {
      await expect(social.connect(strategist).publishStrategy("X", "d", 2001))
        .to.be.revertedWithCustomError(social, "FeeTooHigh");
    });
    it("capital is isolated between strategies", async () => {
      await social.connect(strategist2).publishStrategy("S2", "d", 0);
      await social.connect(follower1).follow(1, ethers.parseEther("500"));
      expect((await social.getFollowerPosition(0, follower1.address)).capitalDeposited).to.equal(DEPOSIT);
      expect((await social.getFollowerPosition(1, follower1.address)).capitalDeposited).to.equal(ethers.parseEther("500"));
    });
    it("deactivated strategy still allows unfollow", async () => {
      await social.connect(strategist).deactivateStrategy(0);
      await social.connect(follower1).unfollow(0);
      expect(await aUSD.balanceOf(follower1.address)).to.equal(INITIAL);
    });
  });
});
