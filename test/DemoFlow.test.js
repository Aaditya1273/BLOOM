// The 90-second testnet demo, end to end, against the same deployment code used for testnet.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { load, usd, time, S } = require("./fixtures");

const USD = (n) => ethers.parseUnits(String(n), 18);

describe("Demo flow — the 90-second Bloom story", function () {
  it("mint -> deposit $100 -> laptop goal -> agent -> send $5 QQQ -> risk NORMAL -> HALT -> reset", async () => {
    const f = await load();
    const { usdg, vault, factory, policy, router, stocks, engine, alice, bob, admin } = f;

    // STEP 1: mint test USDG to the user's smart account
    await factory.createAccount(alice.address, 0);
    const account = await ethers.getContractAt("BloomAccount", await factory.accountAddress(alice.address, 0));
    await usdg.mint(account.target, usd(1000));

    // STEP 2: owner deposits $100 into savings (approve + deposit in one owner batch)
    await account.connect(alice).executeBatch([
      { target: usdg.target, value: 0, data: usdg.interface.encodeFunctionData("approve", [vault.target, usd(100)]) },
      { target: vault.target, value: 0, data: vault.interface.encodeFunctionData("deposit", [usd(100), account.target]) },
    ]);
    expect(await vault.convertToAssets(await vault.balanceOf(account.target))).to.equal(usd(100));

    // STEP 3: portfolio (some QQQ bought via the venue by the owner)
    await stocks.QQQ.token.mint(account.target, ethers.parseUnits("0.2", 18));
    const [stockUsd, totalUsd, priced] = await policy.portfolioValue(account.target);
    expect(priced).to.equal(true);
    expect(stockUsd).to.equal(USD(571.3) * 2n / 10n);
    expect(totalUsd).to.equal(USD(900) + USD(100) + stockUsd);

    // STEP 4-5: "Save $500 for my laptop by December 15." -> policy -> agent activation
    const agent = ethers.Wallet.createRandom().connect(ethers.provider);
    await admin.sendTransaction({ to: agent.address, value: ethers.parseEther("1") });
    const deadline = (await time.latest()) + 80 * 86400;
    await expect(policy.connect(alice).createGoal(account.target, {
      name: ethers.encodeBytes32String("Laptop"), targetAmount: usd(500), deadline,
      maxPerTxUsd: USD(50), dailyCapUsd: USD(50), maxStockAllocationBps: 3000,
      allowedAssets: [usdg.target, stocks.QQQ.token.target, stocks.NVDA.token.target],
    })).to.emit(policy, "GoalCreated");
    await expect(policy.connect(alice).activateGoal(1, agent.address)).to.emit(policy, "GoalActivated");

    // STEP 6: "Send Sarah $5 of QQQ." -> agent executes under policy
    const [, , , , price] = await engine.getRisk(stocks.QQQ.token.target);
    const amount = USD(5) * 10n ** 18n / price;
    const erc20 = new ethers.Interface(["function approve(address,uint256)"]);
    await account.connect(agent).executeByAgent(agent.address, stocks.QQQ.token.target, erc20.encodeFunctionData("approve", [router.target, amount]));
    await expect(account.connect(agent).executeByAgent(agent.address, router.target,
      router.interface.encodeFunctionData("send", [stocks.QQQ.token.target, bob.address, amount, ethers.id("Send Sarah $5 of QQQ.")])))
      .to.emit(account, "ActionExecuted").and.to.emit(router, "Sent");
    expect(await stocks.QQQ.token.balanceOf(bob.address)).to.equal(amount);
    expect(await policy.spentToday(1)).to.be.closeTo(USD(5), USD(0.0001));

    // STEP 7: risk page — AAPL NORMAL, borrowing enabled, 60%
    const aapl = stocks.AAPL.token.target;
    let r = await engine.getRisk(aapl);
    expect([Number(r.state), Number(r.maxLtvBps), r.borrowingAllowed]).to.deep.equal([S.NORMAL, 6000, true]);
    expect(r.price).to.equal(USD(212.41));

    // STEP 8: SIMULATE HALT -> signed report -> HALTED, borrowing disabled, LTV 0
    await expect(f.report("AAPL", { halted: true })).to.emit(engine, "RiskStateChanged").withArgs(aapl, S.NORMAL, S.HALTED);
    r = await engine.getRisk(aapl);
    expect([Number(r.state), Number(r.maxLtvBps), r.borrowingAllowed]).to.deep.equal([S.HALTED, 0, false]);

    // ... and the agent refuses to act on a halted asset
    await f.report("QQQ", { halted: true });
    await expect(account.connect(agent).executeByAgent(agent.address, router.target,
      router.interface.encodeFunctionData("send", [stocks.QQQ.token.target, bob.address, 1n, ethers.ZeroHash])))
      .to.emit(account, "ActionRejected");

    // STEP 9: reset -> NORMAL, borrowing enabled again
    await expect(f.report("AAPL", { halted: false })).to.emit(engine, "RiskStateChanged").withArgs(aapl, S.HALTED, S.NORMAL);
    r = await engine.getRisk(aapl);
    expect([Number(r.state), Number(r.maxLtvBps), r.borrowingAllowed]).to.deep.equal([S.NORMAL, 6000, true]);
  });
});
