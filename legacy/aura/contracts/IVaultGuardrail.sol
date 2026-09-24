// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVaultGuardrail
 * @author Aura Protocol
 * @notice Interface for the Arbitrum Stylus (WASM) guardrail module.
 * @dev This interface is implemented by a Rust contract compiled to WASM via Arbitrum Stylus.
 *      It performs deep, gas-efficient validation of AI-proposed strategies that would be
 *      prohibitively expensive in pure Solidity (calldata parsing, behavioral analysis, etc.).
 *
 *      The guardrail acts as the last line of defense: even if the AI agent is compromised,
 *      the on-chain WASM module will reject any transaction that violates the safety invariants.
 */
interface IVaultGuardrail {
    /**
     * @notice Validates an AI-proposed strategy before execution.
     * @param target The destination protocol address.
     * @param data The encoded calldata to be sent to the target.
     * @param riskScore The risk score (0-100) computed by the AI Risk Officer agent.
     * @param currentExposureBps Current exposure to this target protocol, in basis points (0-10000).
     * @param maxExposureBps Maximum allowed exposure per protocol, in basis points.
     * @param vaultTotalAssets Total assets currently held by the vault (in underlying token units).
     * @return allowed True if the strategy passes all guardrail checks.
     * @return reason A bytes32 code indicating the validation result or rejection reason.
     *
     * Reason Codes:
     *   0x00 = APPROVED
     *   0x01 = REJECTED_DESTINATION_NOT_WHITELISTED
     *   0x02 = REJECTED_EXPOSURE_EXCEEDED
     *   0x03 = REJECTED_RISK_SCORE_TOO_HIGH
     *   0x04 = REJECTED_EXCESSIVE_SLIPPAGE
     *   0x05 = REJECTED_ANOMALOUS_TRANSACTION_SIZE
     *   0x06 = REJECTED_INVALID_SELECTOR
     */
    function validateStrategy(
        address target,
        bytes calldata data,
        uint256 riskScore,
        uint256 currentExposureBps,
        uint256 maxExposureBps,
        uint256 vaultTotalAssets
    ) external view returns (bool allowed, bytes32 reason);
}
