const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuraOrderBook — Full lifecycle", () => {
    let lob, owner, router, keeper, user1, user2;
    const ASSET_ETH  = ethers.keccak256(ethers.toUtf8Bytes("ETH"));
    const ASSET_BTC  = ethers.keccak256(ethers.toUtf8Bytes("BTC"));
    const ASSET_HASH_ETH = BigInt(ASSET_ETH);
    const ASSET_HASH_BTC = BigInt(ASSET_BTC);

    beforeEach(async () => {
        [owner, router, keeper, user1, user2] = await ethers.getSigners();
        const LOB = await ethers.getContractFactory("AuraOrderBook");
        lob = await LOB.deploy();
        await lob.waitForDeployment();
        await lob.initialize(router.address, keeper.address);
    });

    describe("Initialization", () => {
        it("sets router and keeper correctly", async () => {
            expect(await lob.router()).to.equal(router.address);
            expect(await lob.keeper()).to.equal(keeper.address);
            expect(await lob.initialized()).to.equal(true);
        });

        it("rejects double initialization", async () => {
            await expect(lob.initialize(user1.address, user1.address))
                .to.be.revertedWith("Already initialized");
        });

        it("only owner can change router", async () => {
            await expect(lob.connect(user1).setRouter(user1.address))
                .to.be.reverted;
            await lob.setRouter(user1.address);
            expect(await lob.router()).to.equal(user1.address);
        });
    });

    describe("store_order", () => {
        it("stores a long order from the router", async () => {
            const collateral = ethers.parseUnits("100", 18);
            const limitPrice = ethers.parseUnits("2000", 18);
            const tx = await lob.connect(router).store_order(
                user1.address, ASSET_HASH_ETH, true, collateral, 5, limitPrice
            );
            await tx.wait();

            const order = await lob.get_order(0);
            expect(order[0]).to.equal(user1.address);
            expect(order[1]).to.equal(ASSET_HASH_ETH);
            expect(order[2]).to.equal(true); // isLong
            expect(order[3]).to.equal(collateral);
            expect(order[4]).to.equal(5n); // leverage
            expect(order[5]).to.equal(limitPrice);
            expect(order[7]).to.equal(1n); // STATUS_ACTIVE
        });

        it("rejects store_order from non-router caller", async () => {
            await expect(
                lob.connect(user1).store_order(
                    user1.address, ASSET_HASH_ETH, true, 100, 5, 2000
                )
            ).to.be.revertedWith("Only router");
        });

        it("rejects orders with invalid params", async () => {
            await expect(
                lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 0, 5, 2000)
            ).to.be.revertedWith("Invalid params");
            await expect(
                lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 100, 0, 2000)
            ).to.be.revertedWith("Invalid params");
            await expect(
                lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 100, 5, 0)
            ).to.be.revertedWith("Invalid params");
        });

        it("rejects leverage > 50x", async () => {
            await expect(
                lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 100, 51, 2000)
            ).to.be.revertedWith("Max leverage 50x");
        });

        it("increments active bid/ask counts per asset", async () => {
            await lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 100, 1, 2000);
            await lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 100, 1, 1900);
            await lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, false, 100, 1, 2100);

            const [bids, asks] = await lob.get_book_depth(ASSET_HASH_ETH);
            expect(bids).to.equal(2n);
            expect(asks).to.equal(1n);
        });
    });

    describe("cancel_order", () => {
        beforeEach(async () => {
            await lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 100, 5, 2000);
        });

        it("allows the owner (via router) to cancel an active order", async () => {
            const result = await lob.connect(router).cancel_order.staticCall(0, user1.address);
            expect(result).to.equal(true);

            await lob.connect(router).cancel_order(0, user1.address);
            const order = await lob.get_order(0);
            expect(order[7]).to.equal(0n); // STATUS_CANCELLED
        });

        it("rejects cancel from non-router", async () => {
            await expect(
                lob.connect(user1).cancel_order(0, user1.address)
            ).to.be.revertedWith("Only router");
        });

        it("returns false when caller is not the owner", async () => {
            const result = await lob.connect(router).cancel_order.staticCall(0, user2.address);
            expect(result).to.equal(false);
        });

        it("decrements bid count on cancel", async () => {
            const [bidsBefore] = await lob.get_book_depth(ASSET_HASH_ETH);
            await lob.connect(router).cancel_order(0, user1.address);
            const [bidsAfter] = await lob.get_book_depth(ASSET_HASH_ETH);
            expect(bidsAfter).to.equal(bidsBefore - 1n);
        });
    });

    describe("match_orders", () => {
        beforeEach(async () => {
            // Seed: 3 bids @ 1900, 1950, 2000 ; 2 asks @ 2050, 2100
            for (const p of [1900, 1950, 2000]) {
                await lob.connect(router).store_order(
                    user1.address, ASSET_HASH_ETH, true, 100, 1, ethers.parseUnits(p.toString(), 18)
                );
            }
            for (const p of [2050, 2100]) {
                await lob.connect(router).store_order(
                    user1.address, ASSET_HASH_ETH, false, 100, 1, ethers.parseUnits(p.toString(), 18)
                );
            }
        });

        it("matches bids when current price <= bid limit", async () => {
            // Current price = 1950. Bids @ 1950 and 2000 should match (price <= limit), bid @ 1900 should NOT.
            const matched = await lob.connect(keeper).match_orders.staticCall(
                ASSET_HASH_ETH, ethers.parseUnits("1950", 18)
            );
            expect(matched).to.equal(2n);

            await lob.connect(keeper).match_orders(ASSET_HASH_ETH, ethers.parseUnits("1950", 18));
            const filled = await lob.get_filled_orders(ASSET_HASH_ETH);
            expect(filled.length).to.equal(2);
        });

        it("matches asks when current price >= ask limit", async () => {
            // Current price = 2050. Bids @ 1900,1950,2000 → 2050 NOT <= bid → no fill.
            // Asks: 2050 >= 2050 (yes), 2050 >= 2100 (no) → 1 ask filled.
            const matched = await lob.connect(keeper).match_orders.staticCall(
                ASSET_HASH_ETH, ethers.parseUnits("2050", 18)
            );
            expect(matched).to.equal(1n);
        });

        it("returns 0 when no orders match", async () => {
            // Current price 2030 → no bid filled (1900,1950,2000 are below 2030 → bids only fill if current <= limit, so wait, current > all bids → bids don't match. Asks @ 2050, 2100 → current 2030 < ask, so asks don't match either)
            // Actually: bid at 2000, current 2030 → 2030 > 2000 → not filled (no good for buyer).
            // Asks at 2050 → 2030 < 2050 → not filled.
            const matched = await lob.connect(keeper).match_orders.staticCall(
                ASSET_HASH_ETH, ethers.parseUnits("2030", 18)
            );
            expect(matched).to.equal(0n);
        });

        it("rejects match_orders from non-keeper/non-router", async () => {
            await expect(
                lob.connect(user1).match_orders(ASSET_HASH_ETH, 2000)
            ).to.be.revertedWith("Unauthorized");
        });

        it("does NOT cross-match orders from a different asset", async () => {
            // BTC asset hash, current_price that would match the ETH orders
            await lob.connect(keeper).match_orders(ASSET_HASH_BTC, ethers.parseUnits("1950", 18));
            const ethFilled = await lob.get_filled_orders(ASSET_HASH_ETH);
            expect(ethFilled.length).to.equal(0);
        });
    });

    describe("consume_order", () => {
        beforeEach(async () => {
            await lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 100, 1, 2000);
        });

        it("consumes an active order in one call", async () => {
            const result = await lob.connect(router).consume_order.staticCall(0);
            expect(result).to.equal(true);

            await lob.connect(router).consume_order(0);
            const order = await lob.get_order(0);
            expect(order[7]).to.equal(3n); // STATUS_EXECUTED (skip FILLED)
        });

        it("rejects consume from non-router", async () => {
            await expect(
                lob.connect(user1).consume_order(0)
            ).to.be.revertedWith("Only router");
        });

        it("returns false when order is not ACTIVE", async () => {
            await lob.connect(router).consume_order(0); // first call succeeds
            const result = await lob.connect(router).consume_order.staticCall(0); // 2nd call fails
            expect(result).to.equal(false);
        });
    });

    describe("get_active_orders_sorted", () => {
        beforeEach(async () => {
            // 5 bids @ 1900,1950,2000,1850,1980 — should be sorted desc: 2000,1980,1950,1900,1850
            for (const p of [1900, 1950, 2000, 1850, 1980]) {
                await lob.connect(router).store_order(
                    user1.address, ASSET_HASH_ETH, true, 100, 1, ethers.parseUnits(p.toString(), 18)
                );
            }
        });

        it("returns bids sorted descending (highest first)", async () => {
            const [ids, prices, sizes] = await lob.get_active_orders_sorted(ASSET_HASH_ETH, true, 5);
            expect(prices.map(p => Number(ethers.formatUnits(p, 18)))).to.deep.equal([2000, 1980, 1950, 1900, 1850]);
            expect(ids.length).to.equal(5);
            expect(sizes.length).to.equal(5);
        });

        it("respects max_results cap", async () => {
            const [ids] = await lob.get_active_orders_sorted(ASSET_HASH_ETH, true, 3);
            expect(ids.length).to.equal(3);
        });

        it("returns empty array when no orders match", async () => {
            const [ids] = await lob.get_active_orders_sorted(ASSET_HASH_BTC, true, 5);
            expect(ids.length).to.equal(0);
        });
    });

    describe("Stats and views", () => {
        it("tracks total orders placed and filled", async () => {
            // Place a bid that WILL match: bid @2100, current 2050 → 2050 <= 2100 → fill
            await lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, true, 100, 1, ethers.parseUnits("2100", 18));
            // And an ask that WILL match: ask @2000, current 2050 → 2050 >= 2000 → fill
            await lob.connect(router).store_order(user1.address, ASSET_HASH_ETH, false, 100, 1, ethers.parseUnits("2000", 18));

            await lob.connect(keeper).match_orders(ASSET_HASH_ETH, ethers.parseUnits("2050", 18));

            const [next, placed, filled] = await lob.get_stats();
            expect(next).to.equal(2n);
            expect(placed).to.equal(2n);
            expect(filled).to.equal(2n); // both should fill
        });
    });
});
