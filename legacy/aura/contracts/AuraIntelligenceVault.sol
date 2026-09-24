// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./IVaultGuardrail.sol";

/**
 * @title AuraIntelligenceVault
 * @author Aura Protocol — Built for Robinhood Chain (Arbitrum Orbit)
 * @notice ERC-4626 vault where an AI agent manages allocation autonomously,
 *         protected by on-chain Stylus (WASM) guardrails.
 *
 * @dev Defense in Depth:
 *   Layer 1: Solidity — Role checks, whitelist, exposure caps, risk ceiling, pause
 *   Layer 2: Stylus WASM — Deep calldata analysis, behavioral anomaly detection
 *   Layer 3: User Sovereignty — Withdrawals NEVER blocked, even when paused
 */
contract AuraIntelligenceVault is ERC4626, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ══════════════════════ ROLES ══════════════════════
    bytes32 public constant AI_EXECUTOR_ROLE = keccak256("AI_EXECUTOR_ROLE");
    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");

    // ══════════════════════ STATE ══════════════════════
    IVaultGuardrail public stylusGuardrail;
    uint256 public maxProtocolExposureBps; // Default 4000 = 40%
    uint256 public maxRiskScore;           // Default 70
    uint256 public totalDeployed;
    uint256 public strategyNonce;

    mapping(address => uint256) public protocolExposure;
    mapping(address => bool) public whitelistedProtocols;
    mapping(address => mapping(bytes4 => bool)) public approvedSelectors;

    // ══════════════════════ EVENTS ══════════════════════
    event StrategyExecuted(uint256 indexed nonce, address indexed executor, address indexed target, uint256 riskScore, uint256 value, bool success);
    event StrategyRejectedBySolidity(uint256 indexed nonce, address indexed target, string reason);
    event StrategyRejectedByStylus(uint256 indexed nonce, address indexed target, bytes32 reason);
    event GuardrailUpdated(address indexed newGuardrail);
    event ProtocolWhitelisted(address indexed protocol, bool status);
    event SelectorApproved(address indexed protocol, bytes4 indexed selector, bool status);
    event ExposureCapUpdated(uint256 newCapBps);
    event RiskScoreCeilingUpdated(uint256 newCeiling);
    event CapitalDeployed(address indexed protocol, uint256 amount);
    event CapitalWithdrawn(address indexed protocol, uint256 amount);
    event EmergencyRecovery(address indexed token, uint256 amount);

    // ══════════════════════ ERRORS ══════════════════════
    error ProtocolNotWhitelisted(address target);
    error ExposureExceeded(address target, uint256 currentBps, uint256 maxBps);
    error RiskScoreTooHigh(uint256 provided, uint256 maximum);
    error StylusGuardrailRejected(bytes32 reason);
    error StrategyExecutionFailed(bytes returnData);
    error SelectorNotApproved(address target, bytes4 selector);
    error InvalidParameter();

    // ══════════════════════ CONSTRUCTOR ══════════════════════
    constructor(
        IERC20 _asset,
        address _admin,
        address _stylusGuardrail
    ) ERC4626(_asset) ERC20("Aura Intelligence Vault Share", "ivAUSD") {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(STRATEGIST_ROLE, _admin);
        stylusGuardrail = IVaultGuardrail(_stylusGuardrail);
        maxProtocolExposureBps = 4000;
        maxRiskScore = 70;
    }

    // ══════════════════════ CORE: STRATEGY EXECUTION ══════════════════════

    /**
     * @notice Execute an AI-proposed strategy through multi-layer validation.
     * @param target The destination protocol address.
     * @param data The ABI-encoded calldata.
     * @param riskScore Risk score (0-100) from the AI Risk Officer.
     */
    function executeStrategy(
        address target,
        bytes calldata data,
        uint256 riskScore
    ) external nonReentrant whenNotPaused onlyRole(AI_EXECUTOR_ROLE) {
        uint256 currentNonce = strategyNonce++;

        // Layer 1a: Protocol whitelist
        if (!whitelistedProtocols[target]) {
            emit StrategyRejectedBySolidity(currentNonce, target, "PROTOCOL_NOT_WHITELISTED");
            revert ProtocolNotWhitelisted(target);
        }

        // Layer 1b: Function selector check
        if (data.length >= 4) {
            bytes4 selector = bytes4(data[:4]);
            if (!approvedSelectors[target][selector]) {
                emit StrategyRejectedBySolidity(currentNonce, target, "SELECTOR_NOT_APPROVED");
                revert SelectorNotApproved(target, selector);
            }
        }

        // Layer 1c: Risk score ceiling
        if (riskScore > maxRiskScore) {
            emit StrategyRejectedBySolidity(currentNonce, target, "RISK_SCORE_TOO_HIGH");
            revert RiskScoreTooHigh(riskScore, maxRiskScore);
        }

        // Layer 1d: Exposure cap
        uint256 vaultTotal = totalAssets();
        uint256 currentExposureBps = vaultTotal > 0 ? (protocolExposure[target] * 10000) / vaultTotal : 0;
        if (currentExposureBps > maxProtocolExposureBps) {
            emit StrategyRejectedBySolidity(currentNonce, target, "EXPOSURE_EXCEEDED");
            revert ExposureExceeded(target, currentExposureBps, maxProtocolExposureBps);
        }

        // Layer 2: Stylus WASM Guardrail
        if (address(stylusGuardrail) != address(0)) {
            (bool allowed, bytes32 reason) = stylusGuardrail.validateStrategy(
                target, data, riskScore, currentExposureBps, maxProtocolExposureBps, vaultTotal
            );
            if (!allowed) {
                emit StrategyRejectedByStylus(currentNonce, target, reason);
                revert StylusGuardrailRejected(reason);
            }
        }

        // Layer 3: Execute
        (bool success, bytes memory returnData) = target.call(data);
        if (!success) {
            emit StrategyExecuted(currentNonce, msg.sender, target, riskScore, 0, false);
            revert StrategyExecutionFailed(returnData);
        }

        emit StrategyExecuted(currentNonce, msg.sender, target, riskScore, 0, true);
    }

    /**
     * @notice Deploy vault capital to a protocol with exposure tracking.
     */
    function deployCapital(
        address target, uint256 amount, bytes calldata data, uint256 riskScore
    ) external nonReentrant whenNotPaused onlyRole(AI_EXECUTOR_ROLE) {
        uint256 currentNonce = strategyNonce++;
        if (!whitelistedProtocols[target]) revert ProtocolNotWhitelisted(target);
        if (riskScore > maxRiskScore) revert RiskScoreTooHigh(riskScore, maxRiskScore);
        if (data.length >= 4 && !approvedSelectors[target][bytes4(data[:4])]) {
            revert SelectorNotApproved(target, bytes4(data[:4]));
        }

        uint256 vaultTotal = totalAssets();
        uint256 newExposureBps = vaultTotal > 0 ? ((protocolExposure[target] + amount) * 10000) / vaultTotal : 10000;
        if (newExposureBps > maxProtocolExposureBps) revert ExposureExceeded(target, newExposureBps, maxProtocolExposureBps);

        if (address(stylusGuardrail) != address(0)) {
            uint256 curBps = vaultTotal > 0 ? (protocolExposure[target] * 10000) / vaultTotal : 0;
            (bool allowed, bytes32 reason) = stylusGuardrail.validateStrategy(target, data, riskScore, curBps, maxProtocolExposureBps, vaultTotal);
            if (!allowed) revert StylusGuardrailRejected(reason);
        }

        IERC20(asset()).safeIncreaseAllowance(target, amount);
        (bool success, bytes memory returnData) = target.call(data);
        if (!success) revert StrategyExecutionFailed(returnData);

        protocolExposure[target] += amount;
        totalDeployed += amount;
        emit CapitalDeployed(target, amount);
        emit StrategyExecuted(currentNonce, msg.sender, target, riskScore, amount, true);
    }

    /**
     * @notice Withdraw capital from a protocol back to the vault.
     */
    function withdrawCapital(
        address target, uint256 amount, bytes calldata data
    ) external nonReentrant onlyRole(AI_EXECUTOR_ROLE) {
        if (!whitelistedProtocols[target]) revert ProtocolNotWhitelisted(target);
        (bool success, bytes memory returnData) = target.call(data);
        if (!success) revert StrategyExecutionFailed(returnData);

        protocolExposure[target] = protocolExposure[target] >= amount ? protocolExposure[target] - amount : 0;
        totalDeployed = totalDeployed >= amount ? totalDeployed - amount : 0;
        emit CapitalWithdrawn(target, amount);
    }

    // ══════════════════════ VIEW FUNCTIONS ══════════════════════

    function getProtocolExposureBps(address protocol) external view returns (uint256) {
        uint256 total = totalAssets();
        return total > 0 ? (protocolExposure[protocol] * 10000) / total : 0;
    }

    function idleCapital() external view returns (uint256) {
        uint256 total = totalAssets();
        return total > totalDeployed ? total - totalDeployed : 0;
    }

    function utilizationRateBps() external view returns (uint256) {
        uint256 total = totalAssets();
        return total > 0 ? (totalDeployed * 10000) / total : 0;
    }

    // ══════════════════════ ADMIN FUNCTIONS ══════════════════════

    function setStylusGuardrail(address _guardrail) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stylusGuardrail = IVaultGuardrail(_guardrail);
        emit GuardrailUpdated(_guardrail);
    }

    function whitelistProtocol(address protocol, bool status) external onlyRole(STRATEGIST_ROLE) {
        if (protocol == address(0)) revert InvalidParameter();
        whitelistedProtocols[protocol] = status;
        emit ProtocolWhitelisted(protocol, status);
    }

    function approveSelector(address protocol, bytes4 selector, bool status) external onlyRole(STRATEGIST_ROLE) {
        approvedSelectors[protocol][selector] = status;
        emit SelectorApproved(protocol, selector, status);
    }

    function setMaxProtocolExposure(uint256 _maxBps) external onlyRole(STRATEGIST_ROLE) {
        if (_maxBps == 0 || _maxBps > 10000) revert InvalidParameter();
        maxProtocolExposureBps = _maxBps;
        emit ExposureCapUpdated(_maxBps);
    }

    function setMaxRiskScore(uint256 _maxScore) external onlyRole(STRATEGIST_ROLE) {
        if (_maxScore > 100) revert InvalidParameter();
        maxRiskScore = _maxScore;
        emit RiskScoreCeilingUpdated(_maxScore);
    }

    // ══════════════════════ EMERGENCY ══════════════════════

    function pauseVault() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpauseVault() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function emergencyRecover(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == asset()) revert InvalidParameter();
        IERC20(token).safeTransfer(msg.sender, amount);
        emit EmergencyRecovery(token, amount);
    }

    // ══════════════════════ ERC-4626 OVERRIDES ══════════════════════

    /// @dev Total assets = idle balance + deployed capital (true NAV).
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalDeployed;
    }

    /// @dev Withdrawals are NEVER blocked, even when paused. User sovereignty.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 ownerAssets = _convertToAssets(balanceOf(owner), Math.Rounding.Floor);
        uint256 available = IERC20(asset()).balanceOf(address(this));
        return ownerAssets < available ? ownerAssets : available;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 shares = balanceOf(owner);
        uint256 available = IERC20(asset()).balanceOf(address(this));
        uint256 maxShares = _convertToShares(available, Math.Rounding.Floor);
        return shares < maxShares ? shares : maxShares;
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
