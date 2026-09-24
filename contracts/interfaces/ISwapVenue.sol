// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal exact-input swap venue that StockRouter may route through when explicitly approved.
interface ISwapVenue {
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut);
}
