const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuraPerps — Edge Cases & Liquidation", function () {
    let ausd, oracle, vault, perps;
    let owner, user, user2, liquidator;

    beforeEach(async function () {
        [owner, user, user2, liquidator] = await ethers.getSigners();

        const AUSD = await ethers.getContractFactory("aUSD");
        ausd = await AUSD.deploy();

        const Oracle = await ethers.getContractFactory("MockOracle");
        oracle = await Oracle.deploy();
        await oracle.setPrice("BTC", ethers.parseUnits("60000", 18));

        const Vault = await ethers.getContractFactory("AuraVault");
        vault = await Vault.deploy(await ausd.getAddress());

        const Perps = await ethers.getContractFactory("AuraPerps");
        perps = await Perps.deploy(await ausd.getAddress(), await oracle.getAddress(), await vault.getAddress());
        await vault.setAuraPerps(await perps.getAddress());

        // Fund
        await ausd.mint(user.address, ethers.parseUnits("100000", 18));
        await ausd.mint(user2.address, ethers.parseUnits("100000", 18));
        await ausd.mint(owner.address, ethers.parseUnits("500000", 18));
        await ausd.connect(owner).approve(await vault.getAddress(), ethers.parseUnits("200000", 18));
        await vault.connect(owner).deposit(ethers.parseUnits("200000", 18), owner.address);
    });

    // ═══════════ ADD MARGIN ═══════════

    describe("addMargin", function () {
        it("increases collateral on open position", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 10);

            const extra = ethers.parseUnits("50", 18);
            await ausd.connect(user).approve(await perps.getAddress(), extra);
            await perps.connect(user).addMargin(0, extra);

            const pos = await perps.positions(0);
            // effectiveCollateral = (100 - fee) + 50
            const fee = collat * 10n / 10000n;
            expect(pos.collateralAmount).to.equal(collat - fee + extra);
        });

        it("reverts addMargin on closed position", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);
            await perps.connect(user).closePosition(0);

            const extra = ethers.parseUnits("10", 18);
            await ausd.connect(user).approve(await perps.getAddress(), extra);
            await expect(perps.connect(user).addMargin(0, extra)).to.be.revertedWith("AuraPerps: Position not open");
        });

        it("reverts addMargin from non-owner", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);

            const extra = ethers.parseUnits("10", 18);
            await ausd.connect(user2).approve(await perps.getAddress(), extra);
            await expect(perps.connect(user2).addMargin(0, extra)).to.be.revertedWith("AuraPerps: Not owner");
        });
    });

    // ═══════════ TRIGGER ORDERS ═══════════

    describe("Trigger Orders (TP/SL)", function () {
        it("setTriggerOrders stores TP and SL prices", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);

            const tp = ethers.parseUnits("70000", 18);
            const sl = ethers.parseUnits("55000", 18);
            await perps.connect(user).setTriggerOrders(0, tp, sl);

            const pos = await perps.positions(0);
            expect(pos.takeProfitPrice).to.equal(tp);
            expect(pos.stopLossPrice).to.equal(sl);
        });

        it("executeTriggerOrder closes position on SL hit (short, price rises)", async () => {
            const collat = ethers.parseUnits("1000", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", false, collat, 2);

            // For short: SL triggers when price rises above SL
            const pos = await perps.positions(0);
            const sl = pos.entryPrice + ethers.parseUnits("5000", 18);
            await perps.connect(user).setTriggerOrders(0, 0, sl);

            // Price rises above SL — short is in loss, no vault payout needed
            await oracle.setPrice("BTC", pos.entryPrice + ethers.parseUnits("6000", 18));
            await expect(perps.connect(liquidator).executeTriggerOrder(0)).to.not.be.reverted;

            const pos2 = await perps.positions(0);
            expect(pos2.isOpen).to.equal(false);
        });

        it("executeTriggerOrder fires on SL hit (long)", async () => {
            const collat = ethers.parseUnits("1000", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 2);
            await perps.connect(user).setTriggerOrders(0, 0, ethers.parseUnits("50000", 18));

            await oracle.setPrice("BTC", ethers.parseUnits("45000", 18));
            await expect(perps.connect(liquidator).executeTriggerOrder(0)).to.not.be.reverted;

            const pos = await perps.positions(0);
            expect(pos.isOpen).to.equal(false);
        });

        it("executeTriggerOrder reverts when triggers not met", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);
            await perps.connect(user).setTriggerOrders(0, ethers.parseUnits("70000", 18), ethers.parseUnits("50000", 18));

            // Price stays at 60k — neither TP nor SL hit
            await expect(perps.connect(liquidator).executeTriggerOrder(0)).to.be.revertedWith("AuraPerps: Triggers not met");
        });

        it("setTriggerOrders reverts for non-owner", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);

            await expect(perps.connect(user2).setTriggerOrders(0, ethers.parseUnits("70000", 18), 0)).to.be.revertedWith("AuraPerps: Not owner");
        });
    });

    // ═══════════ PARTIAL CLOSE ═══════════

    describe("Partial Close", function () {
        it("closePositionPartially reduces position size", async () => {
            const collat = ethers.parseUnits("1000", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);

            const pos0 = await perps.positions(0);
            const halfSize = pos0.positionSize / 2n;
            await perps.connect(user).closePositionPartially(0, halfSize);

            const pos1 = await perps.positions(0);
            expect(pos1.positionSize).to.be.lt(pos0.positionSize);
        });

        it("closePositionPartially reverts with zero size", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);

            await expect(perps.connect(user).closePositionPartially(0, 0)).to.be.revertedWith("AuraPerps: Invalid close size");
        });

        it("closePositionPartially reverts with size > position", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);

            const pos = await perps.positions(0);
            await expect(perps.connect(user).closePositionPartially(0, pos.positionSize + 1n)).to.be.revertedWith("AuraPerps: Invalid close size");
        });

        it("closePositionPartially reverts for non-owner", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);

            await expect(perps.connect(user2).closePositionPartially(0, 1000)).to.be.revertedWith("AuraPerps: Not owner");
        });
    });

    // ═══════════ LIQUIDATION EDGE CASES ═══════════

    describe("Liquidation Edge Cases", function () {
        it("liquidation pays bounty to liquidator", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 50);

            // Crash price to trigger liquidation (50x long, ~2% drop = wipeout)
            await oracle.setPrice("BTC", ethers.parseUnits("30000", 18));

            const before = await ausd.balanceOf(liquidator.address);
            await perps.connect(liquidator).liquidatePosition(0);
            const after = await ausd.balanceOf(liquidator.address);
            expect(after).to.be.gt(before);
        });

        it("liquidation reverts on safe position", async () => {
            const collat = ethers.parseUnits("1000", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 2);

            // Price stays at 60k — position is safe
            await expect(perps.connect(liquidator).liquidatePosition(0)).to.be.revertedWith("AuraPerps: Position is safe");
        });

        it("liquidation reverts on already closed position", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 5);
            await perps.connect(user).closePosition(0);

            await oracle.setPrice("BTC", ethers.parseUnits("1", 18));
            await expect(perps.connect(liquidator).liquidatePosition(0)).to.be.revertedWith("AuraPerps: Position not open");
        });

        it("double liquidation reverts", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 50);

            await oracle.setPrice("BTC", ethers.parseUnits("30000", 18));
            await perps.connect(liquidator).liquidatePosition(0);
            await expect(perps.connect(liquidator).liquidatePosition(0)).to.be.revertedWith("AuraPerps: Position not open");
        });

        it("liquidation decreases OI", async () => {
            const collat = ethers.parseUnits("100", 18);
            await ausd.connect(user).approve(await perps.getAddress(), collat);
            await perps.connect(user).openPosition("BTC", true, collat, 50);

            const oiBefore = await perps.totalLongOI("BTC");
            await oracle.setPrice("BTC", ethers.parseUnits("30000", 18));
            await perps.connect(liquidator).liquidatePosition(0);
            const oiAfter = await perps.totalLongOI("BTC");
            expect(oiAfter).to.be.lt(oiBefore);
        });
    });
});
