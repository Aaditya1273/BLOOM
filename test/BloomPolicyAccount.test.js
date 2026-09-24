const { expect } = require("chai");
const { ethers } = require("hardhat");
const { load, usd, time, S } = require("./fixtures");

const Q = (n) => ethers.parseUnits(String(n), 18);
const USD = (n) => ethers.parseUnits(String(n), 18);
const R = (s) => ethers.encodeBytes32String(s);

async function setup() {
  const f = await load();
  const { factory, usdg, stocks, policy, alice } = f;
  // alice's smart account
  await factory.createAccount(alice.address, 0);
  const account = await ethers.getContractAt("BloomAccount", await factory.accountAddress(alice.address, 0));
  await usdg.mint(account.target, usd(1000));
  await stocks.QQQ.token.mint(account.target, Q(1));
  // the agent session key is a fresh key (never the owner key)
  const agent = ethers.Wallet.createRandom().connect(ethers.provider);
  await f.admin.sendTransaction({ to: agent.address, value: ethers.parseEther("1") });
  const deadline = (await time.latest()) + 60 * 86400;
  await policy.connect(alice).createGoal(account.target, {
    name: R("Laptop"), targetAmount: usd(500), deadline,
    maxPerTxUsd: USD(50), dailyCapUsd: USD(50), maxStockAllocationBps: 3000,
    allowedAssets: [usdg.target, stocks.QQQ.token.target, stocks.NVDA.token.target],
  });
  await policy.connect(alice).activateGoal(1, agent.address);
  const I = {
    erc20: new ethers.Interface(["function approve(address,uint256)", "function transfer(address,uint256)"]),
    vault: f.vault.interface, router: f.router.interface, claims: f.claims.interface,
  };
  const exec = (target, data, signer = agent) => account.connect(signer).executeByAgent(signer.address, target, data);
  return { ...f, account, agent, deadline, I, exec };
}

