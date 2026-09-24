// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice ABI shared by the Stylus BloomRiskEngine (production) and BloomRiskEngineEVM (reference / local tests).
interface IRiskEngine {
    /// @dev Numeric values are part of the ABI and MUST match the Stylus implementation.
    enum RiskState {
        NORMAL, //             0
        HALTED, //             1
        STALE, //              2
        DEVIATION, //          3
        CORP_ACTION_PAUSED, // 4
        SEQUENCER_DOWN, //     5
        INVALID_PRICE, //      6
        UNSUPPORTED //         7
    }

    /// @notice Live (non-cached) risk evaluation for `asset`.
    /// @return state             current risk state
    /// @return maxLtvBps         configured max LTV when NORMAL, otherwise 0
    /// @return borrowingAllowed  true only when NORMAL
    /// @return liquidationAllowed true only when NORMAL (protected mode otherwise)
    /// @return price             oracle price normalised to 1e18 USD, 0 when the price cannot be trusted
    /// @return updatedAt         oracle updatedAt of that price, 0 when untrusted
    function getRisk(address asset)
        external
        view
        returns (
            uint8 state,
            uint16 maxLtvBps,
            bool borrowingAllowed,
            bool liquidationAllowed,
            uint256 price,
            uint256 updatedAt
        );

    /// @notice Recompute and persist the state for `asset`, emitting events on transitions. Permissionless.
    function refresh(address asset) external returns (uint8 state);
}
