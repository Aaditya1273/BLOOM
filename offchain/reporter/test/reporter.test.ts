import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Wallet } from "ethers";
import { AssetsResponse, PricesResponse } from "../src/api.ts";
import {
  clampObservedAt, corporateActionPaused, nextNonce, parseDecimal, referencePriceOf, reportDigest,
  signMarketReport, verifyCanonical, type MarketReport,
} from "../src/core.ts";

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const vectors = JSON.parse(readFileSync(new URL("../../../test/vectors/risk-vectors.json", import.meta.url), "utf8"));

test("API validation accepts the real response shape", () => {
  const { quotes } = PricesResponse.parse(fx("quote-good.json"));
  assert.equal(quotes[0].tokenSymbol, "QQQ");
  assert.equal(quotes[0].isTradingHalt, false);
  assert.equal(AssetsResponse.parse(fx("assets.json")).assets.length, 2);
});

test("API validation rejects every malformed fixture", () => {
  for (const [i, bad] of fx("quote-malformed.json").entries()) {
    assert.equal(PricesResponse.safeParse(bad).success, false, `fixture #${i} should be rejected`);
  }
  assert.equal(AssetsResponse.safeParse({ assets: [{ tokenSymbol: "QQQ", deployments: [], currentMultiplier: 1.0007, status: "x" }] }).success, false);
});

test("exact decimal parsing (no floats)", () => {
  assert.equal(parseDecimal("1.000700791241405425"), 1000700791241405425n);
  assert.equal(parseDecimal("735.36"), 735360000000000000000n);
  assert.equal(parseDecimal("1"), 10n ** 18n);
  assert.equal(parseDecimal("0.1234567890123456789999"), 123456789012345678n); // truncated past 18 dp
  assert.equal(parseDecimal("212.41", 8), 21241000000n);
  for (const bad of ["", "-1", "1e3", "1.", ".5", "NaN", " 1", "1,5"]) assert.throws(() => parseDecimal(bad), bad);
});

test("reference price: token mid, else (bid+ask)/2 * multiplier", () => {
  const q = PricesResponse.parse(fx("quote-good.json")).quotes[0];
  assert.equal(referencePriceOf(q), (735875333847279893328n + 735895347863104721437n) / 2n);
  const noToken = { ...q, tokenBid: undefined, tokenAsk: undefined };
  assert.equal(referencePriceOf(noToken, "1.000700791241405425"), (735370000000000000000n * 1000700791241405425n) / 10n ** 18n);
  assert.throws(() => referencePriceOf(noToken));
  assert.throws(() => referencePriceOf({ ...noToken, bid: "0" }, "1"));
});

test("observedAt = min(generatedAt, block time), never before previous report", () => {
  assert.equal(clampObservedAt(1000n, 900n, 0n), 900n); // future generatedAt clamped to chain time
  assert.equal(clampObservedAt(800n, 900n, 0n), 800n);
  assert.equal(clampObservedAt(null, 900n, 0n), 900n);
  assert.equal(clampObservedAt(800n, 900n, 850n), 850n); // engine rejects out-of-order reports
});

test("nonce sequencing = engine nonce + 1", () => {
  assert.equal(nextNonce(0n), 1n);
  assert.equal(nextNonce(41n), 42n);
});

test("EIP-712 digest and signature match test/vectors/risk-vectors.json exactly", async () => {
  const v = vectors.eip712;
  // Hardhat account #0 (public dev key) — the vector's signer
  const w = new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  assert.equal(w.address, v.signer);
  const r: MarketReport = { ...v.message, uiMultiplier: BigInt(v.message.uiMultiplier), referencePrice: BigInt(v.message.referencePrice),
    observedAt: BigInt(v.message.observedAt), nonce: BigInt(v.message.nonce) };
  assert.equal(reportDigest(v.domain.verifyingContract, v.domain.chainId, r), v.digest);
  assert.equal(await signMarketReport(w, v.domain.verifyingContract, v.domain.chainId, r), v.signature);
});

test("canonical mismatch refusal (production)", () => {
  const assets = AssetsResponse.parse(fx("assets.json")).assets;
  verifyCanonical([{ symbol: "QQQ", address: "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68" }], assets);
  assert.throws(() => verifyCanonical([{ symbol: "QQQ", address: "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1" }], assets), /canonical/);
  assert.throws(() => verifyCanonical([{ symbol: "TSLA", address: "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1" }], assets), /no chain 4663/);
  assert.throws(() => verifyCanonical([{ symbol: "QQQ", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68" }], assets, 46630));
});

test("corporate action pause: pending multiplier within window / processing action", () => {
  const assets = AssetsResponse.parse(fx("assets.json")).assets;
  const aapl = assets.find((a) => a.tokenSymbol === "AAPL");
  const now = Date.parse("2026-09-25T00:00:00Z") / 1000;
  assert.equal(corporateActionPaused("AAPL", aapl, [], now, 86400), true);
  assert.equal(corporateActionPaused("AAPL", aapl, [], now, 3600), false);
  const qqq = assets.find((a) => a.tokenSymbol === "QQQ");
  assert.equal(corporateActionPaused("QQQ", qqq, [], now, 86400), false);
  const div = { type: "CORPORATE_ACTION_TYPE_CASH_DIVIDEND", status: "CORPORATE_ACTION_STATUS_IN_PROGRESS", tokenSymbol: "QQQ" };
  assert.equal(corporateActionPaused("QQQ", qqq, [{ ...div, processDate: { year: 2026, month: 10, day: 8 } }], now, 86400), false);
  assert.equal(corporateActionPaused("QQQ", qqq, [{ ...div, processDate: { year: 2026, month: 9, day: 25 } }], now, 86400), true);
});
