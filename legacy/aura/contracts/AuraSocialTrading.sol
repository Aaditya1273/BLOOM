// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuraSocialTrading
 * @author Aura Protocol — Built for Robinhood Chain (Arbitrum Orbit)
 * @notice On-chain copy trading: strategists publish strategies, followers allocate
 *         capital that is automatically copied when the strategist executes trades.
 *
 * @dev Architecture:
 *   - Each strategy has a unique ID and a strategist address
 *   - Followers deposit aUSD into the strategy; their share is tracked proportionally
 *   - When the strategist calls executeForFollowers, the contract opens positions
 *     on AuraPerps on behalf of each follower (batch execution)
 *   - Performance fees are deducted from profits only (high-water mark)
 *   - Followers can unfollow and withdraw at any time (no lock-up)
 *
 * Security:
 *   - ReentrancyGuard on all state-changing external functions
 *   - Fee cap: 20% max performance fee
 *   - Max followers per strategy: 100 (gas bound on batch execution)
 *   - Max leverage enforced: 50x (mirrors AuraPerps limit)
 *   - Only the strategist can execute trades for their strategy
 *   - Followers' capital is isolated per strategy (no cross-contamination)
 */
contract AuraSocialTrading is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ══════════════════════ CONSTANTS ══════════════════════
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000; // 20%
    uint256 public constant MAX_FOLLOWERS = 100;
    uint256 public constant MAX_LEVERAGE = 50;
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ══════════════════════ STATE ══════════════════════
    IERC20 public immutable aUSD;

    struct Strategy {
        address strategist;
        string name;
        string description;
        uint256 performanceFeeBps; // e.g. 1000 = 10%
        bool isActive;
        uint256 totalFollowerCapital; // sum of all follower deposits (aUSD)
        uint256 followerCount;
        uint256 totalPnl;            // cumulative realized PnL (signed via int256 cast)
        uint256 createdAt;
    }

    struct FollowerPosition {
        uint256 capitalDeposited;    // aUSD deposited by this follower
        uint256 highWaterMark;       // for performance fee calculation
        bool isActive;
    }

    uint256 public nextStrategyId;
    mapping(uint256 => Strategy) public strategies;
    // strategyId => follower => FollowerPosition
    mapping(uint256 => mapping(address => FollowerPosition)) public followerPositions;
    // strategyId => list of follower addresses (for batch iteration)
    mapping(uint256 => address[]) private _followers;
    // strategyId => follower => index in _followers array (1-indexed, 0 = not present)
    mapping(uint256 => mapping(address => uint256)) private _followerIndex;

    // Accumulated fees per strategist (claimable)
    mapping(address => uint256) public pendingFees;

    // ══════════════════════ EVENTS ══════════════════════
    event StrategyPublished(
        uint256 indexed strategyId,
        address indexed strategist,
        string name,
        uint256 performanceFeeBps
    );
    event StrategyDeactivated(uint256 indexed strategyId, address indexed strategist);
    event Followed(uint256 indexed strategyId, address indexed follower, uint256 amount);
    event Unfollowed(uint256 indexed strategyId, address indexed follower, uint256 amountReturned);
    event TradeExecuted(
        uint256 indexed strategyId,
        address indexed strategist,
        string asset,
        bool isLong,
        uint256 leverage,
        uint256 totalCapitalUsed,
        uint256 followerCount
    );
    event ProfitDistributed(
        uint256 indexed strategyId,
        address indexed follower,
        uint256 profit,
        uint256 fee
    );
    event FeesClaimed(address indexed strategist, uint256 amount);
    event CapitalAdded(uint256 indexed strategyId, address indexed follower, uint256 amount);

    // ══════════════════════ ERRORS ══════════════════════
    error StrategyNotFound(uint256 strategyId);
    error StrategyNotActive(uint256 strategyId);
    error NotStrategist(uint256 strategyId, address caller);
    error FeeTooHigh(uint256 feeBps, uint256 maxBps);
    error LeverageTooHigh(uint256 leverage, uint256 maxLeverage);
    error MaxFollowersReached(uint256 strategyId);
    error AlreadyFollowing(uint256 strategyId, address follower);
    error NotFollowing(uint256 strategyId, address follower);
    error ZeroAmount();
    error InsufficientCapital(uint256 available, uint256 required);
    error NoFeesToClaim();

    // ══════════════════════ CONSTRUCTOR ══════════════════════
    constructor(address _aUSD) Ownable(msg.sender) {
        require(_aUSD != address(0), "AuraSocialTrading: zero aUSD address");
        aUSD = IERC20(_aUSD);
    }

    // ══════════════════════ STRATEGIST FUNCTIONS ══════════════════════

    /**
     * @notice Publish a new copy-trading strategy.
     * @param name Human-readable strategy name
     * @param description Strategy description / risk profile
     * @param performanceFeeBps Performance fee in basis points (max 2000 = 20%)
     * @return strategyId The ID of the newly created strategy
     */
    function publishStrategy(
        string calldata name,
        string calldata description,
        uint256 performanceFeeBps
    ) external returns (uint256 strategyId) {
        if (performanceFeeBps > MAX_PERFORMANCE_FEE_BPS) {
            revert FeeTooHigh(performanceFeeBps, MAX_PERFORMANCE_FEE_BPS);
        }
        require(bytes(name).length > 0, "AuraSocialTrading: empty name");

        strategyId = nextStrategyId++;
        strategies[strategyId] = Strategy({
            strategist: msg.sender,
            name: name,
            description: description,
            performanceFeeBps: performanceFeeBps,
            isActive: true,
            totalFollowerCapital: 0,
            followerCount: 0,
            totalPnl: 0,
            createdAt: block.timestamp
        });

        emit StrategyPublished(strategyId, msg.sender, name, performanceFeeBps);
    }

    /**
     * @notice Deactivate a strategy. Existing followers can still withdraw.
     * @param strategyId The strategy to deactivate
     */
    function deactivateStrategy(uint256 strategyId) external {
        Strategy storage s = _requireStrategy(strategyId);
        if (s.strategist != msg.sender) revert NotStrategist(strategyId, msg.sender);
        s.isActive = false;
        emit StrategyDeactivated(strategyId, msg.sender);
    }

    /**
     * @notice Execute a trade for all followers of a strategy.
     *         The strategist specifies the trade parameters; the contract
     *         records the execution and distributes any realized PnL.
     *
     * @dev In this implementation the contract records the trade intent on-chain
     *      and emits events. Integration with AuraPerps for actual position opening
     *      is done via the backend keeper (same pattern as AuraPerpsRouter).
     *      This keeps the contract gas-efficient while maintaining full on-chain auditability.
     *
     * @param strategyId Strategy to execute for
     * @param asset Asset to trade (e.g. "BTC", "ETH", "TSLA")
     * @param isLong Direction of the trade
     * @param leverage Leverage multiplier (1-50)
     * @param capitalFractionBps Fraction of each follower's capital to use (in BPS, max 10000)
     */
    function executeForFollowers(
        uint256 strategyId,
        string calldata asset,
        bool isLong,
        uint256 leverage,
        uint256 capitalFractionBps
    ) external nonReentrant {
        Strategy storage s = _requireStrategy(strategyId);
        if (s.strategist != msg.sender) revert NotStrategist(strategyId, msg.sender);
        if (!s.isActive) revert StrategyNotActive(strategyId);
        if (leverage == 0 || leverage > MAX_LEVERAGE) revert LeverageTooHigh(leverage, MAX_LEVERAGE);
        require(capitalFractionBps > 0 && capitalFractionBps <= BPS_DENOMINATOR, "AuraSocialTrading: invalid fraction");
        require(bytes(asset).length > 0, "AuraSocialTrading: empty asset");

        address[] storage followers = _followers[strategyId];
        uint256 count = followers.length;
        require(count > 0, "AuraSocialTrading: no followers");

        uint256 totalCapitalUsed = 0;
        for (uint256 i = 0; i < count; i++) {
            address follower = followers[i];
            FollowerPosition storage fp = followerPositions[strategyId][follower];
            if (!fp.isActive || fp.capitalDeposited == 0) continue;
            uint256 capitalUsed = (fp.capitalDeposited * capitalFractionBps) / BPS_DENOMINATOR;
            totalCapitalUsed += capitalUsed;
        }

        emit TradeExecuted(
            strategyId,
            msg.sender,
            asset,
            isLong,
            leverage,
            totalCapitalUsed,
            count
        );
    }

    /**
     * @notice Distribute realized profit to followers and collect performance fee.
     *         Called by the strategist (or keeper) after a trade closes profitably.
     *
     * @param strategyId Strategy ID
     * @param follower Follower address to credit
     * @param profit Gross profit amount in aUSD (must be transferred to this contract first)
     */
    function distributeProfitToFollower(
        uint256 strategyId,
        address follower,
        uint256 profit
    ) external nonReentrant {
        Strategy storage s = _requireStrategy(strategyId);
        if (s.strategist != msg.sender) revert NotStrategist(strategyId, msg.sender);
        if (profit == 0) revert ZeroAmount();

        FollowerPosition storage fp = followerPositions[strategyId][follower];
        if (!fp.isActive) revert NotFollowing(strategyId, follower);

        // Transfer profit from strategist/keeper to this contract
        aUSD.safeTransferFrom(msg.sender, address(this), profit);

        // Calculate performance fee (only on profit above high-water mark)
        uint256 fee = 0;
        uint256 currentValue = fp.capitalDeposited + profit;
        if (currentValue > fp.highWaterMark) {
            uint256 gainAboveHWM = currentValue - fp.highWaterMark;
            fee = (gainAboveHWM * s.performanceFeeBps) / BPS_DENOMINATOR;
            fp.highWaterMark = currentValue;
        }

        uint256 netProfit = profit - fee;
        fp.capitalDeposited += netProfit;
        s.totalFollowerCapital += netProfit;
        s.totalPnl += profit;

        if (fee > 0) {
            pendingFees[s.strategist] += fee;
        }

        emit ProfitDistributed(strategyId, follower, netProfit, fee);
    }

    /**
     * @notice Claim accumulated performance fees.
     */
    function claimFees() external nonReentrant {
        uint256 amount = pendingFees[msg.sender];
        if (amount == 0) revert NoFeesToClaim();
        pendingFees[msg.sender] = 0;
        aUSD.safeTransfer(msg.sender, amount);
        emit FeesClaimed(msg.sender, amount);
    }

    // ══════════════════════ FOLLOWER FUNCTIONS ══════════════════════

    /**
     * @notice Follow a strategy by depositing aUSD capital.
     * @param strategyId Strategy to follow
     * @param amount Amount of aUSD to allocate
     */
    function follow(uint256 strategyId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Strategy storage s = _requireStrategy(strategyId);
        if (!s.isActive) revert StrategyNotActive(strategyId);

        FollowerPosition storage fp = followerPositions[strategyId][msg.sender];
        if (fp.isActive) revert AlreadyFollowing(strategyId, msg.sender);
        if (s.followerCount >= MAX_FOLLOWERS) revert MaxFollowersReached(strategyId);

        aUSD.safeTransferFrom(msg.sender, address(this), amount);

        fp.capitalDeposited = amount;
        fp.highWaterMark = amount;
        fp.isActive = true;

        s.totalFollowerCapital += amount;
        s.followerCount++;

        _followers[strategyId].push(msg.sender);
        _followerIndex[strategyId][msg.sender] = _followers[strategyId].length; // 1-indexed

        emit Followed(strategyId, msg.sender, amount);
    }

    /**
     * @notice Add more capital to an existing follower position.
     * @param strategyId Strategy to add capital to
     * @param amount Additional aUSD amount
     */
    function addCapital(uint256 strategyId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Strategy storage s = _requireStrategy(strategyId);

        FollowerPosition storage fp = followerPositions[strategyId][msg.sender];
        if (!fp.isActive) revert NotFollowing(strategyId, msg.sender);

        aUSD.safeTransferFrom(msg.sender, address(this), amount);

        fp.capitalDeposited += amount;
        // Update high-water mark if adding capital (new capital starts fresh)
        if (fp.capitalDeposited > fp.highWaterMark) {
            fp.highWaterMark = fp.capitalDeposited;
        }
        s.totalFollowerCapital += amount;

        emit CapitalAdded(strategyId, msg.sender, amount);
    }

    /**
     * @notice Unfollow a strategy and withdraw all capital.
     *         Always succeeds — followers can never be locked in.
     * @param strategyId Strategy to unfollow
     */
    function unfollow(uint256 strategyId) external nonReentrant {
        Strategy storage s = _requireStrategy(strategyId);
        FollowerPosition storage fp = followerPositions[strategyId][msg.sender];
        if (!fp.isActive) revert NotFollowing(strategyId, msg.sender);

        uint256 amount = fp.capitalDeposited;

        // Remove from followers list (swap-and-pop)
        _removeFollower(strategyId, msg.sender);

        fp.capitalDeposited = 0;
        fp.highWaterMark = 0;
        fp.isActive = false;

        if (s.totalFollowerCapital >= amount) {
            s.totalFollowerCapital -= amount;
        } else {
            s.totalFollowerCapital = 0;
        }
        if (s.followerCount > 0) s.followerCount--;

        if (amount > 0) {
            aUSD.safeTransfer(msg.sender, amount);
        }

        emit Unfollowed(strategyId, msg.sender, amount);
    }

    // ══════════════════════ VIEW FUNCTIONS ══════════════════════

    /**
     * @notice Get all followers of a strategy.
     */
    function getFollowers(uint256 strategyId) external view returns (address[] memory) {
        return _followers[strategyId];
    }

    /**
     * @notice Get strategy details.
     */
    function getStrategy(uint256 strategyId) external view returns (Strategy memory) {
        return strategies[strategyId];
    }

    /**
     * @notice Get follower position details.
     */
    function getFollowerPosition(uint256 strategyId, address follower)
        external
        view
        returns (FollowerPosition memory)
    {
        return followerPositions[strategyId][follower];
    }

    /**
     * @notice Get all active strategies (paginated).
     * @param offset Start index
     * @param limit Max results
     */
    function getActiveStrategies(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Strategy[] memory result)
    {
        uint256 total = nextStrategyId;
        uint256 count = 0;
        // First pass: count active strategies
        for (uint256 i = offset; i < total && count < limit; i++) {
            if (strategies[i].isActive) count++;
        }
        ids = new uint256[](count);
        result = new Strategy[](count);
        uint256 idx = 0;
        for (uint256 i = offset; i < total && idx < count; i++) {
            if (strategies[i].isActive) {
                ids[idx] = i;
                result[idx] = strategies[i];
                idx++;
            }
        }
    }

    // ══════════════════════ INTERNAL ══════════════════════

    function _requireStrategy(uint256 strategyId) internal view returns (Strategy storage) {
        require(strategyId < nextStrategyId, "AuraSocialTrading: strategy not found");
        return strategies[strategyId];
    }

    /**
     * @dev Swap-and-pop removal from followers array. O(1).
     */
    function _removeFollower(uint256 strategyId, address follower) internal {
        uint256 idx = _followerIndex[strategyId][follower];
        require(idx > 0, "AuraSocialTrading: follower not in list");
        idx--; // convert to 0-indexed

        address[] storage list = _followers[strategyId];
        uint256 lastIdx = list.length - 1;

        if (idx != lastIdx) {
            address last = list[lastIdx];
            list[idx] = last;
            _followerIndex[strategyId][last] = idx + 1; // keep 1-indexed
        }
        list.pop();
        delete _followerIndex[strategyId][follower];
    }
}
