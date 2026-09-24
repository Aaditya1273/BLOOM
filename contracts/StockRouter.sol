// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IBloomAssetRegistry} from "./interfaces/IBloomAssetRegistry.sol";
import {ISwapVenue} from "./interfaces/ISwapVenue.sol";

/// @title StockRouter
/// @notice Sends and (optionally) swaps canonical Robinhood Stock Tokens and USDG for Bloom users and agents.
/// @dev Every token address is checked against BloomAssetRegistry. A token that merely has the right
///      ticker/name is rejected unless its exact address is registered. Swaps only go through venues the
///      owner explicitly approved, require a non-zero minimum output and a deadline, and verify the output
///      actually received by the recipient.
contract StockRouter is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IBloomAssetRegistry public immutable registry;
    mapping(address => bool) public approvedVenue;

    event Sent(address indexed from, address indexed to, address indexed token, uint256 amount, bytes32 memo);
    event Swapped(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address venue
    );
    event VenueApproved(address indexed venue, bool approved);

    error ZeroAmount();
    error ZeroAddress();
    error SelfTransfer();
    error VenueNotApproved(address venue);
    error MinOutRequired();
    error Expired(uint256 deadline);
    error SameToken();
    error InsufficientOutput(uint256 received, uint256 minOut);

    constructor(IBloomAssetRegistry registry_, address owner_) Ownable(owner_) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        registry = registry_;
    }

    function setVenue(address venue, bool approved) external onlyOwner {
        if (venue == address(0)) revert ZeroAddress();
        approvedVenue[venue] = approved;
        emit VenueApproved(venue, approved);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Transfer a supported asset from the caller to `to`. The caller must have approved this router.
    /// @param memo opaque reference (e.g. hash of a chat message id); never contains personal data.
    function send(address token, address to, uint256 amount, bytes32 memo) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (to == msg.sender) revert SelfTransfer();
        registry.requireSupported(token, IBloomAssetRegistry.AssetKind.NONE);
        IERC20(token).safeTransferFrom(msg.sender, to, amount);
        emit Sent(msg.sender, to, token, amount, memo);
    }

    /// @notice Swap between two supported assets through an approved venue. Output goes to the caller.
    function swap(
        address venue,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 received) {
        if (!approvedVenue[venue]) revert VenueNotApproved(venue);
        if (amountIn == 0) revert ZeroAmount();
        if (minAmountOut == 0) revert MinOutRequired();
        if (block.timestamp > deadline) revert Expired(deadline);
        if (tokenIn == tokenOut) revert SameToken();
        registry.requireSupported(tokenIn, IBloomAssetRegistry.AssetKind.NONE);
        registry.requireSupported(tokenOut, IBloomAssetRegistry.AssetKind.NONE);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(venue, amountIn);
        uint256 before = IERC20(tokenOut).balanceOf(msg.sender);
        ISwapVenue(venue).swapExactIn(tokenIn, tokenOut, amountIn, minAmountOut, msg.sender);
        IERC20(tokenIn).forceApprove(venue, 0);
        received = IERC20(tokenOut).balanceOf(msg.sender) - before;
        if (received < minAmountOut) revert InsufficientOutput(received, minAmountOut);
        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, received, venue);
    }
}
