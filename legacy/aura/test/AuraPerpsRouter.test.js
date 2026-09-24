const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuraPerpsRouter — Extended Coverage", function () {
    let aUSD, oracle, vault, perps, lob, router, mmFund;
    let owner, taker, maker, maker2, mmAgent;

    const SYMBOL = "BTC";
    const PRICE = ethers.parseUnits("100000", 18);

    beforeEach(async () => {
        [owner, taker, maker, maker2, mmAgent] = await ethers.getSigners();

        const AUSD = await ethers.getContractFactory("aUSD");
        aUSD = await AUSD.deploy();

        const Oracle = await ethers.getContractFactory("MockOracle");
        oracle = await Oracle.deploy();
        await oracle.setPrice(SYMBOL, PRICE);

        const Vault = await ethers.getContractFactory("AuraVault");
        vault = await Vault.deploy(await aUSD.getAddress());

        const Perps = await ethers.getContractFactory("AuraPerps");
        perps = await Perps.deploy(await aUSD.getAddress(), await oracle.getAddress(), await vault.getAddress());
        await vault.setAuraPerps(await perps.getAddress());

        const LOB = await ethers.getContractFactory("AuraOrderBook");
        lob = await LOB.deploy();

        const Router = await ethers.getContractFactory("AuraPerpsRouter");
        router = await Router.deploy(await aUSD.getAddress(), await lob.getAddress(), await perps.getAddress(), await oracle.getAddress());
        await lob.initialize(await router.getAddress(), owner.address);
        await perps.setRouter(await router.getAddress());
        await router.registerAsset(SYMBOL);

        const MMFund = await ethers.getContractFactory("AuraMMFund");
        mmFund = await MMFund.deploy(await aUSD.getAddress(), await router.getAddress());
        await mmFund.setAgent(mmAgent.address);
        await router.setMmAgent(mmAgent.address);

        // Seed
        for (const s of [taker, maker, maker2, owner]) {
            await aUSD.mint(s.address, ethers.parseUnits("100000", 18));
        }
        await aUSD.approve(await vault.getAddress(), ethers.parseUnits("50000", 18));
        await vault.deposit(ethers.parseUnits("50000", 18), owner.address);
    });

    // ═══════════ CANCEL + REFUND ═══════════

    describe("Cancel & Refund", function () {
        it("cancelLimitOrder refunds full collateral to maker", async () => {
            const collat = ethers.parseUnits("200", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat);
            const tx = await router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 2, PRICE);
            const receipt = await tx.wait();
            const event = receipt.logs.map(l => { try { return router.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "LimitOrderPlaced");
            const orderId = event.args.orderId;

            const before = await aUSD.balanceOf(maker.address);
            await router.connect(maker).cancelLimitOrder(orderId);
            const after = await aUSD.balanceOf(maker.address);
            expect(after - before).to.equal(collat);
        });

        it("cancelLimitOrder reverts for non-owner", async () => {
            const collat = ethers.parseUnits("100", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat);
            const tx = await router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 1, PRICE);
            const receipt = await tx.wait();
            const event = receipt.logs.map(l => { try { return router.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "LimitOrderPlaced");
            const orderId = event.args.orderId;

            await expect(router.connect(taker).cancelLimitOrder(orderId)).to.be.reverted;
        });

        it("cancelLimitOrder zeroes escrow so double-cancel fails", async () => {
            const collat = ethers.parseUnits("100", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat);
            const tx = await router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 1, PRICE);
            const receipt = await tx.wait();
            const event = receipt.logs.map(l => { try { return router.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "LimitOrderPlaced");
            const orderId = event.args.orderId;

            await router.connect(maker).cancelLimitOrder(orderId);
            await expect(router.connect(maker).cancelLimitOrder(orderId)).to.be.reverted;
        });
    });

    // ═══════════ MULTI-MAKER FILLS ═══════════

    describe("Multi-Maker Routing", function () {
        it("walks multiple makers before fallback", async () => {
            // 2 makers each with 50 aUSD * 1x = 50 size
            const mc = ethers.parseUnits("50", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), mc);
            await router.connect(maker).placeLimitOrder(SYMBOL, false, mc, 1, PRICE);
            await aUSD.connect(maker2).approve(await router.getAddress(), mc);
            await router.connect(maker2).placeLimitOrder(SYMBOL, false, mc, 1, PRICE);

            // Taker wants 200 size (200 aUSD * 1x). Book has 100, fallback gets 100.
            const tc = ethers.parseUnits("200", 18);
            await aUSD.connect(taker).approve(await router.getAddress(), tc);
            const tx = await router.connect(taker).routedMarketOpen(SYMBOL, true, tc, 1);
            const receipt = await tx.wait();

            const routed = receipt.logs.map(l => { try { return router.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "MarketOrderRouted");
            expect(routed.args.makerFills).to.equal(2n);
            expect(routed.args.bookFilledSize).to.equal(mc * 2n);
            expect(routed.args.fallbackSize).to.be.gt(0n);
        });

        it("skips makers larger than remaining taker capacity", async () => {
            // Maker with 500 size, taker only wants 100 size
            const mc = ethers.parseUnits("500", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), mc);
            await router.connect(maker).placeLimitOrder(SYMBOL, false, mc, 1, PRICE);

            const tc = ethers.parseUnits("100", 18);
            await aUSD.connect(taker).approve(await router.getAddress(), tc);
            const tx = await router.connect(taker).routedMarketOpen(SYMBOL, true, tc, 1);
            const receipt = await tx.wait();

            const routed = receipt.logs.map(l => { try { return router.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "MarketOrderRouted");
            expect(routed.args.makerFills).to.equal(0n);
            expect(routed.args.fallbackSize).to.be.gt(0n);
        });
    });

    // ═══════════ KEEPER matchAndExecute ═══════════

    describe("Keeper matchAndExecute", function () {
        it("keeper matches crossed orders and opens positions", async () => {
            // Bid at 101k, Ask at 99k → crossed
            const collat = ethers.parseUnits("100", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat);
            await router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 1, ethers.parseUnits("101000", 18));
            await aUSD.connect(maker2).approve(await router.getAddress(), collat);
            await router.connect(maker2).placeLimitOrder(SYMBOL, false, collat, 1, ethers.parseUnits("99000", 18));

            const tx = await router.matchAndExecute(SYMBOL);
            const receipt = await tx.wait();
            const matched = receipt.logs.map(l => { try { return router.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find(e => e.name === "OrdersMatched");
            expect(matched).to.not.be.undefined;
        });

        it("matchAndExecute reverts for non-keeper", async () => {
            await expect(router.connect(taker).matchAndExecute(SYMBOL)).to.be.revertedWith("Router: not keeper");
        });

        it("matchAndExecute reverts for unregistered asset", async () => {
            await expect(router.matchAndExecute("FAKE")).to.be.revertedWith("Router: asset not registered");
        });
    });

    // ═══════════ VIEW FUNCTIONS ═══════════

    describe("View Functions", function () {
        it("getBookDepth returns correct bid/ask counts", async () => {
            const collat = ethers.parseUnits("50", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat * 3n);
            await router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 1, PRICE);
            await router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 1, PRICE);
            await router.connect(maker).placeLimitOrder(SYMBOL, false, collat, 1, PRICE);

            const [bids, asks] = await router.getBookDepth(SYMBOL);
            expect(bids).to.equal(2n);
            expect(asks).to.equal(1n);
        });

        it("getOrderBookSorted returns sorted arrays", async () => {
            const collat = ethers.parseUnits("50", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat * 2n);
            await router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 1, ethers.parseUnits("99000", 18));
            await router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 1, ethers.parseUnits("98000", 18));

            const [bidIds, bidPrices] = await router.getOrderBookSorted(SYMBOL, 10);
            expect(bidIds.length).to.equal(2);
            expect(bidPrices[0]).to.be.gte(bidPrices[1]);
        });

        it("getSupportedAssetsCount increments on registerAsset", async () => {
            const before = await router.getSupportedAssetsCount();
            await router.registerAsset("ETH");
            expect(await router.getSupportedAssetsCount()).to.equal(before + 1n);
        });

        it("getAssetHash returns non-zero for registered asset", async () => {
            const hash = await router.getAssetHash(SYMBOL);
            expect(hash).to.not.equal(0n);
        });

        it("getAssetHash returns zero for unregistered asset", async () => {
            expect(await router.getAssetHash("FAKE")).to.equal(0n);
        });
    });

    // ═══════════ PARAM VALIDATION ═══════════

    describe("Parameter Validation", function () {
        it("placeLimitOrder reverts with zero collateral", async () => {
            await expect(router.connect(maker).placeLimitOrder(SYMBOL, true, 0, 1, PRICE)).to.be.revertedWith("Router: invalid params");
        });

        it("placeLimitOrder reverts with leverage > 50", async () => {
            const collat = ethers.parseUnits("10", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat);
            await expect(router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 51, PRICE)).to.be.revertedWith("Router: invalid params");
        });

        it("placeLimitOrder reverts with zero price", async () => {
            const collat = ethers.parseUnits("10", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat);
            await expect(router.connect(maker).placeLimitOrder(SYMBOL, true, collat, 1, 0)).to.be.revertedWith("Router: invalid params");
        });

        it("placeLimitOrder reverts for unregistered asset", async () => {
            const collat = ethers.parseUnits("10", 18);
            await aUSD.connect(maker).approve(await router.getAddress(), collat);
            await expect(router.connect(maker).placeLimitOrder("FAKE", true, collat, 1, PRICE)).to.be.revertedWith("Router: asset not registered");
        });

        it("routedMarketOpen reverts with zero collateral", async () => {
            await expect(router.connect(taker).routedMarketOpen(SYMBOL, true, 0, 1)).to.be.revertedWith("Router: invalid params");
        });

        it("routedMarketOpen reverts with leverage > 50", async () => {
            const collat = ethers.parseUnits("10", 18);
            await aUSD.connect(taker).approve(await router.getAddress(), collat);
            await expect(router.connect(taker).routedMarketOpen(SYMBOL, true, collat, 51)).to.be.revertedWith("Router: invalid params");
        });
    });

    // ═══════════ ADMIN ═══════════

    describe("Admin Controls", function () {
        it("setKeeper updates keeper address", async () => {
            await router.setKeeper(taker.address);
            // Now taker can call matchAndExecute
            await oracle.setPrice("ETH", PRICE);
            await router.registerAsset("ETH");
            await expect(router.connect(taker).matchAndExecute("ETH")).to.not.be.reverted;
        });

        it("setKeeper reverts for non-owner", async () => {
            await expect(router.connect(taker).setKeeper(taker.address)).to.be.reverted;
        });

        it("registerAsset reverts for non-owner", async () => {
            await expect(router.connect(taker).registerAsset("SOL")).to.be.reverted;
        });
    });
});
