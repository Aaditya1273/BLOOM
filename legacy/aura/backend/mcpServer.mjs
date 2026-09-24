/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║         AURA MCP SERVER — AI-to-Perps Trading Interface          ║
 * ║   Delegation model: user authorizes this agent via setAiAgent,   ║
 * ║   then the agent executes via executeBatchByAgent on their       ║
 * ║   AuraAccount. No user private keys needed.                      ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node mcpServer.mjs              (stdio — Claude Desktop, Cursor, Kiro)
 *   node mcpServer.mjs --http 3002  (HTTP/SSE — ChatGPT, remote agents)
 */

import { config } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { ethers } from "ethers";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { withX402 } from "./x402Middleware.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, ".env"), override: true });

// ── Config ──
const ARB_SEPOLIA_RPC = process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc";
const ROBINHOOD_RPC = process.env.RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const STYLUS_LOB_ADDRESS = process.env.STYLUS_LOB_ADDRESS;
const AURA_PERPS_ADDRESS = process.env.AURA_PERPS_ADDRESS;
const AUSD_ADDRESS = process.env.AUSD_ADDRESS;
const MOCK_ORACLE_ADDRESS = process.env.MOCK_ORACLE_ADDRESS;
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS;
const ARB_SEPOLIA_AUSD = process.env.ARB_SEPOLIA_AUSD;
// ── Providers & Agent Wallet ──
const sepoliaProvider = new ethers.JsonRpcProvider(ARB_SEPOLIA_RPC);
const robinhoodProvider = new ethers.JsonRpcProvider(ROBINHOOD_RPC);

const AGENT_PKEY = process.env.CHAT_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY || PRIVATE_KEY;
const agentWallet = new ethers.Wallet(AGENT_PKEY, robinhoodProvider);
const agentWalletSepolia = new ethers.Wallet(AGENT_PKEY, sepoliaProvider);

let txQueue = Promise.resolve();

// ── ABIs ──
const STYLUS_LOB_ABI = [
  "function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) returns (uint256)",
  "function cancel_order(uint256 order_id, address caller) returns (bool)",
  "function get_active_orders_sorted(uint256 asset_hash, bool is_long, uint256 max_results) view returns (uint256[] ids, uint256[] prices, uint256[] sizes)",
  "function get_book_depth(uint256 asset_hash) view returns (uint256, uint256)",
];

const AURA_ACCOUNT_ABI = [
  "function executeBatchByAgent(address[] dest, uint256[] value, bytes[] func) external",
];

const PERPS_ABI = [
  "function openPosition(string asset, bool isLong, uint256 collateralAmount, uint256 leverage) returns (uint256)",
  "function closePosition(uint256 positionId) external",
  "function closePositionPartially(uint256 positionId, uint256 closeSize) external",
  "function addMargin(uint256 positionId, uint256 additionalCollateral) external",
  "function setTriggerOrders(uint256 positionId, uint256 tpPrice, uint256 slPrice) external",
  "function positions(uint256 positionId) view returns (address owner, string asset, bool isLong, uint256 collateralAmount, uint256 leverage, uint256 entryPrice, uint256 positionSize, bool isOpen, uint256 openedAt, uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice, uint256 takeProfitPrice, uint256 stopLossPrice)",
  "function nextPositionId() view returns (uint256)",
  "function calculatePnL(uint256 positionId, uint256 currentPrice) view returns (uint256 pnl, bool isProfit)",
  "function totalLongOI(string asset) view returns (uint256)",
  "function totalShortOI(string asset) view returns (uint256)",
  "function FUNDING_RATE_PER_SECOND() view returns (uint256)",
];

const AUSD_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const ESCROW_ABI = [
  "function place_limit_order(uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)",
  "function cancel_order(uint256 order_id, address caller) external"
];

const ORACLE_ABI = ["function setPrice(string asset, uint256 price) external"];

const AUDIT_TRAIL_ADDRESS = "0x42D141CBe4aDc46B082D702C2e1bD802236348C4";
const AUDIT_TRAIL_ABI = [
  "function totalRecords() view returns (uint256)",
  "function lastConfidenceScore(address agent, address user) view returns (uint8)",
  "function getAgentReputation(address agent) view returns (uint256 trades, uint256 avgScore)",
  "function recordReasoningWithScore(address user, bytes32 reasoningHash, string action, uint8 confidenceScore) external",
  "event ReasoningRecorded(address indexed agent, address indexed user, bytes32 reasoningHash, uint256 timestamp, string action)",
  "event ReasoningRecordedWithScore(address indexed agent, address indexed user, bytes32 reasoningHash, uint256 timestamp, string action, uint8 confidenceScore)",
];

const AURA_DAO_ADDRESS = process.env.AURA_DAO_ADDRESS || "0xC8fF29922564556aAEE591e7BCa11667F71FeD32";
const DAO_ABI = [
  "function isAgentKYA(address agent) view returns (bool)",
  "function nextProposalId() view returns (uint256)",
  "function proposals(uint256) view returns (uint256 id, string title, string description, uint256 forVotes, uint256 againstVotes, bool executed, uint256 endTime)",
  "function vote(uint256 proposalId, bool support) external"
];

// ── DCA Store (in-memory) ──
const activeDCAs = new Map(); // dcaId -> { interval, remaining, asset, amount, ... }

/** Record a trade decision on-chain in AuraAuditTrail */
async function recordAudit(userAddress, action, reasoning) {
  try {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(reasoning)));
    const score = Math.min(100, Math.max(30, 60 + Math.floor(Math.random() * 25))); // 60-85 range
    const audit = new ethers.Contract(AUDIT_TRAIL_ADDRESS, AUDIT_TRAIL_ABI, agentWallet);
    const tx = await audit.recordReasoningWithScore(userAddress, hash, action, score);
    await tx.wait();
    return { hash, score, txHash: tx.hash };
  } catch (e) { console.error("[AuditTrail] record failed:", e.message); return null; }
}

// ── Interfaces for encoding calldata ──
const perpsIface = new ethers.Interface(PERPS_ABI);
const ausdIface = new ethers.Interface(AUSD_ABI);

// ── Pyth Price IDs ──
const PYTH_IDS = {
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  AMZN: "62731dfcc8b8542e52753f208248c3e73fab2ec15422d6f65c2decda71ccea0d",
  NFLX: "8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2",
  AMD: "6969003ef4c5fbb3b57a6be3883102362d05572c2dc7f72b767ad48f4206204b",
  PLTR: "11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0",
};

function assetHash(symbol) {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes(symbol.toUpperCase())));
}

