/**
 * backend/copyEngine.js
 * 
 * Production Copy Trading Engine — Off-chain Keeper
 * ──────────────────────────────────────────────────
 * Scans AuraPerps for leader trades via manual block polling (no ethers events),
 * and replicates them on-chain via AuraCopyTradingV2.
 *
 * Architecture:
 *   Manual Block Scanner ──► Trade Queue ──► Executor
 *                                             │
 *                             ┌────────────────┘
 *                             ▼
 *                   AuraCopyTradingV2.sol
 *                             │
 *                             ▼
 *                       AuraPerps.sol
 *
 * Rate-Limit Strategy:
 *   - Manual getLogs every 30s (1 RPC call per scan)
 *   - No ethers `.on()` event polling (avoids eth_blockNumber spam)
 *   - Health monitor disabled (too many RPC calls for free tier)
 *   - All errors caught — process NEVER crashes
 *
 * @author Aura Protocol
 */
const { ethers } = require("ethers");

// ══════════════════════ ABIs ══════════════════════

const PERPS_ABI = [
    "event PositionOpened(uint256 indexed positionId, address indexed owner, string asset, bool isLong, uint256 collateral, uint256 leverage, uint256 entryPrice, uint256 openedAt)",
    "event PositionClosed(uint256 indexed positionId, address indexed owner, uint256 pnl, bool isProfit, uint256 exitPrice, uint256 fundingFee)",
    "event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, address indexed owner, uint256 bounty)",
    "event MarginAdded(uint256 indexed positionId, uint256 amount)",
    "function positions(uint256) view returns (address owner, string asset, bool isLong, uint256 collateralAmount, uint256 leverage, uint256 entryPrice, uint256 positionSize, bool isOpen, uint256 openedAt, uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice, uint256 takeProfitPrice, uint256 stopLossPrice)",
    "function nextPositionId() view returns (uint256)",
];

const COPY_TRADING_ABI = [
    "function executeCopyOpen(address leader, uint256 leaderPositionId, string asset, bool isLong, uint256 leaderCollateral, uint256 leaderTotalBalance, uint256 leverage, uint256 leaderEntryPrice) external",
    "function executeCopyClose(uint256 leaderPositionId) external",
    "function emergencyCloseCopy(uint256 followerPerpsPositionId) external",
    "function leaders(address) view returns (bool isRegistered, bool isActive, uint256 performanceFeeBps, uint256 totalFollowers, uint256 totalCopiedCapital, uint256 totalRealizedPnl, bool isPnlPositive, uint256 tradesExecuted, uint256 tradesWon, uint256 createdAt)",
    "function getLeaderFollowers(address) view returns (address[])",
    "function getCopyPositions(uint256 leaderPositionId) view returns (tuple(uint256 leaderPositionId, uint256 followerPerpsPositionId, address follower, address leader, uint256 collateralUsed, bool isOpen, uint256 openedAt)[])",
    "function getLeaderCount() view returns (uint256)",
    "function leaderList(uint256) view returns (address)",
    "function getActiveLeaders(uint256 offset, uint256 limit) view returns (address[], tuple(bool isRegistered, bool isActive, uint256 performanceFeeBps, uint256 totalFollowers, uint256 totalCopiedCapital, uint256 totalRealizedPnl, bool isPnlPositive, uint256 tradesExecuted, uint256 tradesWon, uint256 createdAt)[])",
    "function allocations(address leader, address follower) view returns (bool isActive, uint256 capitalDeposited, uint256 capitalInPositions, uint256 highWaterMark, uint256 scaleFactor, uint256 maxSlippageBps, uint256 joinedAt)",
    "function pendingFees(address) view returns (uint256)",
    "function getFollowerAvailableBalance(address leader, address follower) view returns (uint256)",
    "function getFollowerOpenPositions(address leader, address follower) view returns (uint256[])",
    "function getFollowerOpenPositionCount(address leader, address follower) view returns (uint256)",

    "event LeaderRegistered(address indexed leader, uint256 performanceFeeBps)",
    "event LeaderDeactivated(address indexed leader)",
    "event FollowerJoined(address indexed leader, address indexed follower, uint256 capital, uint256 scaleFactor, uint256 maxSlippageBps)",
    "event FollowerLeft(address indexed leader, address indexed follower, uint256 capitalReturned)",
    "event CopyTradeOpened(address indexed leader, address indexed follower, uint256 leaderPosId, uint256 followerPosId, string asset, bool isLong, uint256 collateral, uint256 leverage, uint256 leaderEntryPrice)",
    "event CopyTradeClosed(address indexed leader, address indexed follower, uint256 followerPosId, uint256 pnl, bool isProfit, uint256 fee)",
    "event CopyTradeSkipped(address indexed leader, address indexed follower, uint256 leaderPosId, uint8 reason)",
];

