// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBloomAssetRegistry {
    enum AssetKind {
        NONE,
        STABLE, //      USDG
        STOCK_TOKEN //  Robinhood Stock Token
    }

    struct SupportedAsset {
        bytes32 symbol;
        address token;
        address priceFeed;
        uint8 decimals;
        AssetKind kind;
        bool enabled;
    }

    function chainId() external view returns (uint256);

    function getAsset(address token) external view returns (SupportedAsset memory);

    function getAssetBySymbol(bytes32 symbol) external view returns (SupportedAsset memory);

    /// @notice Reverts unless `token` is registered, enabled and of `kind` (NONE = any kind).
    function requireSupported(address token, AssetKind kind) external view returns (SupportedAsset memory);

    function isSupported(address token) external view returns (bool);

    function stableAsset() external view returns (address);

    function listAssets() external view returns (SupportedAsset[] memory);
}
