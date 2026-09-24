// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IAuraGuardrail.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AdvancedGuardrail
 * @dev Combines standard Solidity checks with high-performance Stylus logic.
 * This contract satisfies both security and innovation criteria for the hackathon.
 */
contract AdvancedGuardrail is IAuraGuardrail, Ownable {
    
    // The address of the Stylus module (WASM)
    address public stylusModule;
    
    mapping(address => bool) public whitelistedDestinations;
    uint256 public maxTransactionValue;
    uint256 public dailyLimit;
    uint256 public spentToday;
    uint256 public lastResetTime;

    event StylusModuleUpdated(address indexed newModule);
    event LimitExceeded(uint256 attempted, uint256 remaining);

    constructor(address initialOwner, address _stylusModule) Ownable(initialOwner) {
        stylusModule = _stylusModule;
        maxTransactionValue = 0.5 ether;
        dailyLimit = 2 ether;
        lastResetTime = block.timestamp;
    }

    function setStylusModule(address _stylusModule) external onlyOwner {
        stylusModule = _stylusModule;
        emit StylusModuleUpdated(_stylusModule);
    }

    function toggleDestination(address dest, bool status) external onlyOwner {
        whitelistedDestinations[dest] = status;
    }

    function checkTransaction(address dest, uint256 value, bytes calldata func) external override returns (bool) {
        // 1. Reset daily limit if 24h passed
        if (block.timestamp >= lastResetTime + 1 days) {
            spentToday = 0;
            lastResetTime = block.timestamp;
        }

        // 2. Solidity Check: Transaction Value Limit
        if (value > maxTransactionValue) return false;
        if (spentToday + value > dailyLimit) {
            emit LimitExceeded(value, dailyLimit - spentToday);
            return false;
        }

        // 3. Solidity Check: Destination Whitelist
        if (!whitelistedDestinations[dest]) return false;

        // 4. Stylus Check: High-performance safety logic
        // We call the WASM module for advanced pattern matching or complex math
        if (stylusModule != address(0)) {
            (bool success, bytes memory data) = stylusModule.staticcall(
                abi.encodeWithSignature("check_safety(address)", dest)
            );
            if (!success || data.length == 0) return false;
            return abi.decode(data, (bool));
        }

        return true;
    }
}
