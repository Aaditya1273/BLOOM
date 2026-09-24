// Halt-aware reporter: Robinhood API -> validate -> map symbol -> normalise -> EIP-712 MarketReport -> submitReport.
//   production    (chain 4663): canonical addresses must match the API; feeds are never touched.
//   testnet-mock  (46630/31337): real API prices are written to the mock feeds, then reported. Symbol -> address
//                 comes from the deployment file (tokens are mocks). Demo scenarios are applied and honoured.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, FetchRequest, JsonRpcProvider, Wallet } from "ethers";
import { installFetchTransport } from "../../ethers-fetch.ts";
import { withLock } from "../../txlock.ts";
import { makeLogger, type Logger } from "../../log.ts";
import { fetchAssets, fetchCorporateActions, fetchQuote, type ApiAsset, type CorpAction } from "./api.ts";
import {
  clampObservedAt, corporateActionPaused, isoToSec, nextNonce, parseDecimal, referencePriceOf,
  signMarketReport, verifyCanonical, E18, type MarketReport,
} from "./core.ts";

installFetchTransport(FetchRequest);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const abi = (name: string) => JSON.parse(readFileSync(join(ROOT, "offchain", "abi", `${name}.json`), "utf8"));

export const SCENARIOS = ["HALT", "STALE", "DEVIATION", "CORP_ACTION", "SEQUENCER_DOWN", "RESET"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export type Mode = "production" | "testnet-mock";

export type Deployment = {
  chainId: number;
  mode: string;
  contracts: Record<string, string>;
  assets: Record<string, { token: string; feed?: string; decimals: number; kind: "STABLE" | "STOCK_TOKEN" }>;
};

export type ReporterOptions = {
  rpcUrl: string;
  deployment: Deployment;
  reporterKey: string;
  feedAdminKey?: string; // testnet-mock only
  mode?: Mode;
  corpActionWindowSec?: number;
  canonical?: { symbol: string; address: string }[]; // production: from config/robinhood-mainnet.json
  logger?: Logger;
};

export function loadDeployment(name: string): Deployment {
  return JSON.parse(readFileSync(join(ROOT, "deployments", `${name}.json`), "utf8"));
}

export function createReporter(opts: ReporterOptions) {
  const log = opts.logger ?? makeLogger("reporter");
  const dep = opts.deployment;
  const mode: Mode = opts.mode ?? (dep.chainId === 4663 ? "production" : "testnet-mock");
  if (mode === "testnet-mock" && dep.chainId === 4663) throw new Error("testnet-mock mode refused on mainnet (4663)");
  if (mode === "production" && dep.chainId !== 4663) throw new Error("production mode requires chain 4663");
  const windowSec = opts.corpActionWindowSec ?? 86_400;

  const provider = new JsonRpcProvider(opts.rpcUrl, dep.chainId, { staticNetwork: true, cacheTimeout: -1 }); // no request cache: nonces must be fresh
  const reporter = new Wallet(opts.reporterKey, provider);
  const feedAdmin = mode === "testnet-mock" && opts.feedAdminKey ? new Wallet(opts.feedAdminKey, provider) : null;
  if (mode === "testnet-mock" && !feedAdmin) throw new Error("testnet-mock mode needs FEED_ADMIN_PRIVATE_KEY");
  const engineAddr = dep.contracts.BloomRiskEngine;
  const engine = new Contract(engineAddr, abi("BloomRiskEngineEVM"), reporter);
  const stocks = Object.entries(dep.assets).filter(([, a]) => a.kind === "STOCK_TOKEN").map(([s]) => s);

  // demo scenario state (testnet only)
  const active = new Map<string, Scenario>(); // symbol -> HALT | STALE | DEVIATION | CORP_ACTION
  const devRef = new Map<string, bigint>(); // DEVIATION: reference price held while the feed is moved
  const lastPrice = new Map<string, bigint>(); // 1e18, last good price (API unreachable => keep it)
  let sequencerDown = false;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> = Promise.resolve();

  async function send(signer: Wallet, label: string, fn: () => Promise<any>): Promise<string> {
    return withLock(signer.address, async () => {
      const tx = await fn();
      const rc = await tx.wait();
      if (rc.status !== 1) throw new Error(`${label} reverted`);
      log.info("tx", { label, txHash: tx.hash });
      return tx.hash as string;
    });
  }

  const feedOf = (sym: string) => new Contract(dep.assets[sym].feed!, abi("MockAggregatorV3"), feedAdmin ?? provider);
  const tokenOf = (sym: string) => new Contract(dep.assets[sym].token, abi("MockStockToken"), feedAdmin ?? provider);
  const feedScale = async (sym: string) => 10n ** (18n - BigInt(await feedOf(sym).decimals()));
  const blockTs = async () => BigInt((await provider.getBlock("latest"))!.timestamp);

  async function submit(sym: string, fields: Omit<MarketReport, "asset" | "observedAt" | "nonce">, generatedAt: bigint | null) {
    const asset = dep.assets[sym].token;
    const prev = await engine.getReport(asset);
    const r: MarketReport = {
      asset,
      ...fields,
      observedAt: clampObservedAt(generatedAt, await blockTs(), BigInt(prev.observedAt)),
      nonce: nextNonce(BigInt(prev.nonce)),
    };
    const sig = await signMarketReport(reporter, engineAddr, dep.chainId, r);
    const txHash = await send(reporter, `submitReport ${sym}`, () =>
      engine.submitReport(r.asset, r.halted, r.corporateActionPaused, r.uiMultiplier, r.referencePrice, r.observedAt, r.nonce, sig));
    log.info("report", { symbol: sym, halted: r.halted, corporateActionPaused: r.corporateActionPaused,
      uiMultiplier: r.uiMultiplier, referencePrice: r.referencePrice, observedAt: r.observedAt, nonce: r.nonce, signature: sig, txHash });
    return txHash;
  }

  /** Real API price (1e18/token) or the last known one; never throws in testnet-mock mode. */
  async function priceFor(sym: string): Promise<{ price: bigint; generatedAt: bigint | null }> {
    try {
      const q = await fetchQuote(sym);
      const price = referencePriceOf(q);
      lastPrice.set(sym, price);
      return { price, generatedAt: isoToSec(q.generatedAt) };
    } catch (e) {
      if (!lastPrice.has(sym)) {
        const [, answer] = await feedOf(sym).latestRoundData();
        lastPrice.set(sym, BigInt(answer) * (await feedScale(sym)));
      }
      log.warn("api unavailable, keeping last price", { symbol: sym, error: e });
      return { price: lastPrice.get(sym)!, generatedAt: null };
    }
  }

  /** Write `price` (1e18) to the mock feed; returns the exact price the feed now reports (1e18). */
  async function writeFeed(sym: string, price: bigint): Promise<{ written: bigint; txHash: string }> {
    const scale = await feedScale(sym);
    const answer = price / scale;
    const txHash = await send(feedAdmin!, `feed ${sym}`, () => feedOf(sym).updateAnswer(answer));
    return { written: answer * scale, txHash };
  }

  async function tickTestnet(sym: string): Promise<string[]> {
    const sc = active.get(sym);
    if (sc === "STALE") return []; // feed updates paused for this symbol so it stays stale
    const hashes: string[] = [];
    const { price, generatedAt } = await priceFor(sym);
    let ref: bigint;
    if (sc === "DEVIATION") {
      ref = devRef.get(sym)!; // feed was moved +8%; reference stays
    } else {
      const w = await writeFeed(sym, price);
      hashes.push(w.txHash);
      ref = w.written;
    }
    const uiMultiplier = BigInt(await tokenOf(sym).uiMultiplier());
    hashes.push(await submit(sym, { halted: sc === "HALT", corporateActionPaused: false, uiMultiplier, referencePrice: ref }, generatedAt));
    return hashes;
  }

  async function tickProduction(): Promise<string[]> {
    const [assets, actions] = await Promise.all([fetchAssets(), fetchCorporateActions()]);
    const expected = [...(opts.canonical ?? []), ...stocks.map((s) => ({ symbol: s, address: dep.assets[s].token }))];
    verifyCanonical(expected, assets, 4663); // throws => refuse to report
    const byS = new Map<string, ApiAsset>(assets.map((a) => [a.tokenSymbol, a]));
    const hashes: string[] = [];
    for (const sym of stocks) {
      try {
        const a = byS.get(sym)!;
        const q = await fetchQuote(sym);
        const dq = q.deployments.find((d) => d.chainId === 4663);
        if (!dq || dq.contractAddress.toLowerCase() !== dep.assets[sym].token.toLowerCase()) throw new Error(`${sym}: quote deployment mismatch`);
        const uiMultiplier = parseDecimal(a.currentMultiplier);
        const onchain = BigInt(await new Contract(dep.assets[sym].token, abi("MockStockToken"), provider).uiMultiplier());
        if (onchain !== uiMultiplier) log.warn("multiplier differs from onchain (engine will pause)", { symbol: sym, api: uiMultiplier, onchain });
        const paused = corporateActionPaused(sym, a, actions as CorpAction[], Math.floor(Date.now() / 1000), windowSec);
        hashes.push(await submit(sym, { halted: q.isTradingHalt, corporateActionPaused: paused, uiMultiplier,
          referencePrice: referencePriceOf(q, a.currentMultiplier) }, isoToSec(q.generatedAt)));
      } catch (e) {
        log.error("report failed", { symbol: sym, error: e }); // no report => engine goes STALE (fail closed)
      }
    }
    return hashes;
  }

  async function runOnce(): Promise<string[]> {
    const job = running.then(async () => {
      if (mode === "production") return tickProduction();
      const hashes: string[] = [];
      for (const sym of stocks) {
        try {
          hashes.push(...(await tickTestnet(sym)));
        } catch (e) {
          log.error("tick failed", { symbol: sym, error: e });
        }
      }
      return hashes;
    });
    running = job.catch(() => undefined);
    return job;
  }

  /** Apply a demo scenario with real onchain transactions. Testnet/local only. */
  async function simulate(symbol: string, scenario: Scenario): Promise<string[]> {
    if (mode !== "testnet-mock") throw new Error("scenarios are testnet-only");
    if (!stocks.includes(symbol)) throw new Error(`unknown stock symbol ${symbol}`);
    const job = running.then(async () => {
      const hashes: string[] = [];
      const seq = new Contract(dep.contracts.MockSequencerUptimeFeed, abi("MockSequencerUptimeFeed"), feedAdmin);
      switch (scenario) {
        case "HALT": {
          active.set(symbol, "HALT");
          const [, answer] = await feedOf(symbol).latestRoundData();
          const ref = BigInt(answer) * (await feedScale(symbol));
          const uiMultiplier = BigInt(await tokenOf(symbol).uiMultiplier());
          hashes.push(await submit(symbol, { halted: true, corporateActionPaused: false, uiMultiplier, referencePrice: ref }, null));
          break;
        }
        case "STALE": {
          active.set(symbol, "STALE");
          const [, answer] = await feedOf(symbol).latestRoundData();
          const cfg = await engine.getAssetConfig(dep.assets[symbol].token);
          const at = (await blockTs()) - BigInt(cfg.heartbeat) - 60n;
          hashes.push(await send(feedAdmin!, `stale ${symbol}`, () => feedOf(symbol).updateAnswerAt(answer, at)));
          hashes.push(await send(reporter, `refresh ${symbol}`, () => engine.refresh(dep.assets[symbol].token)));
          break;
        }
        case "DEVIATION": {
          const { price } = await priceFor(symbol);
          const w = await writeFeed(symbol, price);
          hashes.push(w.txHash);
          devRef.set(symbol, w.written);
          active.set(symbol, "DEVIATION");
          const uiMultiplier = BigInt(await tokenOf(symbol).uiMultiplier());
          hashes.push(await submit(symbol, { halted: false, corporateActionPaused: false, uiMultiplier, referencePrice: w.written }, null));
          hashes.push((await writeFeed(symbol, (w.written * 108n) / 100n)).txHash);
          hashes.push(await send(reporter, `refresh ${symbol}`, () => engine.refresh(dep.assets[symbol].token)));
          break;
        }
        case "CORP_ACTION": {
          active.set(symbol, "CORP_ACTION");
          hashes.push(await send(feedAdmin!, `oraclePaused ${symbol}`, () => tokenOf(symbol).setOraclePaused(true)));
          hashes.push(await send(reporter, `refresh ${symbol}`, () => engine.refresh(dep.assets[symbol].token)));
          break;
        }
        case "SEQUENCER_DOWN": {
          sequencerDown = true;
          hashes.push(await send(feedAdmin!, "sequencer down", () => seq.setStatus(true, 0)));
          hashes.push(await send(reporter, `refresh ${symbol}`, () => engine.refresh(dep.assets[symbol].token)));
          break;
        }
        case "RESET": {
          active.clear();
          devRef.clear();
          const now = await blockTs(); // startedAt in the past => grace period already elapsed
          hashes.push(await send(feedAdmin!, "sequencer up", () => seq.setStatus(false, now - 3600n)));
          sequencerDown = false;
          for (const s of stocks) {
            if (await tokenOf(s).oraclePaused()) hashes.push(await send(feedAdmin!, `unpause ${s}`, () => tokenOf(s).setOraclePaused(false)));
          }
          break;
        }
      }
      return hashes;
    });
    running = job.catch(() => undefined);
    const hashes = await job;
    // RESET: restore feeds + fresh reports for every asset through the normal loop path
    if (scenario === "RESET") hashes.push(...(await runOnce()));
    return hashes;
  }

  function start(intervalSec = 30) {
    if (timer) return;
    const tick = () => runOnce().catch((e) => log.error("loop tick failed", { error: e }));
    tick();
    timer = setInterval(tick, intervalSec * 1000);
    log.info("reporter loop started", { mode, intervalSec, chainId: dep.chainId, reporter: reporter.address });
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    mode,
    runOnce,
    simulate,
    start,
    stop,
    activeScenarios: () => ({ ...Object.fromEntries(active), ...(sequencerDown ? { SEQUENCER: "SEQUENCER_DOWN" } : {}) }),
    idle: () => running,
    E18,
  };
}
export type Reporter = ReturnType<typeof createReporter>;
