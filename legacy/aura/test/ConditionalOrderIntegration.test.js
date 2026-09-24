const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Integration: NLP → ConditionalOrder → Keeper Execution", function () {
    let aUSD, oracle, vault, perps, com;
    let owner, user, keeper;

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

        // Seed vault
        await aUSD.mint(owner.address, ethers.parseUnits("100000", 18));
        await aUSD.approve(await vault.getAddress(), ethers.parseUnits("50000", 18));
        await vault.deposit(ethers.parseUnits("50000", 18), owner.address);

        // Deploy COM
        const COM = await ethers.getContractFactory("ConditionalOrderManager");
        com = await COM.deploy(await perps.getAddress(), await oracle.getAddress());
        await com.setKeeper(keeper.address);

        // Give user funds
        await aUSD.mint(user.address, ethers.parseUnits("10000", 18));
    });


    describe("E2E: Stop-Loss on Long Position", function () {
        it("full flow: open position → set SL → price drops → keeper executes", async () => {
            // 1. User opens a LONG position
            await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL);
            const openTx = await perps.connect(user).openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
            const openReceipt = await openTx.wait();
            const posEvent = openReceipt.logs.map(l => {
                try { return perps.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "PositionOpened");
            const positionId = posEvent.args.positionId;

            // Verify position is open
            const pos = await perps.positions(positionId);
            expect(pos.isOpen).to.equal(true);
            expect(pos.isLong).to.equal(true);

            // 2. User sets SL at $2200 via AuraPerps (simulates what the agent tx would do)
            const slPrice = ethers.parseUnits("2200", 18);
            await perps.connect(user).setTriggerOrders(positionId, 0, slPrice);

            // 3. User also registers with ConditionalOrderManager (keeper monitoring)
            await com.connect(user).createOrder(positionId, 0, slPrice);
            expect(await com.getActiveOrderCount(user.address)).to.equal(1n);

            // 4. Price drops to $2100 — SL should trigger
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));

            // 5. Verify trigger is detected
            expect(await com.isTriggered(0)).to.equal(true);
            const executable = await com.getExecutableOrders(SYMBOL, 10);
            expect(executable.length).to.equal(1);

            // 6. Keeper executes
            await com.connect(keeper).executeOrder(0);

            // 7. Verify position is closed
            const closedPos = await perps.positions(positionId);
            expect(closedPos.isOpen).to.equal(false);

            // 8. Verify order status is EXECUTED
            const order = await com.orders(0);
            expect(order.status).to.equal(1n);
        });
    });

    describe("E2E: Take-Profit on Short Position", function () {
        it("full flow: open short → set TP → price drops → keeper executes", async () => {
            // 1. User opens a SHORT position
            await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL);
            const openTx = await perps.connect(user).openPosition(SYMBOL, false, COLLATERAL, LEVERAGE);
            const openReceipt = await openTx.wait();
            const posEvent = openReceipt.logs.map(l => {
                try { return perps.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "PositionOpened");
            const positionId = posEvent.args.positionId;

            // 2. Set TP at $2000 (short profits when price drops)
            const tpPrice = ethers.parseUnits("2000", 18);
            await perps.connect(user).setTriggerOrders(positionId, tpPrice, 0);
            await com.connect(user).createOrder(positionId, 1, tpPrice);

            // 3. Ensure perps has enough aUSD for fee transfer on profitable close
            await aUSD.mint(await perps.getAddress(), ethers.parseUnits("10000", 18));
            await aUSD.mint(await vault.getAddress(), ethers.parseUnits("50000", 18));

            // 4. Price drops to $1900
            await oracle.setPrice(SYMBOL, ethers.parseUnits("1900", 18));

            // 5. Keeper executes
            expect(await com.isTriggered(0)).to.equal(true);
            await com.connect(keeper).executeOrder(0);

            // 6. Position closed with profit
            const closedPos = await perps.positions(positionId);
            expect(closedPos.isOpen).to.equal(false);
        });
    });

    describe("E2E: Keeper createOrderFor (gasless flow)", function () {
        it("keeper creates order on behalf of user, then executes when triggered", async () => {
            // 1. User opens position
            await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL);
            const openTx = await perps.connect(user).openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
            const openReceipt = await openTx.wait();
            const posEvent = openReceipt.logs.map(l => {
                try { return perps.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "PositionOpened");
            const positionId = posEvent.args.positionId;

            // 2. User sets triggers on AuraPerps (required for executeTriggerOrder)
            const slPrice = ethers.parseUnits("2300", 18);
            await perps.connect(user).setTriggerOrders(positionId, 0, slPrice);

            // 3. Keeper creates the monitoring order (simulates gasless AI agent flow)
            await com.connect(keeper).createOrderFor(user.address, positionId, 0, slPrice);

            // 4. Price drops
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2250", 18));

            // 5. Keeper executes
            await com.connect(keeper).executeOrder(0);

            const closedPos = await perps.positions(positionId);
            expect(closedPos.isOpen).to.equal(false);
        });
    });

    describe("E2E: Multiple positions, only triggered ones execute", function () {
        it("two positions with different SLs, only one triggers", async () => {
            // Position 1: SL at $2200
            await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL * 2n);
            const tx1 = await perps.connect(user).openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
            const r1 = await tx1.wait();
            const pos1Id = r1.logs.map(l => {
                try { return perps.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "PositionOpened").args.positionId;

            // Position 2: SL at $2000
            const tx2 = await perps.connect(user).openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
            const r2 = await tx2.wait();
            const pos2Id = r2.logs.map(l => {
                try { return perps.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "PositionOpened").args.positionId;

            await perps.connect(user).setTriggerOrders(pos1Id, 0, ethers.parseUnits("2200", 18));
            await perps.connect(user).setTriggerOrders(pos2Id, 0, ethers.parseUnits("2000", 18));

            await com.connect(user).createOrder(pos1Id, 0, ethers.parseUnits("2200", 18));
            await com.connect(user).createOrder(pos2Id, 0, ethers.parseUnits("2000", 18));

            // Price drops to 2100 — only pos1 SL triggers
            await oracle.setPrice(SYMBOL, ethers.parseUnits("2100", 18));

            const executable = await com.getExecutableOrders(SYMBOL, 10);
            expect(executable.length).to.equal(1);
            expect(executable[0]).to.equal(0n); // order for pos1

            // Execute only the triggered one
            await com.connect(keeper).executeOrder(0);

            // pos1 closed, pos2 still open
            expect((await perps.positions(pos1Id)).isOpen).to.equal(false);
            expect((await perps.positions(pos2Id)).isOpen).to.equal(true);
        });
    });
});
