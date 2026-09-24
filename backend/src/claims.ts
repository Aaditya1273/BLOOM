// Claim links: public claimId in the URL, 6-digit code shared out of band. Only a salted scrypt hash of the
// code is stored; redemption is attempt-limited and the claim authority signs a ClaimAuthorization for the
// verified recipient, then relays BloomClaims.claim.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { Contract, getAddress, hexlify, isAddress } from "ethers";
import { assetByToken, c, chainId, claimAuthority, fail, fmt, provider, sendTx, addr } from "./ctx.ts";
import { jsonStore } from "./store.ts";

const MAX_ATTEMPTS = 5;
type Rec = { salt: string; hash: string; attempts: number };
const store = jsonStore<Record<string, Rec>>("claims", {});
const hashCode = (code: string, salt: string) => scryptSync(code, Buffer.from(salt, "hex"), 32).toString("hex");

/** New claim id + code. The code is returned once to the sender and never logged or stored in clear. */
export function newClaimSecret() {
  const claimId = hexlify(randomBytes(32));
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  store.update((d) => { d[claimId] = { salt, hash: hashCode(code, salt), attempts: 0 }; });
  return { claimId, code };
}
export const forgetClaim = (claimId: string) => store.update((d) => { delete d[claimId]; });

const STATUS = ["NONE", "OPEN", "CLAIMED", "EXPIRED", "CANCELLED"];
const checkId = (id: string) => { if (!/^0x[0-9a-fA-F]{64}$/.test(id)) fail(400, "BAD_REQUEST", "Invalid claim id."); };

export async function getClaim(claimId: string) {
  checkId(claimId);
  const cl = await c.claims.claims(claimId);
  if (Number(cl.status) === 0) fail(404, "NOT_FOUND", "Claim not found.");
  const a = assetByToken(cl.token);
  const now = (await provider.getBlock("latest"))!.timestamp;
  let status = STATUS[Number(cl.status)];
  if (status === "OPEN" && now > Number(cl.expiry)) status = "EXPIRED";
  return {
    claimId, token: cl.token, symbol: a?.symbol ?? "?", amount: fmt(BigInt(cl.amount), a?.decimals ?? 18),
    sender: cl.sender, expiresAt: new Date(Number(cl.expiry) * 1000).toISOString(), status,
  };
}

export async function redeemClaim(claimId: string, recipient: string, code: string) {
  checkId(claimId);
  if (!isAddress(recipient)) fail(400, "BAD_REQUEST", "recipient must be an address.");
  if (!/^\d{6}$/.test(code)) fail(400, "BAD_REQUEST", "code must be 6 digits.");
  if (!claimAuthority) fail(503, "INTERNAL", "Claim authority key not configured.");
  const rec = store.get()[claimId];
  if (!rec) fail(404, "NOT_FOUND", "Claim not found.");
  if (rec!.attempts >= MAX_ATTEMPTS) fail(429, "BAD_REQUEST", "Too many wrong codes. Ask the sender for a new link.");
  const ok = timingSafeEqual(Buffer.from(hashCode(code, rec!.salt), "hex"), Buffer.from(rec!.hash, "hex"));
  store.update((d) => { d[claimId].attempts += ok ? 0 : 1; });
  if (!ok) fail(400, "BAD_REQUEST", "That code is not correct.");
  const cl = await c.claims.claims(claimId);
  if (Number(cl.status) !== 1) fail(400, "BAD_REQUEST", `This claim is ${STATUS[Number(cl.status)].toLowerCase()}.`);
  const to = getAddress(recipient);
  const deadline = BigInt((await provider.getBlock("latest"))!.timestamp + 600);
  const sig = await claimAuthority!.signTypedData(
    { name: "BloomClaims", version: "1", chainId, verifyingContract: addr.BloomClaims },
    { ClaimAuthorization: [{ name: "claimId", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "amount", type: "uint256" }, { name: "deadline", type: "uint64" }] },
    { claimId, recipient: to, amount: cl.amount, deadline },
  );
  const claims = c.claims.connect(claimAuthority) as Contract;
  const rc = await sendTx(claimAuthority!, "claim", () => claims.claim(claimId, to, cl.amount, deadline, sig));
  return { txHash: rc.hash };
}
