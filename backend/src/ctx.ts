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
dotenv.config({ path: join(ROOT, ".env"), quiet: true });
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

export const RPC_URL = env.RPC_URL ?? (MAINNET ? env.RH_MAINNET_RPC_URL : LOCAL ? "http://127.0.0.1:8545" : env.RH_TESTNET_RPC_URL);
if (!RPC_URL) throw new Error("No RPC URL: set RH_TESTNET_RPC_URL / RH_MAINNET_RPC_URL / RPC_URL");
export const provider = new JsonRpcProvider(RPC_URL, chainId, { staticNetwork: true, cacheTimeout: -1 }); // no request cache: nonces must be fresh

// Well-known PUBLIC Hardhat dev keys. Used only when the deployment is chain 31337.
const HH = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // #0 admin / feed admin / minter
  reporter: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1
  claimAuthority: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // #2
  demoOwner: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // #5
  agent: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // #6
};
const key = (name: string, local?: string) => env[name] || (LOCAL ? local : undefined);
const wallet = (k?: string) => (k ? new Wallet(k, provider) : null);

export const keys = {
  reporter: key("REPORTER_PRIVATE_KEY", HH.reporter),
  feedAdmin: key("FEED_ADMIN_PRIVATE_KEY") || key("DEPLOYER_PRIVATE_KEY", HH.deployer),
};
// Owner / faucet keys are never loaded on mainnet: those operations are testnet-only.
export const demoOwner = MAINNET ? null : wallet(key("DEMO_OWNER_PRIVATE_KEY", HH.demoOwner));
export const minter = MAINNET ? null : wallet(key("MINTER_PRIVATE_KEY") || key("DEPLOYER_PRIVATE_KEY", HH.deployer));
export const agentKey = wallet(key("AGENT_SESSION_PRIVATE_KEY", HH.agent));
export const claimAuthority = wallet(key("CLAIM_AUTHORITY_PRIVATE_KEY", HH.claimAuthority));

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
  | "NOT_FOUND" | "TESTNET_ONLY" | "CHAIN_ERROR" | "INTERNAL";
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

/** Send with a per-key lock, wait for the receipt, map failures to CHAIN_ERROR. */
export async function sendTx(signer: Wallet, label: string, fn: () => Promise<any>) {
  return withLock(signer.address, async () => {
    try {
      const tx = await fn();
      const rc = await tx.wait();
      if (!rc || rc.status !== 1) fail(502, "CHAIN_ERROR", `${label} reverted onchain.`, { txHash: tx.hash });
      log.info("tx", { label, txHash: tx.hash, from: signer.address });
      return rc!;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const reason = decodeRevert(e);
      log.warn("tx failed", { label, reason });
      return fail(502, "CHAIN_ERROR", `${label} failed: ${reason}`, { reason });
    }
  });
}
