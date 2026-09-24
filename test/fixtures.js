const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployTestnetSystem, signReport } = require("../scripts/lib/system");
const cfg = require("../config/robinhood-testnet.json");

const E18 = 10n ** 18n;
const usd = (n) => ethers.parseUnits(String(n), 6);
const S = { NORMAL: 0, HALTED: 1, STALE: 2, DEVIATION: 3, CORP_ACTION_PAUSED: 4, SEQUENCER_DOWN: 5, INVALID_PRICE: 6, UNSUPPORTED: 7 };

async function systemFixture() {
  const [admin, reporter, claimAuthority, alice, bob, carol, agent, attacker] = await ethers.getSigners();
  const sys = await deployTestnetSystem(cfg, { admin, reporter, claimAuthority });
  const chainId = (await ethers.provider.getNetwork()).chainId;
  let nonce = 0n;

  /** Sign + submit a market report for `symbol`; defaults describe a healthy, open market. */
  async function report(symbol, patch = {}, signer = reporter) {
    const { token, feed } = sys.stocks[symbol];
    const [, answer] = await feed.latestRoundData();
    const now = BigInt(await time.latest());
    const r = {
      asset: token.target,
      halted: false,
      corporateActionPaused: false,
      uiMultiplier: E18,
      referencePrice: answer * 10n ** 10n,
      observedAt: now,
      nonce: ++nonce,
      ...patch,
    };
    const sig = await signReport(signer, sys.engine.target, chainId, r);
    return sys.engine.submitReport(r.asset, r.halted, r.corporateActionPaused, r.uiMultiplier, r.referencePrice, r.observedAt, r.nonce, sig);
  }

  async function reportAll() {
    for (const s of Object.keys(sys.stocks)) await report(s);
  }

  async function stateOf(symbol) {
    const [state] = await sys.engine.getRisk(sys.stocks[symbol].token.target);
    return Number(state);
  }

  await reportAll();
  return { ...sys, admin, reporter, claimAuthority, alice, bob, carol, agent, attacker, chainId, report, reportAll, stateOf, cfg };
}

const load = () => loadFixture(systemFixture);

module.exports = { load, systemFixture, E18, usd, S, time, cfg };
