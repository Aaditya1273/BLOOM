const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Hybrid LOB+AMM — routedMarketOpen", function () {
    let aUSD, oracle, vault, perps, lob, router, mmFund;
    let owner, taker, maker, mmAgent;

    const SYMBOL = "BTC";
    const PRICE_AT_OPEN = ethers.parseUnits("100000", 18);

    beforeEach(async () => {
        [owner, taker, maker, mmAgent] = await ethers.getSigners();

        const AUSD = await ethers.getContractFactory("aUSD");
        aUSD = await AUSD.deploy();

        const Oracle = await ethers.getContractFactory("MockOracle");
        oracle = await Oracle.deploy();
        await oracle.setPrice(SYMBOL, PRICE_AT_OPEN);

        const Vault = await ethers.getContractFactory("AuraVault");
        vault = await Vault.deploy(await aUSD.getAddress());

        const Perps = await ethers.getContractFactory("AuraPerps");
        perps = await Perps.deploy(await aUSD.getAddress(), await oracle.getAddress(), await vault.getAddress());
        await vault.setAuraPerps(await perps.getAddress());

        const LOB = await ethers.getContractFactory("AuraOrderBook");
        lob = await LOB.deploy();

        const Router = await ethers.getContractFactory("AuraPerpsRouter");
        router = await Router.deploy(
            await aUSD.getAddress(),
            await lob.getAddress(),
            await perps.getAddress(),
            await oracle.getAddress(),
        );
        await lob.initialize(await router.getAddress(), owner.address);
        await perps.setRouter(await router.getAddress());
        await router.registerAsset(SYMBOL);

        const MMFund = await ethers.getContractFactory("AuraMMFund");
        mmFund = await MMFund.deploy(await aUSD.getAddress(), await router.getAddress());
        await mmFund.setAgent(mmAgent.address);
        await router.setMmAgent(mmAgent.address);

        // Seed everyone.
        await aUSD.mint(taker.address, ethers.parseUnits("10000", 18));
        await aUSD.mint(maker.address, ethers.parseUnits("10000", 18));
        await aUSD.mint(owner.address, ethers.parseUnits("100000", 18));

        // Vault liquidity for the fallback path.
        await aUSD.approve(await vault.getAddress(), ethers.parseUnits("50000", 18));
        await vault.deposit(ethers.parseUnits("50000", 18), owner.address);
    });

    it("opens taker fully on book when book has enough depth", async () => {
        // Maker places an ASK at 100k for 100 aUSD * 1x = 100 size.
        const makerCollat = ethers.parseUnits("100", 18);
        await aUSD.connect(maker).approve(await router.getAddress(), makerCollat);
        await router.connect(maker).placeLimitOrder(SYMBOL, false, makerCollat, 1, PRICE_AT_OPEN);

        // Taker buys 1x with 100 aUSD → 100 size, perfectly matched against book.
        const takerCollat = ethers.parseUnits("100", 18);
        await aUSD.connect(taker).approve(await router.getAddress(), takerCollat);
        const tx = await router.connect(taker).routedMarketOpen(SYMBOL, true, takerCollat, 1);
        const receipt = await tx.wait();

        // PositionOpened fired twice (maker + taker). MarketOrderRouted has bookFilledSize > 0 and fallbackSize = 0.
        const routed = receipt.logs.map(l => {
            try { return router.interface.parseLog(l); } catch { return null; }
        }).filter(Boolean).find(e => e.name === "MarketOrderRouted");
        expect(routed).to.not.be.undefined;
        expect(routed.args.bookFilledSize).to.equal(makerCollat); // 100 size
        expect(routed.args.fallbackSize).to.equal(0n);
        expect(routed.args.makerFills).to.equal(1n);
    });

    it("falls back to Vault LP when book is empty", async () => {
        const takerCollat = ethers.parseUnits("100", 18);
        await aUSD.connect(taker).approve(await router.getAddress(), takerCollat);
        const tx = await router.connect(taker).routedMarketOpen(SYMBOL, true, takerCollat, 2);
        const receipt = await tx.wait();

        const routed = receipt.logs.map(l => {
            try { return router.interface.parseLog(l); } catch { return null; }
        }).filter(Boolean).find(e => e.name === "MarketOrderRouted");
        expect(routed.args.bookFilledSize).to.equal(0n);
        expect(routed.args.fallbackSize).to.equal(takerCollat * 2n);
        expect(routed.args.makerFills).to.equal(0n);
    });

    it("placeLimitOrderFor pulls from MMFund when called by mmAgent", async () => {
        // Seed and configure the MM fund.
        await aUSD.mint(owner.address, ethers.parseUnits("2000", 18));
        await aUSD.approve(await mmFund.getAddress(), ethers.parseUnits("2000", 18));
        await mmFund.deposit(ethers.parseUnits("2000", 18));
        await mmFund.connect(mmAgent).approveRouter(ethers.parseUnits("2000", 18));

        const collat = ethers.parseUnits("50", 18);
        const limitPrice = ethers.parseUnits("99000", 18);

        const fundBefore = await aUSD.balanceOf(await mmFund.getAddress());
        await router.connect(mmAgent).placeLimitOrderFor(
            await mmFund.getAddress(), SYMBOL, true, collat, 1, limitPrice
        );
        const fundAfter = await aUSD.balanceOf(await mmFund.getAddress());

        expect(fundBefore - fundAfter).to.equal(collat);

        // Cancelling refunds the MMFund (the order's owner).
        // First locate the order id from event.
        // (For brevity here we just assert a depth bump.)
        const [bids,] = await router.getBookDepth(SYMBOL);
        expect(bids).to.equal(1n);
    });

    it("rejects placeLimitOrderFor from a non-agent caller", async () => {
        const collat = ethers.parseUnits("10", 18);
        await aUSD.connect(maker).approve(await router.getAddress(), collat);
        await expect(
            router.connect(maker).placeLimitOrderFor(maker.address, SYMBOL, true, collat, 1, PRICE_AT_OPEN)
        ).to.be.revertedWith("Router: not agent");
    });
});
