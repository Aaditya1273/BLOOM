// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRiskEngine} from "./interfaces/IRiskEngine.sol";
import {ILendingAdapter} from "./interfaces/ILendingAdapter.sol";
import {IBloomAssetRegistry} from "./interfaces/IBloomAssetRegistry.sol";

/// @title BloomVault
/// @notice USDG savings vault (ERC-4626) with Stock-Token-collateralised USDG borrowing gated by the Bloom risk engine.
///
///  - Savers deposit USDG and receive bUSDG shares. Idle USDG may be allocated to ONE allowlisted lending adapter.
///  - Borrowers post registered Robinhood Stock Tokens as collateral and borrow USDG up to the risk engine's max LTV.
///  - Every borrow, collateral withdrawal (with debt) and liquidation asks the risk engine first. Any collateral asset
///    outside NORMAL state => max LTV 0 => borrowing blocked and liquidations paused (protected mode).
///
/// Security notes:
///  - No arbitrary external calls: the only external targets are the asset, registered collateral tokens, the
///    risk engine and the single adapter whose `asset()`/`vault()` are verified. No delegatecall.
///  - ERC-4626 inflation/donation attacks are mitigated with a 6-decimal virtual share offset (see tests).
///  - Fee-on-transfer / rebasing tokens are rejected by balance-delta checks.
///  - Prototype simplification: borrowing is interest-free (documented in SECURITY.md); USDG is valued at $1.
contract BloomVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");

    uint256 internal constant BPS = 10_000;
    /// @notice Liquidation threshold = engine max LTV + buffer.
    uint256 public constant LIQUIDATION_BUFFER_BPS = 1_500;
    uint256 public constant LIQUIDATION_BONUS_BPS = 500;
    uint256 public constant CLOSE_FACTOR_BPS = 5_000;
    uint256 public constant MAX_COLLATERAL_ASSETS = 8;

    IBloomAssetRegistry public immutable registry;
    /// @dev Scales a USDG amount to 1e18 USD (USDG is valued at $1).
    uint256 internal immutable _usdScale;
    IRiskEngine public riskEngine;
    ILendingAdapter public adapter;

    uint256 public totalDebt;
    mapping(address => uint256) public debtOf;
    mapping(address => mapping(address => uint256)) public collateralOf;
    mapping(address => address[]) internal _collateralAssets;

    // ─── events ───
    event CollateralDeposited(address indexed user, address indexed token, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed token, uint256 amount);
    event BorrowApproved(address indexed user, uint256 amount, uint256 newDebt);
    event BorrowBlocked(address indexed user, uint256 amount, address indexed asset, uint8 riskState, bytes32 reason);
    event Repaid(address indexed payer, address indexed user, uint256 amount, uint256 newDebt);
    event Liquidated(
        address indexed liquidator, address indexed user, address indexed token, uint256 repaid, uint256 seized
    );
    event BadDebtWrittenOff(address indexed user, uint256 amount);
    event PolicyChanged(bytes32 indexed what, address value);
    event EmergencyPaused(address indexed by);
    event Allocated(uint256 amount);
    event Recalled(uint256 requested, uint256 received);

    // ─── errors ───
    error ZeroAmount();
    error ZeroAddress();
    error NotStockToken(address token);
    error TooManyCollateralAssets();
    error InsufficientCollateral();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error Unhealthy();
    error NotLiquidatable();
    error LiquidationPaused(address asset, uint8 riskState);
    error ExceedsCloseFactor(uint256 maxRepay);
    error TransferAmountMismatch(uint256 expected, uint256 received);
    error BadAdapter();
    error AdapterNotEmpty();
    error HasCollateral();

    bytes32 internal constant REASON_RISK_STATE = "RISK_STATE";
    bytes32 internal constant REASON_LTV = "LTV_EXCEEDED";
    bytes32 internal constant REASON_NO_COLLATERAL = "NO_COLLATERAL";
    bytes32 internal constant REASON_LIQUIDITY = "INSUFFICIENT_LIQUIDITY";

    constructor(IERC20 usdg, IBloomAssetRegistry registry_, IRiskEngine riskEngine_, address admin)
        ERC20("Bloom Savings USDG", "bUSDG")
        ERC4626(usdg)
    {
        if (address(registry_) == address(0) || address(riskEngine_) == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        // the vault asset must be the registry's canonical stable asset
        registry_.requireSupported(address(usdg), IBloomAssetRegistry.AssetKind.STABLE);
        uint8 dec = IERC20Metadata(address(usdg)).decimals();
        if (dec > 18) revert BadAdapter();
        _usdScale = 10 ** (18 - dec);
        registry = registry_;
        riskEngine = riskEngine_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
        _grantRole(STRATEGIST_ROLE, admin);
    }

    // ═══════════════════════════ admin ═══════════════════════════

    function setRiskEngine(IRiskEngine engine) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(engine) == address(0)) revert ZeroAddress();
        riskEngine = engine;
        emit PolicyChanged("RISK_ENGINE", address(engine));
    }

    /// @notice Replace the lending adapter. The current adapter must be fully recalled first.
    function setAdapter(ILendingAdapter newAdapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(adapter) != address(0) && adapter.totalAssets() != 0) revert AdapterNotEmpty();
        if (address(newAdapter) != address(0)) {
            if (newAdapter.asset() != asset() || newAdapter.vault() != address(this)) revert BadAdapter();
        }
        adapter = newAdapter;
        emit PolicyChanged("ADAPTER", address(newAdapter));
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
        emit EmergencyPaused(msg.sender);
    }

    /// @notice Only governance (not the guardian) can unpause.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function allocate(uint256 amount) external onlyRole(STRATEGIST_ROLE) nonReentrant whenNotPaused {
        if (address(adapter) == address(0)) revert BadAdapter();
        if (amount == 0) revert ZeroAmount();
        IERC20(asset()).forceApprove(address(adapter), amount);
        adapter.supply(amount);
        IERC20(asset()).forceApprove(address(adapter), 0);
        emit Allocated(amount);
    }

    function recall(uint256 amount) external onlyRole(STRATEGIST_ROLE) nonReentrant {
        uint256 got = _recall(amount);
        emit Recalled(amount, got);
    }

    /// @notice Recognise unrecoverable debt of a fully liquidated account (loss is shared by savers).
    function writeOffBadDebt(address user) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (_collateralAssets[user].length != 0) revert HasCollateral();
        uint256 d = debtOf[user];
        debtOf[user] = 0;
        totalDebt -= d;
        emit BadDebtWrittenOff(user, d);
    }

    // ═══════════════════════════ ERC-4626 ═══════════════════════════

    /// @dev Virtual shares/assets offset (OpenZeppelin mitigation) against first-depositor inflation attacks.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function totalAssets() public view override returns (uint256) {
        return _idle() + _adapterAssets() + totalDebt;
    }

    /// @notice USDG that can leave the vault right now (idle + adapter), excluding outstanding loans.
    function availableLiquidity() public view returns (uint256) {
        return _idle() + _adapterAssets();
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxMint(receiver);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 own = super.maxWithdraw(owner);
        uint256 liq = availableLiquidity();
        return own < liq ? own : liq;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 own = super.maxRedeem(owner);
        uint256 liqShares = _convertToShares(availableLiquidity(), Math.Rounding.Floor);
        return own < liqShares ? own : liqShares;
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant whenNotPaused returns (uint256) {
        if (assets == 0) revert ZeroAmount();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant whenNotPaused returns (uint256) {
        if (shares == 0) revert ZeroAmount();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        if (assets == 0) revert ZeroAmount();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        if (shares == 0) revert ZeroAmount();
        return super.redeem(shares, receiver, owner);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        uint256 before = _idle();
        IERC20(asset()).safeTransferFrom(caller, address(this), assets);
        uint256 received = _idle() - before;
        if (received != assets) revert TransferAmountMismatch(assets, received);
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        if (caller != owner) _spendAllowance(owner, caller, shares);
        _burn(owner, shares);
        _ensureIdle(assets);
        IERC20(asset()).safeTransfer(receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // ═══════════════════════════ collateral & borrowing ═══════════════════════════

    function depositCollateral(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        registry.requireSupported(token, IBloomAssetRegistry.AssetKind.STOCK_TOKEN);
        if (collateralOf[msg.sender][token] == 0) {
            if (_collateralAssets[msg.sender].length >= MAX_COLLATERAL_ASSETS) revert TooManyCollateralAssets();
            _collateralAssets[msg.sender].push(token);
        }
        collateralOf[msg.sender][token] += amount;
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        if (received != amount) revert TransferAmountMismatch(amount, received);
        emit CollateralDeposited(msg.sender, token, amount);
    }

    /// @notice Withdraw collateral. With outstanding debt this requires every collateral asset to be NORMAL and the
    ///         position to stay within max LTV. Debt-free users can always withdraw (even while paused).
    function withdrawCollateral(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = collateralOf[msg.sender][token];
        if (amount > bal) revert InsufficientCollateral();
        collateralOf[msg.sender][token] = bal - amount;
        if (bal == amount) _removeCollateralAsset(msg.sender, token);

        if (debtOf[msg.sender] != 0) {
            _requireNotPaused();
            (bool ok,,, uint256 capacity) = _borrowCapacity(msg.sender);
            if (!ok || _debtValue(debtOf[msg.sender]) > capacity) revert Unhealthy();
        }
        IERC20(token).safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, token, amount);
    }

    /// @notice Borrow USDG against collateral. Risk-blocked or over-LTV requests do NOT revert: they emit
    ///         BorrowBlocked and return false so the rejection is observable onchain.
    function borrow(uint256 amount) external nonReentrant whenNotPaused returns (bool) {
        if (amount == 0) revert ZeroAmount();
        (bool ok, address blockedAsset, uint8 state, uint256 capacity) = _borrowCapacity(msg.sender);
        if (_collateralAssets[msg.sender].length == 0) {
            emit BorrowBlocked(msg.sender, amount, address(0), 0, REASON_NO_COLLATERAL);
            return false;
        }
        if (!ok) {
            emit BorrowBlocked(msg.sender, amount, blockedAsset, state, REASON_RISK_STATE);
            return false;
        }
        uint256 newDebt = debtOf[msg.sender] + amount;
        if (_debtValue(newDebt) > capacity) {
            emit BorrowBlocked(msg.sender, amount, address(0), 0, REASON_LTV);
            return false;
        }
        if (amount > availableLiquidity()) {
            emit BorrowBlocked(msg.sender, amount, address(0), 0, REASON_LIQUIDITY);
            return false;
        }
        debtOf[msg.sender] = newDebt;
        totalDebt += amount;
        _ensureIdle(amount);
        IERC20(asset()).safeTransfer(msg.sender, amount);
        emit BorrowApproved(msg.sender, amount, newDebt);
        return true;
    }

    /// @notice Repay debt for `user`. Always allowed, including while paused or in protected mode.
    function repay(address user, uint256 amount) external nonReentrant returns (uint256 repaid) {
        uint256 d = debtOf[user];
        repaid = amount < d ? amount : d;
        if (repaid == 0) revert ZeroAmount();
        debtOf[user] = d - repaid;
        totalDebt -= repaid;
        uint256 before = _idle();
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), repaid);
        uint256 received = _idle() - before;
        if (received != repaid) revert TransferAmountMismatch(repaid, received);
        emit Repaid(msg.sender, user, repaid, d - repaid);
    }

    /// @notice Liquidate an unhealthy position. Paused whenever any of the user's collateral assets is outside
    ///         NORMAL risk state (halts, stale prices, corporate actions, sequencer downtime => protected mode).
    function liquidate(address user, address token, uint256 repayAmount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 seized)
    {
        if (repayAmount == 0) revert ZeroAmount();
        uint256 d = debtOf[user];
        (uint256 liqValue, uint256 tokenPrice, uint8 tokenDecimals) = _liquidationValue(user, token);
        if (_debtValue(d) <= liqValue) revert NotLiquidatable();

        uint256 maxRepay = d * CLOSE_FACTOR_BPS / BPS;
        if (maxRepay == 0) maxRepay = d;
        if (repayAmount > maxRepay) revert ExceedsCloseFactor(maxRepay);

        // seize = repay value * (1 + bonus) / price, capped to the user's balance of `token`
        uint256 seizeValue = _debtValue(repayAmount) * (BPS + LIQUIDATION_BONUS_BPS) / BPS;
        seized = seizeValue * (10 ** tokenDecimals) / tokenPrice;
        uint256 bal = collateralOf[user][token];
        if (seized > bal) seized = bal;
        if (seized == 0) revert InsufficientCollateral();

        debtOf[user] = d - repayAmount;
        totalDebt -= repayAmount;
        collateralOf[user][token] = bal - seized;
        if (bal == seized) _removeCollateralAsset(user, token);

        uint256 before = _idle();
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), repayAmount);
        uint256 received = _idle() - before;
        if (received != repayAmount) revert TransferAmountMismatch(repayAmount, received);
        IERC20(token).safeTransfer(msg.sender, seized);
        emit Liquidated(msg.sender, user, token, repayAmount, seized);
    }

    // ═══════════════════════════ views ═══════════════════════════

    function collateralAssetsOf(address user) external view returns (address[] memory) {
        return _collateralAssets[user];
    }

    /// @return allowed        true if every collateral asset is borrowable (NORMAL)
    /// @return blockedAsset   first asset outside NORMAL (if any)
    /// @return blockedState   its risk state
    /// @return capacityUsd    borrow capacity in 1e18 USD
    /// @return debtUsd        current debt in 1e18 USD
    function accountHealth(address user)
        external
        view
        returns (bool allowed, address blockedAsset, uint8 blockedState, uint256 capacityUsd, uint256 debtUsd)
    {
        (allowed, blockedAsset, blockedState, capacityUsd) = _borrowCapacity(user);
        debtUsd = _debtValue(debtOf[user]);
    }

    // ═══════════════════════════ internals ═══════════════════════════

    function _idle() internal view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function _adapterAssets() internal view returns (uint256) {
        return address(adapter) == address(0) ? 0 : adapter.totalAssets();
    }

    function _debtValue(uint256 usdgAmount) internal view returns (uint256) {
        return usdgAmount * _usdScale;
    }

    function _collateralValue(uint256 amount, uint256 price, uint8 tokenDecimals) internal pure returns (uint256) {
        return amount * price / (10 ** tokenDecimals);
    }

    function _borrowCapacity(address user)
        internal
        view
        returns (bool allowed, address blockedAsset, uint8 blockedState, uint256 capacity)
    {
        allowed = true;
        address[] storage list = _collateralAssets[user];
        for (uint256 i; i < list.length; ++i) {
            address token = list[i];
            (uint8 state, uint16 maxLtvBps, bool borrowingAllowed,, uint256 price,) = riskEngine.getRisk(token);
            if (!borrowingAllowed || price == 0) {
                if (allowed) (allowed, blockedAsset, blockedState) = (false, token, state);
                continue;
            }
            uint8 dec = registry.getAsset(token).decimals;
            capacity += _collateralValue(collateralOf[user][token], price, dec) * maxLtvBps / BPS;
        }
        if (!allowed) capacity = 0;
    }

    /// @dev Liquidation-threshold-weighted collateral value; reverts (protected mode) if any asset is not NORMAL.
    function _liquidationValue(address user, address seizeToken)
        internal
        view
        returns (uint256 value, uint256 seizePrice, uint8 seizeDecimals)
    {
        address[] storage list = _collateralAssets[user];
        bool found;
        for (uint256 i; i < list.length; ++i) {
            address token = list[i];
            (uint8 state, uint16 maxLtvBps,, bool liquidationAllowed, uint256 price,) = riskEngine.getRisk(token);
            if (!liquidationAllowed || price == 0) revert LiquidationPaused(token, state);
            uint8 dec = registry.getAsset(token).decimals;
            uint256 threshold = maxLtvBps + LIQUIDATION_BUFFER_BPS;
            if (threshold > 9_500) threshold = 9_500;
            value += _collateralValue(collateralOf[user][token], price, dec) * threshold / BPS;
            if (token == seizeToken) (found, seizePrice, seizeDecimals) = (true, price, dec);
        }
        if (!found) revert InsufficientCollateral();
    }

    function _ensureIdle(uint256 amount) internal {
        uint256 idle = _idle();
        if (idle >= amount) return;
        _recall(amount - idle);
        idle = _idle();
        if (idle < amount) revert InsufficientLiquidity(amount, idle);
    }

    function _recall(uint256 amount) internal returns (uint256 received) {
        if (address(adapter) == address(0) || amount == 0) return 0;
        uint256 before = _idle();
        adapter.withdraw(amount);
        received = _idle() - before;
    }

    function _removeCollateralAsset(address user, address token) internal {
        address[] storage list = _collateralAssets[user];
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == token) {
                list[i] = list[list.length - 1];
                list.pop();
                return;
            }
        }
    }
}
