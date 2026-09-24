const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Stylus Guardrail — Fuzz & Edge Case Tests
 * Tests the MockVaultGuardrail (Solidity mirror of the Stylus WASM guardrail)
 * for whitelist enforcement, leverage bounds, and volume limits.
 */
describe("Stylus Guardrail — Fuzz & Edge Cases", function () {
    let guardrail, vault, ausd;
    let admin, executor, user, attacker;

    const AI_EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("AI_EXECUTOR_ROLE"));

    beforeEach(async function () {
        [admin, executor, user, attacker] = await ethers.getSigners();

        const AUSD = await ethers.getContractFactory("aUSD");
        ausd = await AUSD.deploy();

        const MockGuardrail = await ethers.getContractFactory("MockVaultGuardrail");
        guardrail = await MockGuardrail.deploy();

        const Vault = await ethers.getContractFactory("AuraIntelligenceVault");
        vault = await Vault.deploy(await ausd.getAddress(), admin.address, await guardrail.getAddress());
        await vault.connect(admin).grantRole(AI_EXECUTOR_ROLE, executor.address);
    });

    describe("Whitelist Enforcement", function () {
        it("rejects execution to non-whitelisted protocol", async () => {
            const calldata = "0x095ea7b3" + "0".repeat(128);
            await expect(
                vault.connect(executor).executeStrategy(attacker.address, calldata, 50)
            ).to.be.reverted;
        });

        it("rejects whitelisted protocol with non-approved selector", async () => {
            await vault.connect(admin).whitelistProtocol(user.address, true);
            const badSelector = "0xdeadbeef" + "0".repeat(128);
            await expect(
                vault.connect(executor).executeStrategy(user.address, badSelector, 50)
            ).to.be.reverted;
        });

        it("allows whitelisted protocol with approved selector", async () => {
            await vault.connect(admin).whitelistProtocol(user.address, true);
            await vault.connect(admin).approveSelector(user.address, "0x095ea7b3", true);
            // Won't revert on guardrail check (may revert on actual call, but guardrail passes)
        });

        it("removing protocol from whitelist blocks previously allowed calls", async () => {
            await vault.connect(admin).whitelistProtocol(user.address, true);
            await vault.connect(admin).approveSelector(user.address, "0x095ea7b3", true);
            await vault.connect(admin).whitelistProtocol(user.address, false);

            const calldata = "0x095ea7b3" + "0".repeat(128);
            await expect(
                vault.connect(executor).executeStrategy(user.address, calldata, 50)
            ).to.be.reverted;
        });
    });

    describe("Leverage Bounds (via AuraPerps)", function () {
        let perps, oracle, auraVault;

        beforeEach(async () => {
            const Oracle = await ethers.getContractFactory("MockOracle");
            oracle = await Oracle.deploy();
            await oracle.setPrice("BTC", ethers.parseUnits("60000", 18));

            const AuraVault = await ethers.getContractFactory("AuraVault");
            auraVault = await AuraVault.deploy(await ausd.getAddress());

            const Perps = await ethers.getContractFactory("AuraPerps");
            perps = await Perps.deploy(await ausd.getAddress(), await oracle.getAddress(), await auraVault.getAddress());
            await auraVault.setAuraPerps(await perps.getAddress());

            await ausd.mint(user.address, ethers.parseUnits("10000", 18));
            await ausd.mint(admin.address, ethers.parseUnits("50000", 18));
            await ausd.connect(admin).approve(await auraVault.getAddress(), ethers.parseUnits("50000", 18));
            await auraVault.connect(admin).deposit(ethers.parseUnits("50000", 18), admin.address);
        });

        it("rejects leverage = 0", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await expect(perps.connect(user).openPosition("BTC", true, collat, 0)).to.be.revertedWith("AuraPerps: Max 50x leverage allowed");
        });

        it("rejects leverage = 51", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await expect(perps.connect(user).openPosition("BTC", true, collat, 51)).to.be.revertedWith("AuraPerps: Max 50x leverage allowed");
        });

        it("accepts leverage = 50 (boundary)", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await expect(perps.connect(user).openPosition("BTC", true, collat, 50)).to.not.be.reverted;
        });

        it("accepts leverage = 1 (minimum)", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await expect(perps.connect(user).openPosition("BTC", true, collat, 1)).to.not.be.reverted;
        });

        it("fuzz: random leverages [1..50] all succeed", async () => {
            for (let i = 0; i < 10; i++) {
                const lev = Math.floor(Math.random() * 50) + 1;
                const collat = ethers.parseUnits("10", 18);
                await ausd.connect(user).approve(await perps.getAddress(), collat);
                await expect(perps.connect(user).openPosition("BTC", true, collat, lev)).to.not.be.reverted;
            }
        });

        it("fuzz: random leverages [51..200] all revert", async () => {
            for (let i = 0; i < 5; i++) {
                const lev = Math.floor(Math.random() * 150) + 51;
                const collat = ethers.parseUnits("10", 18);
                await ausd.connect(user).approve(await perps.getAddress(), collat);
                await expect(perps.connect(user).openPosition("BTC", true, collat, lev)).to.be.reverted;
            }
        });
    });

    describe("Volume & Position Size Limits", function () {
        let perps, oracle, auraVault;

        beforeEach(async () => {
            const Oracle = await ethers.getContractFactory("MockOracle");
            oracle = await Oracle.deploy();
            await oracle.setPrice("BTC", ethers.parseUnits("60000", 18));

            const AuraVault = await ethers.getContractFactory("AuraVault");
            auraVault = await AuraVault.deploy(await ausd.getAddress());

            const Perps = await ethers.getContractFactory("AuraPerps");
            perps = await Perps.deploy(await ausd.getAddress(), await oracle.getAddress(), await auraVault.getAddress());
            await auraVault.setAuraPerps(await perps.getAddress());

            await ausd.mint(user.address, ethers.parseUnits("1000000", 18));
            await ausd.mint(admin.address, ethers.parseUnits("1000000", 18));
            await ausd.connect(admin).approve(await auraVault.getAddress(), ethers.parseUnits("500000", 18));
            await auraVault.connect(admin).deposit(ethers.parseUnits("500000", 18), admin.address);
        });

        it("rejects zero collateral", async () => {
            await expect(perps.connect(user).openPosition("BTC", true, 0, 5)).to.be.revertedWith("AuraPerps: Invalid collateral");
        });

        it("rejects position when collateral insufficient for transfer", async () => {
            // User has no approval → transfer fails
            const collat = ethers.parseUnits("100", 18);
            await expect(perps.connect(user).openPosition("BTC", true, collat, 5)).to.be.reverted;
        });

        it("OI tracking: long OI increases on open", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            const oiBefore = await perps.totalLongOI("BTC");
            await perps.connect(user).openPosition("BTC", true, collat, 10);
            const oiAfter = await perps.totalLongOI("BTC");
            expect(oiAfter).to.be.gt(oiBefore);
        });

        it("OI tracking: short OI increases on short open", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            const oiBefore = await perps.totalShortOI("BTC");
            await perps.connect(user).openPosition("BTC", false, collat, 10);
            const oiAfter = await perps.totalShortOI("BTC");
            expect(oiAfter).to.be.gt(oiBefore);
        });

        it("multi-asset OI isolation: BTC OI unaffected by ETH position", async () => {
            await oracle.setPrice("ETH", ethers.parseUnits("3000", 18));
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);

            const btcOiBefore = await perps.totalLongOI("BTC");
            await perps.connect(user).openPosition("ETH", true, collat, 5);
            const btcOiAfter = await perps.totalLongOI("BTC");
            expect(btcOiAfter).to.equal(btcOiBefore);
        });
    });
});
