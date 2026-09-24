/**
 * Simulates what the /trade frontend does when a user signs a LIMIT order:
 *   1. Connect to Arbitrum Sepolia with the EOA private key
 *   2. Encode store_order(...) on the Stylus LOB
 *   3. Send the tx and wait for receipt
 *   4. Print the new order id
 *
 * Picks an aggressive BID limit ($300 above mid) so the next Keeper cycle
 * matches it immediately — which is what we want to demo: book grows, then
 * keeper drains it.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), override: true });
const { ethers } = require("ethers");

const STYLUS = process.env.STYLUS_LOB_ADDRESS;
const RPC    = process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc";
const PK     = process.env.PRIVATE_KEY;

const ABI = [
  "function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) returns (uint256)",
  "function get_stats() view returns (uint256, uint256, uint256)",
];

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet   = new ethers.Wallet(PK, provider);
  const lob      = new ethers.Contract(STYLUS, ABI, wallet);

  // Read current ETH from Pyth so we know what an "aggressive" bid looks like.
  const pythRes = await fetch(
    "https://hermes.pyth.network/v2/updates/price/latest?ids[]=ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"
  );
  const pythData = await pythRes.json();
  const ethEntry = pythData.parsed[0];
  const ethMid   = Number(ethEntry.price.price) * Math.pow(10, ethEntry.price.expo);

  // BID at $300 above mid → BID is fillable when current_price <= limit_price,
  // so this should match in the next keeper cycle (keeper feeds current=mid<bid).
  const bidPrice = ethMid + 300;
  const assetHash = BigInt(ethers.keccak256(ethers.toUtf8Bytes("ETH")));

  console.log(`Wallet:      ${wallet.address}`);
  console.log(`Stylus LOB:  ${STYLUS}`);
  console.log(`ETH mid:     $${ethMid.toFixed(2)}`);
  console.log(`Placing BID: $${bidPrice.toFixed(2)} (300 above mid → fillable)`);

  const stats0 = await lob.get_stats();
  console.log(`Stats pre :  nextId=${stats0[0]} placed=${stats0[1]} filled=${stats0[2]}`);

  const tx = await lob.store_order(
    wallet.address,
    assetHash,
    true,                                    // BID
    ethers.parseUnits("100", 18),            // 100 collateral
    1n,                                      // 1x leverage
    ethers.parseUnits(bidPrice.toFixed(2), 18)
  );
  console.log(`TX sent:     ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Block:       ${receipt.blockNumber} | gasUsed: ${receipt.gasUsed}`);

  const stats1 = await lob.get_stats();
  console.log(`Stats post:  nextId=${stats1[0]} placed=${stats1[1]} filled=${stats1[2]}`);
  console.log(`✅ Order placed — order id is ${stats1[0] - 1n}`);
})();
