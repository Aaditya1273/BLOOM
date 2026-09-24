// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title aUSD Test Stablecoin
 * @dev Test stablecoin for Aura Perps DEX, featuring a daily faucet.
 */
contract aUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1000 * 10**18;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastFaucetTime;

    constructor() ERC20("Aura USD", "aUSD") {}

    /**
     * @dev Mint 1000 aUSD. (Hackathon setup - no cooldown)
     */
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
    
    /**
     * @dev Mint arbitrary amount. (Hackathon setup)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Burn arbitrary amount. (Hackathon setup)
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
