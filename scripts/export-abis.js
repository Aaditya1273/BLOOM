// Exports the ABIs the offchain services need into offchain/abi (committed, so services run without compiling).
const fs = require("fs");
const path = require("path");
const names = [
  "BloomAssetRegistry", "BloomRiskEngineEVM", "BloomVault", "StockRouter", "BloomClaims", "BloomPolicy",
  "BloomAccount", "BloomAccountFactory", "MockUSDG", "MockStockToken", "MockAggregatorV3", "MockSequencerUptimeFeed",
  "MockLendingAdapter", "MockSwapVenue", "EntryPoint",
];
const root = path.join(__dirname, "..");
const outDir = path.join(root, "offchain", "abi");
fs.mkdirSync(outDir, { recursive: true });
function find(dir, file) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = find(p, file); if (r) return r; } else if (e.name === file) return p;
  }
}
for (const n of names) {
  const f = find(path.join(root, "artifacts"), `${n}.json`);
  if (!f) throw new Error(`artifact ${n} not found; run npx hardhat compile`);
  const { abi } = JSON.parse(fs.readFileSync(f, "utf8"));
  fs.writeFileSync(path.join(outDir, `${n}.json`), JSON.stringify(abi, null, 2) + "\n");
}
// the Stylus engine exposes the same ABI as the EVM twin
fs.copyFileSync(path.join(outDir, "BloomRiskEngineEVM.json"), path.join(outDir, "BloomRiskEngine.json"));
console.log(`exported ${names.length} ABIs -> offchain/abi`);
