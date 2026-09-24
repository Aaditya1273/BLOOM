// Generates test/vectors/risk-vectors.json: the shared specification vectors consumed by
// the Hardhat tests (BloomRiskEngineEVM / RiskLib) and the Stylus engine's Rust tests.
// Expected states are written by hand below; they are NOT derived from either implementation.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const S = { NORMAL: 0, HALTED: 1, STALE: 2, DEVIATION: 3, CORP_ACTION_PAUSED: 4, SEQUENCER_DOWN: 5, INVALID_PRICE: 6, UNSUPPORTED: 7 };
const NOW = 1_800_000_000;
const E18 = 10n ** 18n;
const P = 21241000000n; // $212.41 with 8 decimals
const P18 = 212410000000000000000n;

const base = {
  now: NOW, configured: true, isStockToken: true, heartbeat: 3600, deviationBps: 500,
  sequencerRequired: true, sequencerOk: true, sequencerAnswer: "0", sequencerStartedAt: NOW - 7200, sequencerGrace: 3600,
  feedOk: true, roundId: 10, answer: P.toString(), updatedAt: NOW - 8, answeredInRound: 10, feedDecimals: 8,
  hasReport: true, reportObservedAt: NOW - 30, maxReportAge: 300, halted: false, reportCorpActionPaused: false,
  reportMultiplier: E18.toString(), referencePrice: P18.toString(),
  tokenOk: true, tokenOraclePaused: false, tokenMultiplier: E18.toString(),
};
const c = (name, patch, state, price) => ({ name, input: { ...base, ...patch }, expected: { state, price: (price ?? 0n).toString() } });
const at = (bps) => (P18 * (10000n + BigInt(bps)) / 10000n).toString(); // reference so that deviation == bps exactly

