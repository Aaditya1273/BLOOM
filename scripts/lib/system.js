// Shared deployment logic for Bloom. Used by the Hardhat test fixtures and by scripts/deploy.js,
// so the demo system that tests exercise is exactly the system that gets deployed.
const { ethers } = require("hardhat");

const sym = (s) => ethers.encodeBytes32String(s);
const KIND = { NONE: 0, STABLE: 1, STOCK_TOKEN: 2 };

async function deployContract(name, args, log) {
  const f = await ethers.getContractFactory(name);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  if (log) log(`  ${name.padEnd(26)} ${await c.getAddress()}`);
  return c;
}

/**
 * Deploy the complete TESTNET system with mocks.
 * @param {object} cfg        parsed config/robinhood-testnet.json (or a test override)
 * @param {object} opts       { admin, reporter, claimAuthority, riskEngineAddress?, log? }
 *   riskEngineAddress: use an already-deployed engine (e.g. the Stylus engine). Otherwise the EVM twin is deployed.
 */
async function deployTestnetSystem(cfg, opts) {
  const { admin, reporter, claimAuthority, log } = opts;
  const adminAddr = await admin.getAddress();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const out = { chainId: Number(chainId), mode: "testnet-mocks", contracts: {}, assets: {} };
  const put = (k, c) => (out.contracts[k] = c.target ?? c);

  // Use the canonical EntryPoint when it exists on the target chain; deploy a local one otherwise (Hardhat).
  let entryPoint;
  if (cfg.entryPoint && (await ethers.provider.getCode(cfg.entryPoint)) !== "0x") {
    entryPoint = await ethers.getContractAt("EntryPoint", cfg.entryPoint);
  } else {
    entryPoint = await deployContract("EntryPoint", [], log);
  }
  put("EntryPoint", entryPoint);
  const registry = await deployContract("BloomAssetRegistry", [adminAddr, chainId], log);
  put("BloomAssetRegistry", registry);

  const usdg = await deployContract("MockUSDG", [adminAddr], log);
  put("MockUSDG", usdg);
  await (await registry.registerAsset(sym("USDG"), usdg.target, ethers.ZeroAddress, 6, KIND.STABLE)).wait();
  out.assets.USDG = { token: usdg.target, decimals: 6, kind: "STABLE" };

  // sequencer mock, started well in the past so the grace period has elapsed
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const sequencer = await deployContract("MockSequencerUptimeFeed", [adminAddr, now - 3600], log);
  put("MockSequencerUptimeFeed", sequencer);

  let engine;
  if (opts.riskEngineAddress) {
    engine = await ethers.getContractAt("BloomRiskEngineEVM", opts.riskEngineAddress); // same ABI as Stylus engine
    out.contracts.BloomRiskEngine = opts.riskEngineAddress;
    out.riskEngineImpl = "stylus";
  } else {
    engine = await deployContract("BloomRiskEngineEVM", [adminAddr, cfg.risk.maxReportAge], log);
    out.contracts.BloomRiskEngine = engine.target;
    out.riskEngineImpl = "evm-reference";
  }
  await (await engine.setSequencerConfig(sequencer.target, cfg.risk.sequencer.grace, cfg.risk.sequencer.required)).wait();
  await (await engine.setReporter(await reporter.getAddress(), true)).wait();

  const stocks = {};
  for (const s of cfg.stockTokens) {
    const token = await deployContract("MockStockToken", [s.name, s.symbol, adminAddr], log);
    const feed = await deployContract(
      "MockAggregatorV3",
      [cfg.feedDecimals, `${s.symbol} / USD (testnet mock)`, ethers.parseUnits(s.initialPrice, cfg.feedDecimals), adminAddr],
      log
    );
    await (await registry.registerAsset(sym(s.symbol), token.target, feed.target, 18, KIND.STOCK_TOKEN)).wait();
    await (
      await engine.setAssetConfig(token.target, feed.target, cfg.risk.heartbeat, cfg.risk.deviationBps, cfg.risk.maxLtvBps, true, true)
    ).wait();
    stocks[s.symbol] = { token, feed };
    out.assets[s.symbol] = { token: token.target, feed: feed.target, decimals: 18, kind: "STOCK_TOKEN" };
  }

  const vault = await deployContract("BloomVault", [usdg.target, registry.target, engine.target, adminAddr], log);
  put("BloomVault", vault);
  const adapter = await deployContract("MockLendingAdapter", [usdg.target, vault.target, cfg.lending.aprBps, adminAddr], log);
  put("MockLendingAdapter", adapter);
  await (await vault.setAdapter(adapter.target)).wait();

  const router = await deployContract("StockRouter", [registry.target, adminAddr], log);
  put("StockRouter", router);
  const venue = await deployContract("MockSwapVenue", [engine.target, registry.target, adminAddr], log);
  put("MockSwapVenue", venue);
  await (await router.setVenue(venue.target, true)).wait();

  const claims = await deployContract("BloomClaims", [registry.target, await claimAuthority.getAddress(), adminAddr], log);
  put("BloomClaims", claims);
  const policy = await deployContract("BloomPolicy", [registry.target, engine.target, vault.target, router.target, claims.target], log);
  put("BloomPolicy", policy);
  const factory = await deployContract("BloomAccountFactory", [entryPoint.target, policy.target], log);
  put("BloomAccountFactory", factory);

  // venue inventory so the demo "Invest" flow can buy Stock Tokens
  for (const { token } of Object.values(stocks)) {
    await (await token.mint(venue.target, ethers.parseUnits("100000", 18))).wait();
  }
  await (await usdg.mint(venue.target, ethers.parseUnits("1000000", 6))).wait();

  return { out, entryPoint, registry, usdg, sequencer, engine, stocks, vault, adapter, router, venue, claims, policy, factory };
}

