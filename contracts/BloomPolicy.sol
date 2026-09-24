// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IBloomAssetRegistry} from "./interfaces/IBloomAssetRegistry.sol";
import {IRiskEngine} from "./interfaces/IRiskEngine.sol";

interface IOwnedAccount {
    function owner() external view returns (address);
}

/// @title BloomPolicy
/// @notice Onchain rules that bound what a Bloom Agent session key may do for a user's smart account.
///
/// The AI is never the final authority: AI output -> backend validator -> THIS policy -> smart account.
/// A session key can only trigger a closed set of (target, selector) pairs on Bloom contracts, with decoded and
/// checked arguments, per-transaction and per-day USD caps, an asset allowlist, a Stock Token allocation ceiling,
/// a validity window, and it is bound to one account. Anything else is rejected.
contract BloomPolicy {
    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_ALLOWED_ASSETS = 8;

    // ─── allowed selectors (the complete agent surface) ───
    bytes4 internal constant SEL_APPROVE = 0x095ea7b3; // approve(address,uint256)
    bytes4 internal constant SEL_VAULT_DEPOSIT = 0x6e553f65; // deposit(uint256,address)
    bytes4 internal constant SEL_ROUTER_SEND = bytes4(keccak256("send(address,address,uint256,bytes32)"));
    bytes4 internal constant SEL_ROUTER_SWAP =
        bytes4(keccak256("swap(address,address,address,uint256,uint256,uint256)"));
    bytes4 internal constant SEL_CREATE_CLAIM =
        bytes4(keccak256("createClaim(bytes32,address,uint256,address,uint64)"));

    // ─── rejection reasons (surfaced to users in plain English by the backend) ───
    bytes32 public constant R_NO_POLICY = "NO_ACTIVE_POLICY";
    bytes32 public constant R_NOT_YET_VALID = "POLICY_NOT_YET_VALID";
    bytes32 public constant R_EXPIRED = "POLICY_EXPIRED";
    bytes32 public constant R_VALUE = "NATIVE_VALUE_NOT_ALLOWED";
    bytes32 public constant R_TARGET = "TARGET_NOT_ALLOWED";
    bytes32 public constant R_SELECTOR = "SELECTOR_NOT_ALLOWED";
    bytes32 public constant R_ASSET = "ASSET_NOT_ALLOWED";
    bytes32 public constant R_RISK = "ASSET_RISK_BLOCKED";
    bytes32 public constant R_TX_CAP = "PER_TX_CAP_EXCEEDED";
    bytes32 public constant R_DAILY_CAP = "DAILY_CAP_EXCEEDED";
    bytes32 public constant R_RECEIVER = "RECEIVER_NOT_ALLOWED";
    bytes32 public constant R_SPENDER = "SPENDER_NOT_ALLOWED";
    bytes32 public constant R_MALFORMED = "MALFORMED_CALLDATA";
    bytes32 public constant R_ZERO = "ZERO_AMOUNT";

    struct GoalParams {
        bytes32 name; // e.g. "Laptop"
        uint256 targetAmount; // USDG units
        uint64 deadline;
        uint128 maxPerTxUsd; // 1e18 USD
        uint128 dailyCapUsd; // 1e18 USD
        uint16 maxStockAllocationBps;
        address[] allowedAssets;
    }

    struct Goal {
        address account;
        address agent; // session key, set on activation
        bytes32 name;
        uint256 targetAmount;
        uint64 createdAt;
        uint64 deadline; // also the session-key expiry
        uint128 maxPerTxUsd;
        uint128 dailyCapUsd;
        uint16 maxStockAllocationBps;
        bool active;
    }

    IBloomAssetRegistry public immutable registry;
    IRiskEngine public immutable riskEngine;
    address public immutable vault;
    address public immutable router;
    address public immutable claims;
    address public immutable usdg;
    uint256 internal immutable _usdScale;

    uint256 public goalCount;
    mapping(uint256 => Goal) internal _goals;
    mapping(uint256 => address[]) internal _goalAssets;
    mapping(uint256 => mapping(address => bool)) public goalAllowsAsset;
    /// @notice account => session key => active goal id (0 = none)
    mapping(address => mapping(address => uint256)) public goalOfAgent;
    /// @notice goal id => day => USD (1e18) spent
    mapping(uint256 => mapping(uint256 => uint256)) public spentOnDay;

    event GoalCreated(uint256 indexed goalId, address indexed account, bytes32 name, uint256 targetAmount, uint64 deadline);
    event GoalActivated(uint256 indexed goalId, address indexed account, address indexed agent, uint64 expiresAt);
    event GoalRevoked(uint256 indexed goalId, address indexed account);
    event SpendRecorded(uint256 indexed goalId, uint256 day, uint256 usd, uint256 spentToday);

    error NotAccountOwner();
    error InvalidGoal();
    error TooManyAssets();
    error UnknownGoal();
    error AgentAlreadyBound();
    error OnlyAccount();

    constructor(
        IBloomAssetRegistry registry_,
        IRiskEngine riskEngine_,
        address vault_,
        address router_,
        address claims_
    ) {
        registry = registry_;
        riskEngine = riskEngine_;
        vault = vault_;
        router = router_;
        claims = claims_;
        usdg = registry_.stableAsset();
        if (usdg == address(0)) revert InvalidGoal();
        _usdScale = 10 ** (18 - registry_.getAsset(usdg).decimals);
    }

    modifier onlyAccountOrOwner(address account) {
        if (msg.sender != account && msg.sender != IOwnedAccount(account).owner()) revert NotAccountOwner();
        _;
    }

    // ═══════════════════════════ goal lifecycle ═══════════════════════════

    function createGoal(address account, GoalParams calldata p)
        external
        onlyAccountOrOwner(account)
        returns (uint256 goalId)
    {
        if (
            p.deadline <= block.timestamp || p.maxPerTxUsd == 0 || p.dailyCapUsd < p.maxPerTxUsd
                || p.maxStockAllocationBps > BPS || p.allowedAssets.length == 0
        ) revert InvalidGoal();
        if (p.allowedAssets.length > MAX_ALLOWED_ASSETS) revert TooManyAssets();

        goalId = ++goalCount;
        for (uint256 i; i < p.allowedAssets.length; ++i) {
            address a = p.allowedAssets[i];
            registry.requireSupported(a, IBloomAssetRegistry.AssetKind.NONE);
            if (!goalAllowsAsset[goalId][a]) {
                goalAllowsAsset[goalId][a] = true;
                _goalAssets[goalId].push(a);
            }
        }
        _goals[goalId] = Goal({
            account: account,
            agent: address(0),
            name: p.name,
            targetAmount: p.targetAmount,
            createdAt: uint64(block.timestamp),
            deadline: p.deadline,
            maxPerTxUsd: p.maxPerTxUsd,
            dailyCapUsd: p.dailyCapUsd,
            maxStockAllocationBps: p.maxStockAllocationBps,
            active: false
        });
        emit GoalCreated(goalId, account, p.name, p.targetAmount, p.deadline);
    }

    /// @notice Bind a session key to the goal. The key expires at the goal deadline.
    function activateGoal(uint256 goalId, address agent) external {
        Goal storage g = _goals[goalId];
        if (g.account == address(0)) revert UnknownGoal();
        if (msg.sender != g.account && msg.sender != IOwnedAccount(g.account).owner()) revert NotAccountOwner();
        if (agent == address(0) || agent == g.account || g.deadline <= block.timestamp) revert InvalidGoal();
        uint256 existing = goalOfAgent[g.account][agent];
        if (existing != 0 && existing != goalId && _goals[existing].active) revert AgentAlreadyBound();
        if (g.agent != address(0) && g.agent != agent) goalOfAgent[g.account][g.agent] = 0;
        g.agent = agent;
        g.active = true;
        goalOfAgent[g.account][agent] = goalId;
        emit GoalActivated(goalId, g.account, agent, g.deadline);
    }

    /// @notice Immediately revoke the goal and its session key.
    function revokeGoal(uint256 goalId) external {
        Goal storage g = _goals[goalId];
        if (g.account == address(0)) revert UnknownGoal();
        if (msg.sender != g.account && msg.sender != IOwnedAccount(g.account).owner()) revert NotAccountOwner();
        g.active = false;
        if (g.agent != address(0)) goalOfAgent[g.account][g.agent] = 0;
        emit GoalRevoked(goalId, g.account);
    }

    // ═══════════════════════════ authorization ═══════════════════════════

    /// @notice Session validity for ERC-4337 validation: (goalId, validAfter, validUntil). goalId 0 => invalid.
    function sessionOf(address account, address agent)
        external
        view
        returns (uint256 goalId, uint48 validAfter, uint48 validUntil)
    {
        goalId = goalOfAgent[account][agent];
        if (goalId == 0) return (0, 0, 0);
        Goal storage g = _goals[goalId];
        if (!g.active) return (0, 0, 0);
        return (goalId, uint48(g.createdAt), uint48(g.deadline));
    }

    /// @notice Dry-run used by the backend before building a transaction.
    function preview(address account, address agent, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool ok, bytes32 reason, uint256 goalId, uint256 spendUsd)
    {
        return _check(account, agent, target, value, data);
    }

    /// @notice Called by the smart account itself before executing an agent action. Records spend on success.
    function authorize(address agent, address target, uint256 value, bytes calldata data)
        external
        returns (bool ok, bytes32 reason, uint256 goalId)
    {
        uint256 spendUsd;
        (ok, reason, goalId, spendUsd) = _check(msg.sender, agent, target, value, data);
        if (!ok) return (false, reason, goalId);
        if (spendUsd != 0) {
            uint256 day = block.timestamp / 1 days;
            uint256 total = spentOnDay[goalId][day] + spendUsd;
            spentOnDay[goalId][day] = total;
            emit SpendRecorded(goalId, day, spendUsd, total);
        }
    }

    /// @notice Post-execution check: Stock Token share of the account's Bloom portfolio stays within the goal cap.
    function allocationWithinLimit(address account, uint256 goalId) public view returns (bool) {
        (uint256 stockUsd, uint256 totalUsd, bool priced) = portfolioValue(account);
        if (!priced) return false;
        if (totalUsd == 0) return true;
        return stockUsd * BPS <= uint256(_goals[goalId].maxStockAllocationBps) * totalUsd;
    }

    /// @notice USD (1e18) value of an account's registered assets plus its vault position.
    /// @return stockUsd Stock Token value
    /// @return totalUsd total value (stock + USDG + vault position)
    /// @return priced false if any held Stock Token has no trusted price (fail closed)
    function portfolioValue(address account) public view returns (uint256 stockUsd, uint256 totalUsd, bool priced) {
        priced = true;
        IBloomAssetRegistry.SupportedAsset[] memory assets = registry.listAssets();
        for (uint256 i; i < assets.length; ++i) {
            IBloomAssetRegistry.SupportedAsset memory a = assets[i];
            uint256 bal = IERC20(a.token).balanceOf(account);
            if (bal == 0) continue;
            if (a.kind == IBloomAssetRegistry.AssetKind.STABLE) {
                totalUsd += bal * _usdScale;
            } else {
                (,,,, uint256 price,) = riskEngine.getRisk(a.token);
                if (price == 0) {
                    priced = false;
                    continue;
                }
                uint256 v = bal * price / (10 ** a.decimals);
                stockUsd += v;
                totalUsd += v;
            }
        }
        uint256 shares = IERC20(vault).balanceOf(account);
        if (shares != 0) totalUsd += IERC4626(vault).convertToAssets(shares) * _usdScale;
    }

    function getGoal(uint256 goalId) external view returns (Goal memory g, address[] memory assets) {
        return (_goals[goalId], _goalAssets[goalId]);
    }

    function spentToday(uint256 goalId) external view returns (uint256) {
        return spentOnDay[goalId][block.timestamp / 1 days];
    }

    // ═══════════════════════════ internals ═══════════════════════════

    function _check(address account, address agent, address target, uint256 value, bytes calldata data)
        internal
        view
        returns (bool, bytes32, uint256 goalId, uint256 spendUsd)
    {
        goalId = goalOfAgent[account][agent];
        if (goalId == 0) return (false, R_NO_POLICY, 0, 0);
        Goal storage g = _goals[goalId];
        if (!g.active) return (false, R_NO_POLICY, goalId, 0);
        if (block.timestamp < g.createdAt) return (false, R_NOT_YET_VALID, goalId, 0);
        if (block.timestamp > g.deadline) return (false, R_EXPIRED, goalId, 0);
        if (value != 0) return (false, R_VALUE, goalId, 0);
        if (data.length < 4) return (false, R_MALFORMED, goalId, 0);
        bytes4 sel = bytes4(data[:4]);

        address token;
        uint256 amount;

        if (sel == SEL_APPROVE) {
            // only exact, capped approvals of allowed assets to Bloom contracts
            if (data.length != 68) return (false, R_MALFORMED, goalId, 0);
            (address spender, uint256 amt) = abi.decode(data[4:], (address, uint256));
            if (spender != vault && spender != router && spender != claims) return (false, R_SPENDER, goalId, 0);
            if (!goalAllowsAsset[goalId][target]) return (false, R_TARGET, goalId, 0);
            (bool ok, bytes32 r, uint256 usd) = _value(target, amt);
            if (!ok) return (false, r, goalId, 0);
            if (usd > g.maxPerTxUsd) return (false, R_TX_CAP, goalId, 0);
            return (true, bytes32(0), goalId, 0); // approvals are not spend; the following action is
        } else if (target == vault && sel == SEL_VAULT_DEPOSIT) {
            if (data.length != 68) return (false, R_MALFORMED, goalId, 0);
            address receiver;
            (amount, receiver) = abi.decode(data[4:], (uint256, address));
            if (receiver != account) return (false, R_RECEIVER, goalId, 0);
            token = usdg;
        } else if (target == router && sel == SEL_ROUTER_SEND) {
            if (data.length != 132) return (false, R_MALFORMED, goalId, 0);
            (token,, amount,) = abi.decode(data[4:], (address, address, uint256, bytes32));
        } else if (target == router && sel == SEL_ROUTER_SWAP) {
            if (data.length != 196) return (false, R_MALFORMED, goalId, 0);
            address tokenOut;
            (, token, tokenOut, amount,,) = abi.decode(data[4:], (address, address, address, uint256, uint256, uint256));
            if (!goalAllowsAsset[goalId][tokenOut]) return (false, R_ASSET, goalId, 0);
        } else if (target == claims && sel == SEL_CREATE_CLAIM) {
            if (data.length != 164) return (false, R_MALFORMED, goalId, 0);
            (, token, amount,,) = abi.decode(data[4:], (bytes32, address, uint256, address, uint64));
        } else if (target == vault || target == router || target == claims) {
            return (false, R_SELECTOR, goalId, 0);
        } else {
            return (false, R_TARGET, goalId, 0);
        }

        if (amount == 0) return (false, R_ZERO, goalId, 0);
        if (!goalAllowsAsset[goalId][token]) return (false, R_ASSET, goalId, 0);
        bool priced;
        bytes32 reason;
        (priced, reason, spendUsd) = _value(token, amount);
        if (!priced) return (false, reason, goalId, 0);
        if (spendUsd > g.maxPerTxUsd) return (false, R_TX_CAP, goalId, 0);
        if (spentOnDay[goalId][block.timestamp / 1 days] + spendUsd > g.dailyCapUsd) {
            return (false, R_DAILY_CAP, goalId, 0);
        }
        return (true, bytes32(0), goalId, spendUsd);
    }

    function _value(address token, uint256 amount) internal view returns (bool, bytes32, uint256) {
        IBloomAssetRegistry.SupportedAsset memory a = registry.getAsset(token);
        if (!a.enabled) return (false, R_ASSET, 0);
        // bounds the multiplications below (price <= 1e36 < 2^120) and turns "unlimited" amounts into a clean rejection
        if (amount > type(uint128).max) return (false, R_TX_CAP, 0);
        if (a.kind == IBloomAssetRegistry.AssetKind.STABLE) return (true, bytes32(0), amount * _usdScale);
        (uint8 state,,,, uint256 price,) = riskEngine.getRisk(token);
        if (state != uint8(IRiskEngine.RiskState.NORMAL) || price == 0) return (false, R_RISK, 0);
        return (true, bytes32(0), amount * price / (10 ** a.decimals));
    }

    /// @notice Whether an action with this selector requires the post-execution allocation check.
    function requiresAllocationCheck(bytes calldata data) external pure returns (bool) {
        return data.length >= 4 && bytes4(data[:4]) == SEL_ROUTER_SWAP;
    }
}