const cases = [
  c("normal", {}, S.NORMAL, P18),
  c("unsupported asset", { configured: false }, S.UNSUPPORTED),
  c("sequencer down (answer 1)", { sequencerAnswer: "1" }, S.SEQUENCER_DOWN),
  c("sequencer feed call failed", { sequencerOk: false }, S.SEQUENCER_DOWN),
  c("sequencer startedAt zero", { sequencerStartedAt: 0 }, S.SEQUENCER_DOWN),
  c("sequencer inside grace period", { sequencerStartedAt: NOW - 3600 }, S.SEQUENCER_DOWN),
  c("sequencer just past grace", { sequencerStartedAt: NOW - 3601 }, S.NORMAL, P18),
  c("sequencer startedAt in future", { sequencerStartedAt: NOW + 5 }, S.SEQUENCER_DOWN),
  c("sequencer not required, feed broken", { sequencerRequired: false, sequencerOk: false, sequencerAnswer: "1" }, S.NORMAL, P18),
  c("price feed call failed", { feedOk: false }, S.INVALID_PRICE),
  c("zero price", { answer: "0" }, S.INVALID_PRICE),
  c("negative price", { answer: "-1" }, S.INVALID_PRICE),
  c("updatedAt zero", { updatedAt: 0 }, S.INVALID_PRICE),
  c("updatedAt in future", { updatedAt: NOW + 1 }, S.INVALID_PRICE),
  c("incomplete round", { answeredInRound: 9 }, S.INVALID_PRICE),
  c("price above MAX_PRICE", { answer: (10n ** 36n + 1n).toString(), feedDecimals: 18 }, S.INVALID_PRICE),
  c("scaled price above MAX_PRICE", { answer: (10n ** 30n).toString(), feedDecimals: 8 }, S.INVALID_PRICE),
  c("feed decimals > 36", { feedDecimals: 37 }, S.INVALID_PRICE),
  c("price scales to zero", { answer: "1", feedDecimals: 20, referencePrice: "0" }, S.INVALID_PRICE),
  c("18-decimal feed", { answer: P18.toString(), feedDecimals: 18 }, S.NORMAL, P18),
  c("20-decimal feed", { answer: (P18 * 100n).toString(), feedDecimals: 20 }, S.NORMAL, P18),
  c("stale price (heartbeat+1)", { updatedAt: NOW - 3601 }, S.STALE, P18),
  c("price exactly at heartbeat", { updatedAt: NOW - 3600 }, S.NORMAL, P18),
  c("no market report", { hasReport: false }, S.STALE, P18),
  c("stale market report", { reportObservedAt: NOW - 301 }, S.STALE, P18),
  c("report exactly at max age", { reportObservedAt: NOW - 300 }, S.NORMAL, P18),
  c("report from future", { reportObservedAt: NOW + 1 }, S.STALE, P18),
  c("halted", { halted: true }, S.HALTED, P18),
  c("halted beats corp action", { halted: true, tokenOraclePaused: true }, S.HALTED, P18),
  c("stale price beats halt", { halted: true, updatedAt: NOW - 4000 }, S.STALE, P18),
  c("token oraclePaused", { tokenOraclePaused: true }, S.CORP_ACTION_PAUSED, P18),
  c("report corp action flag", { reportCorpActionPaused: true }, S.CORP_ACTION_PAUSED, P18),
  c("multiplier mismatch", { tokenMultiplier: (E18 * 2n).toString() }, S.CORP_ACTION_PAUSED, P18),
  c("multiplier not reported", { reportMultiplier: "0", tokenMultiplier: (E18 * 2n).toString() }, S.NORMAL, P18),
  c("token hook call failed", { tokenOk: false }, S.CORP_ACTION_PAUSED, P18),
  c("non-stock asset ignores reports", { isStockToken: false, hasReport: false, tokenOk: false, referencePrice: "0" }, S.NORMAL, P18),
  c("deviation above threshold (ref high)", { referencePrice: at(600) }, S.DEVIATION, P18),
  c("deviation below threshold (ref high)", { referencePrice: at(400) }, S.NORMAL, P18),
  c("deviation above threshold (ref low)", { referencePrice: at(-600) }, S.DEVIATION, P18),
  c("reference above MAX_PRICE", { referencePrice: (10n ** 36n + 1n).toString() }, S.DEVIATION, P18),
  c("no reference price", { referencePrice: "0" }, S.NORMAL, P18),
  c("exact 5% with round numbers", { answer: "10500000000", referencePrice: (100n * E18).toString() }, S.NORMAL, 105n * E18),
  c("5.0001% deviation", { answer: "10500010000", referencePrice: (100n * E18).toString() }, S.DEVIATION, 1050001n * 10n ** 14n),
];

// EIP-712 vector (well-known Hardhat account #0 test key, never used for funds)
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
async function eip712() {
  const wallet = new ethers.Wallet(TEST_KEY);
  const domain = { name: "BloomRiskEngine", version: "1", chainId: 46630, verifyingContract: "0x00000000000000000000000000000000000B1003" };
  const types = { MarketReport: [
    { name: "asset", type: "address" }, { name: "halted", type: "bool" }, { name: "corporateActionPaused", type: "bool" },
    { name: "uiMultiplier", type: "uint256" }, { name: "referencePrice", type: "uint256" },
    { name: "observedAt", type: "uint64" }, { name: "nonce", type: "uint64" } ] };
  const message = { asset: "0x00000000000000000000000000000000000AA91E", halted: true, corporateActionPaused: false,
    uiMultiplier: E18.toString(), referencePrice: P18.toString(), observedAt: NOW - 30, nonce: 7 };
  return {
    domain, message, signer: wallet.address,
    domainSeparator: ethers.TypedDataEncoder.hashDomain(domain),
    structHash: ethers.TypedDataEncoder.from(types).hash(message),
    digest: ethers.TypedDataEncoder.hash(domain, types, message),
    signature: await wallet.signTypedData(domain, types, message),
  };
}

(async () => {
  const out = { note: "Generated by scripts/gen-risk-vectors.js. States: " + JSON.stringify(S), states: S, cases, eip712: await eip712() };
  const file = path.join(__dirname, "..", "test", "vectors", "risk-vectors.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${cases.length} cases -> ${file}`);
})();
