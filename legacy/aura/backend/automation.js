const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

// Use the same stable agent key as index.js
let operatorWallet;
const AGENT_KEY_FILE = path.join(__dirname, ".aura_agent_key");

if (process.env.PRIVATE_KEY) {
    operatorWallet = new ethers.Wallet(process.env.PRIVATE_KEY);
} else if (fs.existsSync(AGENT_KEY_FILE)) {
    const savedKey = fs.readFileSync(AGENT_KEY_FILE, "utf8").trim();
    operatorWallet = new ethers.Wallet(savedKey);
} else {
    operatorWallet = ethers.Wallet.createRandom();
    fs.writeFileSync(AGENT_KEY_FILE, operatorWallet.privateKey, { mode: 0o600 });
}

// ── Persistent storage ───────────────────────────────────────────────
const STRATEGIES_FILE = path.join(__dirname, "strategies.json");
const EXECUTIONS_FILE = path.join(__dirname, "executions.json");

/**
 * In-memory map: strategyId -> {
 *   id, createdAt, totalSwaps, completedSwaps, intervalSeconds,
 *   txParams, accountAddress, status: 'active'|'paused'|'cancelled'|'completed',
 *   nextRunAt: number (ms epoch) | null,
 *   lastTxHash: string | null,
 *   _timer: NodeJS.Timeout | null  (NOT persisted)
 * }
 */
const strategies = new Map();

function loadStrategiesFromDisk() {
    try {
        if (!fs.existsSync(STRATEGIES_FILE)) return [];
        const raw = fs.readFileSync(STRATEGIES_FILE, "utf8");
        if (!raw.trim()) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("  Failed to read strategies.json:", err.message);
        return [];
    }
}

function persistStrategies() {
    try {
        const serializable = Array.from(strategies.values()).map((s) => {
            const { _timer, ...rest } = s; // strip the live timer ref
            return rest;
        });
        fs.writeFileSync(STRATEGIES_FILE, JSON.stringify(serializable, null, 2));
    } catch (err) {
        console.error("  Failed to persist strategies:", err.message);
    }
}

function logExecution(strategyId, data) {
    try {
        let executions = [];
        if (fs.existsSync(EXECUTIONS_FILE)) {
            const content = fs.readFileSync(EXECUTIONS_FILE, "utf8");
            executions = JSON.parse(content);
        }

        executions.push({
            id: Math.random().toString(36).substring(2, 15),
            strategyId,
            timestamp: new Date().toISOString(),
            ...data,
        });

        // Keep only last 100 executions
        if (executions.length > 100) executions = executions.slice(-100);

        fs.writeFileSync(EXECUTIONS_FILE, JSON.stringify(executions, null, 2));
    } catch (err) {
        console.error("Failed to log execution:", err.message);
    }
}

