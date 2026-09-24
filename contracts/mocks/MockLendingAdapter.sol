// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ILendingAdapter} from "../interfaces/ILendingAdapter.sol";

/// @title MockLendingAdapter — TESTNET MOCK
/// @notice Deterministic lending stand-in. Yield accrues linearly at `aprBps` but is capped by USDG actually held,
///         so it can never report value it cannot pay. Yield is funded explicitly by a sponsor (`fundYield`).
///         Mainnet would use a production adapter (e.g. Morpho Blue) only once its integration is verified.
contract MockLendingAdapter is ILendingAdapter, Ownable {
    using SafeERC20 for IERC20;

    uint256 internal constant YEAR = 365 days;

    address public immutable override asset;
    address public immutable override vault;
    uint16 public aprBps;

    uint256 public principal;
    uint256 public accrued;
    uint256 public lastAccrual;

    event Supplied(uint256 amount);
    event Withdrawn(uint256 amount);
    event YieldFunded(address indexed from, uint256 amount);
    event AprUpdated(uint16 aprBps);

    error OnlyVault();
    error AprTooHigh();

    constructor(address asset_, address vault_, uint16 aprBps_, address owner_) Ownable(owner_) {
        if (aprBps_ > 2000) revert AprTooHigh();
        asset = asset_;
        vault = vault_;
        aprBps = aprBps_;
        lastAccrual = block.timestamp;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    function setApr(uint16 aprBps_) external onlyOwner {
        if (aprBps_ > 2000) revert AprTooHigh();
        _accrue();
        aprBps = aprBps_;
        emit AprUpdated(aprBps_);
    }

    function fundYield(uint256 amount) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        emit YieldFunded(msg.sender, amount);
    }

    function totalAssets() public view returns (uint256) {
        uint256 owed = principal + accrued + _pending();
        uint256 bal = IERC20(asset).balanceOf(address(this));
        return owed < bal ? owed : bal;
    }

    function supply(uint256 amount) external onlyVault {
        _accrue();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        principal += amount;
        emit Supplied(amount);
    }

    function withdraw(uint256 amount) external onlyVault returns (uint256 out) {
        _accrue();
        uint256 available = totalAssets();
        out = amount < available ? amount : available;
        // consume accrued yield first, then principal
        if (out <= accrued) {
            accrued -= out;
        } else {
            uint256 fromPrincipal = out - accrued;
            accrued = 0;
            principal = fromPrincipal < principal ? principal - fromPrincipal : 0;
        }
        IERC20(asset).safeTransfer(vault, out);
        emit Withdrawn(out);
    }

    function _pending() internal view returns (uint256) {
        return principal * aprBps * (block.timestamp - lastAccrual) / (10_000 * YEAR);
    }

    function _accrue() internal {
        accrued += _pending();
        lastAccrual = block.timestamp;
    }
}
