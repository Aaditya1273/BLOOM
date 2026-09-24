// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Strategy adapter a BloomVault may allocate idle USDG to.
/// @dev Only the vault that owns the adapter may move funds. Adapters must never hold arbitrary call surfaces.
interface ILendingAdapter {
    function asset() external view returns (address);

    function vault() external view returns (address);

    /// @notice USDG value attributable to the vault (principal + accrued yield).
    function totalAssets() external view returns (uint256);

    /// @notice Pull `amount` USDG from the vault and supply it.
    function supply(uint256 amount) external;

    /// @notice Withdraw `amount` USDG back to the vault. Returns the amount actually returned.
    function withdraw(uint256 amount) external returns (uint256);
}
