const { expect } = require("chai");
const { ethers } = require("hardhat");
const { computeHealth, recommendTopUp } = require("../backend/healthFactor");

describe("LiquidationShield — Integration with healthFactor utility", function () {
    let aUSD, oracle, vault, perps, shield;
    let owner, user, keeper;
    let positionId;

    const SYMBOL = "ETH";
    const ENTRY_PRICE = ethers.parseUnits("2500", 18);
    const COLLATERAL = ethers.parseUnits("1000", 18);
    const LEVERAGE = 5n;

    beforeEach(async () => {
        [owner, user, keeper] = await ethers.getSigners();

        const AUSD = await ethers.getContractFactory("aUSD");
        aUSD = await AUSD.deploy();

        const Oracle = await ethers.getContractFactory("MockOracle");
        oracle = await Oracle.deploy();
        await oracle.setPrice(SYMBOL, ENTRY_PRICE);

        const Vault = await ethers.getContractFactory("AuraVault");
        vault = await Vault.deploy(await aUSD.getAddress());

        const Perps = await ethers.getContractFactory("AuraPerps");
        perps = await Perps.deploy(await aUSD.getAddress(), await oracle.getAddress(), await vault.getAddress());
        await vault.setAuraPerps(await perps.getAddress());

        await aUSD.mint(owner.address, ethers.parseUnits("100000", 18));
        await aUSD.approve(await vault.getAddress(), ethers.parseUnits("50000", 18));
        await vault.deposit(ethers.parseUnits("50000", 18), owner.address);

        const Shield = await ethers.getContractFactory("LiquidationShield");
        shield = await Shield.deploy(await perps.getAddress());
        await shield.setKeeper(keeper.address);

        await aUSD.mint(user.address, ethers.parseUnits("10000", 18));
        await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL);
        const tx = await perps.connect(user).openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
        const receipt = await tx.wait();
        const event = receipt.logs.map(l => {
            try { return perps.interface.parseLog(l); } catch { return null; }
        }).filter(Boolean).find(e => e.name === "PositionOpened");
        positionId = event.args.positionId;
    });


    describe("E2E: Health factor matches AuraPerps liquidation logic", function () {
        it("computes health=100% when position is in profit (long)", async () => {
            // Position opened at $2500, price moves up
            const newPrice = ethers.parseUnits("2700", 18);
            const pos = await perps.positions(positionId);
            const blk = await ethers.provider.getBlock("latest");

            const result = computeHealth(
                {
                    isLong: pos.isLong,
                    collateralAmount: pos.collateralAmount,
                    entryPrice: pos.entryPrice,
                    positionSize: pos.positionSize,
                    openedAt: pos.openedAt,
                },
                newPrice,
                BigInt(blk.timestamp)
            );

            expect(result.isProfit).to.equal(true);
            expect(result.healthBps).to.equal(10000);
        });

        it("computes degrading health as price drops (long)", async () => {
            const pos = await perps.positions(positionId);
            const blk = await ethers.provider.getBlock("latest");

            // Price drops 5% — significant loss with 5x leverage
            const newPrice = ethers.parseUnits("2375", 18);
            const result = computeHealth(
                {
                    isLong: pos.isLong,
                    collateralAmount: pos.collateralAmount,
                    entryPrice: pos.entryPrice,
                    positionSize: pos.positionSize,
                    openedAt: pos.openedAt,
                },
                newPrice,
                BigInt(blk.timestamp)
            );

            // Loss = positionSize * 0.05 = 5000 * 0.05 = 250
            // Health = (collateral - 250) / collateral = ~75%
            expect(result.isProfit).to.equal(false);
            expect(result.healthBps).to.be.greaterThan(7000);
            expect(result.healthBps).to.be.lessThan(8000);
        });

        it("computes health=0 when losses exceed collateral", async () => {
            const pos = await perps.positions(positionId);
            const blk = await ethers.provider.getBlock("latest");

            // Drop 25% — at 5x leverage, that's 125% loss → liquidatable
            const newPrice = ethers.parseUnits("1875", 18);
            const result = computeHealth(
                {
                    isLong: pos.isLong,
                    collateralAmount: pos.collateralAmount,
                    entryPrice: pos.entryPrice,
                    positionSize: pos.positionSize,
                    openedAt: pos.openedAt,
                },
                newPrice,
                BigInt(blk.timestamp)
            );

            expect(result.healthBps).to.equal(0);
            expect(result.isProfit).to.equal(false);
        });

        it("recommendTopUp returns 0 when position is healthy", async () => {
            const pos = await perps.positions(positionId);
            const blk = await ethers.provider.getBlock("latest");

            const newPrice = ethers.parseUnits("2700", 18); // profit
            const topUp = recommendTopUp(
                {
                    isLong: pos.isLong,
                    collateralAmount: pos.collateralAmount,
                    entryPrice: pos.entryPrice,
                    positionSize: pos.positionSize,
                    openedAt: pos.openedAt,
                },
                newPrice,
                BigInt(blk.timestamp)
            );

            expect(topUp).to.equal(0n);
        });

        it("recommendTopUp returns positive amount when health is low", async () => {
            const pos = await perps.positions(positionId);
            const blk = await ethers.provider.getBlock("latest");

            // Drop 15% — 75% loss with 5x leverage, health ~25%
            const newPrice = ethers.parseUnits("2125", 18);
            const topUp = recommendTopUp(
                {
                    isLong: pos.isLong,
                    collateralAmount: pos.collateralAmount,
                    entryPrice: pos.entryPrice,
                    positionSize: pos.positionSize,
                    openedAt: pos.openedAt,
                },
                newPrice,
                BigInt(blk.timestamp),
                5000 // target 50% health
            );

            // Should suggest a meaningful top-up to bring health to 50%
            expect(topUp).to.be.greaterThan(0n);
            expect(topUp).to.be.lessThan(ethers.parseUnits("10000", 18));
        });
    });

    describe("E2E: Full shield flow on-chain", function () {
        const RECOMMENDED = ethers.parseUnits("500", 18);
        const MAX = ethers.parseUnits("2000", 18);

        beforeEach(async () => {
            await shield.connect(user).armShield(positionId, 2000, RECOMMENDED, MAX);
        });

        it("keeper records alert after price drops", async () => {
            // Drop price to make health < 20%
            // collateral=1000, positionSize=5000, entry=2500
            // Need pnl > 800 → priceDiff > 400 → newPrice < 2100
            const newPrice = ethers.parseUnits("2080", 18);
            await oracle.setPrice(SYMBOL, newPrice);

            const pos = await perps.positions(positionId);
            const blk = await ethers.provider.getBlock("latest");
            const { healthBps } = computeHealth(
                {
                    isLong: pos.isLong,
                    collateralAmount: pos.collateralAmount,
                    entryPrice: pos.entryPrice,
                    positionSize: pos.positionSize,
                    openedAt: pos.openedAt,
                },
                newPrice,
                BigInt(blk.timestamp)
            );

            expect(healthBps).to.be.lessThan(2000);

            await expect(shield.connect(keeper).recordAlert(positionId, healthBps))
                .to.emit(shield, "AlertEmitted")
                .withArgs(positionId, user.address, healthBps, RECOMMENDED);
        });

        it("user adds margin after receiving alert, position becomes healthier", async () => {
            const newPrice = ethers.parseUnits("2125", 18);
            await oracle.setPrice(SYMBOL, newPrice);

            const posBefore = await perps.positions(positionId);
            const blk = await ethers.provider.getBlock("latest");
            const before = computeHealth(
                {
                    isLong: posBefore.isLong,
                    collateralAmount: posBefore.collateralAmount,
                    entryPrice: posBefore.entryPrice,
                    positionSize: posBefore.positionSize,
                    openedAt: posBefore.openedAt,
                },
                newPrice,
                BigInt(blk.timestamp)
            );

            // User responds to alert by adding the recommended margin
            await aUSD.connect(user).approve(await perps.getAddress(), RECOMMENDED);
            await perps.connect(user).addMargin(positionId, RECOMMENDED);

            const posAfter = await perps.positions(positionId);
            const after = computeHealth(
                {
                    isLong: posAfter.isLong,
                    collateralAmount: posAfter.collateralAmount,
                    entryPrice: posAfter.entryPrice,
                    positionSize: posAfter.positionSize,
                    openedAt: posAfter.openedAt,
                },
                newPrice,
                BigInt(blk.timestamp)
            );

            expect(after.healthBps).to.be.greaterThan(before.healthBps);
        });
    });
});
