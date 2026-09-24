const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ConditionalOrderManager — SL/TP Lifecycle", function () {
    let aUSD, oracle, vault, perps, com;
    let owner, user, keeper, attacker;

    const SYMBOL = "ETH";
    const ENTRY_PRICE = ethers.parseUnits("2500", 18);
    const COLLATERAL = ethers.parseUnits("1000", 18);
    const LEVERAGE = 5n;

    let positionId;

    beforeEach(async () => {
        [owner, user, keeper, attacker] = await ethers.getSigners();

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

        // Seed vault with liquidity for payouts
        await aUSD.mint(owner.address, ethers.parseUnits("100000", 18));
        await aUSD.approve(await vault.getAddress(), ethers.parseUnits("50000", 18));
        await vault.deposit(ethers.parseUnits("50000", 18), owner.address);

        // Deploy ConditionalOrderManager
        const COM = await ethers.getContractFactory("ConditionalOrderManager");
        com = await COM.deploy(await perps.getAddress(), await oracle.getAddress());
        await com.setKeeper(keeper.address);

        // Give user funds and open a position
        await aUSD.mint(user.address, ethers.parseUnits("10000", 18));
        await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL);
        const tx = await perps.connect(user).openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
        const receipt = await tx.wait();
        // Extract positionId from event
        const event = receipt.logs.map(l => {
            try { return perps.interface.parseLog(l); } catch { return null; }
        }).filter(Boolean).find(e => e.name === "PositionOpened");
        positionId = event.args.positionId;
    });

    // ═══════════ CREATION ═══════════

    describe("Order Creation", function () {
        it("creates a stop-loss order", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            const tx = await com.connect(user).createOrder(positionId, 0, slPrice); // 0 = STOP_LOSS
            const receipt = await tx.wait();

            const event = receipt.logs.map(l => {
                try { return com.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "OrderCreated");

            expect(event.args.orderId).to.equal(0n);
            expect(event.args.owner).to.equal(user.address);
            expect(event.args.positionId).to.equal(positionId);
            expect(event.args.orderType).to.equal(0n); // STOP_LOSS
            expect(event.args.triggerPrice).to.equal(slPrice);
        });

        it("creates a take-profit order", async () => {
            const tpPrice = ethers.parseUnits("3000", 18);
            await com.connect(user).createOrder(positionId, 1, tpPrice); // 1 = TAKE_PROFIT

            const order = await com.orders(0);
            expect(order.orderType).to.equal(1n);
            expect(order.triggerPrice).to.equal(tpPrice);
            expect(order.status).to.equal(0n); // ACTIVE
        });

        it("reverts if trigger price is zero", async () => {
            await expect(
                com.connect(user).createOrder(positionId, 0, 0)
            ).to.be.revertedWith("COM: invalid trigger price");
        });

        it("reverts if caller is not position owner", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            await expect(
                com.connect(attacker).createOrder(positionId, 0, slPrice)
            ).to.be.revertedWith("COM: not position owner");
        });

        it("reverts if position is not open", async () => {
            // Close the position first
            await perps.connect(user).closePosition(positionId);
            const slPrice = ethers.parseUnits("2200", 18);
            await expect(
                com.connect(user).createOrder(positionId, 0, slPrice)
            ).to.be.revertedWith("COM: position not open");
        });

        it("createOrderFor allows keeper to create on behalf of user", async () => {
            const tpPrice = ethers.parseUnits("3500", 18);
            await com.connect(keeper).createOrderFor(user.address, positionId, 1, tpPrice);

            const order = await com.orders(0);
            expect(order.owner).to.equal(user.address);
            expect(order.triggerPrice).to.equal(tpPrice);
        });

        it("createOrderFor reverts if owner doesn't match position", async () => {
            const tpPrice = ethers.parseUnits("3500", 18);
            await expect(
                com.connect(keeper).createOrderFor(attacker.address, positionId, 1, tpPrice)
            ).to.be.revertedWith("COM: owner mismatch");
        });

        it("createOrderFor reverts if caller is not keeper", async () => {
            const tpPrice = ethers.parseUnits("3500", 18);
            await expect(
                com.connect(attacker).createOrderFor(user.address, positionId, 1, tpPrice)
            ).to.be.revertedWith("COM: not keeper");
        });
    });

    // ═══════════ CANCELLATION ═══════════

    describe("Order Cancellation", function () {
        beforeEach(async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            await com.connect(user).createOrder(positionId, 0, slPrice);
        });

        it("owner can cancel their order", async () => {
            await com.connect(user).cancelOrder(0);
            const order = await com.orders(0);
            expect(order.status).to.equal(2n); // CANCELLED
        });

        it("emits OrderCancelled event", async () => {
            await expect(com.connect(user).cancelOrder(0))
                .to.emit(com, "OrderCancelled")
                .withArgs(0n, user.address);
        });

        it("reverts if non-owner tries to cancel", async () => {
            await expect(
                com.connect(attacker).cancelOrder(0)
            ).to.be.revertedWith("COM: not owner");
        });

        it("reverts if order is already cancelled", async () => {
            await com.connect(user).cancelOrder(0);
            await expect(
                com.connect(user).cancelOrder(0)
            ).to.be.revertedWith("COM: not active");
        });
    });

    // ═══════════ EXECUTION ═══════════

    describe("Order Execution", function () {
        it("executes stop-loss when price drops below trigger (long)", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            // Set triggers on AuraPerps so executeTriggerOrder works
            await perps.connect(user).setTriggerOrders(positionId, 0, slPrice);
            await com.connect(user).createOrder(positionId, 0, slPrice);

            // Price drops to 2100 — below SL
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));

            await expect(com.connect(keeper).executeOrder(0))
                .to.emit(com, "OrderExecuted")
                .withArgs(0n, keeper.address, positionId);

            const order = await com.orders(0);
            expect(order.status).to.equal(1n); // EXECUTED
            expect(order.executedAt).to.be.gt(0n);
        });

        it("executes take-profit when price rises above trigger (long)", async () => {
            const tpPrice = ethers.parseUnits("3000", 18);
            await perps.connect(user).setTriggerOrders(positionId, tpPrice, 0);
            await com.connect(user).createOrder(positionId, 1, tpPrice);

            // Ensure vault has enough to pay profit, and perps has enough for fee transfer
            await aUSD.mint(await vault.getAddress(), ethers.parseUnits("50000", 18));
            await aUSD.mint(await perps.getAddress(), ethers.parseUnits("10000", 18));

            // Price rises to 3100
            await oracle.setPrice(SYMBOL, ethers.parseUnits("3100", 18));

            await com.connect(keeper).executeOrder(0);

            const order = await com.orders(0);
            expect(order.status).to.equal(1n); // EXECUTED
        });

        it("reverts if trigger not met", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            await com.connect(user).createOrder(positionId, 0, slPrice);

            // Price is still at 2500 — above SL
            await expect(
                com.connect(keeper).executeOrder(0)
            ).to.be.revertedWith("COM: trigger not met");
        });

        it("reverts if order already executed", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            await perps.connect(user).setTriggerOrders(positionId, 0, slPrice);
            await com.connect(user).createOrder(positionId, 0, slPrice);
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));

            await com.connect(keeper).executeOrder(0);
            await expect(
                com.connect(keeper).executeOrder(0)
            ).to.be.revertedWith("COM: not active");
        });

        it("reverts if non-keeper tries to execute", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            await com.connect(user).createOrder(positionId, 0, slPrice);
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));

            await expect(
                com.connect(attacker).executeOrder(0)
            ).to.be.revertedWith("COM: not keeper");
        });

        it("reverts if position was closed externally", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            await com.connect(user).createOrder(positionId, 0, slPrice);

            // User closes position manually
            await perps.connect(user).closePosition(positionId);

            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));
            await expect(
                com.connect(keeper).executeOrder(0)
            ).to.be.revertedWith("COM: position closed");
        });
    });

    // ═══════════ SHORT POSITION TRIGGERS ═══════════

    describe("Short Position Triggers", function () {
        let shortPositionId;

        beforeEach(async () => {
            // Open a short position
            await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL);
            const tx = await perps.connect(user).openPosition(SYMBOL, false, COLLATERAL, LEVERAGE);
            const receipt = await tx.wait();
            const event = receipt.logs.map(l => {
                try { return perps.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "PositionOpened");
            shortPositionId = event.args.positionId;
        });

        it("stop-loss triggers when price RISES above trigger (short)", async () => {
            const slPrice = ethers.parseUnits("2800", 18);
            await perps.connect(user).setTriggerOrders(shortPositionId, 0, slPrice);
            await com.connect(user).createOrder(shortPositionId, 0, slPrice);

            // Price rises to 2900 — bad for short, SL triggers
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2900", 18));

            await com.connect(keeper).executeOrder(0);
            const order = await com.orders(0);
            expect(order.status).to.equal(1n);
        });

        it("take-profit triggers when price DROPS below trigger (short)", async () => {
            const tpPrice = ethers.parseUnits("2000", 18);
            await perps.connect(user).setTriggerOrders(shortPositionId, tpPrice, 0);
            await com.connect(user).createOrder(shortPositionId, 1, tpPrice);

            // Price drops to 1900 — good for short, TP triggers
            await oracle.setPrice(SYMBOL, ethers.parseUnits("1900", 18));

            await com.connect(keeper).executeOrder(0);
            const order = await com.orders(0);
            expect(order.status).to.equal(1n);
        });
    });

    // ═══════════ VIEW FUNCTIONS ═══════════

    describe("View Functions", function () {
        beforeEach(async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            const tpPrice = ethers.parseUnits("3000", 18);
            await com.connect(user).createOrder(positionId, 0, slPrice);
            await com.connect(user).createOrder(positionId, 1, tpPrice);
        });

        it("getUserOrders returns all user order IDs", async () => {
            const ids = await com.getUserOrders(user.address);
            expect(ids.length).to.equal(2);
            expect(ids[0]).to.equal(0n);
            expect(ids[1]).to.equal(1n);
        });

        it("getActiveOrderCount returns correct count", async () => {
            expect(await com.getActiveOrderCount(user.address)).to.equal(2n);
            await com.connect(user).cancelOrder(0);
            expect(await com.getActiveOrderCount(user.address)).to.equal(1n);
        });

        it("isTriggered returns false when price hasn't hit trigger", async () => {
            expect(await com.isTriggered(0)).to.equal(false); // SL at 2200, price at 2500
            expect(await com.isTriggered(1)).to.equal(false); // TP at 3000, price at 2500
        });

        it("isTriggered returns true when SL is hit", async () => {
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));
            expect(await com.isTriggered(0)).to.equal(true);
        });

        it("isTriggered returns true when TP is hit", async () => {
            await oracle.setPrice(SYMBOL, ethers.parseUnits("3100", 18));
            expect(await com.isTriggered(1)).to.equal(true);
        });

        it("getExecutableOrders returns triggered orders", async () => {
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));
            const executable = await com.getExecutableOrders(SYMBOL, 10);
            expect(executable.length).to.equal(1);
            expect(executable[0]).to.equal(0n); // Only SL triggered
        });

        it("getExecutableOrders returns empty when nothing triggered", async () => {
            const executable = await com.getExecutableOrders(SYMBOL, 10);
            expect(executable.length).to.equal(0);
        });
    });

    // ═══════════ EDGE CASES ═══════════

    describe("Edge Cases", function () {
        it("multiple orders on same position", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            const tpPrice = ethers.parseUnits("3000", 18);
            await com.connect(user).createOrder(positionId, 0, slPrice);
            await com.connect(user).createOrder(positionId, 1, tpPrice);

            expect(await com.nextOrderId()).to.equal(2n);
            expect(await com.getActiveOrderCount(user.address)).to.equal(2n);
        });

        it("order ID increments correctly", async () => {
            const price1 = ethers.parseUnits("2200", 18);
            const price2 = ethers.parseUnits("2100", 18);
            await com.connect(user).createOrder(positionId, 0, price1);
            await com.connect(user).createOrder(positionId, 0, price2);

            const order0 = await com.orders(0);
            const order1 = await com.orders(1);
            expect(order0.triggerPrice).to.equal(price1);
            expect(order1.triggerPrice).to.equal(price2);
        });

        it("trigger at exact price boundary", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            await com.connect(user).createOrder(positionId, 0, slPrice);

            // Price exactly at trigger
            await oracle.setPrice(SYMBOL, slPrice);
            expect(await com.isTriggered(0)).to.equal(true);
        });

        it("cancelled order is not returned by getExecutableOrders", async () => {
            const slPrice = ethers.parseUnits("2200", 18);
            await com.connect(user).createOrder(positionId, 0, slPrice);
            await com.connect(user).cancelOrder(0);

            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));
            const executable = await com.getExecutableOrders(SYMBOL, 10);
            expect(executable.length).to.equal(0);
        });
    });
});