async function executeSwap(strategy) {
    const { id: strategyId, txParams, accountAddress, completedSwaps, totalSwaps } = strategy;
    const current = completedSwaps + 1;

    try {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${strategyId}]  AGENT ACTION: Executing swap ${current}/${totalSwaps}...`);

        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 60000;
        const signer = operatorWallet.connect(provider);

        const balance = await provider.getBalance(operatorWallet.address);
        if (balance === 0n) {
            console.error(`[${strategyId}]  ERROR: Agent has no ETH for gas. Address: ${operatorWallet.address}`);
            logExecution(strategyId, { status: "failed", error: "Agent has no ETH for gas", current, total: totalSwaps });
            return false;
        }

        const accountAbi = ["function executeBatchByAgent(address[] dest, uint256[] value, bytes[] func) external"];
        const account = new ethers.Contract(accountAddress, accountAbi, signer);

        const parsedValues = txParams.values.map((v) => BigInt(v));

        const tx = await account.executeBatchByAgent(
            txParams.targets,
            parsedValues,
            txParams.datas,
            { gasLimit: 2000000 }
        );

        console.log(`[${strategyId}] ⏳ Transaction sent: ${tx.hash}. Waiting for confirmation...`);
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(`[${strategyId}]  SUCCESS: Swap ${current} confirmed in block ${receipt.blockNumber}!`);
            logExecution(strategyId, {
                status: "confirmed",
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                current,
                total: totalSwaps,
                txParams: {
                    targets: txParams.targets,
                    values: txParams.values,
                    description: txParams.description || `Swap ${current}/${totalSwaps} for ${strategyId}`,
                    tokenInSymbol: txParams.tokenInSymbol,
                    tokenOutSymbol: txParams.tokenOutSymbol,
                },
            });
            strategy.lastTxHash = tx.hash;
            return true;
        } else {
            console.error(`[${strategyId}]  REVERTED: Swap ${current} failed on-chain.`);
            logExecution(strategyId, {
                status: "failed",
                txHash: tx.hash,
                error: "Transaction reverted on-chain",
                current,
                total: totalSwaps,
            });
            return false;
        }
    } catch (err) {
        console.error(`[${strategyId}]  EXECUTION FAILED:`, err.message);
        logExecution(strategyId, { status: "failed", error: err.message, current, total: totalSwaps });
        return false;
    }
}

function clearTimer(strategy) {
    if (strategy._timer) {
        clearTimeout(strategy._timer);
        strategy._timer = null;
    }
}

function scheduleNextRun(strategy, delayMs) {
    clearTimer(strategy);
    strategy.nextRunAt = Date.now() + delayMs;
    strategy._timer = setTimeout(() => runStep(strategy.id), delayMs);
    persistStrategies();
}

async function runStep(strategyId) {
    const strategy = strategies.get(strategyId);
    if (!strategy) return;
    if (strategy.status !== "active") return; // paused or cancelled in the meantime

    // Defensive: if already at the cap, mark complete.
    if (strategy.completedSwaps >= strategy.totalSwaps) {
        strategy.status = "completed";
        strategy.nextRunAt = null;
        clearTimer(strategy);
        persistStrategies();
        console.log(`[${strategyId}]  ALL SWAPS COMPLETED.`);
        return;
    }

    await executeSwap(strategy);
    strategy.completedSwaps += 1;

    if (strategy.completedSwaps >= strategy.totalSwaps) {
        strategy.status = "completed";
        strategy.nextRunAt = null;
        clearTimer(strategy);
        persistStrategies();
        console.log(`[${strategyId}]  ALL SWAPS COMPLETED.`);
        return;
    }

    if (strategy.status !== "active") {
        // got paused/cancelled while the swap was running
        persistStrategies();
        return;
    }

    scheduleNextRun(strategy, strategy.intervalSeconds * 1000);
}

/**
 * Start a brand-new strategy.
 */
async function startAutomation(strategyId, totalSwaps, intervalSeconds, txParams, accountAddress, initialDelayMs = 0) {
    console.log(
        ` Automation Engine Started for ${totalSwaps} swaps. Initial Delay: ${initialDelayMs}ms, Interval: ${intervalSeconds}s`
    );

    // If a strategy with this id already exists, clear it first (idempotency).
    const existing = strategies.get(strategyId);
    if (existing) clearTimer(existing);

    const strategy = {
        id: strategyId,
        createdAt: new Date().toISOString(),
        totalSwaps: parseInt(totalSwaps, 10),
        completedSwaps: 0,
        intervalSeconds: parseInt(intervalSeconds, 10),
        txParams,
        accountAddress,
        status: "active",
        nextRunAt: null,
        lastTxHash: null,
        _timer: null,
    };
    strategies.set(strategyId, strategy);

    scheduleNextRun(strategy, Math.max(0, initialDelayMs));
}

function pauseStrategy(strategyId) {
    const strategy = strategies.get(strategyId);
    if (!strategy) return { ok: false, error: "Strategy not found" };
    if (strategy.status === "completed") return { ok: false, error: "Already completed" };
    if (strategy.status === "cancelled") return { ok: false, error: "Already cancelled" };
    if (strategy.status === "paused") return { ok: true, strategy: serializeStrategy(strategy) };

    strategy.status = "paused";
    clearTimer(strategy);
    strategy.nextRunAt = null;
    persistStrategies();
    console.log(`[${strategyId}] ⏸  Paused`);
    return { ok: true, strategy: serializeStrategy(strategy) };
}

function resumeStrategy(strategyId) {
    const strategy = strategies.get(strategyId);
    if (!strategy) return { ok: false, error: "Strategy not found" };
    if (strategy.status === "completed") return { ok: false, error: "Already completed" };
    if (strategy.status === "cancelled") return { ok: false, error: "Cancelled" };
    if (strategy.status === "active") return { ok: true, strategy: serializeStrategy(strategy) };

    strategy.status = "active";
    // Run the next swap (almost) immediately on resume.
    scheduleNextRun(strategy, 1000);
    console.log(`[${strategyId}] ▶  Resumed`);
    return { ok: true, strategy: serializeStrategy(strategy) };
}

function cancelStrategy(strategyId) {
    const strategy = strategies.get(strategyId);
    if (!strategy) return { ok: false, error: "Strategy not found" };
    if (strategy.status === "cancelled") return { ok: true, strategy: serializeStrategy(strategy) };

    strategy.status = "cancelled";
    clearTimer(strategy);
    strategy.nextRunAt = null;
    persistStrategies();
    console.log(`[${strategyId}]  Cancelled`);
    return { ok: true, strategy: serializeStrategy(strategy) };
}

function serializeStrategy(s) {
    const { _timer, ...rest } = s;
    return rest;
}

function listStrategies() {
    return Array.from(strategies.values()).map(serializeStrategy);
}

function getStrategy(strategyId) {
    const s = strategies.get(strategyId);
    return s ? serializeStrategy(s) : null;
}

/**
 * Restore strategies from disk (called once at backend startup).
 * Active strategies have their timers re-armed; completed/cancelled stay as-is.
 */
function restoreStrategies() {
    const saved = loadStrategiesFromDisk();
    if (saved.length === 0) {
        console.log(" No persisted strategies to restore.");
        return;
    }

    let active = 0;
    let paused = 0;
    let other = 0;

    for (const s of saved) {
        const strategy = { ...s, _timer: null };
        strategies.set(strategy.id, strategy);

        if (strategy.status === "active") {
            // Compute remaining delay until the next scheduled run.
            const now = Date.now();
            let delayMs;
            if (strategy.nextRunAt && strategy.nextRunAt > now) {
                delayMs = strategy.nextRunAt - now;
            } else {
                // Either we missed it during downtime or it was unset; run shortly.
                delayMs = 2000;
            }
            scheduleNextRun(strategy, delayMs);
            active += 1;
        } else if (strategy.status === "paused") {
            paused += 1;
        } else {
            other += 1;
        }
    }

    console.log(` Restored ${saved.length} strategies (${active} active resumed, ${paused} paused, ${other} other).`);
    persistStrategies(); // rewrite with refreshed nextRunAt values
}

module.exports = {
    startAutomation,
    pauseStrategy,
    resumeStrategy,
    cancelStrategy,
    listStrategies,
    getStrategy,
    restoreStrategies,
    operatorAddress: operatorWallet.address,
};