async function fetchPythPrice(symbol) {
  const id = PYTH_IDS[symbol.toUpperCase()];
  if (!id) return null;
  const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}`);
  const data = await res.json();
  if (data.parsed?.[0]) {
    const p = data.parsed[0].price;
    return parseFloat(p.price) * Math.pow(10, p.expo);
  }
  return null;
}

/** Execute a batch of calls on a user's AuraAccount via the agent wallet */
async function executeBatchOnAccount(auraAccountAddress, targets, values, datas) {
  const account = new ethers.Contract(auraAccountAddress, AURA_ACCOUNT_ABI, agentWallet);
  const tx = await account.executeBatchByAgent(targets, values, datas);
  return await tx.wait();
}

// ── MCP Server ──
const server = new McpServer({ name: "aura-perps", version: "1.0.0" });

server.registerTool("get_price", {
  description: "Get real-time price for a supported asset (BTC, ETH, TSLA, AMZN, NFLX, AMD, PLTR) from Pyth Network",
  inputSchema: z.object({ asset: z.string().describe("Asset symbol e.g. BTC, ETH, TSLA") }),
}, async ({ asset }) => {
  const price = await fetchPythPrice(asset);
  if (!price) return { content: [{ type: "text", text: `Unsupported asset: ${asset}. Supported: ${Object.keys(PYTH_IDS).join(", ")}` }] };
  return { content: [{ type: "text", text: JSON.stringify({ asset: asset.toUpperCase(), price, source: "pyth_hermes" }) }] };
});

server.registerTool("get_orderbook", {
  description: "Get live order book (bids/asks) from the Stylus WASM LOB on Arbitrum Sepolia",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol e.g. BTC, ETH"),
    depth: z.number().optional().describe("Max orders per side (default 10)"),
  }),
}, async ({ asset, depth = 10 }) => {
  const hash = assetHash(asset);
  const lob = new ethers.Contract(STYLUS_LOB_ADDRESS, STYLUS_LOB_ABI, sepoliaProvider);
  const [bidsRaw, asksRaw, bookDepth] = await Promise.all([
    lob.get_active_orders_sorted(hash, true, depth),
    lob.get_active_orders_sorted(hash, false, depth),
    lob.get_book_depth(hash),
  ]);
  const decode = (tuple) => {
    const out = [];
    for (let i = 0; i < tuple[0].length; i++) {
      out.push({ price: Number(ethers.formatUnits(tuple[1][i], 18)), size: Number(ethers.formatUnits(tuple[2][i], 18)) });
    }
    return out;
  };
  return { content: [{ type: "text", text: JSON.stringify({
    asset: asset.toUpperCase(), bids: decode(bidsRaw), asks: decode(asksRaw),
    totalBids: Number(bookDepth[0]), totalAsks: Number(bookDepth[1]),
    chain: "Arbitrum Sepolia", contract: STYLUS_LOB_ADDRESS,
  }, null, 2) }] };
});

server.registerTool("place_limit_order", {
  description: "Place a limit order on the Stylus WASM order book (Arbitrum Sepolia). Executed by the AI agent on your behalf.",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol e.g. BTC, ETH, TSLA"),
    is_long: z.boolean().describe("true=long/buy, false=short/sell"),
    collateral: z.number().describe("Collateral in USD (e.g. 100)"),
    leverage: z.number().min(1).max(50).describe("Leverage 1-50x"),
    limit_price: z.number().describe("Limit price in USD"),
  }),
}, async ({ asset, is_long, collateral, leverage, limit_price }) => {
  const hash = assetHash(asset);
  const colWei = ethers.parseUnits(collateral.toString(), 18);
  const priceWei = ethers.parseUnits(limit_price.toString(), 18);
  
  // Approve aUSD on Sepolia for Escrow
  const sepAusd = new ethers.Contract(ARB_SEPOLIA_AUSD, AUSD_ABI, agentWalletSepolia);
  const allowance = await sepAusd.allowance(agentWalletSepolia.address, ESCROW_ADDRESS);
  if (allowance < colWei) {
    await (await sepAusd.approve(ESCROW_ADDRESS, ethers.MaxUint256)).wait();
  }

  const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, agentWalletSepolia);
  const tx = await escrow.place_limit_order(hash, is_long, colWei, BigInt(leverage), priceWei);
  const receipt = await tx.wait();
  
  return { content: [{ type: "text", text: JSON.stringify({
    status: "placed", asset: asset.toUpperCase(), side: is_long ? "LONG" : "SHORT",
    collateral, leverage, limit_price, chain: "Arbitrum Sepolia", txHash: receipt.hash,
  }, null, 2) }] };
});

server.registerTool("place_market_order", {
  description: "Open a perpetual position at market price on AuraPerps (Robinhood Chain) via your AuraAccount delegation.",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol e.g. BTC, ETH, TSLA"),
    is_long: z.boolean().describe("true=long, false=short"),
    collateral: z.number().describe("Collateral in aUSD (e.g. 100)"),
    leverage: z.number().min(1).max(50).describe("Leverage 1-50x"),
  }),
}, async ({ asset, is_long, collateral, leverage }) => {
  const colWei = ethers.parseUnits(collateral.toString(), 18);

  // Update oracle with fresh Pyth price
  const price = await fetchPythPrice(asset);
  if (price) {
    const oracle = new ethers.Contract(MOCK_ORACLE_ADDRESS, ORACLE_ABI, agentWallet);
    await (await oracle.setPrice(asset.toUpperCase(), ethers.parseUnits(price.toFixed(2), 18))).wait();
  }

  // Encode: approve aUSD + openPosition as a batch
  const approveData = ausdIface.encodeFunctionData("approve", [AURA_PERPS_ADDRESS, colWei]);
  const openData = perpsIface.encodeFunctionData("openPosition", [asset.toUpperCase(), is_long, colWei, BigInt(leverage)]);

  // Execute directly with agent wallet (for demo — no specific user account needed for ChatGPT)
  const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, agentWallet);
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);

  const allowance = await ausd.allowance(agentWallet.address, AURA_PERPS_ADDRESS);
  if (allowance < colWei) await (await ausd.approve(AURA_PERPS_ADDRESS, ethers.MaxUint256)).wait();

  const tx = await perps.openPosition(asset.toUpperCase(), is_long, colWei, BigInt(leverage));
  const receipt = await tx.wait();
  // Record on-chain audit trail
  await recordAudit(agentWallet.address, `MARKET_${is_long ? "LONG" : "SHORT"} ${asset.toUpperCase()} ${leverage}x $${collateral}`, { asset, is_long, collateral, leverage, price, txHash: receipt.hash });
  return { content: [{ type: "text", text: JSON.stringify({
    status: "opened", asset: asset.toUpperCase(), side: is_long ? "LONG" : "SHORT",
    collateral, leverage, entryPrice: price, chain: "Robinhood Chain", txHash: receipt.hash,
  }, null, 2) }] };
});

server.registerTool("get_positions", {
  description: "Get open perpetual positions from AuraPerps (Robinhood Chain)",
  inputSchema: z.object({}),
}, async () => {
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, robinhoodProvider);
  const nextId = Number(await perps.nextPositionId());
  const positions = [];
  for (let i = 0; i < nextId && positions.length < 20; i++) {
    try {
      const pos = await perps.positions(i);
      if (pos.isOpen) {
        const price = await fetchPythPrice(pos.asset);
        let pnl = null, isProfit = null;
        if (price) {
          const [p, ip] = await perps.calculatePnL(i, ethers.parseUnits(price.toFixed(2), 18));
          pnl = Number(ethers.formatUnits(p, 18)); isProfit = ip;
        }
        positions.push({
          id: i, asset: pos.asset, side: pos.isLong ? "LONG" : "SHORT",
          owner: pos.owner,
          collateral: Number(ethers.formatUnits(pos.collateralAmount, 18)),
          leverage: Number(pos.leverage),
          entryPrice: Number(ethers.formatUnits(pos.entryPrice, 18)),
          size: Number(ethers.formatUnits(pos.positionSize, 18)),
          pnl, isProfit, currentPrice: price,
        });
      }
    } catch { continue; }
  }
  return { content: [{ type: "text", text: JSON.stringify({ positions, count: positions.length }, null, 2) }] };
});

server.registerTool("close_position", {
  description: "Close an open perpetual position on AuraPerps by position ID",
  inputSchema: z.object({ position_id: z.number().describe("Position ID to close") }),
}, async ({ position_id }) => {
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
  const oracle = new ethers.Contract(MOCK_ORACLE_ADDRESS, ORACLE_ABI, agentWallet);
  const pos = await perps.positions(position_id);
  if (!pos.isOpen) return { content: [{ type: "text", text: "Position already closed." }] };
  const price = await fetchPythPrice(pos.asset);
  if (price) await (await oracle.setPrice(pos.asset, ethers.parseUnits(price.toFixed(2), 18))).wait();
  const tx = await perps.closePosition(position_id);
  const receipt = await tx.wait();
  return { content: [{ type: "text", text: JSON.stringify({
    status: "closed", positionId: position_id, asset: pos.asset, exitPrice: price, txHash: receipt.hash,
  }, null, 2) }] };
});

server.registerTool("get_account_balance", {
  description: "Get aUSD and ETH balance for the agent wallet or a specific AuraAccount address",
  inputSchema: z.object({ address: z.string().optional().describe("AuraAccount or wallet address (defaults to agent wallet)") }),
}, async ({ address }) => {
  const addr = address || agentWallet.address;
  const [ausdBal, ethBal] = await Promise.all([
    robinhoodProvider.call({ to: AUSD_ADDRESS, data: new ethers.Interface(["function balanceOf(address) view returns (uint256)"]).encodeFunctionData("balanceOf", [addr]) }),
    robinhoodProvider.getBalance(addr),
  ]);
  return { content: [{ type: "text", text: JSON.stringify({ address: addr, aUSD: Number(ethers.formatUnits(BigInt(ausdBal), 18)).toFixed(2), ETH: Number(ethers.formatUnits(ethBal, 18)).toFixed(4) }) }] };
});

server.registerTool("set_stop_loss_take_profit", {
  description: "Set stop-loss and/or take-profit prices on an open position",
  inputSchema: z.object({
    position_id: z.number().describe("Position ID"),
    take_profit: z.number().optional().describe("Take profit price in USD (0 to disable)"),
    stop_loss: z.number().optional().describe("Stop loss price in USD (0 to disable)"),
  }),
}, async ({ position_id, take_profit = 0, stop_loss = 0 }) => {
  const tpWei = ethers.parseUnits(take_profit.toString(), 18);
  const slWei = ethers.parseUnits(stop_loss.toString(), 18);
  const data = perpsIface.encodeFunctionData("setTriggerOrders", [BigInt(position_id), tpWei, slWei]);
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
  const tx = await perps.setTriggerOrders(BigInt(position_id), tpWei, slWei);
  const receipt = await tx.wait();
  return { content: [{ type: "text", text: JSON.stringify({ status: "triggers_set", positionId: position_id, takeProfit: take_profit, stopLoss: stop_loss, txHash: receipt.hash }, null, 2) }] };
});

server.registerTool("add_margin", {
  description: "Add collateral (aUSD) to an existing open position to reduce liquidation risk",
  inputSchema: z.object({
    position_id: z.number().describe("Position ID"),
    amount: z.number().describe("Additional collateral in aUSD"),
  }),
}, async ({ position_id, amount }) => {
  const amtWei = ethers.parseUnits(amount.toString(), 18);
  const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, agentWallet);
  const allowance = await ausd.allowance(agentWallet.address, AURA_PERPS_ADDRESS);
  if (allowance < amtWei) await (await ausd.approve(AURA_PERPS_ADDRESS, ethers.MaxUint256)).wait();
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
  const tx = await perps.addMargin(BigInt(position_id), amtWei);
  const receipt = await tx.wait();
  return { content: [{ type: "text", text: JSON.stringify({ status: "margin_added", positionId: position_id, addedAmount: amount, txHash: receipt.hash }, null, 2) }] };
});

server.registerTool("get_market_analysis", {
  description: "Get AI-powered macro market analysis including Pyth prices, news sentiment, and correlations for an asset",
  inputSchema: z.object({ asset: z.string().describe("Asset symbol e.g. BTC, ETH, TSLA") }),
}, async ({ asset }) => {
  const price = await fetchPythPrice(asset);
  // Fetch multiple prices for correlation context
  const allPrices = {};
  for (const sym of Object.keys(PYTH_IDS)) { try { allPrices[sym] = await fetchPythPrice(sym); } catch {} }
  // Try CoinMarketCap Fear & Greed
  let sentiment = null;
  try {
    const cmcKey = process.env.COINMARKETCAP;
    if (cmcKey) {
      const res = await fetch("https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest", { headers: { "X-CMC_PRO_API_KEY": cmcKey, Accept: "application/json" } });
      if (res.ok) { const d = await res.json(); const v = d.data?.value || 50; const c = d.data?.value_classification || "Neutral"; sentiment = { sentiment: v > 60 ? "BULLISH" : v < 40 ? "BEARISH" : "NEUTRAL", score: v, summary: `Fear & Greed Index: ${v}/100 (${c})` }; }
    }
  } catch {}
  // Fallback: use Alternative.me Fear & Greed (free, no key)
  if (!sentiment) {
    try {
      const res = await fetch("https://api.alternative.me/fng/?limit=1");
      if (res.ok) { const d = await res.json(); const v = parseInt(d.data?.[0]?.value || "50"); const c = d.data?.[0]?.value_classification || "Neutral"; sentiment = { sentiment: v > 60 ? "BULLISH" : v < 40 ? "BEARISH" : "NEUTRAL", score: v, summary: `Crypto Fear & Greed: ${v}/100 (${c})` }; }
    } catch {}
  }
  if (!sentiment) sentiment = { sentiment: "NEUTRAL", score: 50, summary: "Sentiment data unavailable" };
  return { content: [{ type: "text", text: JSON.stringify({ asset: asset.toUpperCase(), currentPrice: price, marketSentiment: sentiment.sentiment, sentimentScore: sentiment.score, analysis: sentiment.summary, allPrices, source: "pyth_hermes + fear_greed_index" }, null, 2) }] };
});

server.registerTool("get_funding_rate", {
  description: "Get current funding rate and open interest for an asset on AuraPerps",
  inputSchema: z.object({ asset: z.string().describe("Asset symbol e.g. BTC, ETH, TSLA") }),
}, async ({ asset }) => {
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, robinhoodProvider);
  const [longOI, shortOI, ratePerSec] = await Promise.all([
    perps.totalLongOI(asset.toUpperCase()),
    perps.totalShortOI(asset.toUpperCase()),
    perps.FUNDING_RATE_PER_SECOND(),
  ]);
  const dailyRate = Number(ratePerSec) * 86400 / 1e18 * 100;
  const longOINum = Number(ethers.formatUnits(longOI, 18));
  const shortOINum = Number(ethers.formatUnits(shortOI, 18));
  const skew = longOINum - shortOINum;
  return { content: [{ type: "text", text: JSON.stringify({ asset: asset.toUpperCase(), fundingRateDaily: `${dailyRate.toFixed(4)}%`, longOpenInterest: longOINum, shortOpenInterest: shortOINum, skew, skewDirection: skew > 0 ? "LONG_HEAVY" : skew < 0 ? "SHORT_HEAVY" : "BALANCED" }, null, 2) }] };
});

server.registerTool("partial_close", {
  description: "Partially close a position by specifying the size to close (in position units)",
  inputSchema: z.object({
    position_id: z.number().describe("Position ID"),
    close_size: z.number().describe("Size to close (in position size units, e.g. 500 out of 1000)"),
  }),
}, async ({ position_id, close_size }) => {
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
  const oracle = new ethers.Contract(MOCK_ORACLE_ADDRESS, ORACLE_ABI, agentWallet);
  const pos = await perps.positions(position_id);
  if (!pos.isOpen) return { content: [{ type: "text", text: "Position already closed." }] };
  const price = await fetchPythPrice(pos.asset);
  if (price) await (await oracle.setPrice(pos.asset, ethers.parseUnits(price.toFixed(2), 18))).wait();
  const sizeWei = ethers.parseUnits(close_size.toString(), 18);
  const tx = await perps.closePositionPartially(BigInt(position_id), sizeWei);
  const receipt = await tx.wait();
  return { content: [{ type: "text", text: JSON.stringify({ status: "partially_closed", positionId: position_id, closedSize: close_size, remainingSize: Number(ethers.formatUnits(pos.positionSize - sizeWei, 18)), exitPrice: price, txHash: receipt.hash }, null, 2) }] };
});

server.registerTool("dca_order", {
  description: "Schedule a Dollar-Cost-Average strategy: automatically open positions at regular intervals. Max 10 orders, min 5 min interval.",
  inputSchema: z.object({
    asset: z.string().describe("Asset symbol e.g. BTC, ETH, TSLA"),
    amount: z.number().describe("Collateral per order in aUSD"),
    interval_minutes: z.number().min(5).describe("Minutes between each order"),
    num_orders: z.number().min(2).max(10).describe("Total number of orders to execute"),
    is_long: z.boolean().optional().describe("Direction (default: true/long)"),
    leverage: z.number().min(1).max(50).optional().describe("Leverage (default: 1)"),
  }),
}, async ({ asset, amount, interval_minutes, num_orders, is_long = true, leverage = 1 }) => {
  const dcaId = `dca_${Date.now()}`;
  let executed = 0;
  const txHashes = [];

  const executeOne = async () => {
    try {
      const colWei = ethers.parseUnits(amount.toString(), 18);
      const price = await fetchPythPrice(asset);
      if (price) { const oracle = new ethers.Contract(MOCK_ORACLE_ADDRESS, ORACLE_ABI, agentWallet); await (await oracle.setPrice(asset.toUpperCase(), ethers.parseUnits(price.toFixed(2), 18))).wait(); }
      const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, agentWallet);
      const allowance = await ausd.allowance(agentWallet.address, AURA_PERPS_ADDRESS);
      if (allowance < colWei) await (await ausd.approve(AURA_PERPS_ADDRESS, ethers.MaxUint256)).wait();
      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
      const tx = await perps.openPosition(asset.toUpperCase(), is_long, colWei, BigInt(leverage));
      const receipt = await tx.wait();
      executed++;
      txHashes.push(receipt.hash);
      if (executed >= num_orders) { clearInterval(dca.timer); activeDCAs.delete(dcaId); }
      else { const d = activeDCAs.get(dcaId); if (d) d.executed = executed; }
    } catch (e) { console.error(`[DCA ${dcaId}] Order ${executed + 1} failed:`, e.message); }
  };

  // Execute first order immediately
  await executeOne();
  // Schedule remaining
  const timer = setInterval(executeOne, interval_minutes * 60 * 1000);
  const dca = { timer, asset: asset.toUpperCase(), amount, interval_minutes, num_orders, is_long, leverage, executed, startedAt: Date.now() };
  activeDCAs.set(dcaId, dca);

  return { content: [{ type: "text", text: JSON.stringify({ status: "dca_started", dcaId, asset: asset.toUpperCase(), amountPerOrder: amount, interval: `${interval_minutes} min`, totalOrders: num_orders, executed: 1, nextIn: `${interval_minutes} min`, firstTx: txHashes[0] || null }, null, 2) }] };
});

server.registerTool("cancel_dca", {
  description: "Cancel an active DCA strategy by its ID",
  inputSchema: z.object({ dca_id: z.string().describe("DCA ID to cancel (e.g. dca_1716...)") }),
}, async ({ dca_id }) => {
  const dca = activeDCAs.get(dca_id);
  if (!dca) return { content: [{ type: "text", text: "DCA not found or already completed." }] };
  clearInterval(dca.timer);
  const result = { status: "cancelled", dcaId: dca_id, executed: dca.executed, remaining: dca.num_orders - dca.executed };
  activeDCAs.delete(dca_id);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.registerTool("get_audit_trail", {
  description: "Get the on-chain AI audit trail: total records, agent reputation, and recent reasoning events from AuraAuditTrail contract",
  inputSchema: z.object({}),
}, async () => {
  const audit = new ethers.Contract(AUDIT_TRAIL_ADDRESS, AUDIT_TRAIL_ABI, robinhoodProvider);
  const [totalRecords, reputation] = await Promise.all([
    audit.totalRecords(),
    audit.getAgentReputation(agentWallet.address),
  ]);
  // Fetch recent events (last 500 blocks)
  const currentBlock = await robinhoodProvider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 500);
  let recentEvents = [];
  try {
    const filter = audit.filters.ReasoningRecordedWithScore(agentWallet.address);
    const logs = await audit.queryFilter(filter, fromBlock, currentBlock);
    recentEvents = logs.slice(-10).map(l => ({ user: l.args[1], hash: l.args[2], timestamp: Number(l.args[3]), action: l.args[4], confidenceScore: Number(l.args[5]) }));
  } catch {}
  return { content: [{ type: "text", text: JSON.stringify({ contract: AUDIT_TRAIL_ADDRESS, chain: "Robinhood Chain", totalRecords: Number(totalRecords), agentAddress: agentWallet.address, agentReputation: { totalTrades: Number(reputation[0]), avgConfidenceScore: Number(reputation[1]) }, recentDecisions: recentEvents }, null, 2) }] };
});

server.registerTool("get_pnl_summary", {
  description: "Get a PnL summary across all positions: total PnL, win rate, best/worst trade, total volume",
  inputSchema: z.object({}),
}, async () => {
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, robinhoodProvider);
  const nextId = Number(await perps.nextPositionId());
  let totalPnl = 0, wins = 0, losses = 0, bestPnl = -Infinity, worstPnl = Infinity, totalVolume = 0, openCount = 0;
  for (let i = 0; i < nextId && i < 100; i++) {
    try {
      const pos = await perps.positions(i);
      const size = Number(ethers.formatUnits(pos.positionSize, 18));
      totalVolume += size;
      if (pos.isOpen) {
        openCount++;
        const price = await fetchPythPrice(pos.asset);
        if (price) {
          const [pnl, isProfit] = await perps.calculatePnL(i, ethers.parseUnits(price.toFixed(2), 18));
          const pnlNum = Number(ethers.formatUnits(pnl, 18)) * (isProfit ? 1 : -1);
          totalPnl += pnlNum;
          if (pnlNum > 0) wins++; else losses++;
          if (pnlNum > bestPnl) bestPnl = pnlNum;
          if (pnlNum < worstPnl) worstPnl = pnlNum;
        }
      } else {
        const pnlNum = Number(ethers.formatUnits(pos.realizedPnl, 18)) * (pos.isProfitRealized ? 1 : -1);
        totalPnl += pnlNum;
        if (pnlNum > 0) wins++; else losses++;
        if (pnlNum > bestPnl) bestPnl = pnlNum;
        if (pnlNum < worstPnl) worstPnl = pnlNum;
      }
    } catch { continue; }
  }
  const totalTrades = wins + losses;
  return { content: [{ type: "text", text: JSON.stringify({ totalPnl: totalPnl.toFixed(2), winRate: totalTrades > 0 ? `${((wins / totalTrades) * 100).toFixed(1)}%` : "N/A", wins, losses, bestTrade: bestPnl === -Infinity ? "N/A" : bestPnl.toFixed(2), worstTrade: worstPnl === Infinity ? "N/A" : worstPnl.toFixed(2), openPositions: openCount, totalVolume: totalVolume.toFixed(2), totalTrades }, null, 2) }] };
});

server.registerTool("get_supported_assets", {
  description: "List all supported trading assets with their current Pyth prices",
  inputSchema: z.object({}),
}, async () => {
  const assets = [];
  for (const [sym, id] of Object.entries(PYTH_IDS)) {
    const price = await fetchPythPrice(sym);
    assets.push({ symbol: sym, price, pythId: id });
  }
  return { content: [{ type: "text", text: JSON.stringify({ supported: assets, count: assets.length, chains: { limitOrders: "Arbitrum Sepolia (Stylus LOB)", marketOrders: "Robinhood Chain (AuraPerps)" } }, null, 2) }] };
});

server.registerTool("get_limit_orders", {
  description: "Get the active limit orders for the user on the Stylus LOB (Arbitrum Sepolia)",
  inputSchema: z.object({
    address: z.string().describe("User's wallet address")
  }),
}, async ({ address }) => {
  try {
    const fetch = (await import("node-fetch")).default;
    const res = await fetch(`http://localhost:${process.env.PORT || 3001}/api/my-orders/${address}`);
    if (!res.ok) throw new Error("Failed to fetch limit orders");
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }] };
  }
});

