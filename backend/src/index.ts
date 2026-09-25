// Bloom API server. Runs the halt-aware reporter in-process (REPORTER_ENABLED, default on for local/testnet) so
// admin risk simulations and the loop share scenario state.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createReporter, type Reporter } from "../../offchain/reporter/src/index.ts";
import { MAINNET, RPC_URL, ROOT, assertKeySeparation, chainId, deployment, keys, log, provider } from "./ctx.ts";
import { createApp } from "./app.ts";

function fatal(msg: string): never {
  log.error("startup refused", { reason: msg });
  process.exit(1);
}

// 1. key separation: distinct key per role, never the deployer/admin key
try {
  assertKeySeparation();
} catch (e) {
  fatal((e as Error).message);
}

// 2. chain safety: the RPC must serve exactly the chain this deployment manifest was made for
let rpcChain: number;
try {
  rpcChain = Number(await provider.send("eth_chainId", []));
} catch (e) {
  fatal(`Cannot reach the RPC to verify the chain id: ${(e as Error).message}`);
}
if (rpcChain !== chainId) fatal(`RPC chain ${rpcChain} does not match deployment chain ${chainId}. Refusing to start.`);

// 3. production CORS must be explicit
if (process.env.NODE_ENV === "production") {
  const origins = (process.env.FRONTEND_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (origins.length === 0 || origins.includes("*")) fatal("Set FRONTEND_ORIGIN to your frontend origin(s) in production (no wildcard).");
}

let reporter: Reporter | null = null;
if (keys.reporter && (MAINNET || keys.feedAdmin)) {
  const canonical = MAINNET
    ? JSON.parse(readFileSync(join(ROOT, "config", "robinhood-mainnet.json"), "utf8")).stockTokens.map((s: any) => ({ symbol: s.symbol, address: s.address }))
    : undefined;
  reporter = createReporter({
    rpcUrl: RPC_URL!, deployment, reporterKey: keys.reporter, feedAdminKey: MAINNET ? undefined : keys.feedAdmin, canonical,
    corpActionWindowSec: process.env.CORP_ACTION_WINDOW_SEC ? Number(process.env.CORP_ACTION_WINDOW_SEC) : undefined,
    logger: log,
  });
  // testnet default interval is gentler on the testnet-funded reporter / mock-oracle keys
  if ((process.env.REPORTER_ENABLED ?? (MAINNET ? "false" : "true")) === "true") reporter.start(Number(process.env.REPORTER_INTERVAL_SEC ?? (chainId === 31337 ? 30 : 120)));
} else {
  log.warn("reporter not configured (REPORTER_PRIVATE_KEY / MOCK_ORACLE_PRIVATE_KEY): risk reports will go stale", { chainId });
}

const port = Number(process.env.PORT ?? 3001);
const server = createApp(reporter).listen(port, () => log.info("listening", { port, chainId, deployment: process.env.BLOOM_DEPLOYMENT ?? "localhost" }));

// graceful shutdown: stop the reporter loop, finish in-flight requests, then exit (forced after 10 s)
let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info("shutting down", { signal });
  reporter?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => log.error("unhandled rejection", { error: e }));
