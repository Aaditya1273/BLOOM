// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuraVault
 * @dev ERC4626 Vault acting as the liquidity provider (counterparty) for AuraPerps.
 */
contract AuraVault is ERC4626, Ownable {
    address public auraPerps;

    constructor(IERC20 _asset) ERC4626(_asset) ERC20("Aura LP Token", "vAUSD") Ownable(msg.sender) {}

    function setAuraPerps(address _auraPerps) external onlyOwner {
        auraPerps = _auraPerps;
    }

    modifier onlyPerps() {
        require(msg.sender == auraPerps, "AuraVault: Only Perps contract allowed");
        _;
    }

    /**
     * @dev Called when a trader loses. The loss is added to the vault, 
     * automatically increasing the value of existing vAUSD shares.
     */
    function receiveLoss(uint256 amount) external onlyPerps {
        require(IERC20(asset()).transferFrom(msg.sender, address(this), amount), "AuraVault: Transfer failed");
    }

    /**
     * @dev Called when a trader wins. The profit is paid from the vault's assets.
     */
    function payoutProfit(address to, uint256 amount) external onlyPerps {
        require(totalAssets() >= amount, "AuraVault: Insufficient liquidity");
        require(IERC20(asset()).transfer(to, amount), "AuraVault: Transfer failed");
    }
}
