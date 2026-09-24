export const CONTRACT_ADDRESSES = {
  AUSD: "0x359961489f069F16E5dbA46d9b174bBF7b25147B",
  ARB_SEPOLIA_AUSD: "0x27cd6eD9482FF6Ae388F629E8E6D57d8dc975c5A",
  MOCK_ORACLE: "0x097AeB196366317cf97986A04f32Df312c96ABa1",
  AURA_PERPS: "0x23aEa07e298d16b00d59c22c865065Be61edAa55",
  AURA_VAULT: "0x4Ae6Ab5BCAb4F0f2FAcAA47aD2ea5832eBDF5792",
  INTELLIGENCE_VAULT: "0x69A88c72eAda96A515e0dc57632A6Abf59EA2E38",
  AURA_ACCOUNT: "0x0C42313e922E7d8b2A1175a695f083Bb0e0cF64A",
  AURA_GUARDRAIL: "0x53d7ED1bD27bdCA3813050dE90D7D545DB800900",
  AURA_COPY_TRADING_V2: process.env.NEXT_PUBLIC_COPY_TRADING_V2_ADDRESS || "0x9f25DFA06596A6c4508D0d8634abA4eb0C75B34d", // Make sure to load from env

  // ────────────────────────────────────────────────────────────────
  // Two completely different routers, used by two different flows:
  //  - SPOT_ROUTER  → Synthra Universal Router (used by /chat for ETH↔Token swaps)
  //  - LOB_ROUTER   → AuraPerpsRouter (used by /trade for limit orders on perps)
  // The legacy `ROUTER` alias is kept for backwards-compat and points at the LOB router.
  // ────────────────────────────────────────────────────────────────
  SPOT_ROUTER: "0x6F308B834595312f734e65e273F2210f43Fc48F8",
  LOB_ROUTER:
    (process.env.NEXT_PUBLIC_LOB_ROUTER_ADDRESS as `0x${string}`) ||
    "0xE960d3FfC63B74aBb499E70ea275C980A4b25ab8",
  ROUTER:
    (process.env.NEXT_PUBLIC_LOB_ROUTER_ADDRESS as `0x${string}`) ||
    "0xE960d3FfC63B74aBb499E70ea275C980A4b25ab8",

  STYLUS_LOB:
    (process.env.NEXT_PUBLIC_STYLUS_LOB_ADDRESS as `0x${string}`) ||
    "0x3346abe000118b25aca953f48deb1978a069e7de",
  STYLUS_LOB_CHAIN_ID: 421614, // Arbitrum Sepolia
  STYLUS_LOB_RPC: "https://sepolia-rollup.arbitrum.io/rpc",
  MM_FUND:
    (process.env.NEXT_PUBLIC_MM_FUND_ADDRESS as `0x${string}`) ||
    "0x0581B992cdeD8C739ac9A26eC629014838549018",
  CONDITIONAL_ORDER_MANAGER: "0x00C81abc47B840E9104620F6477Def4608fD165A",
  LIQUIDATION_SHIELD:
    (process.env.NEXT_PUBLIC_LIQUIDATION_SHIELD_ADDRESS as `0x${string}`) ||
    "0x089ABc77f4C68Da0299C7521ebd82A7Db4791c0B",
  STYLUS_ESCROW: "0x19147627a4b6b0b803b097d3c6216c3351d4913e" as `0x${string}`,
};


export const TOKENS = {
  WETH: "0x7943e237c7F95DA44E0301572D358911207852Fa",
  TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
  AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
  BTC:  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  USDC: "0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F",
  SYN:  "0xC5124C846c6e6307986988dFb7e743327aA05F19"
};

export const INTELLIGENCE_VAULT_ABI = [
  { type: "function", name: "totalAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalDeployed", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "idleCapital", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "utilizationRateBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "maxProtocolExposureBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "maxRiskScore", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "strategyNonce", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getProtocolExposureBps", inputs: [{ name: "protocol", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "convertToAssets", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "convertToShares", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "deposit", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "withdraw", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "paused", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "previewDeposit", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "maxWithdraw", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "event", name: "StrategyExecuted", inputs: [{ indexed: true, name: "nonce", type: "uint256" }, { indexed: true, name: "executor", type: "address" }, { indexed: true, name: "target", type: "address" }, { indexed: false, name: "riskScore", type: "uint256" }, { indexed: false, name: "value", type: "uint256" }, { indexed: false, name: "success", type: "bool" }] },
  { type: "event", name: "StrategyRejectedBySolidity", inputs: [{ indexed: true, name: "nonce", type: "uint256" }, { indexed: true, name: "target", type: "address" }, { indexed: false, name: "reason", type: "string" }] },
  { type: "event", name: "StrategyRejectedByStylus", inputs: [{ indexed: true, name: "nonce", type: "uint256" }, { indexed: true, name: "target", type: "address" }, { indexed: false, name: "reason", type: "bytes32" }] },
  { type: "event", name: "CapitalDeployed", inputs: [{ indexed: true, name: "protocol", type: "address" }, { indexed: false, name: "amount", type: "uint256" }] },
  { type: "event", name: "CapitalWithdrawn", inputs: [{ indexed: true, name: "protocol", type: "address" }, { indexed: false, name: "amount", type: "uint256" }] }
];

export const AUSD_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "faucet", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "mint", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }
];

