// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAuraVault {
    function deposit(uint256 assets, address receiver) external returns (uint256);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256);
}

/// @title ReentrantAttacker
/// @notice Attempts reentrancy on AuraVault withdraw by re-entering during token transfer
contract ReentrantAttacker {
    IAuraVault public vault;
    IERC20 public token;
    uint256 public attackCount;
    uint256 public maxAttacks;

    constructor(address _vault, address _token) {
        vault = IAuraVault(_vault);
        token = IERC20(_token);
    }

    function attack(uint256 amount, uint256 _maxAttacks) external {
        maxAttacks = _maxAttacks;
        attackCount = 0;
        token.approve(address(vault), type(uint256).max);
        vault.deposit(amount, address(this));
        vault.withdraw(amount, address(this), address(this));
    }

    // This would be triggered if the vault used a callback-capable token
    fallback() external {
        if (attackCount < maxAttacks) {
            attackCount++;
            try vault.withdraw(1, address(this), address(this)) {} catch {}
        }
    }

    receive() external payable {}
}

/// @title MaliciousOracle
/// @notice Oracle that returns manipulated prices to test oracle dependency
contract MaliciousOracle {
    uint256 public manipulatedPrice;
    bool public shouldRevert;
    uint256 public callCount;

    function setPrice(string calldata, uint256 price) external {
        manipulatedPrice = price;
    }

    function setRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function getPrice(string calldata) external view returns (uint256) {
        require(!shouldRevert, "Oracle down");
        return manipulatedPrice;
    }
}

/// @title FlashLoanAttacker
/// @notice Simulates a flash loan attack that tries to manipulate vault share price
contract FlashLoanAttacker {
    IAuraVault public vault;
    IERC20 public token;

    constructor(address _vault, address _token) {
        vault = IAuraVault(_vault);
        token = IERC20(_token);
    }

    /// @notice Attempts to inflate share price by donating tokens directly to vault
    function inflateAndWithdraw(uint256 depositAmount, uint256 donationAmount) external {
        token.approve(address(vault), type(uint256).max);
        // Step 1: deposit normally
        vault.deposit(depositAmount, address(this));
        // Step 2: donate directly to vault to inflate share price
        token.transfer(address(vault), donationAmount);
        // Step 3: try to withdraw more than deposited
        vault.redeem(depositAmount, address(this), address(this));
    }
}
