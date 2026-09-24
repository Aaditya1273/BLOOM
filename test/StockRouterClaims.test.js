const { expect } = require("chai");
const { ethers } = require("hardhat");
const { load, usd, time } = require("./fixtures");
const { sym, KIND } = require("../scripts/lib/system");

const Q = (n) => ethers.parseUnits(String(n), 18);

describe("BloomAssetRegistry — canonical assets", function () {
  it("binds to the deployment chain id", async () => {
    const [admin] = await ethers.getSigners();
    const F = await ethers.getContractFactory("BloomAssetRegistry");
    await expect(F.deploy(admin.address, 4663)).to.be.revertedWithCustomError(F, "WrongChain");
  });

  it("rejects decimals mismatch, duplicate token, duplicate symbol, second stable, non-owner", async () => {
    const { registry, stocks, admin, attacker, usdg } = await load();
    const t = await (await ethers.getContractFactory("MockStockToken")).deploy("X", "X", admin.address);
    await expect(registry.registerAsset(sym("X"), t.target, stocks.AAPL.feed.target, 6, KIND.STOCK_TOKEN))
      .to.be.revertedWithCustomError(registry, "DecimalsMismatch");
    await expect(registry.registerAsset(sym("AAPL2"), stocks.AAPL.token.target, stocks.AAPL.feed.target, 18, KIND.STOCK_TOKEN))
      .to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    await expect(registry.registerAsset(sym("AAPL"), t.target, stocks.AAPL.feed.target, 18, KIND.STOCK_TOKEN))
      .to.be.revertedWithCustomError(registry, "SymbolTaken");
    const u2 = await (await ethers.getContractFactory("MockUSDG")).deploy(admin.address);
    await expect(registry.registerAsset(sym("USDG2"), u2.target, ethers.ZeroAddress, 6, KIND.STABLE))
      .to.be.revertedWithCustomError(registry, "StableAlreadySet");
    await expect(registry.connect(attacker).registerAsset(sym("Y"), t.target, stocks.AAPL.feed.target, 18, KIND.STOCK_TOKEN))
      .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    expect((await registry.getAssetBySymbol(sym("USDG"))).token).to.equal(usdg.target);
  });
});

