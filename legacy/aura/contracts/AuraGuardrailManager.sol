// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IAuraGuardrail.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AuraGuardrailManager is IAuraGuardrail, Ownable {
    mapping(address => bool) public whitelistedDestinations;
    mapping(address => mapping(bytes4 => bool)) public whitelistedSelectors;
    
    uint256 public maxTransactionValue;

    event DestinationToggled(address indexed dest, bool status);
    event SelectorToggled(address indexed dest, bytes4 indexed selector, bool status);
    event MaxValueUpdated(uint256 newValue);

    constructor(address initialOwner) Ownable(initialOwner) {
        maxTransactionValue = 1 ether; // Default limit
    }

    function toggleDestination(address dest, bool status) external onlyOwner {
        whitelistedDestinations[dest] = status;
        emit DestinationToggled(dest, status);
    }

    function toggleSelector(address dest, bytes4 selector, bool status) external onlyOwner {
        whitelistedSelectors[dest][selector] = status;
        emit SelectorToggled(dest, selector, status);
    }

    function setMaxTransactionValue(uint256 newValue) external onlyOwner {
        maxTransactionValue = newValue;
        emit MaxValueUpdated(newValue);
    }

    function checkTransaction(address dest, uint256 value, bytes calldata func) external view override returns (bool) {
        // 1. Check value limit
        if (value > maxTransactionValue) return false;

        // 2. Check destination
        if (!whitelistedDestinations[dest]) return false;

        // 3. Check selector if data is provided
        if (func.length >= 4) {
            bytes4 selector = bytes4(func[:4]);
            if (!whitelistedSelectors[dest][selector]) return false;
        }

        return true;
    }
}
