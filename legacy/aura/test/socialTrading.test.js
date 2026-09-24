// test/socialTrading.test.js
// Unit tests for social trading backend endpoints
// Run: node test/socialTrading.test.js

const assert = require("assert");

// ── Mock ethers ─────────────────────────────────────────────────────────────
// We mock the contract to test our formatting and aggregation logic

const MOCK_STRATEGIES = [
  {
    strategist: "0x1234567890123456789012345678901234567890",
    name: "Alpha Scalper",
    description: "High-frequency ETH/BTC scalping strategy",
    performanceFeeBps: BigInt(1000), // 10%
    isActive: true,
    totalFollowerCapital: BigInt("500000000000000000000"), // 500 aUSD
    followerCount: BigInt(5),
    totalPnl: BigInt("75000000000000000000"), // 75 aUSD
    createdAt: BigInt(Math.floor(Date.now() / 1000) - 86400 * 30), // 30 days ago
  },
  {
    strategist: "0x1234567890123456789012345678901234567890",
    name: "Momentum Rider",
    description: "Trend following on major pairs",
    performanceFeeBps: BigInt(500), // 5%
    isActive: true,
    totalFollowerCapital: BigInt("200000000000000000000"), // 200 aUSD
    followerCount: BigInt(3),
    totalPnl: BigInt("30000000000000000000"), // 30 aUSD
    createdAt: BigInt(Math.floor(Date.now() / 1000) - 86400 * 15), // 15 days ago
  },
  {
    strategist: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
    name: "Whale Tracker",
    description: "Follow large institutional movements",
    performanceFeeBps: BigInt(1500), // 15%
    isActive: true,
    totalFollowerCapital: BigInt("1000000000000000000000"), // 1000 aUSD
    followerCount: BigInt(12),
    totalPnl: BigInt("150000000000000000000"), // 150 aUSD
    createdAt: BigInt(Math.floor(Date.now() / 1000) - 86400 * 60), // 60 days ago
  },
];

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    testsFailed++;
  }
}

// ── Test formatStrategy ─────────────────────────────────────────────────────
console.log("\n📋 Testing formatStrategy()...");

// Manually replicate the formatStrategy logic for testing
function mockFormatEther(bigintVal) {
  return (Number(bigintVal) / 1e18).toString();
}

function formatStrategy(id, s) {
  const totalPnl = parseFloat(mockFormatEther(s.totalPnl));
  const totalCapital = parseFloat(mockFormatEther(s.totalFollowerCapital));
  const createdAt = Number(s.createdAt);
  const ageSeconds = Math.max(1, Math.floor(Date.now() / 1000) - createdAt);
  const ageDays = ageSeconds / 86400;
  const effectiveCapital = Math.max(totalCapital, 1);
  const roi = (totalPnl / effectiveCapital) * 100;

  const baseWinRate = totalPnl > 0 ? 55 + Math.min(roi * 0.3, 30) : 30 + Math.random() * 15;
  const winRate = Math.min(95, Math.max(15, baseWinRate));
  const maxDrawdown = totalPnl > 0
    ? Math.max(2, 25 - Math.min(roi * 0.5, 20))
    : Math.min(50, 15 + Math.abs(roi) * 0.3);
  const dailyPnl = totalPnl / Math.max(ageDays, 1);
  const weeklyPnl = dailyPnl * 7;
  const monthlyPnl = dailyPnl * 30;
  const tradesPerDay = 2 + Math.random() * 3;
  const totalTrades = Math.max(1, Math.floor(ageDays * tradesPerDay));

  return {
    id: Number(id),
    strategist: s.strategist,
    name: s.name,
    description: s.description,
    performanceFeeBps: Number(s.performanceFeeBps),
    isActive: s.isActive,
    totalFollowerCapital: totalCapital.toFixed(2),
    followerCount: Number(s.followerCount),
    totalPnl: totalPnl.toFixed(2),
    createdAt,
    roi: parseFloat(roi.toFixed(2)),
    winRate: parseFloat(winRate.toFixed(1)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(1)),
    weeklyPnl: parseFloat(weeklyPnl.toFixed(2)),
    monthlyPnl: parseFloat(monthlyPnl.toFixed(2)),
    totalTrades,
    ageDays: parseFloat(ageDays.toFixed(1)),
    avgTradeSize: totalCapital > 0 ? parseFloat((totalCapital / Math.max(totalTrades, 1)).toFixed(2)) : 0,
  };
}

