const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Fuzz-style property-based tests for AuraPerps and AuraVault.
 * Uses randomized inputs to verify invariants hold across edge cases.
 */
describe("Fuzz & Edge Case Tests", function () {
  let ausd, oracle, vault, perps;
  let owner, user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const AUSD = await ethers.getContractFactory("aUSD");
    ausd = await AUSD.deploy();

    const Oracle = await ethers.getContractFactory("MockOracle");
    oracle = await Oracle.deploy();

    const Vault = await ethers.getContractFactory("AuraVault");
    vault = await Vault.deploy(ausd.target);

    const Perps = await ethers.getContractFactory("AuraPerps");
    perps = await Perps.deploy(ausd.target, oracle.target, vault.target);

    await vault.setAuraPerps(perps.target);
    await oracle.setPrice("BTC", ethers.parseEther("60000"));

    // Fund
    await ausd.connect(user).faucet();
    await ausd.connect(owner).faucet();
    await ausd.connect(owner).approve(vault.target, ethers.parseEther("1000"));
    await vault.connect(owner).deposit(ethers.parseEther("1000"), owner.address);
  });

  // ═══════════════════════════════════════════════════════════
  //              PERPS INVARIANT TESTS
  // ═══════════════════════════════════════════════════════════

  describe("Perps Invariants", function () {
    it("invariant: position size = effectiveCollateral * leverage", async function () {
      const collaterals = [1, 10, 50, 100, 500];
      const leverages = [1, 2, 5, 10, 20, 50];

      for (const col of collaterals) {
        for (const lev of leverages) {
          const colWei = ethers.parseEther(col.toString());
          if (col * lev > 1000) continue; // skip if exceeds balance

          await ausd.connect(user).approve(perps.target, colWei);
          const id = await perps.connect(user).openPosition.staticCall("BTC", true, colWei, lev);
          await perps.connect(user).openPosition("BTC", true, colWei, lev);

          const pos = await perps.positions(id);
          const fee = (colWei * 10n) / 10000n; // 0.1% fee
          const effective = colWei - fee;
          expect(pos.positionSize).to.equal(effective * BigInt(lev));

          // Close to reset
          await perps.connect(user).closePosition(id);
        }
      }
    });

    it("invariant: OI tracking stays consistent after open/close cycles", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("500"));

      // Open 5 longs
      for (let i = 0; i < 5; i++) {
        await perps.connect(user).openPosition("BTC", true, ethers.parseEther("10"), 5);
      }

      const longOI = await perps.totalLongOI("BTC");
      expect(longOI).to.be.gt(0);

      // Close all
      for (let i = 0; i < 5; i++) {
        await perps.connect(user).closePosition(i);
      }

      const longOIAfter = await perps.totalLongOI("BTC");
      expect(longOIAfter).to.equal(0);
    });

    it("invariant: short OI decreases correctly on close", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("300"));

      await perps.connect(user).openPosition("BTC", false, ethers.parseEther("100"), 3);
      const shortOI = await perps.totalShortOI("BTC");
      expect(shortOI).to.be.gt(0);

      await perps.connect(user).closePosition(0);
      expect(await perps.totalShortOI("BTC")).to.equal(0);
    });

    it("should reject leverage > 50x", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await expect(
        perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 51)
      ).to.be.revertedWith("AuraPerps: Max 50x leverage allowed");
    });

    it("should reject zero collateral", async function () {
      await expect(
        perps.connect(user).openPosition("BTC", true, 0, 5)
      ).to.be.revertedWith("AuraPerps: Invalid collateral");
    });

    it("should reject zero leverage", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await expect(
        perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 0)
      ).to.be.revertedWith("AuraPerps: Max 50x leverage allowed");
    });

    it("fuzz: random collateral amounts produce valid positions", async function () {
      const amounts = [
        ethers.parseEther("0.01"),
        ethers.parseEther("0.5"),
        ethers.parseEther("7.77"),
        ethers.parseEther("99.99"),
        ethers.parseEther("123.456"),
      ];

      await ausd.connect(user).approve(perps.target, ethers.parseEther("1000"));

      for (let i = 0; i < amounts.length; i++) {
        const tx = await perps.connect(user).openPosition("BTC", i % 2 === 0, amounts[i], 3);
        await tx.wait();
        const pos = await perps.positions(i);
        expect(pos.isOpen).to.be.true;
        expect(pos.collateralAmount).to.be.gt(0);
      }
    });

    it("fuzz: positions at various prices produce correct PnL direction", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));

      // Open short at 60k — price goes up = short loses
      await perps.connect(user).openPosition("BTC", false, ethers.parseEther("50"), 2);

      // Price goes up — short loses, user gets back less than collateral
      await oracle.setPrice("BTC", ethers.parseEther("62000"));

      const balBefore = await ausd.balanceOf(user.address);
      await perps.connect(user).closePosition(0);
      const balAfter = await ausd.balanceOf(user.address);
      // User gets back less than 50 (lost money on short)
      const returned = balAfter - balBefore;
      expect(returned).to.be.lt(ethers.parseEther("50"));
      expect(returned).to.be.gt(0); // but not liquidated, still gets something back
    });
  });

  // ═══════════════════════════════════════════════════════════
  //              VAULT INVARIANT TESTS
  // ═══════════════════════════════════════════════════════════

  describe("Vault Invariants", function () {
    it("invariant: totalAssets >= totalSupply (no share inflation)", async function () {
      await ausd.connect(user).approve(vault.target, ethers.parseEther("500"));

      // Multiple deposits
      await vault.connect(user).deposit(ethers.parseEther("100"), user.address);
      await vault.connect(user).deposit(ethers.parseEther("200"), user.address);
      await vault.connect(user).deposit(ethers.parseEther("50"), user.address);

      const totalAssets = await vault.totalAssets();
      const totalSupply = await vault.totalSupply();
      // 1:1 ratio initially (no profit/loss yet from perps)
      expect(totalAssets).to.be.gte(totalSupply);
    });

    it("invariant: deposit then full withdraw returns original amount (no loss)", async function () {
      const amount = ethers.parseEther("250");
      await ausd.connect(user).approve(vault.target, amount);

      const balBefore = await ausd.balanceOf(user.address);
      await vault.connect(user).deposit(amount, user.address);
      const shares = await vault.balanceOf(user.address);
      await vault.connect(user).redeem(shares, user.address, user.address);
      const balAfter = await ausd.balanceOf(user.address);

      // Should get back exactly what was deposited (no fees on vault)
      expect(balAfter).to.equal(balBefore);
    });

    it("invariant: shares proportional across multiple depositors", async function () {
      // Faucet fresh tokens for owner (already spent in beforeEach)
      await ausd.connect(owner).faucet();
      await ausd.connect(user).approve(vault.target, ethers.parseEther("100"));
      await ausd.connect(owner).approve(vault.target, ethers.parseEther("100"));

      await vault.connect(user).deposit(ethers.parseEther("100"), user.address);
      await vault.connect(owner).deposit(ethers.parseEther("100"), owner.address);

      const userShares = await vault.balanceOf(user.address);
      // User deposited 100 at 1:1 ratio → should get 100 shares
      expect(userShares).to.equal(ethers.parseEther("100"));
    });

    it("should handle zero deposit gracefully (mints zero shares)", async function () {
      const sharesBefore = await vault.balanceOf(user.address);
      await ausd.connect(user).approve(vault.target, 0);
      await vault.connect(user).deposit(0, user.address);
      const sharesAfter = await vault.balanceOf(user.address);
      expect(sharesAfter).to.equal(sharesBefore);
    });

    it("should handle withdraw more than balance", async function () {
      await ausd.connect(user).approve(vault.target, ethers.parseEther("100"));
      await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

      await expect(
        vault.connect(user).withdraw(ethers.parseEther("200"), user.address, user.address)
      ).to.be.reverted;
    });

    it("vault share price increases when perps traders lose", async function () {
      await ausd.connect(user).approve(vault.target, ethers.parseEther("100"));
      await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

      const sharesBefore = await vault.balanceOf(user.address);
      const previewBefore = await vault.previewRedeem(sharesBefore);

      // Faucet fresh tokens for a trader (use attacker signer slot)
      const [,,, trader] = await ethers.getSigners();
      await ausd.connect(trader).faucet();
      await ausd.connect(trader).approve(perps.target, ethers.parseEther("50"));
      await perps.connect(trader).openPosition("BTC", true, ethers.parseEther("50"), 10);

      // Crash price — trader gets liquidated, vault receives collateral
      await oracle.setPrice("BTC", ethers.parseEther("40000"));
      await perps.connect(user).liquidatePosition(0);

      const previewAfter = await vault.previewRedeem(sharesBefore);
      expect(previewAfter).to.be.gt(previewBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //              EDGE CASES & BOUNDARY TESTS
  // ═══════════════════════════════════════════════════════════

  describe("Boundary Conditions", function () {
    it("should handle minimum collateral (1 wei)", async function () {
      await ausd.connect(user).approve(perps.target, 1);
      // 1 wei collateral — fee rounds to 0, position opens with 1 wei
      await expect(
        perps.connect(user).openPosition("BTC", true, 1, 1)
      ).to.not.be.reverted;
    });

    it("should handle max leverage (50x) correctly", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 50);

      const pos = await perps.positions(0);
      const fee = (ethers.parseEther("100") * 10n) / 10000n;
      const effective = ethers.parseEther("100") - fee;
      expect(pos.positionSize).to.equal(effective * 50n);
    });

    it("should handle multiple assets independently", async function () {
      await oracle.setPrice("ETH", ethers.parseEther("3000"));
      await oracle.setPrice("BTC", ethers.parseEther("60000"));

      await ausd.connect(user).approve(perps.target, ethers.parseEther("200"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);
      await perps.connect(user).openPosition("ETH", false, ethers.parseEther("100"), 5);

      expect(await perps.totalLongOI("BTC")).to.be.gt(0);
      expect(await perps.totalShortOI("ETH")).to.be.gt(0);
      expect(await perps.totalShortOI("BTC")).to.equal(0);
      expect(await perps.totalLongOI("ETH")).to.equal(0);
    });

    it("should handle partial close correctly", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      const pos = await perps.positions(0);
      const halfSize = pos.positionSize / 2n;

      await perps.connect(user).closePositionPartially(0, halfSize);

      const posAfter = await perps.positions(0);
      expect(posAfter.isOpen).to.be.true;
      expect(posAfter.positionSize).to.be.lt(pos.positionSize);
    });

    it("should reject partial close with zero size", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      await expect(
        perps.connect(user).closePositionPartially(0, 0)
      ).to.be.revertedWith("AuraPerps: Invalid close size");
    });

    it("should reject partial close exceeding position size", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      const pos = await perps.positions(0);
      await expect(
        perps.connect(user).closePositionPartially(0, pos.positionSize + 1n)
      ).to.be.revertedWith("AuraPerps: Invalid close size");
    });
  });
});
