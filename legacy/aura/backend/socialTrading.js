/**
 * backend/socialTrading.js
 *
 * Social Trading API — V2 Production Rewrite
 * ────────────────────────────────────────────
 * 100% on-chain data. Zero mocks, zero random values, zero simulations.
 *
 * Data sources:
 *   - AuraCopyTradingV2: leader profiles, follower allocations, copy positions
 *   - AuraPerps: position states, PnL calculations
 *   - MockOracle: real-time prices
 *   - On-chain event logs: trade history, PnL history
 *
 * @author Aura Protocol
 */
const { ethers } = require("ethers");
const db = require("./db");
const { COPY_TRADING_ABI, PERPS_ABI } = require("./copyEngine");

// ── Extended ABIs for views ────────────────────────────────────────────

const ORACLE_ABI = [
    "function getPrice(string) view returns (uint256)",
];

const AUSD_ABI = [
    "function balanceOf(address) view returns (uint256)",
];

// ── Contract helpers ──────────────────────────────────────────────────

function getCopyTradingContract() {
    const addr = process.env.COPY_TRADING_V2_ADDRESS;
    if (!addr) return null;
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 60000;
    return new ethers.Contract(addr, COPY_TRADING_ABI, provider);
}

function getPerpsContract() {
    const addr = process.env.AURA_PERPS_ADDRESS;
    if (!addr) return null;
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 60000;
    return new ethers.Contract(addr, PERPS_ABI, provider);
}

function getOracleContract() {
    const addr = process.env.MOCK_ORACLE_ADDRESS;
    if (!addr) return null;
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 60000;
    return new ethers.Contract(addr, ORACLE_ABI, provider);
}

// ══════════════════════ LEADER FORMATTING ══════════════════════

/**
 * Format a leader profile from on-chain data into API response.
 *
 * All metrics are derived from REAL on-chain state:
 *   - ROI = totalRealizedPnl / totalCopiedCapital (sign-aware)
 *   - winRate = tradesWon / tradesExecuted
 *   - No random values, no estimates
 */
function formatLeaderProfile(address, profile) {
    const totalPnl = parseFloat(ethers.formatEther(profile.totalRealizedPnl));
    const signedPnl = profile.isPnlPositive ? totalPnl : -totalPnl;
    const totalCapital = parseFloat(ethers.formatEther(profile.totalCopiedCapital));
    const tradesExecuted = Number(profile.tradesExecuted);
    const tradesWon = Number(profile.tradesWon);
    const createdAt = Number(profile.createdAt);
    const ageDays = Math.max(0.1, (Date.now() / 1000 - createdAt) / 86400);

    // Real ROI — no estimation
    const roi = totalCapital > 0 ? (signedPnl / totalCapital) * 100 : 0;

    // Real win rate — direct from on-chain counters
    const winRate = tradesExecuted > 0 ? (tradesWon / tradesExecuted) * 100 : 0;

    return {
        address,
        isActive: profile.isActive,
        performanceFeeBps: Number(profile.performanceFeeBps),
        totalFollowers: Number(profile.totalFollowers),
        totalCopiedCapital: parseFloat(totalCapital.toFixed(2)),
        totalPnl: parseFloat(signedPnl.toFixed(2)),
        tradesExecuted,
        tradesWon,
        roi: parseFloat(roi.toFixed(2)),
        winRate: parseFloat(winRate.toFixed(1)),
        ageDays: parseFloat(ageDays.toFixed(1)),
        createdAt,
    };
}

// ══════════════════════ ENDPOINT HANDLERS ══════════════════════

/**
 * GET /api/social/leaders?offset=0&limit=20
 * List all active copy-trading leaders with real on-chain metrics.
 */