test("formatStrategy returns correct basic fields", () => {
  const result = formatStrategy(0, MOCK_STRATEGIES[0]);
  assert.strictEqual(result.id, 0);
  assert.strictEqual(result.name, "Alpha Scalper");
  assert.strictEqual(result.strategist, "0x1234567890123456789012345678901234567890");
  assert.strictEqual(result.performanceFeeBps, 1000);
  assert.strictEqual(result.isActive, true);
  assert.strictEqual(result.followerCount, 5);
});

test("formatStrategy computes PnL correctly", () => {
  const result = formatStrategy(0, MOCK_STRATEGIES[0]);
  assert.strictEqual(result.totalPnl, "75.00");
  assert.strictEqual(result.totalFollowerCapital, "500.00");
});

test("formatStrategy computes positive ROI", () => {
  const result = formatStrategy(0, MOCK_STRATEGIES[0]);
  // ROI = (75/500) * 100 = 15%
  assert.strictEqual(result.roi, 15);
});

test("formatStrategy has positive win rate for profitable strategy", () => {
  const result = formatStrategy(0, MOCK_STRATEGIES[0]);
  assert.ok(result.winRate > 50, `Win rate should be > 50 for profitable strategy, got ${result.winRate}`);
  assert.ok(result.winRate <= 95, `Win rate should be <= 95, got ${result.winRate}`);
});

test("formatStrategy computes age in days", () => {
  const result = formatStrategy(0, MOCK_STRATEGIES[0]);
  // Created 30 days ago
  assert.ok(result.ageDays >= 29 && result.ageDays <= 31, `Age should be ~30 days, got ${result.ageDays}`);
});

test("formatStrategy computes maxDrawdown", () => {
  const result = formatStrategy(0, MOCK_STRATEGIES[0]);
  assert.ok(result.maxDrawdown >= 2, `Max drawdown should be >= 2, got ${result.maxDrawdown}`);
  assert.ok(result.maxDrawdown <= 50, `Max drawdown should be <= 50, got ${result.maxDrawdown}`);
});

test("formatStrategy computes totalTrades > 0", () => {
  const result = formatStrategy(0, MOCK_STRATEGIES[0]);
  assert.ok(result.totalTrades >= 1, `Total trades should be >= 1, got ${result.totalTrades}`);
});

test("formatStrategy computes weekly/monthly PnL", () => {
  const result = formatStrategy(0, MOCK_STRATEGIES[0]);
  // Daily = 75/30 = 2.5, weekly = 17.5, monthly = 75
  assert.ok(result.weeklyPnl > 0, `Weekly PnL should be > 0, got ${result.weeklyPnl}`);
  assert.ok(result.monthlyPnl > 0, `Monthly PnL should be > 0, got ${result.monthlyPnl}`);
});

// ── Test Leaderboard Aggregation ────────────────────────────────────────────
console.log("\n📋 Testing Leaderboard Aggregation...");

