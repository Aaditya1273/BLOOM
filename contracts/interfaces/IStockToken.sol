// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Corporate-action surface of a Robinhood Stock Token as consumed by Bloom.
/// @dev Bloom only reads these values. It never rewrites raw token balances.
interface IStockToken is IERC20Metadata {
    /// @return Current UI multiplier, 1e18 = 1.0 (economic units per raw token unit).
    function uiMultiplier() external view returns (uint256);

    /// @return True while the issuer pauses the oracle to process a corporate action.
    function oraclePaused() external view returns (bool);
}
