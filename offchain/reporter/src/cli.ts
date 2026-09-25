// CLI: node src/cli.ts --once | --loop [--interval 30]
// Env: RPC_URL (or RH_TESTNET_RPC_URL / RH_MAINNET_RPC_URL), BLOOM_DEPLOYMENT, REPORTER_PRIVATE_KEY,
//      FEED_ADMIN_PRIVATE_KEY (testnet-mock), CORP_ACTION_WINDOW_SEC. Local (31337) falls back to Hardhat dev keys.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { createReporter, loadDeployment } from "./index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
dotenv.config({ path: join(ROOT, ".env.local"), quiet: true });
dotenv.config({ path: join(ROOT, ".env"), quiet: true });
const hex0x = (k?: string) => (k ? (k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`) : undefined);
if (!process.env.DEPLOYER_PRIVATE_KEY && process.env.PRIVATE_KEY) process.env.DEPLOYER_PRIVATE_KEY = hex0x(process.env.PRIVATE_KEY);

const { values } = parseArgs({ options: { once: { type: "boolean" }, loop: { type: "boolean" }, interval: { type: "string", default: "30" } } });
const env = process.env;
const deployment = loadDeployment(env.BLOOM_DEPLOYMENT ?? "localhost");
const local = deployment.chainId === 31337;
// Well-known public Hardhat dev keys (#0 deployer/feed admin, #1 reporter) — used ONLY on chain 31337.
const HH = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"];
const rpcUrl =
  env.RPC_URL ??
  (deployment.chainId === 4663
    ? env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
    : deployment.chainId === 46630
      ? env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com"
      : "http://127.0.0.1:8545");
// testnet: the deployer key doubles as reporter unless REPORTER_PRIVATE_KEY is set; mainnet requires an explicit key
const reporterKey = hex0x(env.REPORTER_PRIVATE_KEY) ?? (local ? HH[1] : deployment.chainId === 4663 ? undefined : env.DEPLOYER_PRIVATE_KEY);
const feedAdminKey = env.FEED_ADMIN_PRIVATE_KEY ?? env.DEPLOYER_PRIVATE_KEY ?? (local ? HH[0] : undefined);
if (!rpcUrl || !reporterKey) {
  console.error("Set RPC URL and REPORTER_PRIVATE_KEY");
  process.exit(1);
}
const canonical = deployment.chainId === 4663
  ? JSON.parse(readFileSync(join(ROOT, "config", "robinhood-mainnet.json"), "utf8")).stockTokens.map((s: any) => ({ symbol: s.symbol, address: s.address }))
  : undefined;

const r = createReporter({ rpcUrl, deployment, reporterKey, feedAdminKey, canonical,
  corpActionWindowSec: env.CORP_ACTION_WINDOW_SEC ? Number(env.CORP_ACTION_WINDOW_SEC) : undefined });

if (values.loop) {
  r.start(Number(values.interval));
  process.on("SIGINT", () => { r.stop(); process.exit(0); });
} else {
  const hashes = await r.runOnce();
  console.log(JSON.stringify({ ok: true, txHashes: hashes }));
}