const AUSD_ABI = [
    "function balanceOf(address) view returns (uint256)",
];

// ══════════════════════ CONFIGURATION ══════════════════════

const MAX_RETRIES_OPEN  = 3;
const MAX_RETRIES_CLOSE = 5;
const BASE_RETRY_DELAY_MS = 1000;
const GAS_BUFFER_PERCENT  = 20;
const GAS_BUMP_PERCENT    = 15;
const SCAN_INTERVAL_MS    = 30_000; // Scan for new events every 30s

// ══════════════════════ ENGINE STATE ══════════════════════

let isRunning = false;
let provider = null;
let keeperWallet = null;
let perpsContract = null;
let copyTradingContract = null;
let aUSDContract = null;

// Set of registered leader addresses (lowercase) — cached for fast lookup
const registeredLeaders = new Set();

// Execution queue to prevent nonce conflicts
const executionQueue = [];
let isExecuting = false;

// Last scanned block for manual polling
let lastScannedBlock = 0;

// Scanner interval reference
let scanInterval = null;

// Audit log
const tradeLog = [];

// ══════════════════════ INITIALIZATION ══════════════════════

/**
 * Initialize and start the Copy Trading Engine.
 * Called once at server startup.
 */
async function startCopyEngine() {
    const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.chain.robinhood.com";
    const privateKey = process.env.PRIVATE_KEY;
    const perpsAddr = process.env.AURA_PERPS_ADDRESS;
    const copyTradingAddr = process.env.COPY_TRADING_V2_ADDRESS;
    const aUSDAddr = process.env.AUSD_ADDRESS;

    if (!copyTradingAddr) {
        console.log("[CopyEngine] COPY_TRADING_V2_ADDRESS not set — engine disabled");
        return;
    }
    if (!perpsAddr || !privateKey || !rpcUrl) {
        console.log("[CopyEngine] Missing required env vars — engine disabled");
        return;
    }

    // Use a SEPARATE provider for the CopyEngine to avoid sharing polling state
    // with the rest of the backend. Disable automatic polling entirely.
    provider = new ethers.JsonRpcProvider(rpcUrl);
    provider.pollingInterval = 120_000; // Very slow — we do our own manual polling
    keeperWallet = new ethers.Wallet(privateKey, provider);

    // Contracts
    perpsContract = new ethers.Contract(perpsAddr, PERPS_ABI, keeperWallet);
    copyTradingContract = new ethers.Contract(copyTradingAddr, COPY_TRADING_ABI, keeperWallet);
    aUSDContract = new ethers.Contract(aUSDAddr, AUSD_ABI, provider);

    // Cache registered leaders
    await _refreshLeaderCache();

    // Get current block as starting point
    try {
        lastScannedBlock = await provider.getBlockNumber();
    } catch (err) {
        console.error("[CopyEngine] Failed to get initial block number:", err.message);
        lastScannedBlock = 0;
    }

    // Start manual block scanner (replaces ethers .on() events)
    _startBlockScanner();

    isRunning = true;

    console.log(`[CopyEngine] ✅ Started — Keeper: ${keeperWallet.address}`);
    console.log(`[CopyEngine]    Perps:       ${perpsAddr}`);
    console.log(`[CopyEngine]    CopyTrading: ${copyTradingAddr}`);
    console.log(`[CopyEngine]    Leaders cached: ${registeredLeaders.size}`);
    console.log(`[CopyEngine]    Starting block: ${lastScannedBlock}`);
    console.log(`[CopyEngine]    Scan interval: ${SCAN_INTERVAL_MS / 1000}s`);
}

