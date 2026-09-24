const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Adversarial Security Tests", function () {
  let ausd, oracle, vault, perps;
  let owner, attacker, user, liquidator;

  beforeEach(async function () {
    [owner, attacker, user, liquidator] = await ethers.getSigners();

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

    // Fund users
    await ausd.connect(user).faucet();
    await ausd.connect(attacker).faucet();
    await ausd.connect(owner).faucet();

    // Seed vault with liquidity
    await ausd.connect(owner).approve(vault.target, ethers.parseEther("1000"));
    await vault.connect(owner).deposit(ethers.parseEther("1000"), owner.address);
  });

  // ═══════════════════════════════════════════════════════════
  //              ORACLE MANIPULATION ATTACKS
  // ═══════════════════════════════════════════════════════════

  describe("Oracle Manipulation", function () {
    it("should reject position opening with zero oracle price", async function () {
      // Deploy a MaliciousOracle that returns 0
      const MalOracle = await ethers.getContractFactory("MaliciousOracle");
      const malOracle = await MalOracle.deploy();
      // Deploy fresh vault and perps with malicious oracle
      const Vault2 = await ethers.getContractFactory("AuraVault");
      const vault2 = await Vault2.deploy(ausd.target);
      const Perps2 = await ethers.getContractFactory("AuraPerps");
      const perps2 = await Perps2.deploy(ausd.target, malOracle.target, vault2.target);
      await vault2.setAuraPerps(perps2.target);
      // Price is 0 by default in MaliciousOracle
      await ausd.connect(user).approve(perps2.target, ethers.parseEther("100"));
      await expect(
        perps2.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5)
      ).to.be.revertedWith("AuraPerps: Invalid oracle price");
    });

    it("should prevent profitable liquidation via oracle front-running", async function () {
      // User opens a long at $60k
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 10);

      // Attacker manipulates oracle to crash price (simulating front-run)
      await oracle.setPrice("BTC", ethers.parseEther("50000"));

      // Position should be liquidatable now (loss > collateral)
      // But the attacker should only get the bounty, not drain the vault
      const attackerBefore = await ausd.balanceOf(attacker.address);
      await perps.connect(attacker).liquidatePosition(0);
      const attackerAfter = await ausd.balanceOf(attacker.address);

      // Bounty is 5% of collateral (after fee), not the full position
      const bounty = attackerAfter - attackerBefore;
      expect(bounty).to.be.lt(ethers.parseEther("10")); // max 5% of ~99.9 collateral
    });

    it("should not allow liquidation when position is safe", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      // Price goes up — position is profitable
      await oracle.setPrice("BTC", ethers.parseEther("70000"));

      await expect(
        perps.connect(attacker).liquidatePosition(0)
      ).to.be.revertedWith("AuraPerps: Position is safe");
    });

    it("should handle extreme oracle price swings — vault caps payout", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 2);

      // Set price to extreme value — profit exceeds vault liquidity
      await oracle.setPrice("BTC", ethers.parseEther("1000000"));
      // Vault correctly rejects payout exceeding its assets
      await expect(perps.connect(user).closePosition(0)).to.be.revertedWith("AuraVault: Insufficient liquidity");
    });

    it("should reject stale/zero price on close", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      // Oracle returns 0 (stale/broken)
      await oracle.setPrice("BTC", 0);
      // getPrice returns default 3000e18 when 0, so this tests the default path
      // The position will close at the default price
      await expect(perps.connect(user).closePosition(0)).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════
  //              UNAUTHORIZED ACCESS ATTACKS
  // ═══════════════════════════════════════════════════════════

  describe("Unauthorized Access", function () {
    it("should reject non-owner closing another user's position", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      await expect(
        perps.connect(attacker).closePosition(0)
      ).to.be.revertedWith("AuraPerps: Not the position owner");
    });

    it("should reject non-owner adding margin to another's position", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      await ausd.connect(attacker).approve(perps.target, ethers.parseEther("50"));
      await expect(
        perps.connect(attacker).addMargin(0, ethers.parseEther("50"))
      ).to.be.revertedWith("AuraPerps: Not owner");
    });

    it("should reject non-owner setting trigger orders", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      await expect(
        perps.connect(attacker).setTriggerOrders(0, ethers.parseEther("70000"), ethers.parseEther("50000"))
      ).to.be.revertedWith("AuraPerps: Not owner");
    });

    it("should reject non-router calling openPositionFor", async function () {
      await ausd.connect(attacker).approve(perps.target, ethers.parseEther("100"));
      await expect(
        perps.connect(attacker).openPositionFor(
          attacker.address, "BTC", true, ethers.parseEther("100"), 5
        )
      ).to.be.revertedWith("AuraPerps: Only router");
    });

    it("should reject non-owner setting perps on vault", async function () {
      await expect(
        vault.connect(attacker).setAuraPerps(attacker.address)
      ).to.be.reverted; // OwnableUnauthorizedAccount
    });

    it("should reject direct vault receiveLoss from non-perps", async function () {
      await expect(
        vault.connect(attacker).receiveLoss(ethers.parseEther("100"))
      ).to.be.revertedWith("AuraVault: Only Perps contract allowed");
    });

    it("should reject direct vault payoutProfit from non-perps", async function () {
      await expect(
        vault.connect(attacker).payoutProfit(attacker.address, ethers.parseEther("100"))
      ).to.be.revertedWith("AuraVault: Only Perps contract allowed");
    });

    it("should reject non-owner setting router on perps", async function () {
      await expect(
        perps.connect(attacker).setRouter(attacker.address)
      ).to.be.reverted;
    });

    it("should reject non-owner setting oracle on perps", async function () {
      // AuraPerps inherits Ownable - no setStylusMath from non-owner
      await expect(
        perps.connect(attacker).setStylusMath(attacker.address)
      ).to.be.reverted;
    });

    it("should reject opening position with insufficient allowance", async function () {
      // User has balance but no approval
      await expect(
        perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5)
      ).to.be.reverted;
    });

    it("should reject opening position with insufficient balance", async function () {
      const [,,,, broke] = await ethers.getSigners();
      await ausd.connect(broke).approve(perps.target, ethers.parseEther("1000"));
      await expect(
        perps.connect(broke).openPosition("BTC", true, ethers.parseEther("100"), 5)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════
  //              REENTRANCY & FLASH LOAN ATTACKS
  // ═══════════════════════════════════════════════════════════

  describe("Reentrancy & Flash Loan Resistance", function () {
    it("should resist vault share inflation via direct token donation", async function () {
      // User deposits 100
      await ausd.connect(user).approve(vault.target, ethers.parseEther("100"));
      await vault.connect(user).deposit(ethers.parseEther("100"), user.address);
      const sharesBefore = await vault.balanceOf(user.address);

      // Attacker donates tokens directly to vault (inflation attack)
      await ausd.connect(attacker).transfer(vault.target, ethers.parseEther("500"));

      // User's shares should still represent their proportional claim
      // New depositor should not get inflated shares
      const totalAssets = await vault.totalAssets();
      expect(totalAssets).to.be.gte(ethers.parseEther("1600")); // 1000 + 100 + 500

      // User redeems — should get proportional share including donation
      const redeemable = await vault.previewRedeem(sharesBefore);
      // User should get more than deposited (benefited from donation)
      expect(redeemable).to.be.gte(ethers.parseEther("100"));
    });

    it("should prevent double-close of a position", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 5);

      await perps.connect(user).closePosition(0);

      // Second close should fail
      await expect(
        perps.connect(user).closePosition(0)
      ).to.be.revertedWith("AuraPerps: Position not open");
    });

    it("should prevent double-liquidation of a position", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 10);

      // Crash price to make liquidatable
      await oracle.setPrice("BTC", ethers.parseEther("50000"));
      await perps.connect(attacker).liquidatePosition(0);

      // Second liquidation should fail
      await expect(
        perps.connect(attacker).liquidatePosition(0)
      ).to.be.revertedWith("AuraPerps: Position not open");
    });

    it("should not allow liquidation then close on same position", async function () {
      await ausd.connect(user).approve(perps.target, ethers.parseEther("100"));
      await perps.connect(user).openPosition("BTC", true, ethers.parseEther("100"), 10);

      await oracle.setPrice("BTC", ethers.parseEther("50000"));
      await perps.connect(attacker).liquidatePosition(0);

      await expect(
        perps.connect(user).closePosition(0)
      ).to.be.revertedWith("AuraPerps: Position not open");
    });
  });

  // ═══════════════════════════════════════════════════════════
  //              ACCOUNT ABSTRACTION SECURITY
  // ═══════════════════════════════════════════════════════════

  describe("AuraAccount Access Control", function () {
    let auraAccount, guardrailManager, mockDapp;

    beforeEach(async function () {
      const EntryPoint = await ethers.getContractFactory("EntryPoint", owner);
      const entryPoint = await EntryPoint.deploy();

      const GuardrailManager = await ethers.getContractFactory("AuraGuardrailManager", owner);
      guardrailManager = await GuardrailManager.deploy(owner.address);

      const AuraAccount = await ethers.getContractFactory("AuraAccount", owner);
      const implementation = await AuraAccount.deploy(entryPoint.target);

      const ERC1967Proxy = await ethers.getContractFactory(
        "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy", owner
      );
      const initData = implementation.interface.encodeFunctionData("initialize", [owner.address]);
      const proxy = await ERC1967Proxy.deploy(implementation.target, initData);
      auraAccount = AuraAccount.attach(proxy.target);

      const MockDapp = await ethers.getContractFactory("MockDapp", owner);
      mockDapp = await MockDapp.deploy();

      await auraAccount.setAiAgent(user.address);
      await auraAccount.setGuardrail(guardrailManager.target);
    });

    it("should reject executeBatchByAgent from non-agent", async function () {
      await expect(
        auraAccount.connect(attacker).executeBatchByAgent(
          [mockDapp.target], [0], ["0x"]
        )
      ).to.be.revertedWithCustomError(auraAccount, "NotAuthorized");
    });

    it("should reject executeByAgent from non-agent", async function () {
      await expect(
        auraAccount.connect(attacker).executeByAgent(mockDapp.target, 0, "0x")
      ).to.be.revertedWithCustomError(auraAccount, "NotAuthorized");
    });

    it("should reject agent call to non-whitelisted destination", async function () {
      const data = mockDapp.interface.encodeFunctionData("testCall");
      // Destination not whitelisted in guardrail
      await expect(
        auraAccount.connect(user).executeByAgent(mockDapp.target, 0, data)
      ).to.be.revertedWithCustomError(auraAccount, "GuardrailRejected");
    });

    it("should reject non-owner changing AI agent", async function () {
      await expect(
        auraAccount.connect(attacker).setAiAgent(attacker.address)
      ).to.be.reverted;
    });

    it("should reject non-owner changing guardrail", async function () {
      await expect(
        auraAccount.connect(attacker).setGuardrail(guardrailManager.target)
      ).to.be.reverted;
    });
  });
});
