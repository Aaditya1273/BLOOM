const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuraIntelligenceVault", function () {
    let vault, ausd, mockGuardrail;
    let admin, executor, user, attacker, protocol;

    const AI_EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AI_EXECUTOR_ROLE"));
    const STRATEGIST_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STRATEGIST_ROLE"));

    // Mock function selector (approve)
    const APPROVE_SELECTOR = "0x095ea7b3";

    beforeEach(async function () {
        [admin, executor, user, attacker, protocol] = await ethers.getSigners();

        // Deploy aUSD
        const AUSD = await ethers.getContractFactory("aUSD");
        ausd = await AUSD.deploy();

        // Deploy mock guardrail (simple pass-through for testing)
        const MockGuardrail = await ethers.getContractFactory("MockVaultGuardrail");
        mockGuardrail = await MockGuardrail.deploy();

        // Deploy Intelligence Vault
        const Vault = await ethers.getContractFactory("AuraIntelligenceVault");
        vault = await Vault.deploy(
            await ausd.getAddress(),
            admin.address,
            await mockGuardrail.getAddress()
        );

        // Setup: Grant executor role
        await vault.connect(admin).grantRole(AI_EXECUTOR_ROLE, executor.address);

        // Setup: Whitelist protocol and selector
        await vault.connect(admin).whitelistProtocol(protocol.address, true);
        await vault.connect(admin).approveSelector(protocol.address, APPROVE_SELECTOR, true);

        // Setup: Mint aUSD to user and deposit
        await ausd.connect(user).faucet(); // 1000 aUSD
        await ausd.connect(user).approve(await vault.getAddress(), ethers.parseEther("1000"));
    });

    // ═══════════════════════════════════════════════════════════
    //              TEST 1: ERC-4626 Deposit / Withdraw
    // ═══════════════════════════════════════════════════════════

    describe("ERC-4626 Compliance", function () {
        it("should accept deposits and mint correct shares", async function () {
            const depositAmount = ethers.parseEther("100");
            await vault.connect(user).deposit(depositAmount, user.address);

            expect(await vault.balanceOf(user.address)).to.equal(depositAmount);
            expect(await vault.totalAssets()).to.equal(depositAmount);
        });

        it("should allow withdrawals and burn shares", async function () {
            const depositAmount = ethers.parseEther("100");
            await vault.connect(user).deposit(depositAmount, user.address);

            const balanceBefore = await ausd.balanceOf(user.address);
            await vault.connect(user).withdraw(depositAmount, user.address, user.address);

            expect(await vault.balanceOf(user.address)).to.equal(0);
            expect(await ausd.balanceOf(user.address)).to.equal(balanceBefore + depositAmount);
        });

        it("should return correct share/asset conversion", async function () {
            const depositAmount = ethers.parseEther("500");
            await vault.connect(user).deposit(depositAmount, user.address);

            // 1:1 ratio initially
            expect(await vault.convertToAssets(ethers.parseEther("1"))).to.equal(ethers.parseEther("1"));
            expect(await vault.convertToShares(ethers.parseEther("1"))).to.equal(ethers.parseEther("1"));
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              TEST 2: Access Control
    // ═══════════════════════════════════════════════════════════

    describe("Access Control", function () {
        it("should only allow AI_EXECUTOR_ROLE to call executeStrategy", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

            const calldata = APPROVE_SELECTOR + "0".repeat(120); // dummy valid calldata

            await expect(
                vault.connect(attacker).executeStrategy(protocol.address, calldata, 30)
            ).to.be.reverted;
        });

        it("should allow executor to call executeStrategy", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

            // Calling an EOA with low-level call succeeds (empty return = success)
            // This confirms the access control and guardrail checks all passed
            const calldata = APPROVE_SELECTOR + "0".repeat(120);
            
            await expect(
                vault.connect(executor).executeStrategy(protocol.address, calldata, 30)
            ).to.emit(vault, "StrategyExecuted");
        });

        it("should only allow STRATEGIST_ROLE to whitelist protocols", async function () {
            await expect(
                vault.connect(attacker).whitelistProtocol(attacker.address, true)
            ).to.be.reverted;
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              TEST 3: Protocol Whitelist
    // ═══════════════════════════════════════════════════════════

    describe("Protocol Whitelist", function () {
        it("should reject strategies targeting non-whitelisted protocols", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

            const calldata = APPROVE_SELECTOR + "0".repeat(120);

            await expect(
                vault.connect(executor).executeStrategy(attacker.address, calldata, 30)
            ).to.be.revertedWithCustomError(vault, "ProtocolNotWhitelisted");
        });

        it("should allow whitelisting and de-listing protocols", async function () {
            await vault.connect(admin).whitelistProtocol(attacker.address, true);
            expect(await vault.whitelistedProtocols(attacker.address)).to.be.true;

            await vault.connect(admin).whitelistProtocol(attacker.address, false);
            expect(await vault.whitelistedProtocols(attacker.address)).to.be.false;
        });

        it("should reject whitelisting zero address", async function () {
            await expect(
                vault.connect(admin).whitelistProtocol(ethers.ZeroAddress, true)
            ).to.be.revertedWithCustomError(vault, "InvalidParameter");
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              TEST 4: Risk Score Enforcement
    // ═══════════════════════════════════════════════════════════

    describe("Risk Score Ceiling", function () {
        it("should reject strategies with risk score above ceiling", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

            const calldata = APPROVE_SELECTOR + "0".repeat(120);

            await expect(
                vault.connect(executor).executeStrategy(protocol.address, calldata, 80)
            ).to.be.revertedWithCustomError(vault, "RiskScoreTooHigh");
        });

        it("should accept strategies at or below the ceiling", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

            const calldata = APPROVE_SELECTOR + "0".repeat(120);

            // Risk score 70 (= max) should pass all checks and execute successfully
            await expect(
                vault.connect(executor).executeStrategy(protocol.address, calldata, 70)
            ).to.emit(vault, "StrategyExecuted");
        });

        it("should allow updating the risk score ceiling", async function () {
            await vault.connect(admin).setMaxRiskScore(50);
            expect(await vault.maxRiskScore()).to.equal(50);
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              TEST 5: Selector Validation
    // ═══════════════════════════════════════════════════════════

    describe("Function Selector Validation", function () {
        it("should reject unapproved function selectors", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

            // Use a random selector that's not approved
            const badSelector = "0xdeadbeef";
            const calldata = badSelector + "0".repeat(120);

            await expect(
                vault.connect(executor).executeStrategy(protocol.address, calldata, 30)
            ).to.be.revertedWithCustomError(vault, "SelectorNotApproved");
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              TEST 6: Emergency Controls
    // ═══════════════════════════════════════════════════════════

    describe("Emergency Pause", function () {
        it("should block AI execution when paused", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);
            await vault.connect(admin).pauseVault();

            const calldata = APPROVE_SELECTOR + "0".repeat(120);

            await expect(
                vault.connect(executor).executeStrategy(protocol.address, calldata, 30)
            ).to.be.revertedWithCustomError(vault, "EnforcedPause");
        });

        it("should allow user withdrawals even when paused", async function () {
            const depositAmount = ethers.parseEther("100");
            await vault.connect(user).deposit(depositAmount, user.address);
            await vault.connect(admin).pauseVault();

            // User can still withdraw
            await vault.connect(user).withdraw(depositAmount, user.address, user.address);
            expect(await vault.balanceOf(user.address)).to.equal(0);
        });

        it("should allow unpause", async function () {
            await vault.connect(admin).pauseVault();
            await vault.connect(admin).unpauseVault();
            expect(await vault.paused()).to.be.false;
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              TEST 7: Stylus Guardrail Integration
    // ═══════════════════════════════════════════════════════════

    describe("Stylus Guardrail Integration", function () {
        it("should call the guardrail before execution", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

            // Set guardrail to reject everything
            await mockGuardrail.setRejectAll(true);

            const calldata = APPROVE_SELECTOR + "0".repeat(120);

            await expect(
                vault.connect(executor).executeStrategy(protocol.address, calldata, 30)
            ).to.be.revertedWithCustomError(vault, "StylusGuardrailRejected");
        });

        it("should allow execution when guardrail is disabled (address(0))", async function () {
            // Disable guardrail
            await vault.connect(admin).setStylusGuardrail(ethers.ZeroAddress);

            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);

            const calldata = APPROVE_SELECTOR + "0".repeat(120);

            // Should pass all Solidity checks and execute (EOA call succeeds)
            await expect(
                vault.connect(executor).executeStrategy(protocol.address, calldata, 30)
            ).to.emit(vault, "StrategyExecuted");
        });
    });

    // ═══════════════════════════════════════════════════════════
    //              TEST 8: View Functions
    // ═══════════════════════════════════════════════════════════

    describe("View Functions", function () {
        it("should report correct idle capital", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);
            expect(await vault.idleCapital()).to.equal(ethers.parseEther("100"));
        });

        it("should report zero utilization initially", async function () {
            await vault.connect(user).deposit(ethers.parseEther("100"), user.address);
            expect(await vault.utilizationRateBps()).to.equal(0);
        });

        it("should report zero exposure initially", async function () {
            expect(await vault.getProtocolExposureBps(protocol.address)).to.equal(0);
        });
    });
});
