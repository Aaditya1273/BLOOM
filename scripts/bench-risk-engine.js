// Gas benchmark: Bloom Risk Engine, Stylus (live, Robinhood Chain Testnet) vs its EVM twin (Hardhat, same ABI).
//   npx hardhat run scripts/bench-risk-engine.js            (sends NO testnet transaction)
// Measures steady-state submitReport (a report that updates an existing one) and getRisk.
// Stylus execution gas = receipt gasUsed − gasUsedForL1 (Arbitrum receipts split out the L1 data component);
// getRisk on Stylus = eth_estimateGas − NodeInterface.gasEstimateL1Component for the same calldata.
const { ethers } = require("hardhat");
const { systemFixture } = require("../test/fixtures");
const dep = require("../deployments/robinhood-testnet.json");

const RPC = process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const NODE_INTERFACE = "0x00000000000000000000000000000000000000C8";
const NI_ABI = ["function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"];
const ENGINE_ABI = [
  "function getRisk(address) view returns (uint8,uint16,bool,bool,uint256,uint256)",
  "event HaltUpdated(address indexed asset, bool halted, uint64 observedAt, uint64 nonce, address reporter)",
];

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function main() {
  // ── EVM twin (Hardhat, cancun, viaIR) ──
  const f = await systemFixture(); // deploys the system and submits a first report per asset
  const evmReport = [];
  for (let i = 0; i < 5; i++) {
    const tx = await f.report("AAPL"); // steady-state update of an existing report
    evmReport.push(Number((await tx.wait()).gasUsed));
  }
  const aapl = f.stocks.AAPL.token.target;
  const evmGetRisk = Number(await f.engine.getRisk.estimateGas(aapl)) - 21000; // execution only (minus intrinsic)

  // ── Stylus (live) ──
  const live = new ethers.JsonRpcProvider(RPC, 46630, { staticNetwork: true });
  const engine = new ethers.Contract(dep.contracts.BloomRiskEngine, ENGINE_ABI, live);
  const head = await live.getBlockNumber();
  const logs = await live.getLogs({ address: dep.contracts.BloomRiskEngine, topics: [engine.interface.getEvent("HaltUpdated").topicHash], fromBlock: head - 40000, toBlock: head });
  const recent = logs.slice(-12);
  const stylusReport = [];
  for (const l of recent) {
    const rc = await rpc("eth_getTransactionReceipt", [l.transactionHash]);
    if (rc.status !== "0x1") continue;
    const used = Number(rc.gasUsed);
    const l1 = Number(rc.gasUsedForL1 ?? 0);
    const calldataL2 = 0; // intrinsic + calldata are part of gasUsed on both chains; reported separately below
    stylusReport.push({ total: used, l1, exec: used - l1 - calldataL2 });
  }
  const tokenAAPL = dep.assets.AAPL.token;
  const data = engine.interface.encodeFunctionData("getRisk", [tokenAAPL]);
  const est = Number(await rpc("eth_estimateGas", [{ to: dep.contracts.BloomRiskEngine, data }, "latest"]));
  const ni = new ethers.Contract(NODE_INTERFACE, NI_ABI, live);
  const [l1Est] = await ni.gasEstimateL1Component.staticCall(dep.contracts.BloomRiskEngine, false, data);
  const stylusGetRisk = est - Number(l1Est) - 21000;

  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const out = {
    measuredAt: new Date().toISOString(),
    evm: { submitReportGas: evmReport, submitReportMedian: med(evmReport), getRiskExecGas: evmGetRisk },
    stylus: {
      engine: dep.contracts.BloomRiskEngine,
      submitReport: stylusReport,
      submitReportExecMedian: med(stylusReport.map((s) => s.exec)),
      getRisk: { estimateGas: est, l1Component: Number(l1Est), execGas: stylusGetRisk },
    },
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
