// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IAuraPerps
 * @dev Read-only + public entry points on the UNMODIFIED AuraPerps contract.
 *      openPosition() is public (no router gate), closePosition() checks pos.owner == msg.sender.
 *      Since THIS contract calls openPosition(), it becomes pos.owner and can later closePosition().
 */
interface IAuraPerps {
    function openPosition(
        string calldata asset, bool isLong,
        uint256 collateralAmount, uint256 leverage
    ) external returns (uint256);

    function closePosition(uint256 positionId) external;

    function addMargin(uint256 positionId, uint256 additionalCollateral) external;

    function positions(uint256 positionId) external view returns (
        address owner, string memory asset, bool isLong,
        uint256 collateralAmount, uint256 leverage, uint256 entryPrice,
        uint256 positionSize, bool isOpen, uint256 openedAt,
        uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice,
        uint256 takeProfitPrice, uint256 stopLossPrice
    );

    function calculatePnL(uint256 positionId, uint256 currentPrice)
        external view returns (uint256 pnl, bool isProfit);

    function TRADING_FEE_BPS() external view returns (uint256);
}

interface IMockOracle {
    function getPrice(string calldata asset) external view returns (uint256);
}

/**
 * @title AuraCopyTradingV2
 * @author Aura Protocol — Robinhood Chain (Arbitrum Orbit)
 *
 * @notice Fully standalone copy trading contract for a Perpetual DEX.
 *         Does NOT require any modification to AuraPerps.
 *
 * @dev Architecture — how it works without modifying AuraPerps:
 *
 *   1. AuraPerps.openPosition() is a PUBLIC function: anyone can call it.
 *      It does `aUSD.transferFrom(msg.sender, …)` and sets `pos.owner = msg.sender`.
 *
 *   2. This contract calls openPosition() → so THIS CONTRACT becomes pos.owner.
 *      This lets the contract call closePosition() later (which checks owner == msg.sender).
 *
 *   3. When AuraPerps._close() settles, it sends aUSD back to pos.owner = this contract.
 *      The contract then credits the follower's internal balance accordingly.
 *
 *   Result: full lifecycle control without touching AuraPerps code.
 *
 * Key features:
 *   - Proportional position sizing (risk-fraction model)
 *   - On-chain slippage protection
 *   - Pre-trade health factor check (5% minimum free margin)
 *   - High-water mark performance fees
 *   - Gas cost validation off-chain by keeper
 */