/**
 * Stop the engine gracefully.
 */
function stopCopyEngine() {
    isRunning = false;
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }
    console.log("[CopyEngine] ⏹ Stopped");
}

// ══════════════════════ MANUAL BLOCK SCANNER ══════════════════════

/**
 * Manual block scanner — replaces ethers .on() event listeners.
 * 
 * Every SCAN_INTERVAL_MS, we:
 *   1. Get the current block number (1 RPC call)
 *   2. Fetch PositionOpened + PositionClosed logs since lastScannedBlock (1 RPC call)
 *   3. Process any leader trades found
 * 
 * Total: ~2 RPC calls per scan. At 30s interval = 4 calls/min.
 * This is safe for any free-tier RPC.
 */
function _startBlockScanner() {
    console.log("[CopyEngine] Starting manual block scanner...");

    // Run first scan after 5s delay (let the rest of the server boot)
    setTimeout(() => _scanBlocks(), 5000);

    scanInterval = setInterval(() => {
        _scanBlocks().catch(err => {
            console.error("[CopyEngine] Block scan error (non-fatal):", err.message);
        });
    }, SCAN_INTERVAL_MS);
}

async function _scanBlocks() {
    if (!isRunning) return;

    try {
        const currentBlock = await provider.getBlockNumber();

        if (currentBlock <= lastScannedBlock) {
            return; // No new blocks
        }

        // Limit range to 1000 blocks max to avoid huge getLogs responses
        const fromBlock = lastScannedBlock + 1;
        const toBlock = Math.min(currentBlock, fromBlock + 999);

        // Fetch PositionOpened events
        const openFilter = perpsContract.filters.PositionOpened();
        const openLogs = await provider.getLogs({
            ...openFilter,
            fromBlock,
            toBlock,
        });

        // Fetch PositionClosed events
        const closeFilter = perpsContract.filters.PositionClosed();
        const closeLogs = await provider.getLogs({
            ...closeFilter,
            fromBlock,
            toBlock,
        });

        // Process opened positions
        for (const log of openLogs) {
            try {
                const parsed = perpsContract.interface.parseLog(log);
                if (!parsed) continue;

                const { positionId, owner, asset, isLong, collateral, leverage, entryPrice } = parsed.args;
                const ownerLower = owner.toLowerCase();

                console.log(`[CopyEngine] PositionOpened: id=${positionId} owner=${ownerLower} asset=${asset} isLong=${isLong} collateral=${ethers.formatEther(collateral)}`);

                if (!registeredLeaders.has(ownerLower)) continue;

                const copyTradingAddr = (await copyTradingContract.getAddress()).toLowerCase();
                if (ownerLower === copyTradingAddr) continue;

                console.log(`[CopyEngine] 🎯 Leader trade detected: ${ownerLower} — queuing copy execution`);

                // Use a simple estimate for leader balance (wallet balance only, avoids scanning positions)
                let leaderBalance = await aUSDContract.balanceOf(owner);

                // Cap leaderTotalBalance so the risk fraction is meaningful.
                // Without this cap, leaders with huge balances (e.g. 10M from minting)
                // would produce a tiny risk fraction → copies < $1.
                // Cap at 5x collateral = 20% risk fraction minimum.
                const maxBalance = collateral * 5n;
                if (leaderBalance > maxBalance) {
                    leaderBalance = maxBalance;
                }

                _enqueue({
                    type: "COPY_OPEN",
                    leader: owner,
                    leaderPositionId: positionId,
                    asset,
                    isLong,
                    leaderCollateral: collateral,
                    leaderTotalBalance: leaderBalance,
                    leverage,
                    leaderEntryPrice: entryPrice,
                    timestamp: Date.now(),
                    retries: 0,
                });
            } catch (err) {
                console.error("[CopyEngine] Error processing open log:", err.message);
            }
        }

        // Process closed positions
        for (const log of closeLogs) {
            try {
                const parsed = perpsContract.interface.parseLog(log);
                if (!parsed) continue;

                const { positionId, owner } = parsed.args;
                const ownerLower = owner.toLowerCase();

                if (!registeredLeaders.has(ownerLower)) continue;

                const copyTradingAddr = (await copyTradingContract.getAddress()).toLowerCase();
                if (ownerLower === copyTradingAddr) continue;

                console.log(`[CopyEngine] 🔻 Leader close detected: ${ownerLower} pos=${positionId}`);

                _enqueue({
                    type: "COPY_CLOSE",
                    leaderPositionId: positionId,
                    leader: owner,
                    timestamp: Date.now(),
                    retries: 0,
                });
            } catch (err) {
                console.error("[CopyEngine] Error processing close log:", err.message);
            }
        }

        lastScannedBlock = toBlock;

        if (openLogs.length > 0 || closeLogs.length > 0) {
            console.log(`[CopyEngine] Scanned blocks ${fromBlock}-${toBlock}: ${openLogs.length} opens, ${closeLogs.length} closes`);
        }

    } catch (err) {
        // CRITICAL: Never crash on scan errors. Log and retry next interval.
        console.error("[CopyEngine] Block scan failed (will retry):", err.message);
    }
}

