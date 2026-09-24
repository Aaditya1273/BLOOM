// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AuraAuditTrail
 * @author Aura Protocol
 * @notice On-chain audit trail for AI agent reasoning. Before every execution,
 *         the agent records a hash of its reasoning (executor + risk auditor +
 *         macro analysis) so that the decision process is verifiable on-chain.
 *
 *         Each record can include an AI Confidence Score (0-100) emitted by
 *         the Risk Auditor. The score reflects how confident the agent
 *         committee is in the safety + correctness of the proposed trade.
 *         Users see this score before signing — a first-of-its-kind on-chain
 *         AI confidence marker.
 */
contract AuraAuditTrail {
    error InvalidConfidenceScore();

    /// @dev Original event — kept for backward compatibility.
    event ReasoningRecorded(
        address indexed agent,
        address indexed user,
        bytes32 reasoningHash,
        uint256 timestamp,
        string action
    );

    /// @dev Extended event with AI Confidence Score (0-100).
    event ReasoningRecordedWithScore(
        address indexed agent,
        address indexed user,
        bytes32 reasoningHash,
        uint256 timestamp,
        string action,
        uint8 confidenceScore
    );

    /// @notice Latest confidence score recorded for a (agent, user) pair.
    ///         Lets the frontend read the most recent score without scanning
    ///         events.
    mapping(address => mapping(address => uint8)) public lastConfidenceScore;

    /// @notice Total records emitted (for stats / dashboards).
    uint256 public totalRecords;

    /// @notice Record the hash of the AI committee's reasoning before execution.
    /// @param user The user whose trade is being executed.
    /// @param reasoningHash keccak256 of the JSON-serialized audit + macro analysis.
    /// @param action Short description (e.g. "SWAP ETH→AMZN" or "LIMIT_ORDER BTC 10x").
    function recordReasoning(
        address user,
        bytes32 reasoningHash,
        string calldata action
    ) external {
        totalRecords += 1;
        emit ReasoningRecorded(msg.sender, user, reasoningHash, block.timestamp, action);
    }

    /// @notice Record reasoning with an AI Confidence Score (0-100).
    /// @param user The user whose trade is being executed.
    /// @param reasoningHash keccak256 of the JSON-serialized audit + macro analysis.
    /// @param action Short description.
    /// @param confidenceScore Risk Auditor's confidence (0-100) in the proposed trade.
    function recordReasoningWithScore(
        address user,
        bytes32 reasoningHash,
        string calldata action,
        uint8 confidenceScore
    ) external {
        if (confidenceScore > 100) revert InvalidConfidenceScore();

        lastConfidenceScore[msg.sender][user] = confidenceScore;
        totalRecords += 1;

        // Accumulate agent reputation
        agentReputation[msg.sender].totalTrades += 1;
        agentReputation[msg.sender].cumulativeScore += confidenceScore;

        // Both events fire — old indexers keep working, new ones can read the score.
        emit ReasoningRecorded(msg.sender, user, reasoningHash, block.timestamp, action);
        emit ReasoningRecordedWithScore(
            msg.sender, user, reasoningHash, block.timestamp, action, confidenceScore
        );
    }

    /// @notice Read the latest confidence score for (agent, user). Returns 0
    ///         if no score has been recorded yet.
    function getLastConfidenceScore(address agent, address user) external view returns (uint8) {
        return lastConfidenceScore[agent][user];
    }

    // ═══════════════════════════════════════════════════════════
    //              ON-CHAIN AGENT REPUTATION
    // ═══════════════════════════════════════════════════════════

    struct Reputation {
        uint256 totalTrades;
        uint256 cumulativeScore;  // sum of all confidence scores
    }

    /// @notice Cumulative reputation per agent address.
    mapping(address => Reputation) public agentReputation;

    /// @notice Get the agent's average confidence score (0-100) and trade count.
    function getAgentReputation(address agent) external view returns (uint256 trades, uint256 avgScore) {
        Reputation memory r = agentReputation[agent];
        trades = r.totalTrades;
        avgScore = r.totalTrades > 0 ? r.cumulativeScore / r.totalTrades : 0;
    }
}