export const AURA_VAULT_ABI = [
  { type: "function", name: "totalAssets", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "deposit", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256", name: "shares" }], stateMutability: "nonpayable" },
  { type: "function", name: "withdraw", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256", name: "shares" }], stateMutability: "nonpayable" },
  { type: "function", name: "previewDeposit", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "previewWithdraw", inputs: [{ name: "assets", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" }
];

export const AURA_PERPS_ABI = [{"inputs":[{"internalType":"address","name":"_aUSD","type":"address"},{"internalType":"address","name":"_oracle","type":"address"},{"internalType":"address","name":"_vault","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"OwnableInvalidOwner","type":"error"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"OwnableUnauthorizedAccount","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"MarginAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"pnl","type":"uint256"},{"indexed":false,"internalType":"bool","name":"isProfit","type":"bool"},{"indexed":false,"internalType":"uint256","name":"exitPrice","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"fundingFee","type":"uint256"}],"name":"PositionClosed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":true,"internalType":"address","name":"liquidator","type":"address"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"bounty","type":"uint256"}],"name":"PositionLiquidated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"string","name":"asset","type":"string"},{"indexed":false,"internalType":"bool","name":"isLong","type":"bool"},{"indexed":false,"internalType":"uint256","name":"collateral","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"leverage","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"entryPrice","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"openedAt","type":"uint256"}],"name":"PositionOpened","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"uint256","name":"positionId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"tpPrice","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"slPrice","type":"uint256"}],"name":"TriggersUpdated","type":"event"},{"inputs":[],"name":"FUNDING_RATE_PER_SECOND","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"LIQUIDATION_BOUNTY_PERCENT","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"TRADING_FEE_BPS","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"aUSD","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"positionId","type":"uint256"},{"internalType":"uint256","name":"additionalCollateral","type":"uint256"}],"name":"addMargin","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"positionId","type":"uint256"},{"internalType":"uint256","name":"currentPrice","type":"uint256"}],"name":"calculatePnL","outputs":[{"internalType":"uint256","name":"pnl","type":"uint256"},{"internalType":"bool","name":"isProfit","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"positionId","type":"uint256"}],"name":"closePosition","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"positionId","type":"uint256"},{"internalType":"uint256","name":"closeSize","type":"uint256"}],"name":"closePositionPartially","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"positionId","type":"uint256"}],"name":"executeTriggerOrder","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"string","name":"asset","type":"string"},{"internalType":"bool","name":"isLong","type":"bool"}],"name":"getCurrentFundingRate","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"positionId","type":"uint256"}],"name":"liquidatePosition","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"nextPositionId","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"string","name":"asset","type":"string"},{"internalType":"bool","name":"isLong","type":"bool"},{"internalType":"uint256","name":"collateralAmount","type":"uint256"},{"internalType":"uint256","name":"leverage","type":"uint256"}],"name":"openPosition","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"oracle","outputs":[{"internalType":"contract IMockOracle","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"positions","outputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"string","name":"asset","type":"string"},{"internalType":"bool","name":"isLong","type":"bool"},{"internalType":"uint256","name":"collateralAmount","type":"uint256"},{"internalType":"uint256","name":"leverage","type":"uint256"},{"internalType":"uint256","name":"entryPrice","type":"uint256"},{"internalType":"uint256","name":"positionSize","type":"uint256"},{"internalType":"bool","name":"isOpen","type":"bool"},{"internalType":"uint256","name":"openedAt","type":"uint256"},{"internalType":"uint256","name":"realizedPnl","type":"uint256"},{"internalType":"bool","name":"isProfitRealized","type":"bool"},{"internalType":"uint256","name":"exitPrice","type":"uint256"},{"internalType":"uint256","name":"takeProfitPrice","type":"uint256"},{"internalType":"uint256","name":"stopLossPrice","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_stylusMath","type":"address"}],"name":"setStylusMath","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"positionId","type":"uint256"},{"internalType":"uint256","name":"tpPrice","type":"uint256"},{"internalType":"uint256","name":"slPrice","type":"uint256"}],"name":"setTriggerOrders","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"stylusMath","outputs":[{"internalType":"contract IAuraStylusMath","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"string","name":"","type":"string"}],"name":"totalLongOI","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"string","name":"","type":"string"}],"name":"totalShortOI","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"vault","outputs":[{"internalType":"contract IAuraVault","name":"","type":"address"}],"stateMutability":"view","type":"function"}];