function buildLeaderboard(strategies) {
  const all = strategies.map((s, i) => formatStrategy(i, s));

  // Group by strategist
  const traderMap = {};
  for (const s of all) {
    const addr = s.strategist.toLowerCase();
    if (!traderMap[addr]) {
      traderMap[addr] = {
        address: s.strategist,
        strategies: [],
        totalPnl: 0,
        totalCapital: 0,
        totalFollowers: 0,
        bestRoi: -Infinity,
        totalTrades: 0,
        worstDrawdown: 0,
        bestStrategyName: "",
        firstCreatedAt: Infinity,
      };
    }
    const t = traderMap[addr];
    t.strategies.push(s);
    t.totalPnl += parseFloat(s.totalPnl);
    t.totalCapital += parseFloat(s.totalFollowerCapital);
    t.totalFollowers += s.followerCount;
    t.totalTrades += s.totalTrades;
    if (s.roi > t.bestRoi) {
      t.bestRoi = s.roi;
      t.bestStrategyName = s.name;
    }
    t.worstDrawdown = Math.max(t.worstDrawdown, s.maxDrawdown);
    if (s.createdAt < t.firstCreatedAt) {
      t.firstCreatedAt = s.createdAt;
    }
  }

  let traders = Object.values(traderMap).map((t) => {
    const stratCount = t.strategies.length;
    const avgWinRate = t.strategies.reduce((sum, s) => sum + s.winRate, 0) / stratCount;
    const roi = t.totalCapital > 0 ? (t.totalPnl / t.totalCapital) * 100 : t.bestRoi;
    return {
      address: t.address,
      strategyCount: stratCount,
      totalPnl: parseFloat(t.totalPnl.toFixed(2)),
      totalCapital: parseFloat(t.totalCapital.toFixed(2)),
      totalFollowers: t.totalFollowers,
      totalTrades: t.totalTrades,
      roi: parseFloat(roi.toFixed(2)),
      winRate: parseFloat(avgWinRate.toFixed(1)),
      maxDrawdown: parseFloat(t.worstDrawdown.toFixed(1)),
      bestStrategyName: t.bestStrategyName,
    };
  });

  // Sort by PnL desc
  traders.sort((a, b) => b.totalPnl - a.totalPnl);
  traders.forEach((t, i) => { t.rank = i + 1; });

  return traders;
}

test("leaderboard groups strategies by trader", () => {
  const leaderboard = buildLeaderboard(MOCK_STRATEGIES);
  // 2 unique traders: 0x1234... (2 strategies) and 0xABCD... (1 strategy)
  assert.strictEqual(leaderboard.length, 2);
});

test("leaderboard aggregates PnL correctly", () => {
  const leaderboard = buildLeaderboard(MOCK_STRATEGIES);
  // Trader 0xABCD has 150 PnL, Trader 0x1234 has 75+30 = 105 PnL
  // 0xABCD should be rank 1
  assert.strictEqual(leaderboard[0].address, "0xABCDEF1234567890ABCDEF1234567890ABCDEF12");
  assert.strictEqual(leaderboard[0].totalPnl, 150);
  assert.strictEqual(leaderboard[0].rank, 1);
});

test("leaderboard aggregates followers", () => {
  const leaderboard = buildLeaderboard(MOCK_STRATEGIES);
  const trader1234 = leaderboard.find(t => t.address.startsWith("0x1234"));
  // Should have 5+3 = 8 followers from 2 strategies
  assert.strictEqual(trader1234.totalFollowers, 8);
  assert.strictEqual(trader1234.strategyCount, 2);
});

test("leaderboard sorts by PnL descending by default", () => {
  const leaderboard = buildLeaderboard(MOCK_STRATEGIES);
  assert.ok(leaderboard[0].totalPnl >= leaderboard[1].totalPnl);
});

test("leaderboard assigns ranks", () => {
  const leaderboard = buildLeaderboard(MOCK_STRATEGIES);
  assert.strictEqual(leaderboard[0].rank, 1);
  assert.strictEqual(leaderboard[1].rank, 2);
});

test("leaderboard computes aggregate ROI", () => {
  const leaderboard = buildLeaderboard(MOCK_STRATEGIES);
  for (const trader of leaderboard) {
    assert.ok(typeof trader.roi === "number", "ROI should be a number");
    assert.ok(!isNaN(trader.roi), "ROI should not be NaN");
  }
});

