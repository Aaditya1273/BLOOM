// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AuraDAO {
    // KYA (Know Your Agent) Registry
    mapping(address => bool) public isAgentKYA;
    
    // Proposals
    struct Proposal {
        uint256 id;
        string title;
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        uint256 endTime;
    }
    
    uint256 public nextProposalId;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    
    event AgentCertified(address indexed agent);
    event ProposalCreated(uint256 id, string title, uint256 endTime);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support);

    function certifyAgent(address agent) external {
        isAgentKYA[agent] = true;
        emit AgentCertified(agent);
    }

    function createProposal(string calldata title, string calldata description, uint256 durationMinutes) external {
        uint256 id = nextProposalId++;
        proposals[id] = Proposal({
            id: id,
            title: title,
            description: description,
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            endTime: block.timestamp + (durationMinutes * 1 minutes)
        });
        emit ProposalCreated(id, title, proposals[id].endTime);
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp < p.endTime, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        hasVoted[proposalId][msg.sender] = true;
        
        if (support) {
            p.forVotes += 1;
        } else {
            p.againstVotes += 1;
        }
        
        emit Voted(proposalId, msg.sender, support);
    }
}
