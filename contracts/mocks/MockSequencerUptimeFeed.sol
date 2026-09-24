// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title MockSequencerUptimeFeed — TESTNET MOCK
/// @notice Chainlink L2 Sequencer Uptime Feed semantics (answer 0 = up, 1 = down; startedAt = last status change).
///         Chainlink does not publish an uptime feed for Robinhood Chain, so this mock exists only to demonstrate
///         the engine's sequencer guard on testnet.
contract MockSequencerUptimeFeed is IAggregatorV3, AccessControl {
    bytes32 public constant FEED_ADMIN_ROLE = keccak256("FEED_ADMIN_ROLE");

    uint80 internal _roundId;
    int256 internal _answer;
    uint256 internal _startedAt;

    event SequencerStatusSet(bool down, uint256 startedAt);

    constructor(address admin, uint256 initialStartedAt) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEED_ADMIN_ROLE, admin);
        _roundId = 1;
        _startedAt = initialStartedAt == 0 ? block.timestamp : initialStartedAt;
    }

    function decimals() external pure returns (uint8) {
        return 0;
    }

    /// @param startedAt when the status changed; pass 0 for "now". A past value lets the demo skip the grace period.
    function setStatus(bool down, uint256 startedAt) external onlyRole(FEED_ADMIN_ROLE) {
        _roundId += 1;
        _answer = down ? int256(1) : int256(0);
        _startedAt = startedAt == 0 || startedAt > block.timestamp ? block.timestamp : startedAt;
        emit SequencerStatusSet(down, _startedAt);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _startedAt, block.timestamp, _roundId);
    }
}
