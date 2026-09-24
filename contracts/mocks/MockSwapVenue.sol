// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISwapVenue} from "../interfaces/ISwapVenue.sol";
import {IRiskEngine} from "../interfaces/IRiskEngine.sol";
import {IBloomAssetRegistry} from "../interfaces/IBloomAssetRegistry.sol";

/// @title MockSwapVenue — TESTNET MOCK
/// @notice Inventory-based USDG <-> Stock Token venue priced at the risk engine's oracle price.
///         Refuses to quote unless the asset is in NORMAL risk state. Mainnet routing would use an approved AMM
///         adapter instead; this contract must never be deployed on mainnet.
contract MockSwapVenue is ISwapVenue, Ownable {
    using SafeERC20 for IERC20;

    IRiskEngine public immutable riskEngine;
    IBloomAssetRegistry public immutable registry;

    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address recipient);

    error UnsupportedPair();
    error PriceUnavailable(uint8 state);
    error Slippage(uint256 out, uint256 minOut);
    error ZeroAmount();

    constructor(IRiskEngine riskEngine_, IBloomAssetRegistry registry_, address owner_) Ownable(owner_) {
        riskEngine = riskEngine_;
        registry = registry_;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        address usdg = registry.stableAsset();
        bool buy;
        address stock;
        if (tokenIn == usdg && tokenOut != usdg) {
            (buy, stock) = (true, tokenOut);
        } else if (tokenOut == usdg && tokenIn != usdg) {
            stock = tokenIn;
        } else {
            revert UnsupportedPair();
        }
        IBloomAssetRegistry.SupportedAsset memory a =
            registry.requireSupported(stock, IBloomAssetRegistry.AssetKind.STOCK_TOKEN);
        (uint8 state,,,, uint256 price,) = riskEngine.getRisk(stock);
        if (state != uint8(IRiskEngine.RiskState.NORMAL) || price == 0) revert PriceUnavailable(state);
        uint8 usdgDec = registry.getAsset(usdg).decimals;
        // value in 1e18 USD
        if (buy) {
            uint256 usd = amountIn * 10 ** (18 - usdgDec);
            return usd * 10 ** a.decimals / price;
        }
        uint256 usdOut = amountIn * price / 10 ** a.decimals;
        return usdOut / 10 ** (18 - usdgDec);
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (amountOut < minAmountOut || amountOut == 0) revert Slippage(amountOut, minAmountOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
        emit Swapped(tokenIn, tokenOut, amountIn, amountOut, recipient);
    }

    /// @notice Owner withdraws inventory.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
