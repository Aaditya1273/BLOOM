// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockOracle {
    mapping(string => uint256) public prices;

    // Owner validation omitted for the hackathon simplicity
    function setPrice(string calldata asset, uint256 price) external {
        prices[asset] = price;
    }

    function getPrice(string calldata asset) external view returns (uint256) {
        // Return simulated 3000 USDC per ETH if not set
        if (prices[asset] == 0) return 3000 * 10**18;
        return prices[asset];
    }
}