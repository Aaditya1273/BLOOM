// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IBloomAssetRegistry} from "./interfaces/IBloomAssetRegistry.sol";

/// @title BloomAssetRegistry
/// @notice Explicit canonical asset registry. Business logic never trusts a symbol, name, frontend input or AI output
///         to identify an asset: only addresses registered here by the owner are accepted.
/// @dev Production addresses come from the official Robinhood Chain contracts registry
///      (https://docs.robinhood.com/chain/contracts/) via deployment config, never from this code.
contract BloomAssetRegistry is IBloomAssetRegistry, Ownable2Step {
    uint256 public immutable override chainId;

    mapping(address => SupportedAsset) internal _byToken;
    mapping(bytes32 => address) public tokenBySymbol;
    address[] internal _tokens;
    address public override stableAsset;

    event AssetRegistered(bytes32 indexed symbol, address indexed token, address priceFeed, uint8 decimals, AssetKind kind);
    event AssetStatusChanged(address indexed token, bool enabled);
    event PriceFeedUpdated(address indexed token, address priceFeed);

    error ZeroAddress();
    error EmptySymbol();
    error AlreadyRegistered(address token);
    error SymbolTaken(bytes32 symbol);
    error DecimalsMismatch(uint8 expected, uint8 actual);
    error InvalidKind();
    error StableAlreadySet();
    error UnsupportedAsset(address token);
    error WrongAssetKind(address token);
    error WrongChain(uint256 expected, uint256 actual);

    constructor(address initialOwner, uint256 expectedChainId) Ownable(initialOwner) {
        // Deployment config is bound to one chain; refuses to deploy a mainnet manifest on testnet and vice versa.
        if (expectedChainId != block.chainid) revert WrongChain(expectedChainId, block.chainid);
        chainId = block.chainid;
    }

    /// @param expectedDecimals must equal the token's `decimals()`; protects against config typos and spoofed tokens.
    function registerAsset(bytes32 symbol, address token, address priceFeed, uint8 expectedDecimals, AssetKind kind)
        external
        onlyOwner
    {
        if (token == address(0)) revert ZeroAddress();
        if (symbol == bytes32(0)) revert EmptySymbol();
        if (kind == AssetKind.NONE) revert InvalidKind();
        if (kind == AssetKind.STOCK_TOKEN && priceFeed == address(0)) revert ZeroAddress();
        if (_byToken[token].token != address(0)) revert AlreadyRegistered(token);
        if (tokenBySymbol[symbol] != address(0)) revert SymbolTaken(symbol);
        if (kind == AssetKind.STABLE) {
            if (stableAsset != address(0)) revert StableAlreadySet();
            stableAsset = token;
        }
        uint8 actual = IERC20Metadata(token).decimals();
        if (actual != expectedDecimals) revert DecimalsMismatch(expectedDecimals, actual);

        _byToken[token] = SupportedAsset(symbol, token, priceFeed, actual, kind, true);
        tokenBySymbol[symbol] = token;
        _tokens.push(token);
        emit AssetRegistered(symbol, token, priceFeed, actual, kind);
    }

    function setEnabled(address token, bool enabled) external onlyOwner {
        if (_byToken[token].token == address(0)) revert UnsupportedAsset(token);
        _byToken[token].enabled = enabled;
        emit AssetStatusChanged(token, enabled);
    }

    function setPriceFeed(address token, address priceFeed) external onlyOwner {
        if (_byToken[token].token == address(0)) revert UnsupportedAsset(token);
        if (priceFeed == address(0) && _byToken[token].kind == AssetKind.STOCK_TOKEN) revert ZeroAddress();
        _byToken[token].priceFeed = priceFeed;
        emit PriceFeedUpdated(token, priceFeed);
    }

    function getAsset(address token) external view returns (SupportedAsset memory) {
        return _byToken[token];
    }

    function getAssetBySymbol(bytes32 symbol) external view returns (SupportedAsset memory) {
        return _byToken[tokenBySymbol[symbol]];
    }

    function isSupported(address token) public view returns (bool) {
        return _byToken[token].enabled;
    }

    function requireSupported(address token, AssetKind kind) external view returns (SupportedAsset memory a) {
        a = _byToken[token];
        if (!a.enabled) revert UnsupportedAsset(token);
        if (kind != AssetKind.NONE && a.kind != kind) revert WrongAssetKind(token);
    }

    function listAssets() external view returns (SupportedAsset[] memory out) {
        out = new SupportedAsset[](_tokens.length);
        for (uint256 i; i < _tokens.length; ++i) {
            out[i] = _byToken[_tokens[i]];
        }
    }
}
