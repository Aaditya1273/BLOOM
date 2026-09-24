// Deploys the Stylus BloomRiskEngine with `cargo stylus deploy`.
//   node scripts/deploy-stylus.js testnet
//   node scripts/deploy-stylus.js mainnet   (requires MAINNET_DEPLOY=true, MAINNET_DEPLOY_CONFIRM=YES_I_UNDERSTAND
//                                            and an estimate below MAINNET_MAX_DEPLOYMENT_USD)
// The key is read from DEPLOYER_PRIVATE_KEY and handed to cargo-stylus through a 0600 temp file (never argv).
require("dotenv").config({ quiet: true });
require("./lib/ethers-fetch");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ethers } = require("ethers");

const NETWORKS = {
  testnet: { chainId: 46630, rpc: process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com", maxReportAge: 3600 },
  mainnet: { chainId: 4663, rpc: process.env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", maxReportAge: 900 },
};
const ETH_USD_FEED = require("../config/robinhood-mainnet.json").ethUsdFeed;
const CRATE = path.join(__dirname, "..", "stylus-risk-engine");
const CARGO = process.env.CARGO || path.join(os.homedir(), ".cargo", "bin", "cargo");

function run(args, keyFile) {
  const argv = ["stylus", ...args, ...(args[0] === "deploy" ? ["--private-key-path", keyFile] : [])];
  const r = spawnSync(CARGO, argv, { cwd: CRATE, encoding: "utf8" });
  const out = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  if (r.status !== 0) throw new Error(`cargo stylus ${args[0]} failed:\n${out.slice(-2000)}`);
  return out;
}

async function main() {
  const name = process.argv[2];
  const net = NETWORKS[name];
  if (!net) throw new Error("usage: node scripts/deploy-stylus.js <testnet|mainnet>");
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  const owner = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY).address;
  const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });

  const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bloom-")), "key");
  fs.writeFileSync(keyFile, process.env.DEPLOYER_PRIVATE_KEY, { mode: 0o600 });
  const common = ["--endpoint", net.rpc, "--constructor-args", owner, String(net.maxReportAge)];
  try {
    const check = run(["check", "--endpoint", net.rpc], keyFile);
    const dataFeeEth = Number(check.match(/wasm data fee:\s*([0-9.]+)\s*ETH/i)?.[1] ?? "NaN");

    if (name === "mainnet") {
      if (process.env.MAINNET_DEPLOY !== "true" || process.env.MAINNET_DEPLOY_CONFIRM !== "YES_I_UNDERSTAND") {
        throw new Error("Mainnet deploy refused: set MAINNET_DEPLOY=true and MAINNET_DEPLOY_CONFIRM=YES_I_UNDERSTAND");
      }
      const est = run(["deploy", ...common, "--estimate-gas"], keyFile);
      const gas = [...est.matchAll(/(\d[\d,]*)\s*gas/gi)].map((m) => BigInt(m[1].replace(/,/g, ""))).reduce((a, b) => a + b, 0n);
      const fee = (await provider.getFeeData()).gasPrice;
      const feed = new ethers.Contract(ETH_USD_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"], provider);
      const ethUsd = Number(ethers.formatUnits((await feed.latestRoundData())[1], await feed.decimals()));
      if (gas === 0n) throw new Error(`could not parse gas estimate from cargo stylus output:\n${est}`);
      if (!Number.isFinite(dataFeeEth)) throw new Error("could not parse the WASM activation data fee from cargo stylus check");
      const usd = (Number(ethers.formatEther(gas * fee)) + dataFeeEth) * ethUsd;
      const max = Number(process.env.MAINNET_MAX_DEPLOYMENT_USD ?? "0.01");
      console.log(`Estimated Stylus deployment cost: $${usd.toFixed(4)} (${gas} gas + ${dataFeeEth} ETH activation data fee, ETH/USD $${ethUsd.toFixed(2)})`);
      if (!(usd < max)) throw new Error(`estimate >= MAINNET_MAX_DEPLOYMENT_USD=$${max}; raise it explicitly if intended`);
    }

    const out = run(["deploy", ...common], keyFile);
    const address = (out.match(/deployed code at address:?\s*(0x[0-9a-fA-F]{40})/i) || out.match(/(0x[0-9a-fA-F]{40})/))?.[1];
    if (!address) throw new Error(`could not find deployed address in output:\n${out.slice(-1500)}`);
    const code = await provider.getCode(address);
    if (code === "0x") throw new Error(`no code at ${address}`);
    const file = path.join(__dirname, "..", "deployments", `stylus-risk-engine-${name}.json`);
    fs.writeFileSync(file, JSON.stringify({ chainId: net.chainId, address, owner, maxReportAge: net.maxReportAge, deployedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`BloomRiskEngine (Stylus) deployed at ${address}\nNext: BLOOM_RISK_ENGINE_ADDRESS=${address} npm run deploy:${name}`);
  } finally {
    fs.rmSync(path.dirname(keyFile), { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`STYLUS DEPLOY FAILED: ${e.message}`);
  process.exitCode = 1;
});
