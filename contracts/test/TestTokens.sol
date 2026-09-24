// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only: charges a 1% fee on every transfer.
contract FeeOnTransferToken is ERC20 {
    uint8 private immutable _dec;

    constructor(uint8 dec_) ERC20("Fee Token", "FEE") {
        _dec = dec_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

interface IReenterTarget {
    function withdrawCollateral(address token, uint256 amount) external;
}

/// @notice Test-only: calls back into a target during transferFrom to attempt reentrancy.
contract ReentrantToken is ERC20 {
    address public target;
    bool public attack;
    bool public reentered;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_) external {
        target = target_;
        attack = true;
    }

    function uiMultiplier() external pure returns (uint256) {
        return 1e18;
    }

    function oraclePaused() external pure returns (bool) {
        return false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attack && to == target) {
            attack = false;
            // try to withdraw during the deposit callback; must revert via ReentrancyGuard
            IReenterTarget(target).withdrawCollateral(address(this), value);
            reentered = true;
        }
    }
}