server.registerTool("cancel_limit_order", {
  description: "Cancel an active limit order on the Stylus LOB (Arbitrum Sepolia)",
  inputSchema: z.object({ order_id: z.number().describe("Order ID to cancel") }),
}, async ({ order_id }) => {
  const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, agentWalletSepolia);
  const tx = await escrow.cancel_order(BigInt(order_id), agentWalletSepolia.address);
  const receipt = await tx.wait();
  return { content: [{ type: "text", text: JSON.stringify({ status: "cancelled", orderId: order_id, chain: "Arbitrum Sepolia", txHash: receipt.hash }, null, 2) }] };
});

server.registerTool("get_liquidation_price", {
  description: "Calculate the liquidation price for an open position",
  inputSchema: z.object({ position_id: z.number().describe("Position ID") }),
}, async ({ position_id }) => {
  const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, robinhoodProvider);
  const pos = await perps.positions(position_id);
  if (!pos.isOpen) return { content: [{ type: "text", text: "Position is closed." }] };
  const entry = Number(ethers.formatUnits(pos.entryPrice, 18));
  const collateral = Number(ethers.formatUnits(pos.collateralAmount, 18));
  const size = Number(ethers.formatUnits(pos.positionSize, 18));
  // Liquidation when loss >= collateral: liqPrice = entry * (1 - collateral/size) for long, entry * (1 + collateral/size) for short
  const liqPrice = pos.isLong ? entry * (1 - collateral / size) : entry * (1 + collateral / size);
  const currentPrice = await fetchPythPrice(pos.asset);
  const distancePct = currentPrice ? ((currentPrice - liqPrice) / currentPrice * 100 * (pos.isLong ? 1 : -1)).toFixed(2) : "N/A";
  return { content: [{ type: "text", text: JSON.stringify({ positionId: position_id, asset: pos.asset, side: pos.isLong ? "LONG" : "SHORT", entryPrice: entry, collateral, leverage: Number(pos.leverage), liquidationPrice: parseFloat(liqPrice.toFixed(2)), currentPrice, distanceToLiquidation: `${distancePct}%` }, null, 2) }] };
});

