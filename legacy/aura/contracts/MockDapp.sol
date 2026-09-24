// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockDapp {
    event Called(address sender, uint256 value, bytes data);

    function testCall() external payable {
        emit Called(msg.sender, msg.value, msg.data);
    }

    receive() external payable {
        emit Called(msg.sender, msg.value, "");
    }

    fallback() external payable {
        emit Called(msg.sender, msg.value, msg.data);
    }
}
