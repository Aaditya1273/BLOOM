// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuraMMFund
 * @dev Isolated Market Maker Fund for the AI agent.
 * Holds dedicated aUSD capital separate from the main vault,
 * protecting LP depositors from MM risk.
 * The AI agent places strategic limit orders to capture spread.
 */
contract AuraMMFund is Ownable {
    IERC20 public aUSD;
    address public router;
    address public aiAgent;

    uint256 public totalDeposited;
    uint256 public totalProfitRealized;

    event FundDeposited(address indexed from, uint256 amount);
    event FundWithdrawn(address indexed to, uint256 amount);
    event AgentUpdated(address indexed newAgent);

    modifier onlyAgent() {
        require(msg.sender == aiAgent || msg.sender == owner(), "MMFund: not agent");
        _;
    }

    constructor(address _aUSD, address _router) Ownable(msg.sender) {
        aUSD = IERC20(_aUSD);
        router = _router;
    }

    function setAgent(address _agent) external onlyOwner {
        aiAgent = _agent;
        emit AgentUpdated(_agent);
    }

    function setRouter(address _router) external onlyOwner {
        router = _router;
    }

    /// @notice Deposit aUSD into the MM fund
    function deposit(uint256 amount) external {
        require(aUSD.transferFrom(msg.sender, address(this), amount), "MMFund: transfer failed");
        totalDeposited += amount;
        emit FundDeposited(msg.sender, amount);
    }

    /// @notice Withdraw aUSD from the MM fund (owner only)
    function withdraw(uint256 amount) external onlyOwner {
        require(aUSD.transfer(msg.sender, amount), "MMFund: transfer failed");
        emit FundWithdrawn(msg.sender, amount);
    }

    /// @notice Approve router to spend fund's aUSD for placing limit orders
    function approveRouter(uint256 amount) external onlyAgent {
        aUSD.approve(router, amount);
    }

    /// @notice Get current fund balance
    function balance() external view returns (uint256) {
        return aUSD.balanceOf(address(this));
    }
}
