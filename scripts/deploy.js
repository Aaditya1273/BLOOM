// Bloom deployment entry point.
//   Local:    npx hardhat run scripts/deploy.js --network localhost
//   Testnet:  npx hardhat run scripts/deploy.js --network robinhoodTestnet
//   Mainnet:  npx hardhat run scripts/deploy.js --network robinhoodMainnet   (gated, see DEPLOYMENT.md)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ethers, network } = require("hardhat");
const { deployTestnetSystem, deployMainnetSystem } = require("./lib/system");
const { testnetRoleKey } = require("./lib/env");

const log = (m) => console.log(m);
const addrFromKey = (k) => (k ? new ethers.Wallet(k).address : undefined);

function writeDeployment(name, data) {
  const file = path.join(__dirname, "..", "deployments", `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...data, network: network.name, deployedAt: new Date().toISOString() }, null, 2) + "\n");
  log(`\nDeployment written to deployments/${name}.json`);
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const signers = await ethers.getSigners();
  if (signers.length === 0) throw new Error("No deployer: set DEPLOYER_PRIVATE_KEY in .env");
  const admin = signers[0];
  log(`Network ${network.name} (chainId ${chainId}), deployer ${admin.address}`);

  if (chainId === 4663) {
    // ── MAINNET: hard gates first ──
    if (process.env.MAINNET_DEPLOY !== "true" || process.env.MAINNET_DEPLOY_CONFIRM !== "YES_I_UNDERSTAND") {
      throw new Error("Mainnet deploy refused: set MAINNET_DEPLOY=true and MAINNET_DEPLOY_CONFIRM=YES_I_UNDERSTAND");
    }
    const reporterAddress = process.env.REPORTER_ADDRESS || addrFromKey(process.env.REPORTER_PRIVATE_KEY);
    const claimAuthorityAddress = process.env.CLAIM_AUTHORITY_ADDRESS || addrFromKey(process.env.CLAIM_AUTHORITY_PRIVATE_KEY);
    if (!reporterAddress || !claimAuthorityAddress) throw new Error("Set REPORTER_ADDRESS and CLAIM_AUTHORITY_ADDRESS");
    // Preflight: canonical-asset verification + fork dry-run cost estimate. Exits non-zero if anything fails
    // or the estimated cost is >= MAINNET_MAX_DEPLOYMENT_USD.
    execFileSync("npx", ["hardhat", "run", path.join(__dirname, "preflight-mainnet.js"), "--network", "hardhat"], {
      stdio: "inherit",
      env: { ...process.env, PREFLIGHT_DEPLOYER: admin.address, PREFLIGHT_REPORTER: reporterAddress, PREFLIGHT_CLAIM_AUTHORITY: claimAuthorityAddress },
    });
    const cfg = require("../config/robinhood-mainnet.json");
    const out = await deployMainnetSystem(cfg, {
      admin, reporterAddress, claimAuthorityAddress, log,
      riskEngineAddress: process.env.BLOOM_RISK_ENGINE_ADDRESS,
      allowEvmRiskEngine: process.env.ALLOW_EVM_RISK_ENGINE === "true",
    });
    writeDeployment("robinhood-mainnet", out);
    return;
  }

  // ── TESTNET / LOCAL: mocks, no confirmation gate ──
  if (chainId !== 46630 && chainId !== 31337) throw new Error(`Refusing to deploy testnet mocks on chain ${chainId}`);
  const cfg = require("../config/robinhood-testnet.json");
  const local = chainId === 31337;
  // local: Hardhat dev accounts; testnet: separate keys if set, otherwise the deployer key (single-key testnet setup)
  const reporter = local ? signers[1] : new ethers.Wallet(testnetRoleKey("REPORTER_PRIVATE_KEY"));
  const claimAuthority = local ? signers[2] : new ethers.Wallet(testnetRoleKey("CLAIM_AUTHORITY_PRIVATE_KEY"));
  if (!reporter || !claimAuthority) throw new Error("Set REPORTER_PRIVATE_KEY and CLAIM_AUTHORITY_PRIVATE_KEY in .env");

  const sys = await deployTestnetSystem(cfg, { admin, reporter, claimAuthority, riskEngineAddress: process.env.BLOOM_RISK_ENGINE_ADDRESS, log });
  const out = { ...sys.out, roles: { admin: admin.address, reporter: await reporter.getAddress(), claimAuthority: await claimAuthority.getAddress() } };
  writeDeployment(local ? "localhost" : "robinhood-testnet", out);
}

main().catch((e) => {
  console.error(`\nDEPLOY FAILED: ${e.message}`);
  process.exitCode = 1;
});
