// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {BloomAccount} from "./BloomAccount.sol";
import {BloomPolicy} from "./BloomPolicy.sol";

/// @title BloomAccountFactory
/// @notice Deterministic (CREATE2) BloomAccount deployment. Evolved from Aura's AuraFactory.
contract BloomAccountFactory {
    BloomAccount public immutable accountImplementation;

    event AccountCreated(address indexed owner, address indexed account, uint256 salt);

    constructor(IEntryPoint entryPoint, BloomPolicy policy) {
        accountImplementation = new BloomAccount(entryPoint, policy);
    }

    /// @notice Returns the existing account if already deployed (idempotent, safe to call from initCode).
    function createAccount(address owner, uint256 salt) external returns (BloomAccount account) {
        address addr = accountAddress(owner, salt);
        if (addr.code.length > 0) return BloomAccount(payable(addr));
        account = BloomAccount(
            payable(
                new ERC1967Proxy{salt: bytes32(salt)}(
                    address(accountImplementation), abi.encodeWithSignature("initialize(address)", owner)
                )
            )
        );
        emit AccountCreated(owner, address(account), salt);
    }

    function accountAddress(address owner, uint256 salt) public view returns (address) {
        return Create2.computeAddress(
            bytes32(salt),
            keccak256(
                abi.encodePacked(
                    type(ERC1967Proxy).creationCode,
                    abi.encode(address(accountImplementation), abi.encodeWithSignature("initialize(address)", owner))
                )
            )
        );
    }
}