export const AURA_ROUTER_ABI = [
  { type: "function", name: "placeLimitOrder", inputs: [{ name: "asset", type: "string" }, { name: "isLong", type: "bool" }, { name: "collateral", type: "uint256" }, { name: "leverage", type: "uint256" }, { name: "limitPrice", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "placeLimitOrderFor", inputs: [{ name: "from", type: "address" }, { name: "asset", type: "string" }, { name: "isLong", type: "bool" }, { name: "collateral", type: "uint256" }, { name: "leverage", type: "uint256" }, { name: "limitPrice", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "cancelLimitOrder", inputs: [{ name: "orderId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "routedMarketOpen", inputs: [{ name: "asset", type: "string" }, { name: "isLong", type: "bool" }, { name: "collateral", type: "uint256" }, { name: "leverage", type: "uint256" }], outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable" },
  { type: "function", name: "getOrderBook", inputs: [{ name: "asset", type: "string" }], outputs: [{ type: "uint256[]", name: "bidIds" }, { type: "uint256[]", name: "askIds" }], stateMutability: "view" },
  { type: "function", name: "getOrderBookSorted", inputs: [{ name: "asset", type: "string" }, { name: "depth", type: "uint256" }], outputs: [{ type: "uint256[]", name: "bidIds" }, { type: "uint256[]", name: "bidPrices" }, { type: "uint256[]", name: "bidSizes" }, { type: "uint256[]", name: "askIds" }, { type: "uint256[]", name: "askPrices" }, { type: "uint256[]", name: "askSizes" }], stateMutability: "view" },
  { type: "function", name: "getOrderDetails", inputs: [{ name: "orderId", type: "uint256" }], outputs: [{ type: "address", name: "user" }, { type: "uint256", name: "assetHash" }, { type: "bool", name: "isLong" }, { type: "uint256", name: "collateral" }, { type: "uint256", name: "leverage" }, { type: "uint256", name: "limitPrice" }, { type: "uint256", name: "timestamp" }, { type: "uint256", name: "status" }], stateMutability: "view" },
  { type: "function", name: "getBookDepth", inputs: [{ name: "asset", type: "string" }], outputs: [{ type: "uint256", name: "bids" }, { type: "uint256", name: "asks" }], stateMutability: "view" },
  { type: "function", name: "getStats", inputs: [], outputs: [{ type: "uint256", name: "totalOrders" }, { type: "uint256", name: "placed" }, { type: "uint256", name: "filled" }], stateMutability: "view" }
];


// ────────────────────────────────────────────────────────────────
// STYLUS_LOB_ABI — direct calls to the Rust/WASM order book on
// Arbitrum Sepolia. Uses snake_case selectors (configured in lib.rs
// via #[selector(name = "...")]). Asset is keyed by uint256(keccak256(symbol))
// rather than a string to match the Solidity router convention.
// ────────────────────────────────────────────────────────────────
export const STYLUS_LOB_ABI = [
  {
    type: "function",
    name: "store_order",
    inputs: [
      { name: "owner",       type: "address" },
      { name: "asset_hash",  type: "uint256" },
      { name: "is_long",     type: "bool" },
      { name: "collateral",  type: "uint256" },
      { name: "leverage",    type: "uint256" },
      { name: "limit_price", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancel_order",
    inputs: [
      { name: "order_id", type: "uint256" },
      { name: "caller",   type: "address" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "get_active_orders_sorted",
    inputs: [
      { name: "asset_hash",  type: "uint256" },
      { name: "is_long",     type: "bool" },
      { name: "max_results", type: "uint256" },
    ],
    outputs: [
      { type: "uint256[]", name: "ids" },
      { type: "uint256[]", name: "prices" },
      { type: "uint256[]", name: "sizes" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "get_book_depth",
    inputs: [{ name: "asset_hash", type: "uint256" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "get_stats",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const CONDITIONAL_ORDER_MANAGER_ABI = [
  { type: "function", name: "createOrder", inputs: [{ name: "positionId", type: "uint256" }, { name: "orderType", type: "uint8" }, { name: "triggerPrice", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "cancelOrder", inputs: [{ name: "orderId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "getUserOrders", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256[]" }], stateMutability: "view" },
  { type: "function", name: "getActiveOrderCount", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "orders", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "owner", type: "address" }, { name: "positionId", type: "uint256" }, { name: "asset", type: "string" }, { name: "orderType", type: "uint8" }, { name: "triggerPrice", type: "uint256" }, { name: "status", type: "uint8" }, { name: "createdAt", type: "uint256" }, { name: "executedAt", type: "uint256" }], stateMutability: "view" },
] as const;

export const LIQUIDATION_SHIELD_ABI = [
  { type: "function", name: "armShield", inputs: [{ name: "positionId", type: "uint256" }, { name: "thresholdBps", type: "uint256" }, { name: "recommendedTopUp", type: "uint256" }, { name: "maxTopUpPerEvent", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "disarmShield", inputs: [{ name: "positionId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "mandates", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "armed", type: "bool" }, { name: "thresholdBps", type: "uint256" }, { name: "recommendedTopUp", type: "uint256" }, { name: "maxTopUpPerEvent", type: "uint256" }, { name: "createdAt", type: "uint256" }, { name: "updatedAt", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getActiveMandates", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256[]" }], stateMutability: "view" },
] as const;

export const AURA_COPY_TRADING_V2_ABI = [
  { type: "function", name: "registerAsLeader", inputs: [{ name: "performanceFeeBps", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "followLeader", inputs: [{ name: "leader", type: "address" }, { name: "amount", type: "uint256" }, { name: "scaleFactor", type: "uint256" }, { name: "maxSlippageBps", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "addCapital", inputs: [{ name: "leader", type: "address" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "unfollowLeader", inputs: [{ name: "leader", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "updateFollowerParams", inputs: [{ name: "leader", type: "address" }, { name: "newSF", type: "uint256" }, { name: "newSlip", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "claimFees", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "leaders", inputs: [{ name: "leader", type: "address" }], outputs: [{ name: "isRegistered", type: "bool" }, { name: "isActive", type: "bool" }, { name: "performanceFeeBps", type: "uint256" }, { name: "totalFollowers", type: "uint256" }, { name: "totalCopiedCapital", type: "uint256" }, { name: "totalRealizedPnl", type: "uint256" }, { name: "isPnlPositive", type: "bool" }, { name: "tradesExecuted", type: "uint256" }, { name: "tradesWon", type: "uint256" }, { name: "createdAt", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allocations", inputs: [{ name: "leader", type: "address" }, { name: "follower", type: "address" }], outputs: [{ name: "isActive", type: "bool" }, { name: "capitalDeposited", type: "uint256" }, { name: "capitalInPositions", type: "uint256" }, { name: "highWaterMark", type: "uint256" }, { name: "scaleFactor", type: "uint256" }, { name: "maxSlippageBps", type: "uint256" }, { name: "joinedAt", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "pendingFees", inputs: [{ name: "leader", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getFollowerAvailableBalance", inputs: [{ name: "leader", type: "address" }, { name: "follower", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getLeaderCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getActiveLeaders", inputs: [{ name: "offset", type: "uint256" }, { name: "limit", type: "uint256" }], outputs: [{ name: "activeAddrs", type: "address[]" }, { components: [{ name: "isRegistered", type: "bool" }, { name: "isActive", type: "bool" }, { name: "performanceFeeBps", type: "uint256" }, { name: "totalFollowers", type: "uint256" }, { name: "totalCopiedCapital", type: "uint256" }, { name: "totalRealizedPnl", type: "uint256" }, { name: "isPnlPositive", type: "bool" }, { name: "tradesExecuted", type: "uint256" }, { name: "tradesWon", type: "uint256" }, { name: "createdAt", type: "uint256" }], name: "activeProfiles", type: "tuple[]" }], stateMutability: "view" }
] as const;

export const AURA_CROSS_CHAIN_ESCROW_ABI = [
  { type: "function", name: "placeLimitOrder", inputs: [{ name: "asset_hash", type: "uint256" }, { name: "is_long", type: "bool" }, { name: "collateral", type: "uint256" }, { name: "leverage", type: "uint256" }, { name: "limit_price", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "cancelOrder", inputs: [{ name: "order_id", type: "uint256" }, { name: "caller", type: "address" }], outputs: [], stateMutability: "nonpayable" }
] as const;

export const ERC20_ABI = [
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }
] as const;
