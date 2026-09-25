// Wallet authentication: valid sign-in, invalid/foreign signatures, expiry, replay, wrong chain/domain/wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, type BaseWallet } from "ethers";
import { AuthError, createAuth, type LoginMessage } from "../src/auth.ts";

const CHAIN = 46630;
const URI = "https://bloom.example";

function setup(start = 1_800_000_000) {
  let t = start;
  const auth = createAuth({ chainId: CHAIN, uri: URI, now: () => t });
  return { auth, advance: (s: number) => (t += s) };
}
const sign = (w: BaseWallet, c: { domain: any; types: any; message: LoginMessage }) => w.signTypedData(c.domain, c.types, c.message);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof AuthError, `expected AuthError, got ${e}`);
    return (e as AuthError).code;
  }
  assert.fail("expected an AuthError");
};

test("valid signature -> session bound to the signer", async () => {
  const { auth } = setup();
  const w = Wallet.createRandom();
  const c = auth.issueChallenge(w.address);
  const wallet = auth.verifyLogin(c.message, await sign(w, c));
  assert.equal(wallet, w.address);
  const s = auth.createSession(wallet);
  assert.equal(auth.sessionFromHeader(`Bearer ${s.token}`)?.wallet, w.address);
  assert.equal(auth.sessionFromHeader(`Bearer ${s.token}x`), null);
  assert.equal(auth.sessionFromHeader(undefined), null);
});

test("invalid signature is rejected", () => {
  const { auth } = setup();
  const w = Wallet.createRandom();
  const c = auth.issueChallenge(w.address);
  assert.equal(code(() => auth.verifyLogin(c.message, "0x" + "11".repeat(65))), "INVALID_SIGNATURE");
});

test("wrong wallet: signature by another key, or a challenge issued for someone else", async () => {
  const { auth } = setup();
  const victim = Wallet.createRandom();
  const attacker = Wallet.createRandom();
  const c1 = auth.issueChallenge(victim.address);
  assert.equal(code(() => auth.verifyLogin(c1.message, "0x" + "00".repeat(65))), "INVALID_SIGNATURE");
  const c2 = auth.issueChallenge(victim.address);
  const sig = await sign(attacker, c2);
  assert.equal(code(() => auth.verifyLogin(c2.message, sig)), "WRONG_WALLET");
  // attacker rewrites the wallet field of a victim-issued challenge to their own address
  const c3 = auth.issueChallenge(victim.address);
  const forged = { ...c3.message, wallet: attacker.address };
  const sig3 = await sign(attacker, { ...c3, message: forged });
  assert.equal(code(() => auth.verifyLogin(forged, sig3)), "WRONG_WALLET");
});

test("expired challenge is rejected", async () => {
  const { auth, advance } = setup();
  const w = Wallet.createRandom();
  const c = auth.issueChallenge(w.address);
  const sig = await sign(w, c);
  advance(5 * 60 + 1);
  assert.equal(code(() => auth.verifyLogin(c.message, sig)), "EXPIRED");
});

test("replayed nonce is rejected (single use, even after a failed attempt)", async () => {
  const { auth } = setup();
  const w = Wallet.createRandom();
  const c = auth.issueChallenge(w.address);
  const sig = await sign(w, c);
  auth.verifyLogin(c.message, sig);
  assert.equal(code(() => auth.verifyLogin(c.message, sig)), "REPLAYED_NONCE");
  const c2 = auth.issueChallenge(w.address);
  code(() => auth.verifyLogin(c2.message, "0x" + "11".repeat(65)));
  assert.equal(code(() => auth.verifyLogin(c2.message, sig)), "REPLAYED_NONCE");
  assert.equal(code(() => auth.verifyLogin({ ...c.message, nonce: "never-issued" }, sig)), "REPLAYED_NONCE");
});

test("wrong chain: message chainId or a signature over another chain's domain", async () => {
  const { auth } = setup();
  const w = Wallet.createRandom();
  const c = auth.issueChallenge(w.address);
  const other = { ...c.message, chainId: 4663 };
  assert.equal(code(() => auth.verifyLogin(other, "0x" + "11".repeat(65))), "WRONG_CHAIN");
  // cross-chain replay: signed for chain 4663's domain but submitted to the 46630 backend
  const c2 = auth.issueChallenge(w.address);
  const sig = await w.signTypedData({ ...c2.domain, chainId: 4663 }, c2.types, c2.message);
  assert.equal(code(() => auth.verifyLogin(c2.message, sig)), "WRONG_WALLET");
});

test("wrong domain: another app id, origin or statement", async () => {
  const { auth } = setup();
  const w = Wallet.createRandom();
  for (const patch of [{ app: "evil-app" }, { uri: "https://evil.example" }, { statement: "Approve everything" }]) {
    const c = auth.issueChallenge(w.address);
    const m = { ...c.message, ...patch };
    assert.equal(code(() => auth.verifyLogin(m, "0x" + "11".repeat(65))), "WRONG_DOMAIN");
  }
});

test("tampered timestamps are rejected", async () => {
  const { auth } = setup();
  const w = Wallet.createRandom();
  const c = auth.issueChallenge(w.address);
  const m = { ...c.message, expiresAt: c.message.expiresAt + 86_400 };
  const sig = await sign(w, { ...c, message: m });
  assert.equal(code(() => auth.verifyLogin(m, sig)), "BAD_REQUEST");
});

test("sessions expire and can be revoked", async () => {
  const { auth, advance } = setup();
  const w = Wallet.createRandom();
  const s1 = auth.createSession(w.address);
  auth.revoke(`Bearer ${s1.token}`);
  assert.equal(auth.sessionFromHeader(`Bearer ${s1.token}`), null);
  const s2 = auth.createSession(w.address);
  advance(3601);
  assert.equal(auth.sessionFromHeader(`Bearer ${s2.token}`), null);
});
