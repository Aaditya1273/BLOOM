// Runtime context: env, deployment, provider, keys, contracts and small shared helpers.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Contract, FetchRequest, Interface, JsonRpcProvider, Wallet, formatUnits, isError } from "ethers";
import { installFetchTransport } from "../../offchain/ethers-fetch.ts";
import { withLock } from "../../offchain/txlock.ts";
import { makeLogger } from "../../offchain/log.ts";

installFetchTransport(FetchRequest);

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = process.env.BLOOM_DATA_DIR ?? join(ROOT, "backend", "data");
// .env.local first (first value wins), then .env.
dotenv.config({ path: join(ROOT, ".env.local"), quiet: true });
dotenv.config({ path: join(ROOT, ".env"), quiet: true });
const hex0x = (k?: string) => (k ? (k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`) : undefined);
export const log = makeLogger("backend");
const env = process.env;

export type AssetInfo = { symbol: string; token: string; feed?: string; decimals: number; kind: "STABLE" | "STOCK_TOKEN" };
export const DEPLOYMENT_NAME = env.BLOOM_DEPLOYMENT ?? "localhost";
export const deployment = JSON.parse(readFileSync(join(ROOT, "deployments", `${DEPLOYMENT_NAME}.json`), "utf8"));
export const chainId: number = deployment.chainId;
export const MAINNET = chainId === 4663;
export const LOCAL = chainId === 31337;
export const NETWORK_NAME = MAINNET ? "Robinhood Chain" : LOCAL ? "Robinhood Chain Testnet (local)" : "Robinhood Chain Testnet";
export const EXPLORER = MAINNET ? "https://robinhoodchain.blockscout.com" : LOCAL ? null : "https://explorer.testnet.chain.robinhood.com";

export const assets: AssetInfo[] = Object.entries(deployment.assets as Record<string, Omit<AssetInfo, "symbol">>).map(([symbol, a]) => ({ symbol, ...a }));
export const stocks = assets.filter((a) => a.kind === "STOCK_TOKEN");
export const USDG = assets.find((a) => a.kind === "STABLE")!;
export const assetBySymbol = (s: string) => assets.find((a) => a.symbol === s.toUpperCase());
export const assetByToken = (t: string) => assets.find((a) => a.token.toLowerCase() === t.toLowerCase());

export const RPC_URL =
  env.RPC_URL ??
  (MAINNET
    ? env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
    : LOCAL
      ? "http://127.0.0.1:8545"
      : env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com");
if (!RPC_URL) throw new Error("No RPC URL: set RH_TESTNET_RPC_URL / RH_MAINNET_RPC_URL / RPC_URL");
// 20 s per RPC request (ethers' default is 5 min, which turns a throttled public RPC into hung API requests)
const rpcRequest = new FetchRequest(RPC_URL!);
rpcRequest.timeout = Number(process.env.RPC_TIMEOUT_MS ?? 20_000);
export const provider = new JsonRpcProvider(rpcRequest, chainId, { staticNetwork: true, cacheTimeout: -1 }); // no request cache: nonces must be fresh

/** True for RPC transport problems (timeouts, throttling, unreachable node) as opposed to contract/logic errors. */
export function isRpcFailure(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? "");
  return (
    isError(e as any, "TIMEOUT") || isError(e as any, "NETWORK_ERROR") || isError(e as any, "SERVER_ERROR") ||
    /exceeded maximum retry limit|timeout|ECONNREFUSED|ECONNRESET|fetch failed|429|Too Many Requests/i.test(m)
  );
}

// Well-known PUBLIC Hardhat dev keys. Used only when the deployment is chain 31337.
const HH = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // #0 local admin / mock oracle / faucet
  reporter: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1
  claimAuthority: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // #2
  demoOwner: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // #5
  agent: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // #6
};
/**
 * Key separation: every role reads its OWN variable. There is no fallback to PRIVATE_KEY or the deployer key on any
 * network except local Hardhat (public dev keys). The backend never loads DEPLOYER_PRIVATE_KEY or ADMIN_PRIVATE_KEY.
 *   REPORTER_PRIVATE_KEY         signs EIP-712 market reports (risk engine reporter allowlist only)
 *   AGENT_PRIVATE_KEY            Bloom Agent session key (acts only inside each goal's onchain BloomPolicy)
 *   CLAIM_AUTHORITY_PRIVATE_KEY  signs BloomClaims ClaimAuthorization + relays claims
 *   DEMO_OWNER_PRIVATE_KEY       testnet only, optional: owner of a demo BloomAccount (used by smoke scripts)
 *   FAUCET_PRIVATE_KEY           testnet only: MockUSDG MINTER_ROLE + sponsors BloomAccount creation gas
 *   MOCK_ORACLE_PRIVATE_KEY      testnet only: FEED_ADMIN on mock feeds/sequencer + CORP_ACTION on mock Stock Tokens
 */
// local Hardhat always uses the public dev keys (testnet role keys in .env.local have no local ETH/roles)
const key = (name: string, local?: string) => (LOCAL ? local : hex0x(env[name]));
const wallet = (k?: string) => (k ? new Wallet(k, provider) : null);

export const keys = {
  reporter: key("REPORTER_PRIVATE_KEY", HH.reporter),
  feedAdmin: MAINNET ? undefined : key("MOCK_ORACLE_PRIVATE_KEY", HH.deployer),
};
// Owner / faucet / mock-oracle keys are never loaded on mainnet: those operations are testnet-only.
export const demoOwner = MAINNET ? null : wallet(key("DEMO_OWNER_PRIVATE_KEY", HH.demoOwner));
export const minter = MAINNET ? null : wallet(key("FAUCET_PRIVATE_KEY", HH.deployer));
export const agentKey = wallet(key("AGENT_PRIVATE_KEY", HH.agent));
export const claimAuthority = wallet(key("CLAIM_AUTHORITY_PRIVATE_KEY", HH.claimAuthority));

/** Refuse to run with shared keys: each role must be a distinct key, and none may be the deployer/admin key. */
export function assertKeySeparation(): void {
  if (LOCAL) return;
  const roles: [string, string | undefined][] = [
    ["REPORTER", keys.reporter],
    ["AGENT", agentKey?.privateKey],
    ["CLAIM_AUTHORITY", claimAuthority?.privateKey],
    ["DEMO_OWNER", demoOwner?.privateKey],
    ["FAUCET", minter?.privateKey],
    ["MOCK_ORACLE", keys.feedAdmin],
  ];
  const forbidden = [hex0x(env.DEPLOYER_PRIVATE_KEY), hex0x(env.ADMIN_PRIVATE_KEY), hex0x(env.PRIVATE_KEY)].filter(Boolean).map((k) => k!.toLowerCase());
  const seen = new Map<string, string>();
  for (const [role, k] of roles) {
    if (!k) continue;
    const norm = k.toLowerCase();
    if (forbidden.includes(norm)) throw new Error(`Key separation violated: ${role} uses the deployer/admin key. Give ${role} its own key.`);
    const other = seen.get(norm);
    if (other) throw new Error(`Key separation violated: ${role} and ${other} share one key. Every role needs a distinct key.`);
    seen.set(norm, role);
  }
}

const abi = (name: string) => JSON.parse(readFileSync(join(ROOT, "offchain", "abi", `${name}.json`), "utf8"));
export const ABI = {
  account: abi("BloomAccount"), factory: abi("BloomAccountFactory"), policy: abi("BloomPolicy"), vault: abi("BloomVault"),
  router: abi("StockRouter"), claims: abi("BloomClaims"), engine: abi("BloomRiskEngineEVM"), feed: abi("MockAggregatorV3"),
  stock: abi("MockStockToken"), usdg: abi("MockUSDG"), seq: abi("MockSequencerUptimeFeed"), venue: abi("MockSwapVenue"),
  adapter: abi("MockLendingAdapter"),
};
export const IFACE = Object.fromEntries(Object.entries(ABI).map(([k, v]) => [k, new Interface(v)])) as Record<keyof typeof ABI, Interface>;
const C = deployment.contracts as Record<string, string>;
export const addr = C;
export const c = {
  factory: new Contract(C.BloomAccountFactory, ABI.factory, provider),
  policy: new Contract(C.BloomPolicy, ABI.policy, provider),
  vault: new Contract(C.BloomVault, ABI.vault, provider),
  router: new Contract(C.StockRouter, ABI.router, provider),
  claims: new Contract(C.BloomClaims, ABI.claims, provider),
  engine: new Contract(C.BloomRiskEngine, ABI.engine, provider),
  venue: C.MockSwapVenue ? new Contract(C.MockSwapVenue, ABI.venue, provider) : null,
  adapter: C.MockLendingAdapter ? new Contract(C.MockLendingAdapter, ABI.adapter, provider) : null,
  seq: C.MockSequencerUptimeFeed ? new Contract(C.MockSequencerUptimeFeed, ABI.seq, provider) : null,
};
export const erc20 = (token: string) => new Contract(token, ABI.stock, provider);

// ─── errors ───
export type ErrorCode = "RISK_BLOCKED" | "POLICY_REJECTED" | "UNSUPPORTED_ASSET" | "INSUFFICIENT_BALANCE" | "BAD_REQUEST"
  | "NOT_FOUND" | "TESTNET_ONLY" | "CHAIN_ERROR" | "INTERNAL" | "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED";
export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  details?: Record<string, unknown>;
  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const fail = (status: number, code: ErrorCode, message: string, details?: Record<string, unknown>): never => {
  throw new ApiError(status, code, message, details);
};
export function requireTestnet(what: string): void {
  if (MAINNET) fail(403, "TESTNET_ONLY", `${what} is only available on testnet or a local chain.`);
}

// ─── formatting (no floats for money) ───
export function fmt(v: bigint, decimals: number, dp?: number): string {
  let s = formatUnits(v, decimals);
  if (dp !== undefined) {
    const [i, f = ""] = s.split(".");
    s = dp === 0 ? i : `${i}.${f.padEnd(dp, "0").slice(0, dp)}`;
  }
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}
/** 1e18 USD -> "736.10" (always 2 dp, truncated). */
export function usd(v1e18: bigint): string {
  const [i, f = ""] = formatUnits(v1e18, 18).split(".");
  return `${i}.${f.padEnd(2, "0").slice(0, 2)}`;
}

// ─── transactions ───
const ERR_IFACES = Object.values(IFACE);
function decodeRevert(e: unknown): string {
  const data = (e as any)?.data ?? (e as any)?.info?.error?.data ?? (e as any)?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    for (const i of ERR_IFACES) {
      try {
        const d = i.parseError(data);
        if (d) return `${d.name}(${d.args.map(String).join(", ")})`;
      } catch { /* try next */ }
    }
  }
  if (isError(e as any, "CALL_EXCEPTION")) return (e as any).reason ?? (e as any).shortMessage ?? "call reverted";
  return (e as any)?.shortMessage ?? (e as Error)?.message ?? String(e);
}

const TX_WAIT_MS = Number(process.env.TX_WAIT_MS ?? 90_000);

/** Send with a per-key lock, wait (bounded) for the receipt, map failures to CHAIN_ERROR. */
export async function sendTx(signer: Wallet, label: string, fn: () => Promise<any>) {
  return withLock(signer.address, async () => {
    let hash: string | undefined;
    try {
      const tx = await fn();
      hash = tx.hash;
      // bounded: a stalled RPC must not hold the request (and this key's lock) forever
      const rc = await tx.wait(1, TX_WAIT_MS);
      if (!rc || rc.status !== 1) fail(502, "CHAIN_ERROR", `${label} reverted onchain.`, { txHash: tx.hash });
      log.info("tx", { label, txHash: tx.hash, from: signer.address });
      return rc!;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (hash && isError(e as any, "TIMEOUT")) {
        log.warn("tx pending", { label, txHash: hash });
        return fail(504, "CHAIN_ERROR", `${label} was sent but is not confirmed yet. Check the transaction before retrying.`, { txHash: hash, pending: true });
      }
      const reason = decodeRevert(e);
      log.warn("tx failed", { label, reason });
      return fail(502, "CHAIN_ERROR", `${label} failed: ${reason}`, { reason });
    }
  });
}