// ── EIP-712 market report signing (shared by tests and the reporter) ──
const REPORT_TYPES = {
  MarketReport: [
    { name: "asset", type: "address" },
    { name: "halted", type: "bool" },
    { name: "corporateActionPaused", type: "bool" },
    { name: "uiMultiplier", type: "uint256" },
    { name: "referencePrice", type: "uint256" },
    { name: "observedAt", type: "uint64" },
    { name: "nonce", type: "uint64" },
  ],
};

async function signReport(signer, engineAddress, chainId, report) {
  const domain = { name: "BloomRiskEngine", version: "1", chainId, verifyingContract: engineAddress };
  return signer.signTypedData(domain, REPORT_TYPES, report);
}

module.exports = { deployTestnetSystem, deployContract, signReport, REPORT_TYPES, sym, KIND };

/**
 * Deploy the PRODUCTION system on Robinhood Chain mainnet. No mocks are ever deployed here.
 * Canonical assets come from config/robinhood-mainnet.json (sourced from docs.robinhood.com + Chainlink directory)
 * and are verified by scripts/preflight-mainnet.js before this runs.
 * @param opts { admin, reporterAddress, claimAuthorityAddress, riskEngineAddress?, allowEvmRiskEngine?, expectedChainId?, log? }
 */
async function deployMainnetSystem(cfg, opts) {
  const { admin, reporterAddress, claimAuthorityAddress, log } = opts;
  const adminAddr = await admin.getAddress();
  const chainId = opts.expectedChainId ?? Number((await ethers.provider.getNetwork()).chainId);
  const out = { chainId, mode: "production", contracts: {}, assets: {} };

  if (!cfg.entryPoint || (await ethers.provider.getCode(cfg.entryPoint)) === "0x") throw new Error("EntryPoint not found on chain");
  out.contracts.EntryPoint = cfg.entryPoint;

  const registry = await deployContract("BloomAssetRegistry", [adminAddr, chainId], log);
  out.contracts.BloomAssetRegistry = registry.target;
  await (await registry.registerAsset(sym(cfg.stable.symbol), cfg.stable.address, ethers.ZeroAddress, cfg.stable.decimals, KIND.STABLE)).wait();
  out.assets[cfg.stable.symbol] = { token: cfg.stable.address, decimals: cfg.stable.decimals, kind: "STABLE" };

  let engine;
  if (opts.riskEngineAddress) {
    engine = await ethers.getContractAt("BloomRiskEngineEVM", opts.riskEngineAddress);
    out.riskEngineImpl = "stylus";
  } else if (opts.allowEvmRiskEngine) {
    engine = await deployContract("BloomRiskEngineEVM", [adminAddr, cfg.risk.maxReportAge], log);
    out.riskEngineImpl = "evm-reference";
  } else {
    throw new Error("Mainnet requires BLOOM_RISK_ENGINE_ADDRESS (the deployed Stylus engine) or ALLOW_EVM_RISK_ENGINE=true");
  }
  out.contracts.BloomRiskEngine = engine.target;
  // No Chainlink sequencer uptime feed exists for Robinhood Chain: recorded explicitly onchain.
  await (await engine.setSequencerConfig(ethers.ZeroAddress, 0, false)).wait();
  await (await engine.setReporter(reporterAddress, true)).wait();

  for (const s of cfg.stockTokens) {
    await (await registry.registerAsset(sym(s.symbol), s.address, s.feed, 18, KIND.STOCK_TOKEN)).wait();
    await (await engine.setAssetConfig(s.address, s.feed, cfg.risk.heartbeat, cfg.risk.deviationBps, cfg.risk.maxLtvBps, true, true)).wait();
    out.assets[s.symbol] = { token: s.address, feed: s.feed, decimals: 18, kind: "STOCK_TOKEN" };
  }

  const vault = await deployContract("BloomVault", [cfg.stable.address, registry.target, engine.target, adminAddr], log);
  out.contracts.BloomVault = vault.target;
  const router = await deployContract("StockRouter", [registry.target, adminAddr], log);
  out.contracts.StockRouter = router.target;
  const claims = await deployContract("BloomClaims", [registry.target, claimAuthorityAddress, adminAddr], log);
  out.contracts.BloomClaims = claims.target;
  const policy = await deployContract("BloomPolicy", [registry.target, engine.target, vault.target, router.target, claims.target], log);
  out.contracts.BloomPolicy = policy.target;
  const factory = await deployContract("BloomAccountFactory", [cfg.entryPoint, policy.target], log);
  out.contracts.BloomAccountFactory = factory.target;
  out.notes = { lending: cfg.lending.reason, sequencer: cfg.risk.sequencer.reason, swapVenue: "none approved" };
  return out;
}

module.exports.deployMainnetSystem = deployMainnetSystem;