// ══════════════════════ EXECUTION QUEUE ══════════════════════

function _enqueue(task) {
    executionQueue.push(task);
    _processQueue();
}

async function _processQueue() {
    if (isExecuting || executionQueue.length === 0) return;
    isExecuting = true;

    while (executionQueue.length > 0) {
        const task = executionQueue.shift();
        try {
            await _executeTask(task);
        } catch (err) {
            console.error(`[CopyEngine] Task failed: ${task.type}`, err.message);
            _handleTaskError(task, err);
        }
    }

    isExecuting = false;
}

async function _executeTask(task) {
    switch (task.type) {
        case "COPY_OPEN":
            await _executeCopyOpen(task);
            break;
        case "COPY_CLOSE":
            await _executeCopyClose(task);
            break;
        case "EMERGENCY_CLOSE":
            await _executeEmergencyClose(task);
            break;
        default:
            console.error(`[CopyEngine] Unknown task type: ${task.type}`);
    }
}

// ══════════════════════ COPY OPEN EXECUTION ══════════════════════

async function _executeCopyOpen(task) {
    const {
        leader, leaderPositionId, asset, isLong,
        leaderCollateral, leaderTotalBalance, leverage, leaderEntryPrice
    } = task;

    console.log(`[CopyEngine] Executing COPY_OPEN: leader=${leader} pos=${leaderPositionId} asset=${asset}`);

    // ── Gas pre-flight ──
    const keeperBalance = await provider.getBalance(keeperWallet.address);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;

    let estimatedGas;
    try {
        estimatedGas = await copyTradingContract.executeCopyOpen.estimateGas(
            leader, leaderPositionId, asset, isLong,
            leaderCollateral, leaderTotalBalance, leverage, leaderEntryPrice
        );
    } catch (err) {
        console.error(`[CopyEngine] Gas estimation failed for COPY_OPEN: ${err.message}`);
        _logTrade(task, "FAILED", `Gas estimation failed: ${err.message}`);
        return;
    }

    const gasWithBuffer = estimatedGas * BigInt(100 + GAS_BUFFER_PERCENT) / 100n;
    const estimatedCost = gasWithBuffer * gasPrice;

    if (keeperBalance < estimatedCost) {
        console.error(`[CopyEngine] ❌ Insufficient gas: need ${ethers.formatEther(estimatedCost)} ETH, have ${ethers.formatEther(keeperBalance)}`);
        _logTrade(task, "FAILED", "Insufficient keeper gas balance");
        return;
    }

    // ── Execute ──
    const gasBump = task.retries > 0 ? BigInt(100 + GAS_BUMP_PERCENT * task.retries) / 100n : 1n;
    const txGasPrice = gasPrice * gasBump;

    const tx = await copyTradingContract.executeCopyOpen(
        leader, leaderPositionId, asset, isLong,
        leaderCollateral, leaderTotalBalance, leverage, leaderEntryPrice,
        { gasLimit: gasWithBuffer, gasPrice: txGasPrice }
    );

    console.log(`[CopyEngine] TX sent: ${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status === 1) {
        const copyOpenEvents = receipt.logs.filter(log => {
            try {
                const parsed = copyTradingContract.interface.parseLog(log);
                return parsed?.name === "CopyTradeOpened";
            } catch { return false; }
        });
        const skipEvents = receipt.logs.filter(log => {
            try {
                const parsed = copyTradingContract.interface.parseLog(log);
                return parsed?.name === "CopyTradeSkipped";
            } catch { return false; }
        });

        console.log(`[CopyEngine] ✅ COPY_OPEN success: ${copyOpenEvents.length} copies opened, ${skipEvents.length} skipped (gas: ${receipt.gasUsed})`);
        _logTrade(task, "SUCCESS", `${copyOpenEvents.length} copies, ${skipEvents.length} skipped`, receipt.hash);
    } else {
        console.error(`[CopyEngine] ❌ TX reverted: ${receipt.hash}`);
        _logTrade(task, "REVERTED", "Transaction reverted", receipt.hash);
    }
}

// ══════════════════════ COPY CLOSE EXECUTION ══════════════════════

async function _executeCopyClose(task) {
    const { leaderPositionId, leader } = task;

    console.log(`[CopyEngine] Executing COPY_CLOSE: leaderPos=${leaderPositionId}`);

    let copies;
    try {
        copies = await copyTradingContract.getCopyPositions(leaderPositionId);
    } catch (err) {
        console.log(`[CopyEngine] No copy positions found for leaderPos=${leaderPositionId}`);
        return;
    }

    const openCopies = copies.filter(cp => cp.isOpen);
    if (openCopies.length === 0) {
        console.log(`[CopyEngine] No open copies for leaderPos=${leaderPositionId}`);
        return;
    }

    const keeperBalance = await provider.getBalance(keeperWallet.address);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;

    let estimatedGas;
    try {
        estimatedGas = await copyTradingContract.executeCopyClose.estimateGas(leaderPositionId);
    } catch (err) {
        console.error(`[CopyEngine] Gas estimation failed for COPY_CLOSE: ${err.message}`);
        _logTrade(task, "FAILED", `Gas estimation failed: ${err.message}`);
        return;
    }

    const gasWithBuffer = estimatedGas * BigInt(100 + GAS_BUFFER_PERCENT) / 100n;
    const gasBump = task.retries > 0 ? BigInt(100 + GAS_BUMP_PERCENT * task.retries) / 100n : 1n;
    const txGasPrice = gasPrice * gasBump;
    const estimatedCost = gasWithBuffer * txGasPrice;

    if (keeperBalance < estimatedCost) {
        console.error(`[CopyEngine] ❌ Insufficient gas for close`);
        _logTrade(task, "FAILED", "Insufficient keeper gas balance");
        return;
    }

    const tx = await copyTradingContract.executeCopyClose(
        leaderPositionId,
        { gasLimit: gasWithBuffer, gasPrice: txGasPrice }
    );

    console.log(`[CopyEngine] CLOSE TX sent: ${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status === 1) {
        const closeEvents = receipt.logs.filter(log => {
            try {
                const parsed = copyTradingContract.interface.parseLog(log);
                return parsed?.name === "CopyTradeClosed";
            } catch { return false; }
        });
        console.log(`[CopyEngine] ✅ COPY_CLOSE success: ${closeEvents.length} positions closed (gas: ${receipt.gasUsed})`);
        _logTrade(task, "SUCCESS", `${closeEvents.length} copies closed`, receipt.hash);
    } else {
        console.error(`[CopyEngine] ❌ CLOSE TX reverted: ${receipt.hash}`);
        _logTrade(task, "REVERTED", "Close transaction reverted", receipt.hash);
    }
}

// ══════════════════════ EMERGENCY CLOSE ══════════════════════

async function _executeEmergencyClose(task) {
    const { leaderPositionId, leader } = task;

    console.log(`[CopyEngine] ⚠️ EMERGENCY_CLOSE: leaderPos=${leaderPositionId}`);

    let copies;
    try {
        copies = await copyTradingContract.getCopyPositions(leaderPositionId);
    } catch (err) {
        console.log(`[CopyEngine] No copy positions for emergency close`);
        return;
    }

    for (const cp of copies) {
        if (!cp.isOpen) continue;

        try {
            const tx = await copyTradingContract.emergencyCloseCopy(cp.followerPerpsPositionId);
            const receipt = await tx.wait();
            console.log(`[CopyEngine] Emergency closed followerPos=${cp.followerPerpsPositionId} tx=${receipt.hash}`);
        } catch (err) {
            console.error(`[CopyEngine] Failed to emergency close followerPos=${cp.followerPerpsPositionId}: ${err.message}`);
        }
    }

    _logTrade(task, "SUCCESS", "Emergency close completed");
}

// ══════════════════════ ERROR HANDLING ══════════════════════

function _handleTaskError(task, error) {
    const maxRetries = task.type === "COPY_OPEN" ? MAX_RETRIES_OPEN : MAX_RETRIES_CLOSE;

    if (task.retries < maxRetries) {
        task.retries++;
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, task.retries - 1);
        console.log(`[CopyEngine] Retrying ${task.type} (attempt ${task.retries}/${maxRetries}) in ${delay}ms`);

        setTimeout(() => {
            _enqueue(task);
        }, delay);
    } else {
        console.error(`[CopyEngine] ❌ ${task.type} failed after ${maxRetries} retries: ${error.message}`);
        _logTrade(task, "ABANDONED", `Failed after ${maxRetries} retries: ${error.message}`);
    }
}