async function getLeaders(req, res) {
    try {
        const contract = getCopyTradingContract();
        if (!contract) return res.json({ leaders: [], note: "COPY_TRADING_V2_ADDRESS not set" });

        const offset = parseInt(req.query.offset) || 0;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);

        const [addrs, profiles] = await contract.getActiveLeaders(offset, limit);
        const result = addrs.map((addr, i) => formatLeaderProfile(addr, profiles[i]));

        res.json({ leaders: result, total: result.length, offset, limit });
    } catch (err) {
        console.error("[SocialTrading] getLeaders error:", err.message);
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/social/leader/:address
 * Get a single leader's full profile with follower list.
 */
async function getLeaderProfile(req, res) {
    try {
        const contract = getCopyTradingContract();
        if (!contract) return res.status(503).json({ error: "COPY_TRADING_V2_ADDRESS not set" });

        const address = req.params.address;
        if (!ethers.isAddress(address)) return res.status(400).json({ error: "Invalid address" });

        const profileRaw = await contract.leaders(address);
        if (!profileRaw.isRegistered) {
            return res.status(404).json({ error: "Leader not found" });
        }

        let profile = {
            isRegistered: profileRaw.isRegistered,
            isActive: profileRaw.isActive,
            performanceFeeBps: profileRaw.performanceFeeBps,
            totalFollowers: profileRaw.totalFollowers,
            totalCopiedCapital: profileRaw.totalCopiedCapital,
            totalRealizedPnl: profileRaw.totalRealizedPnl,
            isPnlPositive: profileRaw.isPnlPositive,
            tradesExecuted: Number(profileRaw.tradesExecuted),
            tradesWon: Number(profileRaw.tradesWon),
            createdAt: profileRaw.createdAt
        };

        try {
            const pnlQuery = await db.query(`
                SELECT SUM(pnl * CASE WHEN is_profit THEN 1 ELSE -1 END) as total_pnl,
                       SUM(CASE WHEN is_profit THEN 1 ELSE 0 END) as wins,
                       COUNT(*) as trades
                FROM positions_closed
                WHERE LOWER(owner) = $1
            `, [address.toLowerCase()]);

            if (pnlQuery.rows.length > 0) {
                const personalStats = pnlQuery.rows[0];
                const rawPnl = parseFloat(personalStats.total_pnl || 0);
                const personalPnl = rawPnl / 1e18;
                const personalWins = parseInt(personalStats.wins || 0, 10);
                const personalTrades = parseInt(personalStats.trades || 0, 10);

                const socialPnlStr = ethers.formatEther(profile.totalRealizedPnl);
                const socialPnl = parseFloat(socialPnlStr) * (profile.isPnlPositive ? 1 : -1);
                const combinedPnl = socialPnl + personalPnl;

                profile.totalRealizedPnl = ethers.parseEther(Math.abs(combinedPnl).toFixed(18));
                profile.isPnlPositive = combinedPnl >= 0;
                profile.tradesExecuted += personalTrades;
                profile.tradesWon += personalWins;
            }
        } catch (e) {
            console.error('DB error merging personal history:', e.message);
        }

        const followers = await contract.getLeaderFollowers(address);

        // Get follower details in parallel batches to prevent timeouts
        const followerDetails = [];
        const batchSize = 10;
        for (let i = 0; i < followers.length; i += batchSize) {
            const batch = followers.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(async (follower) => {
                const alloc = await contract.allocations(address, follower);
                if (alloc.isActive) {
                    const openPosCount = await contract.getFollowerOpenPositionCount(address, follower);
                    return {
                        address: follower,
                        capitalDeposited: parseFloat(ethers.formatEther(alloc.capitalDeposited)),
                        capitalInPositions: parseFloat(ethers.formatEther(alloc.capitalInPositions)),
                        availableBalance: parseFloat(ethers.formatEther(alloc.capitalDeposited - alloc.capitalInPositions)),
                        scaleFactor: Number(alloc.scaleFactor) / 10000,
                        maxSlippageBps: Number(alloc.maxSlippageBps),
                        openPositions: Number(openPosCount),
                        joinedAt: Number(alloc.joinedAt),
                    };
                }
                return null;
            }));
            followerDetails.push(...batchResults.filter(Boolean));
        }

        const pendingFees = await contract.pendingFees(address);

        const formattedLeader = formatLeaderProfile(address, profile);
        res.json({
            profile: formattedLeader,
            leader: formattedLeader,
            strategies: [{
                id: 1,
                name: "Main Strategy",
                description: "Copy all trades from this leader.",
                totalPnl: formattedLeader.totalPnl.toFixed(2),
                roi: formattedLeader.roi,
                winRate: formattedLeader.winRate,
                followerCount: formattedLeader.totalFollowers,
                totalFollowerCapital: formattedLeader.totalCopiedCapital.toString(),
                performanceFeeBps: Number(profile.performanceFeeBps),
                isActive: profile.isActive
            }],
            followers: followerDetails,
            pendingFees: parseFloat(ethers.formatEther(pendingFees)),
        });
    } catch (err) {
        console.error("[SocialTrading] getLeaderProfile error:", err.message);
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/social/follower/:leader/:follower
 * Get follower allocation details for a specific leader.
 */
async function getFollowerAllocation(req, res) {
    try {
        const contract = getCopyTradingContract();
        if (!contract) return res.status(503).json({ error: "COPY_TRADING_V2_ADDRESS not set" });

        const { leader, follower } = req.params;
        if (!ethers.isAddress(leader) || !ethers.isAddress(follower)) {
            return res.status(400).json({ error: "Invalid address" });
        }

        const alloc = await contract.allocations(leader, follower);
        if (!alloc.isActive) {
            return res.status(404).json({ error: "Not following this leader" });
        }

        const openPositions = await contract.getFollowerOpenPositions(leader, follower);
        const availableBalance = await contract.getFollowerAvailableBalance(leader, follower);

        // Get details of open positions from AuraPerps
        const perps = getPerpsContract();
        const oracle = getOracleContract();
        const positionDetails = [];

        if (perps && oracle) {
            for (const posId of openPositions) {
                try {
                    const pos = await perps.positions(posId);
                    if (!pos.isOpen) continue;

                    const currentPrice = await oracle.getPrice(pos.asset);
                    const [pnl, isProfit] = await perps.calculatePnL(posId, currentPrice);

                    positionDetails.push({
                        positionId: Number(posId),
                        asset: pos.asset,
                        isLong: pos.isLong,
                        collateral: parseFloat(ethers.formatEther(pos.collateralAmount)),
                        leverage: Number(pos.leverage),
                        entryPrice: parseFloat(ethers.formatEther(pos.entryPrice)),
                        currentPrice: parseFloat(ethers.formatEther(currentPrice)),
                        positionSize: parseFloat(ethers.formatEther(pos.positionSize)),
                        unrealizedPnl: parseFloat(ethers.formatEther(pnl)) * (isProfit ? 1 : -1),
                        isProfit,
                        openedAt: Number(pos.openedAt),
                    });
                } catch (e) {
                    // Position may have been closed since we fetched the list
                }
            }
        }

        res.json({
            leader,
            follower,
            allocation: {
                capitalDeposited: parseFloat(ethers.formatEther(alloc.capitalDeposited)),
                capitalInPositions: parseFloat(ethers.formatEther(alloc.capitalInPositions)),
                availableBalance: parseFloat(ethers.formatEther(availableBalance)),
                highWaterMark: parseFloat(ethers.formatEther(alloc.highWaterMark)),
                scaleFactor: Number(alloc.scaleFactor) / 10000,
                maxSlippageBps: Number(alloc.maxSlippageBps),
                joinedAt: Number(alloc.joinedAt),
            },
            openPositions: positionDetails,
        });
    } catch (err) {
        console.error("[SocialTrading] getFollowerAllocation error:", err.message);
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/social/leaderboard?sortBy=totalPnl&order=desc&limit=20&offset=0&search=
 * Real leaderboard — every metric is on-chain.
 */
async function getLeaderboard(req, res) {
    try {
        const contract = getCopyTradingContract();
        if (!contract) return res.json({ leaders: [], total: 0, note: "COPY_TRADING_V2_ADDRESS not set" });

        const sortBy = req.query.sortBy || "totalPnl";
        const order = req.query.order || "desc";
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = parseInt(req.query.offset) || 0;
        const search = (req.query.search || "").toLowerCase();

        // Fetch all active leaders
        const [addrs, profiles] = await contract.getActiveLeaders(0, 100);
        let leaders = [];
        let statsMap = {};

        try {
            if (addrs.length > 0) {
                const lowerAddrs = addrs.map(a => a.toLowerCase());
                const paramsStr = lowerAddrs.map((_, idx) => `$${idx + 1}`).join(',');
                const pnlQuery = await db.query(`
                    SELECT LOWER(owner) as owner_addr,
                           SUM(pnl * CASE WHEN is_profit THEN 1 ELSE -1 END) as total_pnl,
                           SUM(CASE WHEN is_profit THEN 1 ELSE 0 END) as wins,
                           COUNT(*) as trades
                    FROM positions_closed
                    WHERE LOWER(owner) IN (${paramsStr})
                    GROUP BY LOWER(owner)
                `, lowerAddrs);

                for (let row of pnlQuery.rows) {
                    statsMap[row.owner_addr] = row;
                }
            }
        } catch (e) {
            console.error("DB error in getLeaderboard batch fetch:", e.message);
        }

        for (let i = 0; i < addrs.length; i++) {
            let profileRaw = profiles[i];
            let profile = {
                isRegistered: profileRaw.isRegistered,
                isActive: profileRaw.isActive,
                performanceFeeBps: profileRaw.performanceFeeBps,
                totalFollowers: profileRaw.totalFollowers,
                totalCopiedCapital: profileRaw.totalCopiedCapital,
                totalRealizedPnl: profileRaw.totalRealizedPnl,
                isPnlPositive: profileRaw.isPnlPositive,
                tradesExecuted: Number(profileRaw.tradesExecuted),
                tradesWon: Number(profileRaw.tradesWon),
                createdAt: profileRaw.createdAt
            };

            const addrLower = addrs[i].toLowerCase();
            const personalStats = statsMap[addrLower];

            if (personalStats) {
                const rawPnl = parseFloat(personalStats.total_pnl || 0);
                const personalPnl = rawPnl / 1e18;
                const personalWins = parseInt(personalStats.wins || 0, 10);
                const personalTrades = parseInt(personalStats.trades || 0, 10);

                const socialPnlStr = ethers.formatEther(profile.totalRealizedPnl);
                const socialPnl = parseFloat(socialPnlStr) * (profile.isPnlPositive ? 1 : -1);
                const combinedPnl = socialPnl + personalPnl;

                profile.totalRealizedPnl = ethers.parseEther(Math.abs(combinedPnl).toFixed(18));
                profile.isPnlPositive = combinedPnl >= 0;
                profile.tradesExecuted += personalTrades;
                profile.tradesWon += personalWins;
            }

            leaders.push(formatLeaderProfile(addrs[i], profile));
        }

        // Search filter
        if (search) {
            leaders = leaders.filter(l =>
                l.address.toLowerCase().includes(search)
            );
        }

        // Sort
        const validSortFields = ["totalPnl", "roi", "winRate", "totalFollowers", "totalCopiedCapital", "tradesExecuted", "ageDays"];
        const field = validSortFields.includes(sortBy) ? sortBy : "totalPnl";
        const mult = order === "asc" ? 1 : -1;
        leaders.sort((a, b) => (a[field] - b[field]) * mult);

        // Add rank
        leaders.forEach((l, i) => { l.rank = i + 1; });

        const total = leaders.length;
        const paged = leaders.slice(offset, offset + limit);

        res.json({ leaders: paged, total, offset, limit });
    } catch (err) {
        console.error("[SocialTrading] getLeaderboard error:", err.message);
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/social/leader/:address/history?days=30
 * Real PnL history from on-chain event logs.
 */
async function getLeaderHistory(req, res) {
    try {
        const contract = getCopyTradingContract();
        const perps = getPerpsContract();
        if (!contract || !perps) {
            return res.status(503).json({ error: "Contracts not configured" });
        }

        const address = req.params.address;
        if (!ethers.isAddress(address)) return res.status(400).json({ error: "Invalid address" });

        const days = Math.min(parseInt(req.query.days) || 30, 365);

        const profileRaw = await contract.leaders(address);
        if (!profileRaw.isRegistered) {
            return res.status(404).json({ error: "Leader not found" });
        }

        let profile = {
            isRegistered: profileRaw.isRegistered,
            isActive: profileRaw.isActive,
            performanceFeeBps: profileRaw.performanceFeeBps,
            totalFollowers: profileRaw.totalFollowers,
            totalCopiedCapital: profileRaw.totalCopiedCapital,
            totalRealizedPnl: profileRaw.totalRealizedPnl,
            isPnlPositive: profileRaw.isPnlPositive,
            tradesExecuted: Number(profileRaw.tradesExecuted),
            tradesWon: Number(profileRaw.tradesWon),
            createdAt: profileRaw.createdAt
        };

        try {
            const pnlQuery = await db.query(`
                SELECT SUM(pnl * CASE WHEN is_profit THEN 1 ELSE -1 END) as total_pnl,
                       SUM(CASE WHEN is_profit THEN 1 ELSE 0 END) as wins,
                       COUNT(*) as trades
                FROM positions_closed
                WHERE LOWER(owner) = $1
            `, [address.toLowerCase()]);

            if (pnlQuery.rows.length > 0) {
                const personalStats = pnlQuery.rows[0];
                const rawPnl = parseFloat(personalStats.total_pnl || 0);
                const personalPnl = rawPnl / 1e18;
                const personalWins = parseInt(personalStats.wins || 0, 10);
                const personalTrades = parseInt(personalStats.trades || 0, 10);

                const socialPnlStr = ethers.formatEther(profile.totalRealizedPnl);
                const socialPnl = parseFloat(socialPnlStr) * (profile.isPnlPositive ? 1 : -1);
                const combinedPnl = socialPnl + personalPnl;

                profile.totalRealizedPnl = ethers.parseEther(Math.abs(combinedPnl).toFixed(18));
                profile.isPnlPositive = combinedPnl >= 0;
                profile.tradesExecuted += personalTrades;
                profile.tradesWon += personalWins;
            }
        } catch (e) {
            console.error('DB error merging personal history:', e.message);
        }

        // Query CopyTradeClosed events for this leader
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 60000;
        const currentBlock = await provider.getBlockNumber();

        // Estimate blocks for the time period (Arbitrum Orbit ~250ms block time)
        const blocksPerDay = 345600; // 86400 / 0.25
        const fromBlock = Math.max(0, currentBlock - (days * blocksPerDay));

        const closedFilter = contract.filters.CopyTradeClosed(address);
        let events = [];
        try {
            events = await contract.queryFilter(closedFilter, fromBlock, currentBlock);
        } catch (err) {
            console.warn(`[SocialTrading] queryFilter failed for ${fromBlock}-${currentBlock}, trying chunked fallback...`);
            // If range too large, try with smaller chunked range (last 7 days)
            const fallbackFrom = Math.max(0, currentBlock - blocksPerDay * 7);
            let currentFrom = fallbackFrom;
            let chunkSize = 50000;
            
            while (currentFrom <= currentBlock) {
                let currentTo = Math.min(currentFrom + chunkSize - 1, currentBlock);
                try {
                    const chunk = await contract.queryFilter(closedFilter, currentFrom, currentTo);
                    events = events.concat(chunk);
                    currentFrom = currentTo + 1;
                } catch (chunkErr) {
                    if (chunkSize > 5000) {
                        chunkSize = Math.floor(chunkSize / 2); // Halve the chunk size and retry
                    } else {
                        console.warn(`[SocialTrading] Chunked fetch failed at size ${chunkSize}, aborting log fetch:`, chunkErr.message);
                        break; // Stop fetching if chunk size gets too small (like 10 block limits on free tiers)
                    }
                }
            }
        }

        // Build daily PnL history from events
        const dailyPnl = {};

        for (const event of events) {
            const block = await event.getBlock();
            const date = new Date(block.timestamp * 1000).toISOString().slice(0, 10);
            const pnl = parseFloat(ethers.formatEther(event.args.pnl));
            const signedPnl = event.args.isProfit ? pnl : -pnl;

            if (!dailyPnl[date]) {
                dailyPnl[date] = { pnl: 0, trades: 0, wins: 0 };
            }
            dailyPnl[date].pnl += signedPnl;
            dailyPnl[date].trades++;
            if (event.args.isProfit) dailyPnl[date].wins++;
        }

        // Fetch personal trading history from DB
        try {
            const historyQuery = await db.query(`
                SELECT DATE(to_timestamp(block_timestamp)) as date,
                       SUM(pnl * CASE WHEN is_profit THEN 1 ELSE -1 END) as daily_pnl,
                       SUM(CASE WHEN is_profit THEN 1 ELSE 0 END) as wins,
                       COUNT(*) as trades
                FROM positions_closed
                WHERE LOWER(owner) = $1
                AND to_timestamp(block_timestamp) >= NOW() - INTERVAL '${days} days'
                GROUP BY DATE(to_timestamp(block_timestamp))
            `, [address.toLowerCase()]);

            for (const row of historyQuery.rows) {
                try {
                    const dateObj = new Date(row.date);
                    if (isNaN(dateObj.getTime())) continue;
                    const dateStr = dateObj.toISOString().slice(0, 10);
                    
                    if (!dailyPnl[dateStr]) {
                        dailyPnl[dateStr] = { pnl: 0, trades: 0, wins: 0 };
                    }
                    
                    dailyPnl[dateStr].pnl += (parseFloat(row.daily_pnl || 0) / 1e18);
                    dailyPnl[dateStr].trades += parseInt(row.trades || 0, 10);
                    dailyPnl[dateStr].wins += parseInt(row.wins || 0, 10);
                } catch(err) {}
            }
        } catch(e) {
            console.error('DB error fetching personal daily history:', e.message);
        }

        // Build cumulative history
        const sortedDates = Object.keys(dailyPnl).sort();
        let cumulativePnl = 0;
        const history = sortedDates.map(date => {
            const day = dailyPnl[date];
            cumulativePnl += day.pnl;
            return {
                date,
                dailyPnl: parseFloat(day.pnl.toFixed(2)),
                cumulativePnl: parseFloat(cumulativePnl.toFixed(2)),
                trades: day.trades,
                wins: day.wins,
            };
        });

        const totalPnl = parseFloat(ethers.formatEther(profile.totalRealizedPnl));
        const signedTotalPnl = profile.isPnlPositive ? totalPnl : -totalPnl;
        const totalCapital = parseFloat(ethers.formatEther(profile.totalCopiedCapital));

        res.json({
            address,
            days,
            totalPnl: parseFloat(signedTotalPnl.toFixed(2)),
            totalCapital: parseFloat(totalCapital.toFixed(2)),
            totalTrades: Number(profile.tradesExecuted),
            totalWins: Number(profile.tradesWon),
            history,
        });
    } catch (err) {
        console.error("[SocialTrading] getLeaderHistory error:", err.message);
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/social/copy-positions/:leaderPositionId
 * Get all copy positions for a leader's position.
 */
async function getCopyPositions(req, res) {
    try {
        const contract = getCopyTradingContract();
        if (!contract) return res.status(503).json({ error: "COPY_TRADING_V2_ADDRESS not set" });

        const leaderPositionId = parseInt(req.params.leaderPositionId);
        const copies = await contract.getCopyPositions(leaderPositionId);

        const perps = getPerpsContract();
        const oracle = getOracleContract();

        const result = [];
        for (const cp of copies) {
            let unrealizedPnl = 0;
            let isProfit = false;
            let currentPrice = 0;

            if (cp.isOpen && perps && oracle) {
                try {
                    const pos = await perps.positions(cp.followerPerpsPositionId);
                    if (pos.isOpen) {
                        const price = await oracle.getPrice(pos.asset);
                        const [pnl, profit] = await perps.calculatePnL(cp.followerPerpsPositionId, price);
                        unrealizedPnl = parseFloat(ethers.formatEther(pnl)) * (profit ? 1 : -1);
                        isProfit = profit;
                        currentPrice = parseFloat(ethers.formatEther(price));
                    }
                } catch (e) { /* position closed */ }
            }

            result.push({
                leaderPositionId: Number(cp.leaderPositionId),
                followerPositionId: Number(cp.followerPerpsPositionId),
                follower: cp.follower,
                leader: cp.leader,
                collateralUsed: parseFloat(ethers.formatEther(cp.collateralUsed)),
                isOpen: cp.isOpen,
                openedAt: Number(cp.openedAt),
                unrealizedPnl,
                isProfit,
                currentPrice,
            });
        }

        res.json({ leaderPositionId, copies: result });
    } catch (err) {
        console.error("[SocialTrading] getCopyPositions error:", err.message);
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/social/stats
 * Global copy trading statistics — all on-chain.
 */
async function getGlobalStats(req, res) {
    try {
        const contract = getCopyTradingContract();
        if (!contract) {
            return res.json({
                totalLeaders: 0,
                totalAum: "0",
                totalFollowers: 0,
                totalPnl: "0",
                topPerformer: null,
                note: "COPY_TRADING_V2_ADDRESS not set",
            });
        }

        // Fetch all active leaders
        const [addrs, profiles] = await contract.getActiveLeaders(0, 100);
        const leaders = addrs.map((addr, i) => formatLeaderProfile(addr, profiles[i]));

        const totalAum = leaders.reduce((s, l) => s + l.totalCopiedCapital, 0);
        const totalFollowers = leaders.reduce((s, l) => s + l.totalFollowers, 0);
        const totalPnl = leaders.reduce((s, l) => s + l.totalPnl, 0);
        const totalTrades = leaders.reduce((s, l) => s + l.tradesExecuted, 0);

        let topPerformer = null;
        if (leaders.length > 0) {
            const sorted = [...leaders].sort((a, b) => b.totalPnl - a.totalPnl);
            topPerformer = {
                address: sorted[0].address,
                pnl: sorted[0].totalPnl,
                roi: sorted[0].roi,
                winRate: sorted[0].winRate,
            };
        }

        res.json({
            totalLeaders: leaders.length,
            activeTraders: leaders.length,
            totalAum: totalAum.toFixed(2),
            totalFollowers,
            totalPnl: totalPnl.toFixed(2),
            totalTrades,
            topPerformer,
        });
    } catch (err) {
        console.error("[SocialTrading] getGlobalStats error:", err.message);
        res.status(500).json({ error: err.message });
    }
}

// ══════════════════════ BACKWARD COMPATIBILITY ══════════════════════
// These map old V1 endpoints to V2 data for frontend compatibility.

/**
 * GET /api/social/strategies — maps to leaders (backward compat)
 */
async function getStrategies(req, res) {
    // Redirect to leaders endpoint
    req.query = req.query || {};
    return getLeaders(req, res);
}

/**
 * GET /api/social/strategy/:id — maps to leader by index (backward compat)
 */
async function getStrategyById(req, res) {
    try {
        const contract = getCopyTradingContract();
        if (!contract) return res.status(503).json({ error: "COPY_TRADING_V2_ADDRESS not set" });

        const id = parseInt(req.params.id);
        const leaderCount = await contract.getLeaderCount();

        if (id >= Number(leaderCount)) {
            return res.status(404).json({ error: "Strategy not found" });
        }

        const address = await contract.leaderList(id);
        const profile = await contract.leaders(address);
        const followers = await contract.getLeaderFollowers(address);

        res.json({
            strategy: { id, ...formatLeaderProfile(address, profile) },
            followers,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/social/position/:strategyId/:follower — backward compat
 */
async function getFollowerPosition(req, res) {
    try {
        const contract = getCopyTradingContract();
        if (!contract) return res.status(503).json({ error: "COPY_TRADING_V2_ADDRESS not set" });

        const { strategyId, follower } = req.params;
        if (!ethers.isAddress(follower)) return res.status(400).json({ error: "Invalid address" });

        const id = parseInt(strategyId);
        const leaderCount = await contract.getLeaderCount();
        if (id >= Number(leaderCount)) return res.status(404).json({ error: "Leader not found" });

        const leaderAddr = await contract.leaderList(id);
        const alloc = await contract.allocations(leaderAddr, follower);

        res.json({
            strategyId: id,
            leader: leaderAddr,
            follower,
            capitalDeposited: ethers.formatEther(alloc.capitalDeposited),
            capitalInPositions: ethers.formatEther(alloc.capitalInPositions),
            highWaterMark: ethers.formatEther(alloc.highWaterMark),
            isActive: alloc.isActive,
            scaleFactor: Number(alloc.scaleFactor) / 10000,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/social/trader/:address — backward compat, maps to getLeaderProfile
 */
async function getTraderProfile(req, res) {
    return getLeaderProfile(req, res);
}

/**
 * GET /api/social/trader/:address/history — backward compat
 */
async function getTraderHistory(req, res) {
    return getLeaderHistory(req, res);
}

// ══════════════════════ EXPORTS ══════════════════════

module.exports = {
    // V2 endpoints
    getLeaders,
    getLeaderProfile,
    getFollowerAllocation,
    getLeaderboard,
    getLeaderHistory,
    getCopyPositions,
    getGlobalStats,

    // V1 backward compatibility
    getStrategies,
    getStrategyById,
    getFollowerPosition,
    getTraderProfile,
    getTraderHistory,
};