describe("StockRouter", function () {
  async function setup() {
    const f = await load();
    await f.stocks.QQQ.token.mint(f.alice.address, Q(10));
    await f.stocks.QQQ.token.connect(f.alice).approve(f.router.target, ethers.MaxUint256);
    await f.usdg.mint(f.alice.address, usd(1000));
    await f.usdg.connect(f.alice).approve(f.router.target, ethers.MaxUint256);
    return f;
  }

  it("sends a canonical Stock Token", async () => {
    const { router, stocks, alice, bob } = await setup();
    const memo = ethers.id("chat:1");
    await expect(router.connect(alice).send(stocks.QQQ.token.target, bob.address, Q(0.5), memo))
      .to.emit(router, "Sent").withArgs(alice.address, bob.address, stocks.QQQ.token.target, Q(0.5), memo);
    expect(await stocks.QQQ.token.balanceOf(bob.address)).to.equal(Q(0.5));
  });

  it("rejects a spoofed token with the same name/symbol (canonical address only)", async () => {
    const { router, registry, alice, bob, admin } = await setup();
    const spoof = await (await ethers.getContractFactory("MockStockToken")).deploy("Invesco QQQ (mock Stock Token)", "QQQ", admin.address);
    await spoof.mint(alice.address, Q(1));
    await spoof.connect(alice).approve(router.target, Q(1));
    await expect(router.connect(alice).send(spoof.target, bob.address, Q(1), ethers.ZeroHash))
      .to.be.revertedWithCustomError(registry, "UnsupportedAsset");
  });

  it("rejects disabled assets, zero amounts, zero/self recipient", async () => {
    const { router, registry, stocks, alice, bob } = await setup();
    await expect(router.connect(alice).send(stocks.QQQ.token.target, bob.address, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(router, "ZeroAmount");
    await expect(router.connect(alice).send(stocks.QQQ.token.target, ethers.ZeroAddress, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(router, "ZeroAddress");
    await expect(router.connect(alice).send(stocks.QQQ.token.target, alice.address, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(router, "SelfTransfer");
    await registry.setEnabled(stocks.QQQ.token.target, false);
    await expect(router.connect(alice).send(stocks.QQQ.token.target, bob.address, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(registry, "UnsupportedAsset");
  });

  it("swaps USDG -> QQQ through the approved venue with slippage and deadline protection", async () => {
    const { router, venue, usdg, stocks, alice } = await setup();
    const dl = (await time.latest()) + 600;
    const quote = await venue.quote(usdg.target, stocks.QQQ.token.target, usd(30));
    expect(quote).to.equal(usd(30) * 10n ** 12n * 10n ** 18n / Q(571.3));
    await expect(router.connect(alice).swap(venue.target, usdg.target, stocks.QQQ.token.target, usd(30), 0, dl))
      .to.be.revertedWithCustomError(router, "MinOutRequired");
    await expect(router.connect(alice).swap(venue.target, usdg.target, stocks.QQQ.token.target, usd(30), quote + 1n, dl))
      .to.be.revertedWithCustomError(venue, "Slippage");
    await expect(router.connect(alice).swap(venue.target, usdg.target, stocks.QQQ.token.target, usd(30), quote, dl - 700))
      .to.be.revertedWithCustomError(router, "Expired");
    await expect(router.connect(alice).swap(venue.target, usdg.target, stocks.QQQ.token.target, usd(30), quote, dl)).to.emit(router, "Swapped");
    expect(await usdg.allowance(router.target, venue.target)).to.equal(0);
  });

  it("rejects unapproved venues and refuses to price assets outside NORMAL", async () => {
    const { router, venue, usdg, stocks, alice, attacker, report } = await setup();
    const dl = (await time.latest()) + 600;
    await expect(router.connect(alice).swap(attacker.address, usdg.target, stocks.QQQ.token.target, usd(1), 1, dl))
      .to.be.revertedWithCustomError(router, "VenueNotApproved");
    await report("QQQ", { halted: true });
    await expect(router.connect(alice).swap(venue.target, usdg.target, stocks.QQQ.token.target, usd(1), 1, dl))
      .to.be.revertedWithCustomError(venue, "PriceUnavailable");
  });

  it("owner-only venue management and pause", async () => {
    const { router, attacker, alice, bob, stocks } = await setup();
    await expect(router.connect(attacker).setVenue(attacker.address, true)).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    await router.pause();
    await expect(router.connect(alice).send(stocks.QQQ.token.target, bob.address, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(router, "EnforcedPause");
  });
});

describe("BloomClaims — claim links", function () {
  const AUTH_TYPES = { ClaimAuthorization: [
    { name: "claimId", type: "bytes32" }, { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" }, { name: "deadline", type: "uint64" }] };

  async function setup() {
    const f = await load();
    await f.stocks.QQQ.token.mint(f.alice.address, Q(10));
    await f.stocks.QQQ.token.connect(f.alice).approve(f.claims.target, ethers.MaxUint256);
    const authorize = async (claimId, recipient, amount, deadline, signer = f.claimAuthority, verifyingContract = f.claims.target) =>
      signer.signTypedData({ name: "BloomClaims", version: "1", chainId: f.chainId, verifyingContract }, AUTH_TYPES,
        { claimId, recipient, amount, deadline });
    const id = () => ethers.hexlify(ethers.randomBytes(32));
    return { ...f, authorize, id };
  }

  it("valid claim via claim-authority authorization", async () => {
    const { claims, stocks, alice, bob, authorize, id } = await setup();
    const cid = id();
    const exp = (await time.latest()) + 86400;
    await expect(claims.connect(alice).createClaim(cid, stocks.QQQ.token.target, Q(0.01), ethers.ZeroAddress, exp)).to.emit(claims, "ClaimCreated");
    const dl = (await time.latest()) + 600;
    const sig = await authorize(cid, bob.address, Q(0.01), dl);
    await expect(claims.connect(bob).claim(cid, bob.address, Q(0.01), dl, sig))
      .to.emit(claims, "ClaimClaimed").withArgs(cid, bob.address, stocks.QQQ.token.target, Q(0.01));
    expect(await stocks.QQQ.token.balanceOf(bob.address)).to.equal(Q(0.01));
  });

  it("duplicate claim (double spend) fails", async () => {
    const { claims, stocks, alice, bob, authorize, id } = await setup();
    const cid = id();
    await claims.connect(alice).createClaim(cid, stocks.QQQ.token.target, Q(1), ethers.ZeroAddress, (await time.latest()) + 86400);
    const dl = (await time.latest()) + 600;
    const sig = await authorize(cid, bob.address, Q(1), dl);
    await claims.connect(bob).claim(cid, bob.address, Q(1), dl, sig);
    await expect(claims.connect(bob).claim(cid, bob.address, Q(1), dl, sig)).to.be.revertedWithCustomError(claims, "NotOpen");
  });

  it("claim id cannot be reused", async () => {
    const { claims, stocks, alice, id } = await setup();
    const cid = id();
    const exp = (await time.latest()) + 86400;
    await claims.connect(alice).createClaim(cid, stocks.QQQ.token.target, Q(1), ethers.ZeroAddress, exp);
    await expect(claims.connect(alice).createClaim(cid, stocks.QQQ.token.target, Q(1), ethers.ZeroAddress, exp)).to.be.revertedWithCustomError(claims, "ClaimExists");
  });

  it("expired claim cannot be claimed and refunds to sender", async () => {
    const { claims, stocks, alice, bob, carol, authorize, id } = await setup();
    const cid = id();
    await claims.connect(alice).createClaim(cid, stocks.QQQ.token.target, Q(1), ethers.ZeroAddress, (await time.latest()) + 100);
    await expect(claims.connect(carol).refundExpired(cid)).to.be.revertedWithCustomError(claims, "NotExpired");
    await time.increase(101);
    const dl = (await time.latest()) + 600;
    const sig = await authorize(cid, bob.address, Q(1), dl);
    await expect(claims.connect(bob).claim(cid, bob.address, Q(1), dl, sig)).to.be.revertedWithCustomError(claims, "ClaimHasExpired");
    await expect(claims.connect(carol).refundExpired(cid)).to.emit(claims, "ClaimExpired").withArgs(cid, alice.address, Q(1));
    expect(await stocks.QQQ.token.balanceOf(alice.address)).to.equal(Q(10));
  });

  it("wrong recipient: recipient-bound claim rejects anyone else, and authorization is bound to its recipient", async () => {
    const { claims, stocks, alice, bob, carol, authorize, id } = await setup();
    const bound = id();
    await claims.connect(alice).createClaim(bound, stocks.QQQ.token.target, Q(1), bob.address, (await time.latest()) + 86400);
    await expect(claims.connect(carol).claim(bound, carol.address, Q(1), 0, "0x")).to.be.revertedWithCustomError(claims, "WrongRecipient");
    await expect(claims.connect(carol).claim(bound, bob.address, Q(1), 0, "0x")).to.be.revertedWithCustomError(claims, "WrongRecipient");
    await claims.connect(bob).claim(bound, bob.address, Q(1), 0, "0x");

    const open = id();
    await claims.connect(alice).createClaim(open, stocks.QQQ.token.target, Q(1), ethers.ZeroAddress, (await time.latest()) + 86400);
    const dl = (await time.latest()) + 600;
    const sigForBob = await authorize(open, bob.address, Q(1), dl);
    await expect(claims.connect(carol).claim(open, carol.address, Q(1), dl, sigForBob)).to.be.revertedWithCustomError(claims, "Unauthorized");
  });

  it("unauthorized claim: signature not from claim authority, other contract, or expired authorization", async () => {
    const { claims, stocks, alice, bob, attacker, authorize, id, admin } = await setup();
    const cid = id();
    await claims.connect(alice).createClaim(cid, stocks.QQQ.token.target, Q(1), ethers.ZeroAddress, (await time.latest()) + 86400);
    const dl = (await time.latest()) + 600;
    await expect(claims.connect(attacker).claim(cid, attacker.address, Q(1), dl, await authorize(cid, attacker.address, Q(1), dl, attacker)))
      .to.be.revertedWithCustomError(claims, "Unauthorized");
    await expect(claims.connect(bob).claim(cid, bob.address, Q(1), dl, await authorize(cid, bob.address, Q(1), dl, undefined, admin.address)))
      .to.be.revertedWithCustomError(claims, "Unauthorized");
    const past = (await time.latest()) - 1;
    await expect(claims.connect(bob).claim(cid, bob.address, Q(1), past, await authorize(cid, bob.address, Q(1), past)))
      .to.be.revertedWithCustomError(claims, "AuthorizationExpired");
  });

  it("amount mismatch fails", async () => {
    const { claims, stocks, alice, bob, authorize, id } = await setup();
    const cid = id();
    await claims.connect(alice).createClaim(cid, stocks.QQQ.token.target, Q(1), ethers.ZeroAddress, (await time.latest()) + 86400);
    const dl = (await time.latest()) + 600;
    const sig = await authorize(cid, bob.address, Q(2), dl);
    await expect(claims.connect(bob).claim(cid, bob.address, Q(2), dl, sig)).to.be.revertedWithCustomError(claims, "AmountMismatch");
  });

  it("rejects unsupported tokens, zero id, bad expiry; only sender can cancel", async () => {
    const { claims, stocks, alice, bob, admin, registry, id } = await setup();
    const spoof = await (await ethers.getContractFactory("MockStockToken")).deploy("Q", "QQQ", admin.address);
    const exp = (await time.latest()) + 86400;
    await expect(claims.connect(alice).createClaim(id(), spoof.target, 1, ethers.ZeroAddress, exp)).to.be.revertedWithCustomError(registry, "UnsupportedAsset");
    await expect(claims.connect(alice).createClaim(ethers.ZeroHash, stocks.QQQ.token.target, 1, ethers.ZeroAddress, exp)).to.be.revertedWithCustomError(claims, "InvalidClaimId");
    await expect(claims.connect(alice).createClaim(id(), stocks.QQQ.token.target, 1, ethers.ZeroAddress, exp + 31 * 86400)).to.be.revertedWithCustomError(claims, "InvalidExpiry");
    const cid = id();
    await claims.connect(alice).createClaim(cid, stocks.QQQ.token.target, 1, ethers.ZeroAddress, exp);
    await expect(claims.connect(bob).cancel(cid)).to.be.revertedWithCustomError(claims, "Unauthorized");
    await expect(claims.connect(alice).cancel(cid)).to.emit(claims, "ClaimCancelled");
  });
});
