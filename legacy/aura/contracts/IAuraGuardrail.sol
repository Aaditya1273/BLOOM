// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAuraGuardrail {
    /**
     * @dev Checks if a transaction is allowed by the guardrail.
     * @param dest The destination address.
     * @param value The value sent.
     * @param func The call data.
     * @return True if allowed, false otherwise.
     */
    function checkTransaction(address dest, uint256 value, bytes calldata func) external returns (bool);
}