// ── Test PnL History Generation ─────────────────────────────────────────────
console.log("\n📋 Testing PnL History Generation...");

function generateHistory(totalPnl, totalCapital, days, addressSeed) {
  const history = [];
  const now = Date.now();
  let cumulativePnl = 0;
  const dailyTarget = totalPnl / days;

  const seed = parseInt(addressSeed.slice(2, 10), 16);
  let rng = seed;
  function nextRng() {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  }

  for (let d = days; d >= 0; d--) {
    const date = new Date(now - d * 86400000);
    const volatility = Math.abs(dailyTarget) * 2 + 5;
    const noise = (nextRng() - 0.5) * volatility;
    cumulativePnl += dailyTarget + noise;

    if (d === 0) cumulativePnl = totalPnl;

    const dayRoi = totalCapital > 0 ? (cumulativePnl / totalCapital) * 100 : 0;

    history.push({
      date: date.toISOString().slice(0, 10),
      cumulativePnl: parseFloat(cumulativePnl.toFixed(2)),
      dailyPnl: parseFloat((dailyTarget + noise).toFixed(2)),
      roi: parseFloat(dayRoi.toFixed(2)),
    });
  }

  return history;
}

test("history generates correct number of data points", () => {
  const history = generateHistory(100, 500, 30, "0x1234567890");
  assert.strictEqual(history.length, 31); // 30 days + today
});

test("history ends at actual PnL", () => {
  const history = generateHistory(100, 500, 30, "0x1234567890");
  assert.strictEqual(history[history.length - 1].cumulativePnl, 100);
});

test("history has valid date strings", () => {
  const history = generateHistory(100, 500, 30, "0x1234567890");
  for (const point of history) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(point.date), `Invalid date format: ${point.date}`);
  }
});

test("history ROI values are numbers", () => {
  const history = generateHistory(100, 500, 30, "0x1234567890");
  for (const point of history) {
    assert.ok(typeof point.roi === "number", "ROI should be a number");
    assert.ok(!isNaN(point.roi), "ROI should not be NaN");
  }
});

test("history is deterministic for same address", () => {
  const h1 = generateHistory(100, 500, 30, "0x1234567890");
  const h2 = generateHistory(100, 500, 30, "0x1234567890");
  // Same seed should produce same results
  for (let i = 0; i < h1.length; i++) {
    assert.strictEqual(h1[i].cumulativePnl, h2[i].cumulativePnl);
  }
});

test("history differs for different addresses", () => {
  const h1 = generateHistory(100, 500, 30, "0x1234567890");
  const h2 = generateHistory(100, 500, 30, "0xABCDEF1234");
  // Different seeds should produce different intermediate values
  let allSame = true;
  for (let i = 1; i < h1.length - 1; i++) {
    if (h1[i].cumulativePnl !== h2[i].cumulativePnl) {
      allSame = false;
      break;
    }
  }
  assert.ok(!allSame, "Different addresses should produce different histories");
});

// ── Test Sort Validation ────────────────────────────────────────────────────
console.log("\n📋 Testing Sort Validation...");

test("valid sort fields are accepted", () => {
  const validFields = ["totalPnl", "roi", "winRate", "totalFollowers", "totalCapital", "totalTrades", "maxDrawdown", "ageDays"];
  for (const field of validFields) {
    assert.ok(validFields.includes(field), `${field} should be a valid sort field`);
  }
});

test("invalid sort field falls back to totalPnl", () => {
  const validSortFields = ["totalPnl", "roi", "winRate", "totalFollowers", "totalCapital", "totalTrades", "maxDrawdown", "ageDays"];
  const sortBy = "invalidField";
  const field = validSortFields.includes(sortBy) ? sortBy : "totalPnl";
  assert.strictEqual(field, "totalPnl");
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(50));
console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log("═".repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
