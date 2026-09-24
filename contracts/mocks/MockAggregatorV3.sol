// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title MockAggregatorV3 — TESTNET MOCK ("FeedStub")
/// @notice AggregatorV3Interface-compatible feed for testnet, where Chainlink publishes no Robinhood Chain feeds.
///         Only FEED_ADMIN_ROLE can write. `updateAnswer` is the validated path used by the demo;
///         `setRoundDataUnchecked` exists solely to reproduce invalid-feed scenarios (zero/negative price,
///         incomplete rounds) and is clearly separated.
contract MockAggregatorV3 is IAggregatorV3, AccessControl {
    bytes32 public constant FEED_ADMIN_ROLE = keccak256("FEED_ADMIN_ROLE");

    uint8 public immutable override decimals;
    string public description;

    uint80 internal _roundId;
    int256 internal _answer;
    uint256 internal _startedAt;
    uint256 internal _updatedAt;
    uint80 internal _answeredInRound;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error InvalidAnswer();
    error InvalidTimestamp();

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer, address admin) {
        decimals = decimals_;
        description = description_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEED_ADMIN_ROLE, admin);
        _push(initialAnswer, block.timestamp);
    }

    function updateAnswer(int256 answer) external onlyRole(FEED_ADMIN_ROLE) {
        _push(answer, block.timestamp);
    }

    /// @notice Publish an answer with an explicit past timestamp (used to simulate a stale feed).
    function updateAnswerAt(int256 answer, uint256 updatedAt) external onlyRole(FEED_ADMIN_ROLE) {
        if (updatedAt == 0 || updatedAt > block.timestamp) revert InvalidTimestamp();
        _push(answer, updatedAt);
    }

    /// @notice Scenario-testing escape hatch: writes raw round data without validation.
    function setRoundDataUnchecked(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external onlyRole(FEED_ADMIN_ROLE) {
        (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound) =
            (roundId, answer, startedAt, updatedAt, answeredInRound);
        emit AnswerUpdated(answer, roundId, updatedAt);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    function _push(int256 answer, uint256 updatedAt) internal {
        if (answer <= 0) revert InvalidAnswer();
        _roundId += 1;
        (_answer, _startedAt, _updatedAt, _answeredInRound) = (answer, updatedAt, updatedAt, _roundId);
        emit AnswerUpdated(answer, _roundId, updatedAt);
    }
}