contract AuraCopyTradingV2 is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ══════════════════════ CONSTANTS ══════════════════════

    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000;  // 20% max
    uint256 public constant MAX_FOLLOWERS_PER_LEADER = 50;
    uint256 public constant MAX_LEVERAGE = 50;
    uint256 public constant BPS = 10000;
    uint256 public constant MIN_MARGIN_BPS = 500;            // 5% minimum free margin
    uint256 public constant DEFAULT_SLIPPAGE_BPS = 50;       // 0.5%
    uint256 public constant MIN_SCALE_FACTOR = 1000;         // 0.1x (in BPS)
    uint256 public constant MAX_SCALE_FACTOR = 20000;        // 2.0x (in BPS)
    uint256 public constant SCALE_FACTOR_BASE = 10000;       // 1.0x
    uint256 public constant MIN_COPY_COLLATERAL = 1e16;      // 0.01 aUSD (18 dec)

    // ══════════════════════ IMMUTABLES ══════════════════════

    IERC20      public immutable aUSD;
    IAuraPerps  public immutable perps;
    IMockOracle public immutable oracle;

    // ══════════════════════ STATE ══════════════════════

    address public keeper;

    // ── Leader state ──

    struct LeaderProfile {
        bool     isRegistered;
        bool     isActive;
        uint256  performanceFeeBps;
        uint256  totalFollowers;
        uint256  totalCopiedCapital;
        uint256  totalRealizedPnl;        // absolute value
        bool     isPnlPositive;
        uint256  tradesExecuted;
        uint256  tradesWon;
        uint256  createdAt;
    }

    mapping(address => LeaderProfile) public leaders;
    address[] public leaderList;
    mapping(address => uint256) private _leaderIdx; // 1-indexed

    // ── Follower allocations ──

    struct FollowerAllocation {
        bool     isActive;
        uint256  capitalDeposited;
        uint256  capitalInPositions;
        uint256  highWaterMark;
        uint256  scaleFactor;             // BPS: 10000 = 1.0x
        uint256  maxSlippageBps;
        uint256  joinedAt;
    }

    mapping(address => mapping(address => FollowerAllocation)) public allocations;
    mapping(address => address[]) private _leaderFollowers;
    mapping(address => mapping(address => uint256)) private _followerIdx; // 1-indexed

    // ── Copy position tracking ──

    struct CopyPosition {
        uint256  leaderPositionId;
        uint256  followerPerpsPositionId;
        address  follower;
        address  leader;
        uint256  collateralUsed;
        bool     isOpen;
        uint256  openedAt;
    }

    mapping(uint256 => CopyPosition[]) public copyPositionsByLeader;
    mapping(uint256 => uint256) public followerPosToLeaderPos;
    mapping(uint256 => uint256) public followerPosToIndex;

    mapping(address => mapping(address => uint256[])) private _followerOpenPos;
    mapping(uint256 => uint256) private _openPosIdx; // 1-indexed

    mapping(address => uint256) public pendingFees;

    // ══════════════════════ EVENTS ══════════════════════

    event LeaderRegistered(address indexed leader, uint256 performanceFeeBps);
    event LeaderDeactivated(address indexed leader);
    event LeaderReactivated(address indexed leader);

    event FollowerJoined(address indexed leader, address indexed follower,
        uint256 capital, uint256 scaleFactor, uint256 maxSlippageBps);
    event FollowerLeft(address indexed leader, address indexed follower, uint256 capitalReturned);
    event CapitalAdded(address indexed leader, address indexed follower, uint256 amount);

    event CopyTradeOpened(address indexed leader, address indexed follower,
        uint256 leaderPosId, uint256 followerPosId, string asset, bool isLong,
        uint256 collateral, uint256 leverage, uint256 leaderEntryPrice);
    event CopyTradeClosed(address indexed leader, address indexed follower,
        uint256 followerPosId, uint256 pnl, bool isProfit, uint256 fee);
    event CopyTradeSkipped(address indexed leader, address indexed follower,
        uint256 leaderPosId, SkipReason reason);

    event FeesClaimed(address indexed leader, uint256 amount);

    enum SkipReason {
        SLIPPAGE_EXCEEDED,
        INSUFFICIENT_BALANCE,
        LOW_HEALTH_FACTOR,
        INVALID_PRICE,
        BELOW_MINIMUM_SIZE,
        LEADER_NOT_ACTIVE,
        FOLLOWER_NOT_ACTIVE
    }

    // ══════════════════════ ERRORS ══════════════════════

    error NotKeeper();
    error LeaderAlreadyRegistered();
    error LeaderNotRegistered();
    error LeaderNotActive();
    error FeeTooHigh(uint256 feeBps, uint256 maxBps);
    error MaxFollowersReached();
    error AlreadyFollowing();
    error NotFollowing();
    error ZeroAmount();
    error InvalidScaleFactor(uint256 sf);
    error InvalidSlippage(uint256 bps);
    error NoFeesToClaim();
    error HasOpenPositions(uint256 count);

    // ══════════════════════ MODIFIERS ══════════════════════

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    // ══════════════════════ CONSTRUCTOR ══════════════════════

    constructor(address _aUSD, address _perps, address _oracle) Ownable(msg.sender) {
        require(_aUSD   != address(0) && _perps  != address(0) && _oracle != address(0),
                "CopyTrading: zero address");
        aUSD   = IERC20(_aUSD);
        perps  = IAuraPerps(_perps);
        oracle = IMockOracle(_oracle);
        keeper = msg.sender;
    }

    function setKeeper(address _k) external onlyOwner {
        require(_k != address(0), "CopyTrading: zero keeper");
        keeper = _k;
    }

    // ══════════════════════ LEADER FUNCTIONS ══════════════════════

    function registerAsLeader(uint256 performanceFeeBps) external {
        if (leaders[msg.sender].isRegistered) revert LeaderAlreadyRegistered();
        if (performanceFeeBps > MAX_PERFORMANCE_FEE_BPS) revert FeeTooHigh(performanceFeeBps, MAX_PERFORMANCE_FEE_BPS);

        leaders[msg.sender] = LeaderProfile({
            isRegistered: true, isActive: true,
            performanceFeeBps: performanceFeeBps,
            totalFollowers: 0, totalCopiedCapital: 0,
            totalRealizedPnl: 0, isPnlPositive: true,
            tradesExecuted: 0, tradesWon: 0,
            createdAt: block.timestamp
        });
        leaderList.push(msg.sender);
        _leaderIdx[msg.sender] = leaderList.length;
        emit LeaderRegistered(msg.sender, performanceFeeBps);
    }

    function deactivateLeader() external {
        LeaderProfile storage lp = leaders[msg.sender];
        if (!lp.isRegistered) revert LeaderNotRegistered();
        lp.isActive = false;
        emit LeaderDeactivated(msg.sender);
    }

    function reactivateLeader() external {
        LeaderProfile storage lp = leaders[msg.sender];
        if (!lp.isRegistered) revert LeaderNotRegistered();
        lp.isActive = true;
        emit LeaderReactivated(msg.sender);
    }

    // ══════════════════════ FOLLOWER FUNCTIONS ══════════════════════

    function followLeader(
        address leader, uint256 amount,
        uint256 scaleFactor, uint256 maxSlippageBps
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        LeaderProfile storage lp = leaders[leader];
        if (!lp.isRegistered) revert LeaderNotRegistered();
        if (!lp.isActive) revert LeaderNotActive();
        if (lp.totalFollowers >= MAX_FOLLOWERS_PER_LEADER) revert MaxFollowersReached();

        FollowerAllocation storage fa = allocations[leader][msg.sender];
        if (fa.isActive) revert AlreadyFollowing();

        if (scaleFactor < MIN_SCALE_FACTOR || scaleFactor > MAX_SCALE_FACTOR) revert InvalidScaleFactor(scaleFactor);
        uint256 slip = maxSlippageBps == 0 ? DEFAULT_SLIPPAGE_BPS : maxSlippageBps;
        if (slip > 1000) revert InvalidSlippage(slip);

        aUSD.safeTransferFrom(msg.sender, address(this), amount);

        fa.isActive = true;
        fa.capitalDeposited = amount;
        fa.capitalInPositions = 0;
        fa.highWaterMark = amount;
        fa.scaleFactor = scaleFactor;
        fa.maxSlippageBps = slip;
        fa.joinedAt = block.timestamp;

        lp.totalFollowers++;
        lp.totalCopiedCapital += amount;

        _leaderFollowers[leader].push(msg.sender);
        _followerIdx[leader][msg.sender] = _leaderFollowers[leader].length;

        emit FollowerJoined(leader, msg.sender, amount, scaleFactor, slip);
    }

    function addCapital(address leader, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        FollowerAllocation storage fa = allocations[leader][msg.sender];
        if (!fa.isActive) revert NotFollowing();

        aUSD.safeTransferFrom(msg.sender, address(this), amount);
        fa.capitalDeposited += amount;
        if (fa.capitalDeposited > fa.highWaterMark) fa.highWaterMark = fa.capitalDeposited;
        leaders[leader].totalCopiedCapital += amount;
        emit CapitalAdded(leader, msg.sender, amount);
    }

    function unfollowLeader(address leader) external nonReentrant {
        FollowerAllocation storage fa = allocations[leader][msg.sender];
        if (!fa.isActive) revert NotFollowing();

        // Force close all active copied positions for this follower before unfollowing
        uint256[] memory openPositions = _followerOpenPos[leader][msg.sender];
        for (uint256 i = 0; i < openPositions.length; i++) {
            uint256 followerPerpsPositionId = openPositions[i];
            uint256 lPosId = followerPosToLeaderPos[followerPerpsPositionId];
            uint256 idx = followerPosToIndex[followerPerpsPositionId];
            CopyPosition storage cp = copyPositionsByLeader[lPosId][idx];
            if (cp.isOpen) {
                _closeCopyPosition(cp);
            }
        }

        uint256 amount = fa.capitalDeposited;
        _removeFollower(leader, msg.sender);

        fa.isActive = false;
        fa.capitalDeposited = 0;
        fa.capitalInPositions = 0;
        fa.highWaterMark = 0;

        LeaderProfile storage lp = leaders[leader];
        lp.totalCopiedCapital = lp.totalCopiedCapital >= amount ? lp.totalCopiedCapital - amount : 0;
        if (lp.totalFollowers > 0) lp.totalFollowers--;

        if (amount > 0) aUSD.safeTransfer(msg.sender, amount);
        emit FollowerLeft(leader, msg.sender, amount);
    }

    function updateFollowerParams(address leader, uint256 newSF, uint256 newSlip) external {
        FollowerAllocation storage fa = allocations[leader][msg.sender];
        if (!fa.isActive) revert NotFollowing();
        if (newSF < MIN_SCALE_FACTOR || newSF > MAX_SCALE_FACTOR) revert InvalidScaleFactor(newSF);
        if (newSlip > 1000) revert InvalidSlippage(newSlip);
        fa.scaleFactor = newSF;
        fa.maxSlippageBps = newSlip == 0 ? DEFAULT_SLIPPAGE_BPS : newSlip;
    }

    // ══════════════════════ KEEPER: COPY OPEN ══════════════════════

    /**
     * @notice Keeper calls this when a leader opens a position on AuraPerps.
     *
     * @dev Uses AuraPerps.openPosition() (PUBLIC, no router gate):
     *   1. This contract approves AuraPerps to spend followerCollateral
     *   2. Calls perps.openPosition(asset, isLong, collateral, leverage)
     *   3. AuraPerps sets pos.owner = address(this) → we can close later
     *
     * Proportional sizing formula:
     *   riskFraction = leaderCollateral / leaderTotalBalance
     *   followerCollateral = followerAvailable × riskFraction × (scaleFactor / 10000)
     */
    function executeCopyOpen(
        address leader,
        uint256 leaderPositionId,
        string calldata asset,
        bool isLong,
        uint256 leaderCollateral,
        uint256 leaderTotalBalance,
        uint256 leverage,
        uint256 leaderEntryPrice
    ) external onlyKeeper nonReentrant {
        LeaderProfile storage lp = leaders[leader];
        if (!lp.isRegistered || !lp.isActive) return;
        require(leverage > 0 && leverage <= MAX_LEVERAGE, "CopyTrading: invalid leverage");
        require(leaderTotalBalance > 0 && leaderCollateral > 0, "CopyTrading: zero value");

        uint256 currentPrice = oracle.getPrice(asset);
        require(currentPrice > 0, "CopyTrading: invalid oracle price");

        address[] storage followers = _leaderFollowers[leader];

        for (uint256 i = 0; i < followers.length; i++) {
            _processCopyForFollower(
                leader, followers[i], leaderPositionId,
                asset, isLong, leaderCollateral, leaderTotalBalance,
                leverage, leaderEntryPrice, currentPrice
            );
        }
    }

    function _processCopyForFollower(
        address leader, address follower, uint256 leaderPositionId,
        string calldata asset, bool isLong,
        uint256 leaderCollateral, uint256 leaderTotalBalance,
        uint256 leverage, uint256 leaderEntryPrice, uint256 currentPrice
    ) internal {
        FollowerAllocation storage fa = allocations[leader][follower];
        if (!fa.isActive) {
            emit CopyTradeSkipped(leader, follower, leaderPositionId, SkipReason.FOLLOWER_NOT_ACTIVE);
            return;
        }

        // 1. Proportional collateral
        uint256 riskFrac = (leaderCollateral * 1e18) / leaderTotalBalance;
        uint256 avail = fa.capitalDeposited > fa.capitalInPositions
            ? fa.capitalDeposited - fa.capitalInPositions : 0;
        uint256 fCol = (avail * riskFrac * fa.scaleFactor) / (1e18 * SCALE_FACTOR_BASE);

        // 2. Min size
        if (fCol < MIN_COPY_COLLATERAL) {
            emit CopyTradeSkipped(leader, follower, leaderPositionId, SkipReason.BELOW_MINIMUM_SIZE);
            return;
        }

        // 3. Balance
        if (fCol > avail) {
            emit CopyTradeSkipped(leader, follower, leaderPositionId, SkipReason.INSUFFICIENT_BALANCE);
            return;
        }

        // 4. Health (5% min free margin)
        {
            uint256 remaining = avail - fCol;
            if (fa.capitalDeposited > 0 && (remaining * BPS) / fa.capitalDeposited < MIN_MARGIN_BPS) {
                emit CopyTradeSkipped(leader, follower, leaderPositionId, SkipReason.LOW_HEALTH_FACTOR);
                return;
            }
        }

        // 5. Slippage
        {
            uint256 diff = currentPrice > leaderEntryPrice
                ? currentPrice - leaderEntryPrice
                : leaderEntryPrice - currentPrice;
            if ((diff * BPS) / leaderEntryPrice > fa.maxSlippageBps) {
                emit CopyTradeSkipped(leader, follower, leaderPositionId, SkipReason.SLIPPAGE_EXCEEDED);
                return;
            }
        }

        // 6. Execute via PUBLIC openPosition()
        aUSD.approve(address(perps), fCol);
        uint256 fPosId = perps.openPosition(asset, isLong, fCol, leverage);

        // 7. Record
        fa.capitalInPositions += fCol;

        copyPositionsByLeader[leaderPositionId].push(CopyPosition({
            leaderPositionId: leaderPositionId,
            followerPerpsPositionId: fPosId,
            follower: follower,
            leader: leader,
            collateralUsed: fCol,
            isOpen: true,
            openedAt: block.timestamp
        }));

        uint256 cpIdx = copyPositionsByLeader[leaderPositionId].length - 1;
        followerPosToLeaderPos[fPosId] = leaderPositionId;
        followerPosToIndex[fPosId] = cpIdx;

        _followerOpenPos[leader][follower].push(fPosId);
        _openPosIdx[fPosId] = _followerOpenPos[leader][follower].length;

        leaders[leader].tradesExecuted++;

        emit CopyTradeOpened(leader, follower, leaderPositionId, fPosId,
            asset, isLong, fCol, leverage, leaderEntryPrice);
    }

    // ══════════════════════ KEEPER: COPY CLOSE ══════════════════════

    /**
     * @notice Closes all copied positions when the leader closes.
     * @dev Uses AuraPerps.closePosition() — works because pos.owner == address(this).
     */
    function executeCopyClose(uint256 leaderPositionId) external onlyKeeper nonReentrant {
        CopyPosition[] storage copies = copyPositionsByLeader[leaderPositionId];
        for (uint256 i = 0; i < copies.length; i++) {
            if (!copies[i].isOpen) continue;
            _closeCopyPosition(copies[i]);
        }
    }

    /**
     * @notice Emergency close a single copy position.
     */
    function emergencyCloseCopy(uint256 followerPerpsPositionId) external onlyKeeper nonReentrant {
        uint256 lPosId = followerPosToLeaderPos[followerPerpsPositionId];
        uint256 idx = followerPosToIndex[followerPerpsPositionId];
        CopyPosition storage cp = copyPositionsByLeader[lPosId][idx];
        require(cp.isOpen, "CopyTrading: not open");
        _closeCopyPosition(cp);
    }

    function _closeCopyPosition(CopyPosition storage cp) internal {
        // Check if position is still open on AuraPerps
        (,,,,,,, bool isOpen,,,,,,) = perps.positions(cp.followerPerpsPositionId);

        uint256 settlement = 0;
        if (isOpen) {
            uint256 before = aUSD.balanceOf(address(this));
            perps.closePosition(cp.followerPerpsPositionId);
            uint256 after_ = aUSD.balanceOf(address(this));
            settlement = after_ > before ? after_ - before : 0;
        }

        cp.isOpen = false;

        bool isProfit = settlement > cp.collateralUsed;
        uint256 pnl = isProfit
            ? settlement - cp.collateralUsed
            : cp.collateralUsed - settlement;

        _settlePosition(cp, pnl, isProfit);
    }

    // ══════════════════════ INTERNAL: SETTLEMENT ══════════════════════

    function _settlePosition(CopyPosition storage cp, uint256 pnl, bool isProfit) internal {
        FollowerAllocation storage fa = allocations[cp.leader][cp.follower];
        LeaderProfile storage lp = leaders[cp.leader];

        // Release locked collateral
        fa.capitalInPositions = fa.capitalInPositions >= cp.collateralUsed
            ? fa.capitalInPositions - cp.collateralUsed : 0;

        uint256 fee = 0;
        if (isProfit) {
            fa.capitalDeposited += pnl;
            lp.tradesWon++;

            // Performance fee (high-water mark)
            if (fa.capitalDeposited > fa.highWaterMark) {
                uint256 gain = fa.capitalDeposited - fa.highWaterMark;
                fee = (gain * lp.performanceFeeBps) / BPS;
                fa.capitalDeposited -= fee;
                fa.highWaterMark = fa.capitalDeposited;
                pendingFees[cp.leader] += fee;
            }

            // Update leader PnL
            if (lp.isPnlPositive) { lp.totalRealizedPnl += pnl; }
            else if (pnl >= lp.totalRealizedPnl) {
                lp.totalRealizedPnl = pnl - lp.totalRealizedPnl;
                lp.isPnlPositive = true;
            } else { lp.totalRealizedPnl -= pnl; }
        } else {
            fa.capitalDeposited = pnl >= fa.capitalDeposited ? 0 : fa.capitalDeposited - pnl;

            if (!lp.isPnlPositive) { lp.totalRealizedPnl += pnl; }
            else if (pnl >= lp.totalRealizedPnl) {
                lp.totalRealizedPnl = pnl - lp.totalRealizedPnl;
                lp.isPnlPositive = false;
            } else { lp.totalRealizedPnl -= pnl; }
        }

        _removeOpenPos(cp.leader, cp.follower, cp.followerPerpsPositionId);
        emit CopyTradeClosed(cp.leader, cp.follower, cp.followerPerpsPositionId, pnl, isProfit, fee);
    }

    // ══════════════════════ FEE CLAIM ══════════════════════

    function claimFees() external nonReentrant {
        uint256 amount = pendingFees[msg.sender];
        if (amount == 0) revert NoFeesToClaim();
        pendingFees[msg.sender] = 0;
        aUSD.safeTransfer(msg.sender, amount);
        emit FeesClaimed(msg.sender, amount);
    }

    // ══════════════════════ VIEW FUNCTIONS ══════════════════════

    function getLeaderCount() external view returns (uint256) { return leaderList.length; }

    function getLeaderFollowers(address leader) external view returns (address[] memory) {
        return _leaderFollowers[leader];
    }

    function getCopyPositions(uint256 leaderPosId) external view returns (CopyPosition[] memory) {
        return copyPositionsByLeader[leaderPosId];
    }

    function getFollowerOpenPositionCount(address leader, address follower) external view returns (uint256) {
        return _followerOpenPos[leader][follower].length;
    }

    function getFollowerOpenPositions(address leader, address follower) external view returns (uint256[] memory) {
        return _followerOpenPos[leader][follower];
    }

    function getFollowerAvailableBalance(address leader, address follower) external view returns (uint256) {
        FollowerAllocation storage fa = allocations[leader][follower];
        return fa.capitalDeposited > fa.capitalInPositions
            ? fa.capitalDeposited - fa.capitalInPositions : 0;
    }

    function getActiveLeaders(uint256 offset, uint256 limit)
        external view returns (address[] memory addrs, LeaderProfile[] memory profiles)
    {
        uint256 total = leaderList.length;
        uint256 count = 0;
        for (uint256 i = offset; i < total && count < limit; i++) {
            if (leaders[leaderList[i]].isActive) count++;
        }
        addrs = new address[](count);
        profiles = new LeaderProfile[](count);
        uint256 idx = 0;
        for (uint256 i = offset; i < total && idx < count; i++) {
            if (leaders[leaderList[i]].isActive) {
                addrs[idx] = leaderList[i];
                profiles[idx] = leaders[leaderList[i]];
                idx++;
            }
        }
    }

    // ══════════════════════ INTERNAL HELPERS ══════════════════════

    function _removeFollower(address leader, address follower) internal {
        uint256 idx = _followerIdx[leader][follower];
        require(idx > 0, "not in list");
        idx--;
        address[] storage list = _leaderFollowers[leader];
        uint256 last = list.length - 1;
        if (idx != last) {
            list[idx] = list[last];
            _followerIdx[leader][list[idx]] = idx + 1;
        }
        list.pop();
        delete _followerIdx[leader][follower];
    }

    function _removeOpenPos(address leader, address follower, uint256 posId) internal {
        uint256 idx = _openPosIdx[posId];
        if (idx == 0) return;
        idx--;
        uint256[] storage list = _followerOpenPos[leader][follower];
        uint256 last = list.length - 1;
        if (idx != last) {
            list[idx] = list[last];
            _openPosIdx[list[idx]] = idx + 1;
        }
        list.pop();
        delete _openPosIdx[posId];
    }
}
