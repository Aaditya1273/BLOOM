// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../IVaultGuardrail.sol";

/**
 * @title MockVaultGuardrail
 * @dev Mock implementation of the Stylus guardrail for testing.
 *      Can be configured to approve or reject all strategies.
 */
contract MockVaultGuardrail is IVaultGuardrail {
    bool public rejectAll;
    bytes32 public rejectionReason;

    constructor() {
        rejectAll = false;
        rejectionReason = bytes32(uint256(0x04)); // EXCESSIVE_SLIPPAGE
    }

    function setRejectAll(bool _reject) external {
        rejectAll = _reject;
    }

    function setRejectionReason(bytes32 _reason) external {
        rejectionReason = _reason;
    }

    function validateStrategy(
        address,
        bytes calldata,
        uint256,
        uint256,
        uint256,
        uint256
    ) external view override returns (bool allowed, bytes32 reason) {
        if (rejectAll) {
            return (false, rejectionReason);
        }
        return (true, bytes32(0));
    }
}