// ══════════════════════ HELPERS ══════════════════════

async function _refreshLeaderCache() {
    try {
        const count = await copyTradingContract.getLeaderCount();
        for (let i = 0; i < Number(count); i++) {
            const addr = await copyTradingContract.leaderList(i);
            const profile = await copyTradingContract.leaders(addr);
            if (profile.isRegistered) {
                registeredLeaders.add(addr.toLowerCase());
            }
        }
    } catch (err) {
        console.error(`[CopyEngine] Leader cache refresh failed: ${err.message}`);
    }
}

// ══════════════════════ AUDIT LOG ══════════════════════

function _logTrade(task, status, details, txHash = null) {
    const entry = {
        timestamp: new Date().toISOString(),
        type: task.type,
        leader: task.leader,
        leaderPositionId: task.leaderPositionId?.toString(),
        status,
        details,
        txHash,
        retries: task.retries,
    };

    tradeLog.push(entry);

    if (tradeLog.length > 1000) {
        tradeLog.splice(0, tradeLog.length - 1000);
    }
}

function getTradeLog() {
    return tradeLog;
}

// ══════════════════════ API HELPERS ══════════════════════

function getEngineStatus() {
    return {
        isRunning,
        keeper: keeperWallet?.address || null,
        registeredLeaders: registeredLeaders.size,
        queueLength: executionQueue.length,
        lastProcessedBlock: lastScannedBlock,
        tradeLogCount: tradeLog.length,
    };
}

async function refreshLeaders() {
    await _refreshLeaderCache();
    return { leadersCount: registeredLeaders.size, leaders: Array.from(registeredLeaders) };
}

module.exports = {
    startCopyEngine,
    stopCopyEngine,
    getEngineStatus,
    getTradeLog,
    refreshLeaders,
    COPY_TRADING_ABI,
    PERPS_ABI,
};