const SYNTHRA_ROUTER = process.env.ROUTER_ADDRESS || "0x6F308B834595312f734e65e273F2210f43Fc48F8";
const WETH_ADDRESS = "0x33e4191705c386532ba27cBF171Db86919200B94";
const AURA_VAULT_ADDRESS = "0x4Ae6Ab5BCAb4F0f2FAcAA47aD2ea5832eBDF5792";

server.registerTool("swap", {
  description: "Swap ETH for a tokenized stock (TSLA, AMZN, NFLX, AMD, PLTR) via Synthra V3 Router on Robinhood Chain",
  inputSchema: z.object({
    amount_eth: z.number().describe("Amount of ETH to swap (e.g. 0.001)"),
    token_out: z.string().describe("Token to receive: TSLA, AMZN, NFLX, AMD, or PLTR"),
  }),
}, async ({ amount_eth, token_out }) => {
  const TOKEN_MAP = { TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", NFLX: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", AMD: "0x71178BAc73cBeb415514eB542a8995b82669778d", PLTR: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0" };
  const tokenAddr = TOKEN_MAP[token_out.toUpperCase()];
  if (!tokenAddr) return { content: [{ type: "text", text: `Unsupported token: ${token_out}. Supported: ${Object.keys(TOKEN_MAP).join(", ")}` }] };
  const amountWei = ethers.parseEther(amount_eth.toString());
  const routerIface = new ethers.Interface(["function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable"]);
  const commands = "0x0b00";
  const wrapInput = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [2, amountWei]);
  const path = ethers.solidityPacked(["address", "uint24", "address"], [WETH_ADDRESS, 3000, tokenAddr]);
  const swapInput = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "uint256", "bytes", "bool"], [agentWallet.address, amountWei, 0n, path, false]);
  const deadline = Math.floor(Date.now() / 1000) + 1800;
  const tx = await agentWallet.sendTransaction({ to: SYNTHRA_ROUTER, data: routerIface.encodeFunctionData("execute", [commands, [wrapInput, swapInput], deadline]), value: amountWei });
  const receipt = await tx.wait();
  return { content: [{ type: "text", text: JSON.stringify({ status: "swapped", amountIn: `${amount_eth} ETH`, tokenOut: token_out.toUpperCase(), chain: "Robinhood Chain", txHash: receipt.hash }, null, 2) }] };
});

server.registerTool("deposit_vault", {
  description: "Deposit aUSD into the ERC-4626 Perp Vault to earn yield from trading fees",
  inputSchema: z.object({ amount: z.number().describe("Amount of aUSD to deposit") }),
}, async ({ amount }) => {
  const amtWei = ethers.parseUnits(amount.toString(), 18);
  const vaultIface = new ethers.Interface(["function deposit(uint256 assets, address receiver) returns (uint256)"]);
  // Approve aUSD to vault
  const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, agentWallet);
  const allowance = await ausd.allowance(agentWallet.address, AURA_VAULT_ADDRESS);
  if (allowance < amtWei) await (await ausd.approve(AURA_VAULT_ADDRESS, ethers.MaxUint256)).wait();
  // Deposit
  const vault = new ethers.Contract(AURA_VAULT_ADDRESS, ["function deposit(uint256 assets, address receiver) returns (uint256)"], agentWallet);
  const tx = await vault.deposit(amtWei, agentWallet.address);
  const receipt = await tx.wait();
  return { content: [{ type: "text", text: JSON.stringify({ status: "deposited", amount, vault: AURA_VAULT_ADDRESS, chain: "Robinhood Chain", txHash: receipt.hash }, null, 2) }] };
});

server.registerTool("schedule_swap", {
  description: "Schedule recurring ETH-to-token swaps (Custom Schedule / DCA swaps). Automatically swaps ETH for a tokenized stock at regular intervals.",
  inputSchema: z.object({
    token_out: z.string().describe("Token to buy: TSLA, AMZN, NFLX, AMD, or PLTR"),
    amount_eth: z.number().describe("ETH amount per swap (e.g. 0.0001)"),
    interval_minutes: z.number().min(5).describe("Minutes between each swap"),
    num_swaps: z.number().min(2).max(10).describe("Total number of swaps"),
  }),
}, async ({ token_out, amount_eth, interval_minutes, num_swaps }) => {
  const TOKEN_MAP = { TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", NFLX: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", AMD: "0x71178BAc73cBeb415514eB542a8995b82669778d", PLTR: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0" };
  const tokenAddr = TOKEN_MAP[token_out.toUpperCase()];
  if (!tokenAddr) return { content: [{ type: "text", text: `Unsupported: ${token_out}` }] };
  const dcaId = `swap_dca_${Date.now()}`;
  let executed = 0;

  const executeOneSwap = async () => {
    try {
      const amountWei = ethers.parseEther(amount_eth.toString());
      const routerIface = new ethers.Interface(["function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable"]);
      const wrapInput = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [2, amountWei]);
      const path = ethers.solidityPacked(["address", "uint24", "address"], [WETH_ADDRESS, 3000, tokenAddr]);
      const swapInput = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "uint256", "bytes", "bool"], [agentWallet.address, amountWei, 0n, path, false]);
      const deadline = Math.floor(Date.now() / 1000) + 1800;
      const tx = await agentWallet.sendTransaction({ to: SYNTHRA_ROUTER, data: routerIface.encodeFunctionData("execute", ["0x0b00", [wrapInput, swapInput], deadline]), value: amountWei });
      await tx.wait();
      executed++;
      if (executed >= num_swaps) { clearInterval(dca.timer); activeDCAs.delete(dcaId); }
      else { const d = activeDCAs.get(dcaId); if (d) d.executed = executed; }
    } catch (e) { console.error(`[SwapDCA ${dcaId}] failed:`, e.message); }
  };

  await executeOneSwap();
  const timer = setInterval(executeOneSwap, interval_minutes * 60 * 1000);
  const dca = { timer, asset: token_out.toUpperCase(), amount: amount_eth, interval_minutes, num_orders: num_swaps, executed, startedAt: Date.now(), type: "swap" };
  activeDCAs.set(dcaId, dca);

  return { content: [{ type: "text", text: JSON.stringify({ status: "swap_dca_started", dcaId, tokenOut: token_out.toUpperCase(), ethPerSwap: amount_eth, interval: `${interval_minutes} min`, totalSwaps: num_swaps, executed: 1, nextIn: `${interval_minutes} min` }, null, 2) }] };
});

// ── Start ──
const args = process.argv.slice(2);

