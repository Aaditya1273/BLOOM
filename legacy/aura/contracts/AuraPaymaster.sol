// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title AuraPaymaster
 * @dev Allows gasless transactions for Aura users by sponsoring their EntryPoint gas costs.
 */
contract AuraPaymaster is BasePaymaster {
    using MessageHashUtils for bytes32;
    using ECDSA for bytes32;

    address public verifier;

    constructor(IEntryPoint _entryPoint, address _verifier) BasePaymaster(_entryPoint) {
        verifier = _verifier;
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) internal view override returns (bytes memory context, uint256 validationData) {
        (userOpHash, maxCost);
        // In a real scenario, we would check a signature from the 'verifier' 
        // to ensure the backend authorized this sponsorship.
        return ("", 0); 
    }
}
