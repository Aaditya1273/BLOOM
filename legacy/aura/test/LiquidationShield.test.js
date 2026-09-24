const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidationShield — Mandate Registry", function () {
    let aUSD, oracle, vault, perps, shield;
    let owner, user, attacker, keeper;
    let positionId;

    const SYMBOL = "ETH";
    const ENTRY_PRICE = ethers.parseUnits("2500", 18);
    const COLLATERAL = ethers.parseUnits("1000", 18);
    const LEVERAGE = 5n;

    beforeEach(async () => {
        [owner, user, attacker, keeper] = await ethers.getSigners();

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

        // Seed vault liquidity
        await aUSD.mint(owner.address, ethers.parseUnits("100000", 18));
        await aUSD.approve(await vault.getAddress(), ethers.parseUnits("50000", 18));
        await vault.deposit(ethers.parseUnits("50000", 18), owner.address);

        // Deploy shield
        const Shield = await ethers.getContractFactory("LiquidationShield");
        shield = await Shield.deploy(await perps.getAddress());
        await shield.setKeeper(keeper.address);

        // Open a long position for the user
        await aUSD.mint(user.address, ethers.parseUnits("10000", 18));
        await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL);
        const tx = await perps.connect(user).openPosition(SYMBOL, true, COLLATERAL, LEVERAGE);
        const receipt = await tx.wait();
        const event = receipt.logs.map(l => {
            try { return perps.interface.parseLog(l); } catch { return null; }
        }).filter(Boolean).find(e => e.name === "PositionOpened");
        positionId = event.args.positionId;
    });


    describe("armShield", function () {
        const RECOMMENDED = ethers.parseUnits("100", 18);
        const MAX_PER_EVENT = ethers.parseUnits("500", 18);

        it("arms the shield with custom threshold", async () => {
            const tx = await shield.connect(user).armShield(positionId, 1500, RECOMMENDED, MAX_PER_EVENT);
            const receipt = await tx.wait();
            const event = receipt.logs.map(l => {
                try { return shield.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "ShieldArmed");

            expect(event.args.positionId).to.equal(positionId);
            expect(event.args.owner).to.equal(user.address);
            expect(event.args.thresholdBps).to.equal(1500n);
            expect(event.args.recommendedTopUp).to.equal(RECOMMENDED);

            const m = await shield.mandates(positionId);
            expect(m.armed).to.equal(true);
            expect(m.thresholdBps).to.equal(1500n);
        });

        it("uses default threshold (2000 bps) when 0 passed", async () => {
            await shield.connect(user).armShield(positionId, 0, RECOMMENDED, MAX_PER_EVENT);
            const m = await shield.mandates(positionId);
            expect(m.thresholdBps).to.equal(2000n);
        });

        it("registers position in userMandates list", async () => {
            await shield.connect(user).armShield(positionId, 0, RECOMMENDED, MAX_PER_EVENT);
            const ids = await shield.getUserMandates(user.address);
            expect(ids.length).to.equal(1);
            expect(ids[0]).to.equal(positionId);
        });

        it("re-arming updates the mandate without duplicating in user list", async () => {
            await shield.connect(user).armShield(positionId, 1500, RECOMMENDED, MAX_PER_EVENT);
            const newRecommended = ethers.parseUnits("200", 18);
            await shield.connect(user).armShield(positionId, 2500, newRecommended, MAX_PER_EVENT);

            const m = await shield.mandates(positionId);
            expect(m.thresholdBps).to.equal(2500n);
            expect(m.recommendedTopUp).to.equal(newRecommended);

            const ids = await shield.getUserMandates(user.address);
            expect(ids.length).to.equal(1); // not duplicated
        });

        it("reverts if caller is not the position owner", async () => {
            await expect(
                shield.connect(attacker).armShield(positionId, 0, RECOMMENDED, MAX_PER_EVENT)
            ).to.be.revertedWith("Shield: not position owner");
        });

        it("reverts if position is not open", async () => {
            await perps.connect(user).closePosition(positionId);
            await expect(
                shield.connect(user).armShield(positionId, 0, RECOMMENDED, MAX_PER_EVENT)
            ).to.be.revertedWith("Shield: position not open");
        });

        it("reverts if recommended is zero", async () => {
            await expect(
                shield.connect(user).armShield(positionId, 0, 0, MAX_PER_EVENT)
            ).to.be.revertedWith("Shield: invalid recommended amount");
        });

        it("reverts if max < recommended (sanity check)", async () => {
            await expect(
                shield.connect(user).armShield(positionId, 0, MAX_PER_EVENT, RECOMMENDED)
            ).to.be.revertedWith("Shield: max < recommended");
        });

        it("reverts if threshold > 90% (sanity cap)", async () => {
            await expect(
                shield.connect(user).armShield(positionId, 9500, RECOMMENDED, MAX_PER_EVENT)
            ).to.be.revertedWith("Shield: threshold too high");
        });
    });

    describe("disarmShield", function () {
        beforeEach(async () => {
            await shield.connect(user).armShield(
                positionId, 0,
                ethers.parseUnits("100", 18),
                ethers.parseUnits("500", 18)
            );
        });

        it("owner can disarm", async () => {
            await expect(shield.connect(user).disarmShield(positionId))
                .to.emit(shield, "ShieldDisarmed")
                .withArgs(positionId, user.address);

            const m = await shield.mandates(positionId);
            expect(m.armed).to.equal(false);
        });

        it("reverts if not armed", async () => {
            await shield.connect(user).disarmShield(positionId);
            await expect(
                shield.connect(user).disarmShield(positionId)
            ).to.be.revertedWith("Shield: not armed");
        });

        it("reverts if caller is not position owner", async () => {
            await expect(
                shield.connect(attacker).disarmShield(positionId)
            ).to.be.revertedWith("Shield: not position owner");
        });
    });


    describe("recordAlert", function () {
        const THRESHOLD = 2000n; // 20%
        const RECOMMENDED = ethers.parseUnits("100", 18);
        const MAX_PER_EVENT = ethers.parseUnits("500", 18);

        beforeEach(async () => {
            await shield.connect(user).armShield(positionId, THRESHOLD, RECOMMENDED, MAX_PER_EVENT);
        });

        it("keeper can record an alert when threshold is breached", async () => {
            const healthBps = 1500; // 15% — below 20% threshold
            await expect(shield.connect(keeper).recordAlert(positionId, healthBps))
                .to.emit(shield, "AlertEmitted")
                .withArgs(positionId, user.address, healthBps, RECOMMENDED);
        });

        it("reverts if health >= threshold (no alert needed)", async () => {
            await expect(
                shield.connect(keeper).recordAlert(positionId, 2500)
            ).to.be.revertedWith("Shield: threshold not breached");
        });

        it("reverts if mandate not armed", async () => {
            await shield.connect(user).disarmShield(positionId);
            await expect(
                shield.connect(keeper).recordAlert(positionId, 1500)
            ).to.be.revertedWith("Shield: not armed");
        });

        it("reverts if position not open", async () => {
            await perps.connect(user).closePosition(positionId);
            await expect(
                shield.connect(keeper).recordAlert(positionId, 1500)
            ).to.be.revertedWith("Shield: position not open");
        });

        it("reverts if non-keeper tries to record", async () => {
            await expect(
                shield.connect(attacker).recordAlert(positionId, 1500)
            ).to.be.revertedWith("Shield: not keeper");
        });

        it("owner can also record (admin override)", async () => {
            await expect(shield.connect(owner).recordAlert(positionId, 1000))
                .to.emit(shield, "AlertEmitted");
        });
    });

    describe("View functions", function () {
        const RECOMMENDED = ethers.parseUnits("100", 18);
        const MAX_PER_EVENT = ethers.parseUnits("500", 18);

        it("getMandate returns full struct", async () => {
            await shield.connect(user).armShield(positionId, 1500, RECOMMENDED, MAX_PER_EVENT);
            const m = await shield.getMandate(positionId);
            expect(m.armed).to.equal(true);
            expect(m.thresholdBps).to.equal(1500n);
            expect(m.recommendedTopUp).to.equal(RECOMMENDED);
            expect(m.maxTopUpPerEvent).to.equal(MAX_PER_EVENT);
        });

        it("getActiveMandates filters out disarmed entries", async () => {
            // Arm two positions for the same user
            await shield.connect(user).armShield(positionId, 0, RECOMMENDED, MAX_PER_EVENT);

            await aUSD.connect(user).approve(await perps.getAddress(), COLLATERAL);
            const tx2 = await perps.connect(user).openPosition(SYMBOL, false, COLLATERAL, LEVERAGE);
            const r2 = await tx2.wait();
            const pos2Id = r2.logs.map(l => {
                try { return perps.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean).find(e => e.name === "PositionOpened").args.positionId;

            await shield.connect(user).armShield(pos2Id, 0, RECOMMENDED, MAX_PER_EVENT);

            // Disarm the first
            await shield.connect(user).disarmShield(positionId);

            const active = await shield.getActiveMandates(user.address);
            expect(active.length).to.equal(1);
            expect(active[0]).to.equal(pos2Id);

            const all = await shield.getUserMandates(user.address);
            expect(all.length).to.equal(2); // disarmed entries are still listed
        });
    });

    describe("Access control", function () {
        it("only owner can change keeper", async () => {
            await expect(
                shield.connect(attacker).setKeeper(attacker.address)
            ).to.be.reverted;
        });

        it("owner can change keeper", async () => {
            await shield.connect(owner).setKeeper(attacker.address);
            expect(await shield.keeper()).to.equal(attacker.address);
        });
    });
});