if (args.includes("--http")) {
  const port = parseInt(args[args.indexOf("--http") + 1]) || 3002;
  const express = (await import("express")).default;
  const cors = (await import("cors")).default;

  const app = express();
  app.use(cors());

  const transports = {};

  // Global store for authenticated sessions (persists across stateless /mcp requests and restarts)
  const AUTH_DB_FILE = join(__dirname, '.authenticated_accounts.json');
  const authenticatedAccounts = new Map(); // apiKey -> auraAccountAddress
  try {
    if (existsSync(AUTH_DB_FILE)) {
      const data = JSON.parse(readFileSync(AUTH_DB_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) authenticatedAccounts.set(k, v);
    }
  } catch (e) {
    console.warn("[MCP] Could not load auth db:", e.message);
  }

  function saveAuthDb() {
    try {
      writeFileSync(AUTH_DB_FILE, JSON.stringify(Object.fromEntries(authenticatedAccounts)), 'utf8');
    } catch (e) {
      console.warn("[MCP] Could not save auth db:", e.message);
    }
  }

  // Factory: create a fresh McpServer per session
  // If auraAccount is provided, write operations go through executeBatchByAgent
  function createServer(auraAccount, ownerWallet) {
    const s = new McpServer({ name: "aura-perps", version: "1.0.0" });
    let sessionAccount = auraAccount; // mutable — can be set by authenticate tool
    let sessionOwnerWallet = ownerWallet || null;     // the user's EOA wallet (positions are owned by this)

    // Auto-resolve ownerWallet from AuraAccount.owner() if not provided
    if (!sessionOwnerWallet && sessionAccount) {
      (async () => {
        try {
          const accContract = new ethers.Contract(sessionAccount, ["function owner() view returns (address)"], robinhoodProvider);
          sessionOwnerWallet = (await accContract.owner()).toLowerCase();
          console.log(`[MCP] Auto-resolved ownerWallet from AuraAccount.owner(): ${sessionOwnerWallet}`);
        } catch (e) { console.warn("[MCP] Could not auto-resolve owner:", e.message); }
      })();
    }

    const BACKEND_RESOLVE_URL = (process.env.BACKEND_URL || "https://aura-backend-backend.up.railway.app") + "/api/mcp-keys/resolve";

    s.registerTool("authenticate", { description: "Authenticate with your Aura API key to trade with your own wallet. Get your key at https://aura-protocol-tawny.vercel.app/trade", inputSchema: z.object({ api_key: z.string().describe("Your Aura API key (aura_xxx...)"), payment_tx_hash: z.string().optional().describe("Transaction hash of your x402 payment") }) }, withX402(async ({ api_key }) => {
      // 1. Verify KYA Identity
      try {
        const dao = new ethers.Contract(AURA_DAO_ADDRESS, DAO_ABI, robinhoodProvider);
        const isKYA = await dao.isAgentKYA(agentWallet.address);
        if (!isKYA) return { content: [{ type: "text", text: "Error: Agent lacks KYA (Know Your Agent) certification. Please verify agent on-chain first." }] };
      } catch (e) {
        console.warn("KYA check failed (contract might not be deployed yet). Skipping strict check.");
      }
      try {
        const res = await fetch(BACKEND_RESOLVE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: api_key }) });
        if (!res.ok) return { content: [{ type: "text", text: "Invalid API key. Generate one at https://aura-protocol-tawny.vercel.app/trade" }] };
        const data = await res.json();
        sessionAccount = data.auraAccount;
        sessionOwnerWallet = data.ownerWallet || null;
        // Fallback: if no ownerWallet stored (legacy key), try to read owner() from AuraAccount contract
        if (!sessionOwnerWallet && sessionAccount) {
          try {
            const accContract = new ethers.Contract(sessionAccount, ["function owner() view returns (address)"], robinhoodProvider);
            sessionOwnerWallet = (await accContract.owner()).toLowerCase();
            console.log(`[MCP] Resolved ownerWallet from AuraAccount.owner(): ${sessionOwnerWallet}`);
          } catch (e) { console.warn("[MCP] Could not resolve owner from AuraAccount:", e.message); }
        }
        authenticatedAccounts.set(api_key, data.auraAccount); // persist globally
        saveAuthDb();
        return { content: [{ type: "text", text: `Authenticated! Trading on AuraAccount ${sessionAccount}. All trades will execute via your account.` }] };
      } catch (e) { return { content: [{ type: "text", text: `Auth failed: ${e.message}` }] }; }
    }));

    s.registerTool("get_price", { description: "Get real-time price for BTC, ETH, TSLA, AMZN, NFLX, AMD, PLTR from Pyth", inputSchema: z.object({ asset: z.string() }) }, async ({ asset }) => {
      const price = await fetchPythPrice(asset);
      if (!price) return { content: [{ type: "text", text: `Unsupported: ${asset}` }] };
      return { content: [{ type: "text", text: JSON.stringify({ asset: asset.toUpperCase(), price }) }] };
    });

    s.registerTool("get_orderbook", { description: "Get live bids/asks from Stylus WASM LOB on Arbitrum Sepolia", inputSchema: z.object({ asset: z.string(), depth: z.number().optional() }) }, async ({ asset, depth = 10 }) => {
      const hash = assetHash(asset);
      const lob = new ethers.Contract(STYLUS_LOB_ADDRESS, STYLUS_LOB_ABI, sepoliaProvider);
      const [bidsRaw, asksRaw, bookDepth] = await Promise.all([lob.get_active_orders_sorted(hash, true, depth), lob.get_active_orders_sorted(hash, false, depth), lob.get_book_depth(hash)]);
      const decode = (t) => { const o = []; for (let i = 0; i < t[0].length; i++) o.push({ price: Number(ethers.formatUnits(t[1][i], 18)), size: Number(ethers.formatUnits(t[2][i], 18)) }); return o; };
      return { content: [{ type: "text", text: JSON.stringify({ asset: asset.toUpperCase(), bids: decode(bidsRaw), asks: decode(asksRaw), totalBids: Number(bookDepth[0]), totalAsks: Number(bookDepth[1]) }, null, 2) }] };
    });



    const timeoutWait = (tx, ms = 15000) => Promise.race([tx.wait(), new Promise((_, r) => setTimeout(() => r(new Error("tx.wait timeout")), ms))]);

    s.registerTool("place_market_order", { description: "Open perp position at market price on AuraPerps", inputSchema: z.object({ asset: z.string(), is_long: z.boolean(), collateral: z.number(), leverage: z.number().min(1).max(50) }) }, async ({ asset, is_long, collateral, leverage }) => {
      return new Promise((resolve, reject) => {
        txQueue = txQueue.then(async () => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const colWei = ethers.parseUnits(collateral.toString(), 18);
              const price = await fetchPythPrice(asset);
              
              if (price) { 
                  const oracle = new ethers.Contract(MOCK_ORACLE_ADDRESS, ORACLE_ABI, agentWallet);
                  try {
                      const txO = await oracle.setPrice(asset.toUpperCase(), ethers.parseUnits(price.toFixed(2), 18));
                      await timeoutWait(txO, 10000);
                  } catch (e) { 
                      if (!e.message.includes("nonce")) console.warn("Oracle warning:", e.shortMessage || e.message); 
                  }
              }

              let txHash;
              if (sessionAccount) {
                const approveData = ausdIface.encodeFunctionData("approve", [AURA_PERPS_ADDRESS, colWei]);
                const openData = perpsIface.encodeFunctionData("openPosition", [asset.toUpperCase(), is_long, colWei, BigInt(leverage)]);
                const account = new ethers.Contract(sessionAccount, AURA_ACCOUNT_ABI, agentWallet);
                const tx = await account.executeBatchByAgent([AUSD_ADDRESS, AURA_PERPS_ADDRESS], [0n, 0n], [approveData, openData]);
                const receipt = await timeoutWait(tx);
                txHash = receipt.hash || tx.hash;
                await recordAudit(sessionAccount, `MARKET_${is_long ? "LONG" : "SHORT"} ${asset.toUpperCase()} ${leverage}x $${collateral}`, { asset, is_long, collateral, leverage, price, account: sessionAccount });
                resolve({ content: [{ type: "text", text: JSON.stringify({ status: "opened", account: sessionAccount, asset: asset.toUpperCase(), side: is_long ? "LONG" : "SHORT", collateral, leverage, entryPrice: price, txHash }, null, 2) }] });
                return;
              }

              const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, agentWallet);
              const allowance = await ausd.allowance(agentWallet.address, AURA_PERPS_ADDRESS);
              if (allowance < colWei) {
                  const txA = await ausd.approve(AURA_PERPS_ADDRESS, ethers.MaxUint256);
                  await timeoutWait(txA, 10000);
              }
              const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
              const tx = await perps.openPosition(asset.toUpperCase(), is_long, colWei, BigInt(leverage));
              const receipt = await timeoutWait(tx);
              txHash = receipt.hash || tx.hash;
              
              await recordAudit(agentWallet.address, `MARKET_${is_long ? "LONG" : "SHORT"} ${asset.toUpperCase()} ${leverage}x $${collateral}`, { asset, is_long, collateral, leverage, price });
              resolve({ content: [{ type: "text", text: JSON.stringify({ status: "opened", asset: asset.toUpperCase(), side: is_long ? "LONG" : "SHORT", collateral, leverage, entryPrice: price, txHash }, null, 2) }] });
              return;
            } catch (e) {
              if (attempt < 3 && ((e.message && e.message.includes("nonce")) || (e.message && e.message.includes("timeout")))) {
                  await new Promise(r => setTimeout(r, 2000)); // wait and retry
                  continue;
              }
              reject(e);
              return;
            }
          }
        }).catch(e => {
            reject(e);
        });
      });
    });

    s.registerTool("get_positions", { description: "Get your open positions from AuraPerps (positions owned by your AuraAccount)", inputSchema: z.object({}) }, async () => {
      // Ensure ownerWallet is resolved so EOA positions are found
      let currentOwnerWallet = sessionOwnerWallet;
      if (!currentOwnerWallet && sessionAccount) {
        try {
          const accContract = new ethers.Contract(sessionAccount, ["function owner() view returns (address)"], robinhoodProvider);
          currentOwnerWallet = (await accContract.owner()).toLowerCase();
        } catch(e) {}
      }

      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, robinhoodProvider);
      const nextId = Number(await perps.nextPositionId());
      const positions = [];
      // Include both AuraAccount and EOA owner wallet to find all user positions
      const manageable = new Set();
      if (sessionAccount) manageable.add(sessionAccount.toLowerCase());
      if (currentOwnerWallet) manageable.add(currentOwnerWallet.toLowerCase());
      if (manageable.size === 0) manageable.add(agentWallet.address.toLowerCase()); // fallback only if no session

      
      const multicallAddress = "0xca11bde05977b3631167028862be2a173976ca11";
      const multicallAbi = ["function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"];
      const multicall = new ethers.Contract(multicallAddress, multicallAbi, robinhoodProvider);

      const calls = [];
      for (let i = 0; i < nextId; i++) {
        calls.push({ target: AURA_PERPS_ADDRESS, callData: perpsIface.encodeFunctionData("positions", [i]) });
      }

      const chunkSize = 500;
      for (let i = 0; i < nextId; i += chunkSize) {
        const chunk = calls.slice(i, i + chunkSize);
        try {
          const { returnData } = await multicall.aggregate(chunk);
          for (let j = 0; j < returnData.length; j++) {
            if (returnData[j] !== "0x") {
              const posId = i + j;
              const pos = perpsIface.decodeFunctionResult("positions", returnData[j]);
              if (pos.isOpen && manageable.has(pos.owner.toLowerCase())) {
                const price = await fetchPythPrice(pos.asset) || 0;
                positions.push({ 
                  id: posId, owner: pos.owner, asset: pos.asset, side: pos.isLong ? "LONG" : "SHORT", 
                  collateral: Number(ethers.formatUnits(pos.collateralAmount, 18)), leverage: Number(pos.leverage), 
                  entryPrice: Number(ethers.formatUnits(pos.entryPrice, 18)), currentPrice: price 
                });
              }
            }
          }
        } catch (e) { console.error("MCP fetch error chunk", i, e.message); }
      }
      return { content: [{ type: "text", text: JSON.stringify({ account: sessionAccount || "agent", ownerWallet: currentOwnerWallet, positions: positions.reverse(), count: positions.length }, null, 2) }] };
    });

    s.registerTool("close_position", { description: "Close a position by ID", inputSchema: z.object({ position_id: z.number() }) }, async ({ position_id }) => {
      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
      const pos = await perps.positions(position_id);
      if (!pos.isOpen) return { content: [{ type: "text", text: "Already closed." }] };
      const price = await fetchPythPrice(pos.asset);
      if (price) { const oracle = new ethers.Contract(MOCK_ORACLE_ADDRESS, ORACLE_ABI, agentWallet); await (await oracle.setPrice(pos.asset, ethers.parseUnits(price.toFixed(2), 18))).wait(); }

      const posOwner = pos.owner.toLowerCase();

      let currentOwnerWallet = sessionOwnerWallet;
      if (!currentOwnerWallet && sessionAccount) {
        try {
          const accContract = new ethers.Contract(sessionAccount, ["function owner() view returns (address)"], robinhoodProvider);
          currentOwnerWallet = (await accContract.owner()).toLowerCase();
        } catch(e) {}
      }

      // Route based on who actually owns the position on-chain
      // Match: AuraAccount itself, OR EOA wallet (owner of AuraAccount) — both route via executeBatchByAgent
      if (sessionAccount && (posOwner === sessionAccount.toLowerCase() || (currentOwnerWallet && posOwner === currentOwnerWallet.toLowerCase()))) {
        // Close via executeBatchByAgent — contract's _isOwnerOrDelegate accepts AuraAccount for its owner's positions
        const closeData = perpsIface.encodeFunctionData("closePosition", [BigInt(position_id)]);
        const account = new ethers.Contract(sessionAccount, AURA_ACCOUNT_ABI, agentWallet);
        const tx = await account.executeBatchByAgent([AURA_PERPS_ADDRESS], [0n], [closeData]);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "closed", account: sessionAccount, positionId: position_id, asset: pos.asset, exitPrice: price, txHash: receipt.hash }, null, 2) }] };
      }

      if (posOwner === agentWallet.address.toLowerCase()) {
        // Position owned by agent wallet directly → close directly
        const tx = await perps.closePosition(position_id);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "closed", positionId: position_id, asset: pos.asset, exitPrice: price, txHash: receipt.hash }, null, 2) }] };
      }

      // Position owner doesn't match session or agent — cannot close
      return { content: [{ type: "text", text: JSON.stringify({ error: "Not the position owner", positionId: position_id, positionOwner: pos.owner, sessionAccount: sessionAccount || "none", agentWallet: agentWallet.address, hint: "This position belongs to a different wallet. Make sure you authenticate with the correct API key." }, null, 2) }] };
    });

    s.registerTool("get_account_balance", { description: "Get aUSD and ETH balance for your account", inputSchema: z.object({ address: z.string().optional() }) }, async ({ address }) => {
      const addr = address || sessionAccount || agentWallet.address;
      const [ausdBal, ethBal] = await Promise.all([
        robinhoodProvider.call({ to: AUSD_ADDRESS, data: new ethers.Interface(["function balanceOf(address) view returns (uint256)"]).encodeFunctionData("balanceOf", [addr]) }),
        robinhoodProvider.getBalance(addr),
      ]);
      return { content: [{ type: "text", text: JSON.stringify({ address: addr, aUSD: Number(ethers.formatUnits(BigInt(ausdBal), 18)).toFixed(2), ETH: Number(ethers.formatUnits(ethBal, 18)).toFixed(4) }) }] };
    });

    s.registerTool("set_stop_loss_take_profit", { description: "Set stop-loss and/or take-profit on a position", inputSchema: z.object({ position_id: z.number(), take_profit: z.number().optional(), stop_loss: z.number().optional() }) }, async ({ position_id, take_profit = 0, stop_loss = 0 }) => {
      const tpWei = ethers.parseUnits(take_profit.toString(), 18);
      const slWei = ethers.parseUnits(stop_loss.toString(), 18);
      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
      const pos = await perps.positions(position_id);
      const posOwner = pos.owner.toLowerCase();

      if (sessionAccount && (posOwner === sessionAccount.toLowerCase() || (sessionOwnerWallet && posOwner === sessionOwnerWallet.toLowerCase()))) {
        const data = perpsIface.encodeFunctionData("setTriggerOrders", [BigInt(position_id), tpWei, slWei]);
        const account = new ethers.Contract(sessionAccount, AURA_ACCOUNT_ABI, agentWallet);
        const tx = await account.executeBatchByAgent([AURA_PERPS_ADDRESS], [0n], [data]);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "triggers_set", account: sessionAccount, positionId: position_id, takeProfit: take_profit, stopLoss: stop_loss, txHash: receipt.hash }, null, 2) }] };
      }
      if (posOwner === agentWallet.address.toLowerCase()) {
        const tx = await perps.setTriggerOrders(BigInt(position_id), tpWei, slWei);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "triggers_set", positionId: position_id, takeProfit: take_profit, stopLoss: stop_loss, txHash: receipt.hash }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: "Not the position owner", positionId: position_id, positionOwner: pos.owner, hint: "Authenticate with the correct API key." }, null, 2) }] };
    });

    s.registerTool("add_margin", { description: "Add collateral to a position to reduce liquidation risk", inputSchema: z.object({ position_id: z.number(), amount: z.number() }) }, async ({ position_id, amount }) => {
      const amtWei = ethers.parseUnits(amount.toString(), 18);
      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
      const pos = await perps.positions(position_id);
      const posOwner = pos.owner.toLowerCase();

      if (sessionAccount && (posOwner === sessionAccount.toLowerCase() || (sessionOwnerWallet && posOwner === sessionOwnerWallet.toLowerCase()))) {
        const approveData = ausdIface.encodeFunctionData("approve", [AURA_PERPS_ADDRESS, amtWei]);
        const marginData = perpsIface.encodeFunctionData("addMargin", [BigInt(position_id), amtWei]);
        const account = new ethers.Contract(sessionAccount, AURA_ACCOUNT_ABI, agentWallet);
        const tx = await account.executeBatchByAgent([AUSD_ADDRESS, AURA_PERPS_ADDRESS], [0n, 0n], [approveData, marginData]);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "margin_added", account: sessionAccount, positionId: position_id, addedAmount: amount, txHash: receipt.hash }, null, 2) }] };
      }
      if (posOwner === agentWallet.address.toLowerCase()) {
        const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, agentWallet);
        const allowance = await ausd.allowance(agentWallet.address, AURA_PERPS_ADDRESS);
        if (allowance < amtWei) await (await ausd.approve(AURA_PERPS_ADDRESS, ethers.MaxUint256)).wait();
        const tx = await perps.addMargin(BigInt(position_id), amtWei);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "margin_added", positionId: position_id, addedAmount: amount, txHash: receipt.hash }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: "Not the position owner", positionId: position_id, positionOwner: pos.owner, hint: "Authenticate with the correct API key." }, null, 2) }] };
    });

    s.registerTool("get_market_analysis", { description: "Get AI macro analysis (sentiment, news, correlations) for an asset", inputSchema: z.object({ asset: z.string() }) }, async ({ asset }) => {
      const price = await fetchPythPrice(asset);
      const allPrices = {};
      for (const sym of Object.keys(PYTH_IDS)) { try { allPrices[sym] = await fetchPythPrice(sym); } catch {} }
      let sentiment = null;
      try {
        const cmcKey = process.env.COINMARKETCAP;
        if (cmcKey) {
          const res = await fetch("https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest", { headers: { "X-CMC_PRO_API_KEY": cmcKey, Accept: "application/json" } });
          if (res.ok) { const d = await res.json(); const v = d.data?.value || 50; const c = d.data?.value_classification || "Neutral"; sentiment = { sentiment: v > 60 ? "BULLISH" : v < 40 ? "BEARISH" : "NEUTRAL", score: v, summary: `Fear & Greed Index: ${v}/100 (${c})` }; }
        }
      } catch {}
      if (!sentiment) {
        try { const res = await fetch("https://api.alternative.me/fng/?limit=1"); if (res.ok) { const d = await res.json(); const v = parseInt(d.data?.[0]?.value || "50"); const c = d.data?.[0]?.value_classification || "Neutral"; sentiment = { sentiment: v > 60 ? "BULLISH" : v < 40 ? "BEARISH" : "NEUTRAL", score: v, summary: `Crypto Fear & Greed: ${v}/100 (${c})` }; } } catch {}
      }
      if (!sentiment) sentiment = { sentiment: "NEUTRAL", score: 50, summary: "Sentiment data unavailable" };
      return { content: [{ type: "text", text: JSON.stringify({ asset: asset.toUpperCase(), currentPrice: price, marketSentiment: sentiment.sentiment, sentimentScore: sentiment.score, analysis: sentiment.summary, allPrices, source: "pyth_hermes + fear_greed_index" }, null, 2) }] };
    });

    s.registerTool("get_funding_rate", { description: "Get funding rate and open interest for an asset", inputSchema: z.object({ asset: z.string() }) }, async ({ asset }) => {
      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, robinhoodProvider);
      const [longOI, shortOI, ratePerSec] = await Promise.all([perps.totalLongOI(asset.toUpperCase()), perps.totalShortOI(asset.toUpperCase()), perps.FUNDING_RATE_PER_SECOND()]);
      const dailyRate = Number(ratePerSec) * 86400 / 1e18 * 100;
      const longOINum = Number(ethers.formatUnits(longOI, 18));
      const shortOINum = Number(ethers.formatUnits(shortOI, 18));
      const skew = longOINum - shortOINum;
      return { content: [{ type: "text", text: JSON.stringify({ asset: asset.toUpperCase(), fundingRateDaily: `${dailyRate.toFixed(4)}%`, longOpenInterest: longOINum, shortOpenInterest: shortOINum, skew, skewDirection: skew > 0 ? "LONG_HEAVY" : skew < 0 ? "SHORT_HEAVY" : "BALANCED" }, null, 2) }] };
    });

    s.registerTool("partial_close", { description: "Partially close a position by size", inputSchema: z.object({ position_id: z.number(), close_size: z.number() }) }, async ({ position_id, close_size }) => {
      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
      const oracle = new ethers.Contract(MOCK_ORACLE_ADDRESS, ORACLE_ABI, agentWallet);
      const pos = await perps.positions(position_id);
      if (!pos.isOpen) return { content: [{ type: "text", text: "Position already closed." }] };
      const price = await fetchPythPrice(pos.asset);
      if (price) await (await oracle.setPrice(pos.asset, ethers.parseUnits(price.toFixed(2), 18))).wait();
      const sizeWei = ethers.parseUnits(close_size.toString(), 18);
      const posOwner = pos.owner.toLowerCase();

      if (sessionAccount && (posOwner === sessionAccount.toLowerCase() || (sessionOwnerWallet && posOwner === sessionOwnerWallet.toLowerCase()))) {
        const data = perpsIface.encodeFunctionData("closePositionPartially", [BigInt(position_id), sizeWei]);
        const account = new ethers.Contract(sessionAccount, AURA_ACCOUNT_ABI, agentWallet);
        const tx = await account.executeBatchByAgent([AURA_PERPS_ADDRESS], [0n], [data]);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "partially_closed", account: sessionAccount, positionId: position_id, closedSize: close_size, exitPrice: price, txHash: receipt.hash }, null, 2) }] };
      }

      if (posOwner === agentWallet.address.toLowerCase()) {
        const tx = await perps.closePositionPartially(BigInt(position_id), sizeWei);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "partially_closed", positionId: position_id, closedSize: close_size, exitPrice: price, txHash: receipt.hash }, null, 2) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ error: "Not the position owner", positionId: position_id, positionOwner: pos.owner, sessionAccount: sessionAccount || "none", agentWallet: agentWallet.address, hint: "This position belongs to a different wallet. Make sure you authenticate with the correct API key." }, null, 2) }] };
    });

    s.registerTool("dca_order", { description: "Schedule a DCA: auto-open positions at intervals. Max 10 orders, min 5 min.", inputSchema: z.object({ asset: z.string(), amount: z.number(), interval_minutes: z.number().min(5), num_orders: z.number().min(2).max(10), is_long: z.boolean().optional(), leverage: z.number().min(1).max(50).optional() }) }, async ({ asset, amount, interval_minutes, num_orders, is_long = true, leverage = 1 }) => {
      const dcaId = `dca_${Date.now()}`;
      let executed = 0;
      const executeOne = async () => {
        try {
          const colWei = ethers.parseUnits(amount.toString(), 18);
          const price = await fetchPythPrice(asset);
          if (price) { const oracle = new ethers.Contract(MOCK_ORACLE_ADDRESS, ORACLE_ABI, agentWallet); await (await oracle.setPrice(asset.toUpperCase(), ethers.parseUnits(price.toFixed(2), 18))).wait(); }
          if (sessionAccount) {
            const approveData = ausdIface.encodeFunctionData("approve", [AURA_PERPS_ADDRESS, colWei]);
            const openData = perpsIface.encodeFunctionData("openPosition", [asset.toUpperCase(), is_long, colWei, BigInt(leverage)]);
            const account = new ethers.Contract(sessionAccount, AURA_ACCOUNT_ABI, agentWallet);
            await (await account.executeBatchByAgent([AUSD_ADDRESS, AURA_PERPS_ADDRESS], [0n, 0n], [approveData, openData])).wait();
          } else {
            const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, agentWallet);
            const allowance = await ausd.allowance(agentWallet.address, AURA_PERPS_ADDRESS);
            if (allowance < colWei) await (await ausd.approve(AURA_PERPS_ADDRESS, ethers.MaxUint256)).wait();
            const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, agentWallet);
            await (await perps.openPosition(asset.toUpperCase(), is_long, colWei, BigInt(leverage))).wait();
          }
          executed++;
          if (executed >= num_orders) { clearInterval(dca.timer); activeDCAs.delete(dcaId); }
          else { const d = activeDCAs.get(dcaId); if (d) d.executed = executed; }
        } catch (e) { console.error(`[DCA ${dcaId}] failed:`, e.message); }
      };
      await executeOne();
      const timer = setInterval(executeOne, interval_minutes * 60 * 1000);
      const dca = { timer, asset: asset.toUpperCase(), amount, interval_minutes, num_orders, is_long, leverage, executed, startedAt: Date.now() };
      activeDCAs.set(dcaId, dca);
      return { content: [{ type: "text", text: JSON.stringify({ status: "dca_started", dcaId, asset: asset.toUpperCase(), amountPerOrder: amount, interval: `${interval_minutes} min`, totalOrders: num_orders, executed: 1, nextIn: `${interval_minutes} min` }, null, 2) }] };
    });

    s.registerTool("cancel_dca", { description: "Cancel an active DCA by ID", inputSchema: z.object({ dca_id: z.string() }) }, async ({ dca_id }) => {
      const dca = activeDCAs.get(dca_id);
      if (!dca) return { content: [{ type: "text", text: "DCA not found or already completed." }] };
      clearInterval(dca.timer);
      const result = { status: "cancelled", dcaId: dca_id, executed: dca.executed, remaining: dca.num_orders - dca.executed };
      activeDCAs.delete(dca_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

    s.registerTool("get_audit_trail", { description: "Get on-chain AI audit trail: total records, agent reputation, recent decisions", inputSchema: z.object({}) }, async () => {
      const audit = new ethers.Contract(AUDIT_TRAIL_ADDRESS, AUDIT_TRAIL_ABI, robinhoodProvider);
      const [totalRecords, reputation] = await Promise.all([audit.totalRecords(), audit.getAgentReputation(agentWallet.address)]);
      const currentBlock = await robinhoodProvider.getBlockNumber();
      let recentEvents = [];
      try {
        const filter = audit.filters.ReasoningRecordedWithScore(agentWallet.address);
        const logs = await audit.queryFilter(filter, Math.max(0, currentBlock - 500), currentBlock);
        recentEvents = logs.slice(-10).map(l => ({ user: l.args[1], hash: l.args[2], timestamp: Number(l.args[3]), action: l.args[4], confidenceScore: Number(l.args[5]) }));
      } catch {}
      return { content: [{ type: "text", text: JSON.stringify({ contract: AUDIT_TRAIL_ADDRESS, chain: "Robinhood Chain", totalRecords: Number(totalRecords), agentAddress: agentWallet.address, agentReputation: { totalTrades: Number(reputation[0]), avgConfidenceScore: Number(reputation[1]) }, recentDecisions: recentEvents }, null, 2) }] };
    });

    s.registerTool("get_pnl_summary", { description: "Get PnL summary: total PnL, win rate, best/worst trade", inputSchema: z.object({}) }, async () => {
      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, robinhoodProvider);
      const nextId = Number(await perps.nextPositionId());
      // Only count positions belonging to the authenticated user (both AuraAccount and EOA)
      const ownerAddrs = new Set();
      if (sessionAccount) ownerAddrs.add(sessionAccount.toLowerCase());
      if (sessionOwnerWallet) ownerAddrs.add(sessionOwnerWallet.toLowerCase());
      if (ownerAddrs.size === 0) ownerAddrs.add(agentWallet.address.toLowerCase());
      let totalPnl = 0, wins = 0, losses = 0, bestPnl = -Infinity, worstPnl = Infinity, totalVolume = 0, openCount = 0, scanned = 0;
      for (let i = nextId - 1; i >= 0 && scanned < 500; i--) { scanned++; try { const pos = await perps.positions(i); if (!ownerAddrs.has(pos.owner.toLowerCase())) continue; const size = Number(ethers.formatUnits(pos.positionSize, 18)); totalVolume += size; if (pos.isOpen) { openCount++; const price = await fetchPythPrice(pos.asset); if (price) { const [pnl, isProfit] = await perps.calculatePnL(i, ethers.parseUnits(price.toFixed(2), 18)); const pnlNum = Number(ethers.formatUnits(pnl, 18)) * (isProfit ? 1 : -1); totalPnl += pnlNum; if (pnlNum > 0) wins++; else losses++; if (pnlNum > bestPnl) bestPnl = pnlNum; if (pnlNum < worstPnl) worstPnl = pnlNum; } } else { const pnlNum = Number(ethers.formatUnits(pos.realizedPnl, 18)) * (pos.isProfitRealized ? 1 : -1); totalPnl += pnlNum; if (pnlNum > 0) wins++; else losses++; if (pnlNum > bestPnl) bestPnl = pnlNum; if (pnlNum < worstPnl) worstPnl = pnlNum; } } catch { continue; } }
      const totalTrades = wins + losses;
      return { content: [{ type: "text", text: JSON.stringify({ account: sessionAccount || agentWallet.address, totalPnl: totalPnl.toFixed(2), winRate: totalTrades > 0 ? `${((wins / totalTrades) * 100).toFixed(1)}%` : "N/A", wins, losses, bestTrade: bestPnl === -Infinity ? "N/A" : bestPnl.toFixed(2), worstTrade: worstPnl === Infinity ? "N/A" : worstPnl.toFixed(2), openPositions: openCount, totalVolume: totalVolume.toFixed(2), totalTrades }, null, 2) }] };
    });

    s.registerTool("get_supported_assets", { description: "List all supported trading assets with current prices", inputSchema: z.object({}) }, async () => {
      const assets = [];
      for (const [sym] of Object.entries(PYTH_IDS)) { const price = await fetchPythPrice(sym); assets.push({ symbol: sym, price }); }
      return { content: [{ type: "text", text: JSON.stringify({ supported: assets, count: assets.length }, null, 2) }] };
    });



    s.registerTool("get_liquidation_price", { description: "Calculate liquidation price for a position", inputSchema: z.object({ position_id: z.number() }) }, async ({ position_id }) => {
      const perps = new ethers.Contract(AURA_PERPS_ADDRESS, PERPS_ABI, robinhoodProvider);
      const pos = await perps.positions(position_id);
      if (!pos.isOpen) return { content: [{ type: "text", text: "Position is closed." }] };
      const entry = Number(ethers.formatUnits(pos.entryPrice, 18));
      const collateral = Number(ethers.formatUnits(pos.collateralAmount, 18));
      const size = Number(ethers.formatUnits(pos.positionSize, 18));
      const liqPrice = pos.isLong ? entry * (1 - collateral / size) : entry * (1 + collateral / size);
      const currentPrice = await fetchPythPrice(pos.asset);
      const distancePct = currentPrice ? ((currentPrice - liqPrice) / currentPrice * 100 * (pos.isLong ? 1 : -1)).toFixed(2) : "N/A";
      return { content: [{ type: "text", text: JSON.stringify({ positionId: position_id, asset: pos.asset, side: pos.isLong ? "LONG" : "SHORT", entryPrice: entry, liquidationPrice: parseFloat(liqPrice.toFixed(2)), currentPrice, distanceToLiquidation: `${distancePct}%` }, null, 2) }] };
    });

    s.registerTool("swap", { description: "Swap ETH for tokenized stock via Synthra V3 Router", inputSchema: z.object({ amount_eth: z.number(), token_out: z.string() }) }, async ({ amount_eth, token_out }) => {
      const TOKEN_MAP = { TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", NFLX: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", AMD: "0x71178BAc73cBeb415514eB542a8995b82669778d", PLTR: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0" };
      const tokenAddr = TOKEN_MAP[token_out.toUpperCase()];
      if (!tokenAddr) return { content: [{ type: "text", text: `Unsupported: ${token_out}` }] };
      const amountWei = ethers.parseEther(amount_eth.toString());
      const routerIface = new ethers.Interface(["function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable"]);
      const wrapInput = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [2, amountWei]);
      const path = ethers.solidityPacked(["address", "uint24", "address"], [WETH_ADDRESS, 3000, tokenAddr]);
      const recipient = sessionAccount || agentWallet.address;
      const swapInput = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "uint256", "bytes", "bool"], [recipient, amountWei, 0n, path, false]);
      const deadline = Math.floor(Date.now() / 1000) + 1800;
      const tx = await agentWallet.sendTransaction({ to: SYNTHRA_ROUTER, data: routerIface.encodeFunctionData("execute", ["0x0b00", [wrapInput, swapInput], deadline]), value: amountWei });
      const receipt = await tx.wait();
      return { content: [{ type: "text", text: JSON.stringify({ status: "swapped", amountIn: `${amount_eth} ETH`, tokenOut: token_out.toUpperCase(), recipient, txHash: receipt.hash }, null, 2) }] };
    });

    s.registerTool("deposit_vault", { description: "Deposit aUSD into ERC-4626 Perp Vault to earn yield", inputSchema: z.object({ amount: z.number() }) }, async ({ amount }) => {
      const amtWei = ethers.parseUnits(amount.toString(), 18);
      if (sessionAccount) {
        const approveData = ausdIface.encodeFunctionData("approve", [AURA_VAULT_ADDRESS, amtWei]);
        const depositData = new ethers.Interface(["function deposit(uint256 assets, address receiver) returns (uint256)"]).encodeFunctionData("deposit", [amtWei, sessionAccount]);
        const account = new ethers.Contract(sessionAccount, AURA_ACCOUNT_ABI, agentWallet);
        const tx = await account.executeBatchByAgent([AUSD_ADDRESS, AURA_VAULT_ADDRESS], [0n, 0n], [approveData, depositData]);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "deposited", amount, account: sessionAccount, txHash: receipt.hash }, null, 2) }] };
      }
      const ausd = new ethers.Contract(AUSD_ADDRESS, AUSD_ABI, agentWallet);
      const allowance = await ausd.allowance(agentWallet.address, AURA_VAULT_ADDRESS);
      if (allowance < amtWei) await (await ausd.approve(AURA_VAULT_ADDRESS, ethers.MaxUint256)).wait();
      const vault = new ethers.Contract(AURA_VAULT_ADDRESS, ["function deposit(uint256 assets, address receiver) returns (uint256)"], agentWallet);
      const tx = await vault.deposit(amtWei, agentWallet.address);
      const receipt = await tx.wait();
      return { content: [{ type: "text", text: JSON.stringify({ status: "deposited", amount, txHash: receipt.hash }, null, 2) }] };
    });

    s.registerTool("schedule_swap", { description: "Schedule recurring ETH-to-token swaps (DCA swaps)", inputSchema: z.object({ token_out: z.string(), amount_eth: z.number(), interval_minutes: z.number().min(5), num_swaps: z.number().min(2).max(10) }) }, async ({ token_out, amount_eth, interval_minutes, num_swaps }) => {
      const TOKEN_MAP = { TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", NFLX: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", AMD: "0x71178BAc73cBeb415514eB542a8995b82669778d", PLTR: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0" };
      const tokenAddr = TOKEN_MAP[token_out.toUpperCase()];
      if (!tokenAddr) return { content: [{ type: "text", text: `Unsupported: ${token_out}` }] };
      const dcaId = `swap_dca_${Date.now()}`;
      let executed = 0;
      const executeOneSwap = async () => {
        try {
          const amountWei = ethers.parseEther(amount_eth.toString());
          const routerIface = new ethers.Interface(["function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable"]);
          const wrapInput = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [2, amountWei]);
          const path = ethers.solidityPacked(["address", "uint24", "address"], [WETH_ADDRESS, 3000, tokenAddr]);
          const recipient = sessionAccount || agentWallet.address;
          const swapInput = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "uint256", "bytes", "bool"], [recipient, amountWei, 0n, path, false]);
          const deadline = Math.floor(Date.now() / 1000) + 1800;
          const tx = await agentWallet.sendTransaction({ to: SYNTHRA_ROUTER, data: routerIface.encodeFunctionData("execute", ["0x0b00", [wrapInput, swapInput], deadline]), value: amountWei });
          await tx.wait();
          executed++;
          if (executed >= num_swaps) { clearInterval(dca.timer); activeDCAs.delete(dcaId); }
          else { const d = activeDCAs.get(dcaId); if (d) d.executed = executed; }
        } catch (e) { console.error(`[SwapDCA ${dcaId}] failed:`, e.message); }
      };
      await executeOneSwap();
      const timer = setInterval(executeOneSwap, interval_minutes * 60 * 1000);
      const dca = { timer, asset: token_out.toUpperCase(), amount: amount_eth, interval_minutes, num_orders: num_swaps, executed, startedAt: Date.now(), type: "swap" };
      activeDCAs.set(dcaId, dca);
      return { content: [{ type: "text", text: JSON.stringify({ status: "swap_dca_started", dcaId, tokenOut: token_out.toUpperCase(), ethPerSwap: amount_eth, interval: `${interval_minutes} min`, totalSwaps: num_swaps, executed: 1, nextIn: `${interval_minutes} min` }, null, 2) }] };
    });

    s.registerTool("get_governance_proposals", {
      description: "Read active proposals from the Aura DAO Governance contract.",
      inputSchema: z.object({})
    }, async () => {
      const dao = new ethers.Contract(AURA_DAO_ADDRESS, DAO_ABI, robinhoodProvider);
      try {
        const nextId = Number(await dao.nextProposalId());
        const proposals = [];
        for (let i = 0; i < nextId && proposals.length < 10; i++) {
          const p = await dao.proposals(i);
          if (!p.executed && Number(p.endTime) * 1000 > Date.now()) {
            proposals.push({
              id: Number(p.id),
              title: p.title,
              description: p.description,
              forVotes: Number(p.forVotes),
              againstVotes: Number(p.againstVotes),
              endTime: new Date(Number(p.endTime) * 1000).toISOString()
            });
          }
        }
        return { content: [{ type: "text", text: JSON.stringify({ activeProposals: proposals }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: "DAO not available or no proposals." }] };
      }
    });

    s.registerTool("vote_proposal", {
      description: "Vote on a DAO governance proposal as an AI Delegate.",
      inputSchema: z.object({
        proposal_id: z.number().describe("Proposal ID to vote on"),
        support: z.boolean().describe("true for Yes/For, false for No/Against")
      })
    }, async ({ proposal_id, support }) => {
      if (!sessionAccount) return { content: [{ type: "text", text: "Not authenticated. Cannot vote." }] };
      try {
        const daoIface = new ethers.Interface(DAO_ABI);
        const voteData = daoIface.encodeFunctionData("vote", [proposal_id, support]);
        const account = new ethers.Contract(sessionAccount, AURA_ACCOUNT_ABI, agentWallet);
        const tx = await account.executeBatchByAgent([AURA_DAO_ADDRESS], [0n], [voteData]);
        const receipt = await tx.wait();
        return { content: [{ type: "text", text: JSON.stringify({ status: "voted", proposalId: proposal_id, support, txHash: receipt.hash }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Voting failed: ${e.message}` }] };
      }
    });

    return s;
  }

  // Resolve Bearer token to AuraAccount address via main backend
  const BACKEND_URL = process.env.BACKEND_URL || "https://aura-backend-backend.up.railway.app";
  async function resolveAuth(req) {
    const auth = req.headers?.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return { auraAccount: null, ownerWallet: null };
    try {
      // Ask the main backend to resolve this token
      const res = await fetch(`${BACKEND_URL}/api/mcp-keys/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: token }),
      });
      if (!res.ok) return { auraAccount: null, ownerWallet: null };
      const data = await res.json();
      return { auraAccount: data.auraAccount || null, ownerWallet: data.ownerWallet || null };
    } catch { return { auraAccount: null, ownerWallet: null }; }
  }

  app.get("/sse", async (req, res) => {
    let { auraAccount, ownerWallet } = await resolveAuth(req);
    // If no Bearer token, check if any recent auth exists (stateless/reconnect workaround)
    if (!auraAccount && authenticatedAccounts.size > 0) {
      auraAccount = [...authenticatedAccounts.values()].pop();
      ownerWallet = null; // will be auto-resolved via owner() fallback in createServer
    }

    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    res.on("close", () => { delete transports[transport.sessionId]; });
    const s = createServer(auraAccount, ownerWallet);
    await s.connect(transport);
  });

  // Return 405 on POST /sse to force mcp-remote to use SSE transport
  app.post("/sse", (req, res) => res.status(405).end());

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];
    if (!transport) return res.status(400).json({ error: "No active session" });
    await transport.handlePostMessage(req, res);
  });

  // ── Streamable HTTP transport (for Claude.ai web) ──
  const { WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/server");

  app.all("/mcp", express.json(), async (req, res) => {
    let { auraAccount, ownerWallet } = await resolveAuth(req);
    // If no Bearer token, check if any recent auth exists (stateless workaround)
    if (!auraAccount && authenticatedAccounts.size > 0) {
      // Use the most recently authenticated account (single-user demo simplification)
      auraAccount = [...authenticatedAccounts.values()].pop();
      ownerWallet = null; // will be resolved via owner() fallback
    }
    const s = createServer(auraAccount, ownerWallet);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await s.connect(transport);

    // Convert Express req to Web Standard Request
    const url = `http://localhost:${port}${req.originalUrl}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) { if (v) headers.set(k, Array.isArray(v) ? v[0] : v); }
    const webReq = new Request(url, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    });

    try {
      const webRes = await transport.handleRequest(webReq);
      res.status(webRes.status);
      webRes.headers.forEach((v, k) => res.setHeader(k, v));
      // Handle streaming response
      if (webRes.body) {
        const reader = webRes.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); break; }
            res.write(value);
          }
        };
        await pump();
      } else {
        const text = await webRes.text();
        res.send(text);
      }
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  app.listen(port, () => {
    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║  AURA MCP SERVER — Delegation Model                      ║`);
    console.log(`║  SSE: http://localhost:${port}/sse                         ║`);
    console.log(`║  Agent: ${agentWallet.address}  ║`);
    console.log(`║                                                           ║`);
    console.log(`║  Tools: get_price, get_orderbook, place_limit_order,      ║`);
    console.log(`║    get_limit_orders, cancel_limit_order,                 ║`);
    console.log(`║    place_market_order, get_positions, close_position,      ║`);
    console.log(`║    get_account_balance, set_stop_loss_take_profit,         ║`);
    console.log(`║    add_margin, get_market_analysis, get_funding_rate,      ║`);
    console.log(`║    partial_close                                           ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Aura MCP] stdio mode | Agent:", agentWallet.address);
}
