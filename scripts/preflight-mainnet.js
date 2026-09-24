// Mainnet deployment preflight. Runs on an in-process Hardhat FORK of Robinhood Chain mainnet:
//  1. verifies every configured asset against the official Robinhood Stock Token API and onchain (code, decimals)
//  2. verifies Chainlink feed decimals and freshness
//  3. dry-runs the full production deployment on the fork and records every transaction
//  4. estimates cost = sum(L2 gasUsed + L1 data component via NodeInterface) * live gas price * live ETH/USD (Chainlink)
//  5. exits non-zero if anything fails or cost >= MAINNET_MAX_DEPLOYMENT_USD (default 0.01)
const { ethers, network } = require("hardhat");
const { deployMainnetSystem } = require("./lib/system");
const cfg = require("../config/robinhood-mainnet.json");

const RPC = process.env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const MAX_USD = Number(process.env.MAINNET_MAX_DEPLOYMENT_USD ?? "0.01");
const API = "https://api.robinhood.com/rhj/assets";
const ERC20 = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const FEED = ["function decimals() view returns (uint8)", "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];
const NODE_INTERFACE = "0x00000000000000000000000000000000000000C8";
const NI_ABI = ["function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"];

function fail(msg) {
  console.error(`\nPREFLIGHT FAILED: ${msg}`);
  process.exit(1);
}

async function verifyCanonical(live) {
  console.log("1) Canonical asset verification");
  // ethers' FetchRequest: Hardhat replaces the global fetch dispatcher, which breaks plain fetch() here
  const res = await new ethers.FetchRequest(API).send();
  if (res.statusCode !== 200) fail(`Robinhood asset API returned ${res.statusCode}`);
  const { assets } = res.bodyJson;
  const now = Math.floor(Date.now() / 1000);
  for (const s of cfg.stockTokens) {
    const a = assets.find((x) => x.tokenSymbol === s.symbol);
    const dep = a?.deployments?.find((d) => d.chainId === cfg.chainId);
    if (!dep) fail(`${s.symbol} not listed for chain ${cfg.chainId} in ${API}`);
    if (dep.contractAddress.toLowerCase() !== s.address.toLowerCase()) fail(`${s.symbol} address mismatch: config ${s.address} vs official ${dep.contractAddress}`);
    if ((await live.getCode(s.address)) === "0x") fail(`${s.symbol} has no code`);
    const dec = await new ethers.Contract(s.address, ERC20, live).decimals();
    if (Number(dec) !== 18) fail(`${s.symbol} decimals ${dec} != 18`);
    const feed = new ethers.Contract(s.feed, FEED, live);
    const fdec = await feed.decimals();
    const [, answer, , updatedAt] = await feed.latestRoundData();
    if (Number(fdec) !== cfg.feedDecimals || answer <= 0n) fail(`${s.symbol} feed invalid`);
    const age = now - Number(updatedAt);
    console.log(`   ${s.symbol.padEnd(5)} ${s.address}  official ✓  decimals 18 ✓  feed $${ethers.formatUnits(answer, fdec)} (age ${age}s)`);
    if (age > cfg.risk.heartbeat) console.log(`   ! ${s.symbol} feed older than heartbeat right now (markets closed?) — engine will report STALE until it updates`);
  }
  const usdgDec = await new ethers.Contract(cfg.stable.address, ERC20, live).decimals();
  if (Number(usdgDec) !== cfg.stable.decimals) fail("USDG decimals mismatch");
  console.log(`   USDG  ${cfg.stable.address}  decimals ${usdgDec} ✓`);
}

async function main() {
  if (network.name !== "hardhat") fail("preflight must run with --network hardhat (it forks mainnet in-process)");
  const live = new ethers.JsonRpcProvider(RPC, cfg.chainId, { staticNetwork: true });
  if (Number((await live.getNetwork()).chainId) !== cfg.chainId) fail("RPC is not Robinhood Chain mainnet");
  await verifyCanonical(live);

  console.log("2) Dry-run deployment on a fork of mainnet");
  await network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: RPC } }] });
  await network.provider.send("hardhat_mine", ["0x1"]);
  const deployer = process.env.PREFLIGHT_DEPLOYER || (await ethers.getSigners())[0].address;
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [deployer] });
  await network.provider.send("hardhat_setBalance", [deployer, "0x3635C9ADC5DEA00000"]);
  const admin = await ethers.getSigner(deployer);
  const startBlock = await ethers.provider.getBlockNumber();
  const localChainId = Number((await ethers.provider.getNetwork()).chainId);
  await deployMainnetSystem(cfg, {
    admin,
    reporterAddress: process.env.PREFLIGHT_REPORTER || deployer,
    claimAuthorityAddress: process.env.PREFLIGHT_CLAIM_AUTHORITY || deployer,
    riskEngineAddress: undefined,
    allowEvmRiskEngine: true, // dry-run includes the engine so the estimate is an upper bound
    expectedChainId: localChainId,
  });
  const endBlock = await ethers.provider.getBlockNumber();

  console.log("3) Cost estimate");
  const ni = new ethers.Contract(NODE_INTERFACE, NI_ABI, live);
  let l2Gas = 0n, l1Gas = 0n, txs = 0;
  for (let b = startBlock + 1; b <= endBlock; b++) {
    const block = await ethers.provider.getBlock(b, true);
    for (const tx of block.prefetchedTransactions) {
      const rc = await ethers.provider.getTransactionReceipt(tx.hash);
      l2Gas += rc.gasUsed;
      const create = tx.to === null;
      const [l1] = await ni.gasEstimateL1Component.staticCall(create ? ethers.ZeroAddress : tx.to, create, tx.data);
      l1Gas += l1;
      txs++;
    }
  }
  const fee = await live.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas;
  const ethUsdFeed = new ethers.Contract(cfg.ethUsdFeed, FEED, live);
  const [, ethUsdRaw] = await ethUsdFeed.latestRoundData();
  const ethUsd = Number(ethers.formatUnits(ethUsdRaw, await ethUsdFeed.decimals()));
  const costWei = (l2Gas + l1Gas) * gasPrice;
  const costEth = Number(ethers.formatEther(costWei));
  const costUsd = costEth * ethUsd;
  console.log(`   transactions:      ${txs}`);
  console.log(`   L2 execution gas:  ${l2Gas}`);
  console.log(`   L1 data gas:       ${l1Gas} (NodeInterface.gasEstimateL1Component)`);
  console.log(`   gas price:         ${ethers.formatUnits(gasPrice, "gwei")} gwei (live)`);
  console.log(`   ETH/USD:           $${ethUsd.toFixed(2)} (Chainlink ${cfg.ethUsdFeed})`);
  console.log(`\n   Estimated deployment cost: ${costEth.toFixed(8)} ETH = $${costUsd.toFixed(4)}`);
  if (!(costUsd < MAX_USD)) {
    fail(`estimated cost $${costUsd.toFixed(4)} >= MAINNET_MAX_DEPLOYMENT_USD=$${MAX_USD}. Raise the limit explicitly if intended.`);
  }
  console.log(`   within limit $${MAX_USD} ✓\n`);
}

main().catch((e) => fail(e.message));