describe("BloomPolicy + BloomAccount — agent acts only under the user's rules", function () {
  it("goal lifecycle: only the account owner can create/activate/revoke; events emitted", async () => {
    const { policy, account, attacker, alice, agent, usdg } = await setup();
    const p = { name: R("x"), targetAmount: 1, deadline: (await time.latest()) + 100, maxPerTxUsd: 1, dailyCapUsd: 1, maxStockAllocationBps: 0, allowedAssets: [usdg.target] };
    await expect(policy.connect(attacker).createGoal(account.target, p)).to.be.revertedWithCustomError(policy, "NotAccountOwner");
    await expect(policy.connect(attacker).activateGoal(1, attacker.address)).to.be.revertedWithCustomError(policy, "NotAccountOwner");
    await expect(policy.connect(attacker).revokeGoal(1)).to.be.revertedWithCustomError(policy, "NotAccountOwner");
    await expect(policy.connect(alice).createGoal(account.target, p)).to.emit(policy, "GoalCreated");
    await expect(policy.connect(alice).activateGoal(2, ethers.Wallet.createRandom().address)).to.emit(policy, "GoalActivated");
    expect((await policy.sessionOf(account.target, agent.address)).goalId).to.equal(1);
  });

  it("rejects invalid goals (past deadline, caps, too many assets, unsupported asset)", async () => {
    const { policy, account, alice, usdg, attacker } = await setup();
    const now = await time.latest();
    const base = { name: R("x"), targetAmount: 1, deadline: now + 100, maxPerTxUsd: 2, dailyCapUsd: 2, maxStockAllocationBps: 0, allowedAssets: [usdg.target] };
    await expect(policy.connect(alice).createGoal(account.target, { ...base, deadline: now })).to.be.revertedWithCustomError(policy, "InvalidGoal");
    await expect(policy.connect(alice).createGoal(account.target, { ...base, dailyCapUsd: 1 })).to.be.revertedWithCustomError(policy, "InvalidGoal");
    await expect(policy.connect(alice).createGoal(account.target, { ...base, maxStockAllocationBps: 10001 })).to.be.revertedWithCustomError(policy, "InvalidGoal");
    await expect(policy.connect(alice).createGoal(account.target, { ...base, allowedAssets: Array(9).fill(usdg.target) })).to.be.revertedWithCustomError(policy, "TooManyAssets");
    await expect(policy.connect(alice).createGoal(account.target, { ...base, allowedAssets: [attacker.address] })).to.be.reverted;
  });

  it("approved path: approve + vault deposit into the user's own account (ActionExecuted)", async () => {
    const { account, exec, I, usdg, vault } = await setup();
    await expect(exec(usdg.target, I.erc20.encodeFunctionData("approve", [vault.target, usd(40)]))).to.emit(account, "ActionExecuted");
    await expect(exec(vault.target, I.vault.encodeFunctionData("deposit", [usd(40), account.target])))
      .to.emit(account, "ActionApproved").and.to.emit(account, "ActionExecuted");
    expect(await vault.balanceOf(account.target)).to.be.gt(0);
  });

  it("send $5 of QQQ via router (demo: 'Send Sarah $5 of QQQ')", async () => {
    const { exec, I, stocks, router, bob, account } = await setup();
    const amt = Q(5) * 10n ** 18n / Q(571.3);
    await exec(stocks.QQQ.token.target, I.erc20.encodeFunctionData("approve", [router.target, amt]));
    await expect(exec(router.target, I.router.encodeFunctionData("send", [stocks.QQQ.token.target, bob.address, amt, ethers.id("chat")])))
      .to.emit(account, "ActionExecuted");
    expect(await stocks.QQQ.token.balanceOf(bob.address)).to.equal(amt);
  });

  const reject = async (ctx, target, data, reason) => {
    const tx = ctx.exec(target, data);
    await expect(tx).to.emit(ctx.account, "ActionRejected");
    const rc = await (await tx).wait();
    const ev = rc.logs.map((l) => { try { return ctx.account.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "ActionRejected");
    expect(ethers.decodeBytes32String(ev.args.reason)).to.equal(reason);
  };

  it("AI cannot bypass policy: arbitrary target", async () => {
    const ctx = await setup();
    await reject(ctx, ctx.attacker.address, "0x12345678", "TARGET_NOT_ALLOWED");
  });

  it("AI cannot bypass policy: arbitrary selector on an allowed contract (e.g. vault.withdraw / redeem)", async () => {
    const ctx = await setup();
    await reject(ctx, ctx.vault.target, ctx.I.vault.encodeFunctionData("withdraw", [1, ctx.attacker.address, ctx.account.target]), "SELECTOR_NOT_ALLOWED");
    await reject(ctx, ctx.vault.target, ctx.I.vault.encodeFunctionData("borrow", [1]), "SELECTOR_NOT_ALLOWED");
  });

  it("AI cannot bypass policy: raw token transfer to attacker", async () => {
    const ctx = await setup();
    await reject(ctx, ctx.usdg.target, ctx.I.erc20.encodeFunctionData("transfer", [ctx.attacker.address, usd(1)]), "TARGET_NOT_ALLOWED");
  });

  it("AI cannot bypass policy: approve to a non-Bloom spender / unlimited approval", async () => {
    const ctx = await setup();
    await reject(ctx, ctx.usdg.target, ctx.I.erc20.encodeFunctionData("approve", [ctx.attacker.address, 1]), "SPENDER_NOT_ALLOWED");
    await reject(ctx, ctx.usdg.target, ctx.I.erc20.encodeFunctionData("approve", [ctx.router.target, ethers.MaxUint256]), "PER_TX_CAP_EXCEEDED");
  });

  it("AI cannot bypass policy: deposit shares to someone else", async () => {
    const ctx = await setup();
    await reject(ctx, ctx.vault.target, ctx.I.vault.encodeFunctionData("deposit", [usd(1), ctx.attacker.address]), "RECEIVER_NOT_ALLOWED");
  });

  it("per-transaction cap and daily cap ($50/day) are enforced", async () => {
    const ctx = await setup();
    const send = (n) => ctx.I.router.encodeFunctionData("send", [ctx.usdg.target, ctx.bob.address, usd(n), ethers.ZeroHash]);
    await ctx.exec(ctx.usdg.target, ctx.I.erc20.encodeFunctionData("approve", [ctx.router.target, usd(50)]));
    await reject(ctx, ctx.router.target, send(51), "PER_TX_CAP_EXCEEDED");
    await expect(ctx.exec(ctx.router.target, send(30))).to.emit(ctx.account, "ActionExecuted");
    await reject(ctx, ctx.router.target, send(21), "DAILY_CAP_EXCEEDED");
    await expect(ctx.exec(ctx.router.target, send(20))).to.emit(ctx.account, "ActionExecuted");
    await time.increase(86400);
    await ctx.exec(ctx.usdg.target, ctx.I.erc20.encodeFunctionData("approve", [ctx.router.target, usd(50)]));
    await expect(ctx.exec(ctx.router.target, send(50))).to.emit(ctx.account, "ActionExecuted"); // new day
  });

  it("asset not in the goal allowlist is rejected (AAPL)", async () => {
    const ctx = await setup();
    await reject(ctx, ctx.router.target, ctx.I.router.encodeFunctionData("send", [ctx.stocks.AAPL.token.target, ctx.bob.address, 1, ethers.ZeroHash]), "ASSET_NOT_ALLOWED");
  });

  it("halted asset: 'I didn't execute this because QQQ entered a halted-risk state'", async () => {
    const ctx = await setup();
    await ctx.report("QQQ", { halted: true });
    await reject(ctx, ctx.router.target, ctx.I.router.encodeFunctionData("send", [ctx.stocks.QQQ.token.target, ctx.bob.address, Q(0.001), ethers.ZeroHash]), "ASSET_RISK_BLOCKED");
  });

  it("stock allocation cap (30%) enforced after swaps", async () => {
    const ctx = await setup();
    // account: 1000 USDG + 1 QQQ ($571.30) = 36% stock already => any USDG->QQQ swap must fail the post-check
    await ctx.exec(ctx.usdg.target, ctx.I.erc20.encodeFunctionData("approve", [ctx.router.target, usd(10)]));
    const dl = (await time.latest()) + 600;
    const data = ctx.I.router.encodeFunctionData("swap", [ctx.venue.target, ctx.usdg.target, ctx.stocks.QQQ.token.target, usd(10), 1, dl]);
    await expect(ctx.exec(ctx.router.target, data)).to.be.revertedWithCustomError(ctx.account, "AllocationLimitExceeded");
  });

  it("expired / revoked session key is rejected; native value never allowed", async () => {
    const ctx = await setup();
    await ctx.policy.connect(ctx.alice).revokeGoal(1);
    await reject(ctx, ctx.usdg.target, ctx.I.erc20.encodeFunctionData("approve", [ctx.vault.target, 1]), "NO_ACTIVE_POLICY");
    await ctx.policy.connect(ctx.alice).activateGoal(1, ctx.agent.address);
    await time.increaseTo(ctx.deadline + 1);
    await reject(ctx, ctx.usdg.target, ctx.I.erc20.encodeFunctionData("approve", [ctx.vault.target, 1]), "POLICY_EXPIRED");
    const [ok, reason] = await ctx.policy.preview(ctx.account.target, ctx.agent.address, ctx.vault.target, 1, "0x6e553f65");
    expect(ok).to.equal(false);
    expect(ethers.decodeBytes32String(reason)).to.equal("POLICY_EXPIRED");
  });

  it("session key is bound to its account and cannot be called by others", async () => {
    const ctx = await setup();
    await expect(ctx.account.connect(ctx.attacker).executeByAgent(ctx.agent.address, ctx.usdg.target, "0x"))
      .to.be.revertedWithCustomError(ctx.account, "NotAuthorizedAgent");
    // agent key with no goal on bob's account
    await ctx.factory.createAccount(ctx.bob.address, 0);
    const bobAcc = await ethers.getContractAt("BloomAccount", await ctx.factory.accountAddress(ctx.bob.address, 0));
    const tx = bobAcc.connect(ctx.agent).executeByAgent(ctx.agent.address, ctx.usdg.target, ctx.I.erc20.encodeFunctionData("approve", [ctx.vault.target, 1]));
    await expect(tx).to.emit(bobAcc, "ActionRejected");
  });

  it("agent cannot use owner-only functions (execute, upgrade)", async () => {
    const ctx = await setup();
    await expect(ctx.account.connect(ctx.agent).execute(ctx.attacker.address, 0, "0x")).to.be.revertedWith("account: not Owner or EntryPoint");
    await expect(ctx.account.connect(ctx.agent).upgradeToAndCall(ctx.attacker.address, "0x")).to.be.reverted;
  });

  describe("ERC-4337 session-key validation", function () {
    const pack = (hi, lo) => ethers.toBeHex((BigInt(hi) << 128n) | BigInt(lo), 32);
    async function op(ctx, callData) {
      return {
        sender: ctx.account.target, nonce: await ctx.entryPoint.getNonce(ctx.account.target, 0), initCode: "0x", callData,
        accountGasLimits: pack(500000, 500000), preVerificationGas: 60000, gasFees: pack(1e9, 2e9), paymasterAndData: "0x", signature: "0x",
      };
    }
    const sign = async (ctx, o, key) => ({ ...o, signature: key.signingKey.sign(await ctx.entryPoint.getUserOpHash(o)).serialized });

    it("session key UserOp for executeByAgent is accepted and policy still applies", async () => {
      const ctx = await setup();
      await ctx.admin.sendTransaction({ to: ctx.account.target, value: ethers.parseEther("1") });
      const inner = ctx.I.erc20.encodeFunctionData("approve", [ctx.vault.target, usd(10)]);
      const cd = ctx.account.interface.encodeFunctionData("executeByAgent", [ctx.agent.address, ctx.usdg.target, inner]);
      const o = await sign(ctx, await op(ctx, cd), ctx.agent);
      await expect(ctx.entryPoint.handleOps([o], ctx.admin.address)).to.emit(ctx.account, "ActionExecuted");
      expect(await ctx.usdg.allowance(ctx.account.target, ctx.vault.target)).to.equal(usd(10));
    });

    it("session key UserOp calling execute() (unrestricted) is rejected at validation", async () => {
      const ctx = await setup();
      await ctx.admin.sendTransaction({ to: ctx.account.target, value: ethers.parseEther("1") });
      const cd = ctx.account.interface.encodeFunctionData("execute", [ctx.usdg.target, 0,
        ctx.I.erc20.encodeFunctionData("transfer", [ctx.attacker.address, usd(1000)])]);
      const o = await sign(ctx, await op(ctx, cd), ctx.agent);
      await expect(ctx.entryPoint.handleOps([o], ctx.admin.address)).to.be.revertedWithCustomError(ctx.entryPoint, "FailedOp");
    });

    it("session key cannot impersonate another agent address in executeByAgent", async () => {
      const ctx = await setup();
      await ctx.admin.sendTransaction({ to: ctx.account.target, value: ethers.parseEther("1") });
      const other = ethers.Wallet.createRandom();
      const cd = ctx.account.interface.encodeFunctionData("executeByAgent", [ctx.agent.address, ctx.usdg.target, "0x"]);
      const o = await sign(ctx, await op(ctx, cd), other);
      await expect(ctx.entryPoint.handleOps([o], ctx.admin.address)).to.be.revertedWithCustomError(ctx.entryPoint, "FailedOp");
    });

    it("expired session key UserOp is rejected by the EntryPoint (validUntil)", async () => {
      const ctx = await setup();
      await ctx.admin.sendTransaction({ to: ctx.account.target, value: ethers.parseEther("1") });
      await time.increaseTo(ctx.deadline + 10);
      const cd = ctx.account.interface.encodeFunctionData("executeByAgent", [ctx.agent.address, ctx.usdg.target, "0x"]);
      const o = await sign(ctx, await op(ctx, cd), ctx.agent);
      await expect(ctx.entryPoint.handleOps([o], ctx.admin.address)).to.be.revertedWithCustomError(ctx.entryPoint, "FailedOp");
    });
  });
});
