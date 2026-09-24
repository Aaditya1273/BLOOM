// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SimpleAccount} from "@account-abstraction/contracts/accounts/SimpleAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {Exec} from "@account-abstraction/contracts/utils/Exec.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS, _packValidationData} from
    "@account-abstraction/contracts/core/Helpers.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BloomPolicy} from "./BloomPolicy.sol";

/// @title BloomAccount
/// @notice ERC-4337 smart account (evolved from Aura's AuraAccount / eth-infinitism SimpleAccount) with
///         policy-scoped Bloom Agent session keys.
///
/// - The owner keeps full control (execute / executeBatch / upgrades), directly or via the EntryPoint.
/// - A session key can ONLY call `executeByAgent`, and every call is checked by BloomPolicy before execution:
///   closed (target, selector) set, capped amounts, allowlisted assets, daily cap, validity window.
/// - Session-key UserOperations are accepted by `validateUserOp` only when their callData is `executeByAgent`
///   for that same key; validity bounds are enforced by the EntryPoint through packed validationData.
/// - No delegatecall and no native value on the agent path.
contract BloomAccount is SimpleAccount {
    BloomPolicy public immutable policy;
    uint256 public agentActionNonce;

    event ActionProposed(bytes32 indexed actionId, address indexed agent, address target, bytes4 selector);
    event ActionApproved(bytes32 indexed actionId, uint256 indexed goalId);
    event ActionRejected(bytes32 indexed actionId, uint256 indexed goalId, bytes32 reason);
    event ActionExecuted(bytes32 indexed actionId, uint256 indexed goalId);

    error NotAuthorizedAgent();
    error AllocationLimitExceeded(uint256 goalId);

    constructor(IEntryPoint anEntryPoint, BloomPolicy policy_) SimpleAccount(anEntryPoint) {
        policy = policy_;
    }

    /// @notice Execute one policy-checked action on behalf of the Bloom Agent.
    /// @param agent the session key. Must be msg.sender, or the UserOperation signer when called via EntryPoint.
    /// @return executed false when the policy rejected the action (ActionRejected is emitted, nothing executes).
    function executeByAgent(address agent, address target, bytes calldata data) external returns (bool executed) {
        if (msg.sender != agent && msg.sender != address(entryPoint())) revert NotAuthorizedAgent();

        bytes4 selector = data.length >= 4 ? bytes4(data[:4]) : bytes4(0);
        bytes32 actionId = keccak256(abi.encode(address(this), block.chainid, agentActionNonce++, agent, target, data));
        emit ActionProposed(actionId, agent, target, selector);

        (bool ok, bytes32 reason, uint256 goalId) = policy.authorize(agent, target, 0, data);
        if (!ok) {
            emit ActionRejected(actionId, goalId, reason);
            return false;
        }
        emit ActionApproved(actionId, goalId);

        if (!Exec.call(target, 0, data, gasleft())) Exec.revertWithReturnData();

        if (policy.requiresAllocationCheck(data) && !policy.allocationWithinLimit(address(this), goalId)) {
            revert AllocationLimitExceeded(goalId);
        }
        emit ActionExecuted(actionId, goalId);
        return true;
    }

    function _validateSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
        internal
        view
        override
        returns (uint256)
    {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(userOpHash, userOp.signature);
        if (err != ECDSA.RecoverError.NoError) return SIG_VALIDATION_FAILED;
        if (signer == owner) return SIG_VALIDATION_SUCCESS;

        // Session key: only executeByAgent(signer, ...) is acceptable.
        bytes calldata cd = userOp.callData;
        if (cd.length < 36 || bytes4(cd[:4]) != this.executeByAgent.selector) return SIG_VALIDATION_FAILED;
        if (abi.decode(cd[4:36], (address)) != signer) return SIG_VALIDATION_FAILED;
        (uint256 goalId, uint48 validAfter, uint48 validUntil) = policy.sessionOf(address(this), signer);
        if (goalId == 0) return SIG_VALIDATION_FAILED;
        return _packValidationData(false, validUntil, validAfter);
    }
}
