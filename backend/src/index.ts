// Bloom API server. Runs the halt-aware reporter in-process (REPORTER_ENABLED, default on for local/testnet) so
// /api/risk/simulate and the loop share scenario state.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createReporter, type Reporter } from "../../offchain/reporter/src/index.ts";
import { MAINNET, RPC_URL, ROOT, chainId, deployment, keys, log } from "./ctx.ts";
import { createApp } from "./app.ts";

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
  if ((process.env.REPORTER_ENABLED ?? (MAINNET ? "false" : "true")) === "true") // testnet default is gentler on the faucet-funded reporter key
    reporter.start(Number(process.env.REPORTER_INTERVAL_SEC ?? (chainId === 31337 ? 30 : 120)));
} else {
  log.warn("reporter not configured: risk reports will go stale", { chainId });
}

const port = Number(process.env.PORT ?? 3001);
const server = createApp(reporter).listen(port, () => log.info("listening", { port, chainId, deployment: process.env.BLOOM_DEPLOYMENT ?? "localhost" }));
const shutdown = () => { reporter?.stop(); server.close(() => process.exit(0)); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
