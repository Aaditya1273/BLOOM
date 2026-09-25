// Wallet authentication (EIP-712 typed-data challenge) and short-lived sessions.
//
//   GET  /api/auth/nonce?wallet=0x..   -> typed-data challenge (single-use nonce, 5 min expiry)
//   wallet signs it (eth_signTypedData_v4)
//   POST /api/auth/verify {message, signature} -> backend recovers the signer -> random session token (1 h)
//   every authenticated request: Authorization: Bearer <token>
//
// The authenticated wallet is ALWAYS derived from the verified signature; request bodies/queries are never trusted for
// identity. Replay protection: nonces are single-use and bound to one wallet; the signed message binds the chain id
// (domain + message), the app id and the frontend origin, plus issuedAt/expiresAt. Tokens are stored only as SHA-256
// hashes and never logged.
import { createHash, randomBytes } from "node:crypto";
import { getAddress, isAddress, verifyTypedData, type TypedDataField } from "ethers";

export const APP_ID = "bloom-api";
export const CHALLENGE_TTL_SEC = 5 * 60;
export const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC ?? 60 * 60);
/** Clock skew tolerated between wallet and server when checking issuedAt. */
const MAX_SKEW_SEC = 60;
const MAX_PENDING_CHALLENGES = 10_000;

export type Role = "user" | "admin";
export type Session = { wallet: string; expiresAt: number };

export const LOGIN_TYPES: Record<string, TypedDataField[]> = {
  BloomLogin: [
    { name: "wallet", type: "address" },
    { name: "app", type: "string" },
    { name: "uri", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "statement", type: "string" },
  ],
};
export const STATEMENT = "Sign in to Bloom. This proves you own this wallet. It does not send a transaction or cost gas.";

export type LoginMessage = {
  wallet: string;
  app: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  statement: string;
};

export type AuthErrorCode = "INVALID_SIGNATURE" | "EXPIRED" | "REPLAYED_NONCE" | "WRONG_CHAIN" | "WRONG_DOMAIN" | "WRONG_WALLET" | "BAD_REQUEST";
export class AuthError extends Error {
  code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const loginDomain = (chainId: number) => ({ name: "Bloom", version: "1", chainId });

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Authentication state for one backend instance. `uri` is the frontend origin the signature must be bound to. */
export function createAuth(opts: { chainId: number; uri: string; now?: () => number }) {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const challenges = new Map<string, { wallet: string; issuedAt: number; expiresAt: number }>();
  const sessions = new Map<string, Session>(); // sha256(token) -> session

  function sweep() {
    const t = now();
    for (const [k, v] of challenges) if (v.expiresAt < t) challenges.delete(k);
    for (const [k, v] of sessions) if (v.expiresAt < t) sessions.delete(k);
  }

  function issueChallenge(walletRaw: string) {
    if (!isAddress(walletRaw)) throw new AuthError("BAD_REQUEST", "wallet must be an address.");
    sweep();
    if (challenges.size >= MAX_PENDING_CHALLENGES) throw new AuthError("BAD_REQUEST", "Too many pending sign-ins. Try again shortly.");
    const wallet = getAddress(walletRaw);
    const issuedAt = now();
    const message: LoginMessage = {
      wallet,
      app: APP_ID,
      uri: opts.uri,
      chainId: opts.chainId,
      nonce: randomBytes(16).toString("hex"),
      issuedAt,
      expiresAt: issuedAt + CHALLENGE_TTL_SEC,
      statement: STATEMENT,
    };
    challenges.set(message.nonce, { wallet, issuedAt, expiresAt: message.expiresAt });
    return { domain: loginDomain(opts.chainId), types: LOGIN_TYPES, primaryType: "BloomLogin" as const, message };
  }

  /** Verifies a signed challenge and returns the authenticated wallet. Consumes the nonce whatever the outcome. */
  function verifyLogin(message: LoginMessage, signature: string): string {
    if (!message || typeof message !== "object" || typeof message.nonce !== "string") throw new AuthError("BAD_REQUEST", "Malformed sign-in message.");
    const pending = challenges.get(message.nonce);
    challenges.delete(message.nonce); // single use: a nonce can be tried exactly once
    if (!pending) throw new AuthError("REPLAYED_NONCE", "This sign-in request was already used or never issued. Start again.");
    const t = now();
    if (Number(message.expiresAt) !== pending.expiresAt || Number(message.issuedAt) !== pending.issuedAt) {
      throw new AuthError("BAD_REQUEST", "Sign-in message does not match the issued challenge.");
    }
    if (t > pending.expiresAt) throw new AuthError("EXPIRED", "This sign-in request expired. Start again.");
    if (Number(message.issuedAt) > t + MAX_SKEW_SEC) throw new AuthError("EXPIRED", "Sign-in request is from the future.");
    if (Number(message.chainId) !== opts.chainId) throw new AuthError("WRONG_CHAIN", "This sign-in is for a different network.");
    if (message.app !== APP_ID || message.uri !== opts.uri || message.statement !== STATEMENT) {
      throw new AuthError("WRONG_DOMAIN", "This sign-in was issued for a different app.");
    }
    if (!isAddress(message.wallet) || getAddress(message.wallet) !== pending.wallet) {
      throw new AuthError("WRONG_WALLET", "This sign-in was issued for a different wallet.");
    }
    let signer: string;
    try {
      signer = verifyTypedData(loginDomain(opts.chainId), LOGIN_TYPES, { ...message, wallet: pending.wallet }, signature);
    } catch {
      throw new AuthError("INVALID_SIGNATURE", "The signature could not be verified.");
    }
    if (getAddress(signer) !== pending.wallet) throw new AuthError("WRONG_WALLET", "The signature was not made by this wallet.");
    return pending.wallet;
  }

  function createSession(wallet: string) {
    sweep();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now() + SESSION_TTL_SEC;
    sessions.set(sha256(token), { wallet: getAddress(wallet), expiresAt });
    return { token, expiresAt };
  }

  /** Resolves `Authorization: Bearer <token>`; null if missing, unknown or expired. */
  function sessionFromHeader(header: string | undefined): Session | null {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header ?? "");
    if (!m) return null;
    const s = sessions.get(sha256(m[1]));
    if (!s || s.expiresAt < now()) return null;
    return s;
  }

  function revoke(header: string | undefined) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header ?? "");
    if (m) sessions.delete(sha256(m[1]));
  }

  return { issueChallenge, verifyLogin, createSession, sessionFromHeader, revoke };
}

export type Auth = ReturnType<typeof createAuth>;
