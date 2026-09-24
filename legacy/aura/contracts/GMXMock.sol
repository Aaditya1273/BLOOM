// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract GMXMock {
    event Staked(address indexed user, uint256 amount);
    
    function stake(uint256 amount) external {
        emit Staked(msg.sender, amount);
    }
}
