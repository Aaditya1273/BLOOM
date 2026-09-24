// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IAuraOrderBook {
    function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256);
    function cancel_order(uint256 order_id, address caller) external returns (bool);
    function consume_order(uint256 order_id) external returns (bool);
    function match_orders(uint256 asset_hash, uint256 current_price) external returns (uint256);
    function mark_executed(uint256 order_id) external returns (bool);
    function get_order(uint256 order_id) external view returns (address, uint256, bool, uint256, uint256, uint256, uint256, uint256);
    function get_filled_orders(uint256 asset_hash) external view returns (uint256[] memory);
    function get_active_orders(uint256 asset_hash, bool is_long) external view returns (uint256[] memory);
    function get_active_orders_sorted(uint256 asset_hash, bool is_long, uint256 max_results) external view returns (uint256[] memory ids, uint256[] memory prices, uint256[] memory sizes);
    function get_book_depth(uint256 asset_hash) external view returns (uint256, uint256);
    function get_stats() external view returns (uint256, uint256, uint256);
}

interface IAuraPerps {
    function openPositionFor(address user, string calldata asset, bool isLong, uint256 collateralAmount, uint256 leverage) external returns (uint256);
    function openPositionAtPrice(address user, string calldata asset, bool isLong, uint256 collateralAmount, uint256 leverage, uint256 entryPrice) external returns (uint256);
}

interface IMockOracle {
    function getPrice(string calldata asset) external view returns (uint256);
}

/**
 * @title AuraPerpsRouter
 * @dev Bridge between the Stylus/Solidity LOB and AuraPerps. Three flows:
 *      1. placeLimitOrder      — user-funded resting limit
 *      2. placeLimitOrderFor   — agent-funded resting limit (MMFund-financed MM)
 *      3. routedMarketOpen     — true hybrid: walks the book first, falls back
 *         to the Vault LP (AuraPerps oracle path) for any unfilled remainder.
 */
contract AuraPerpsRouter is Ownable {
    IERC20 public aUSD;
    IAuraOrderBook public orderBook;
    IAuraPerps public perps;
    IMockOracle public oracle;
    address public keeper;
    address public mmAgent;

    /// @notice Maximum maker fills walked per routedMarketOpen call. Bounded
    ///         to keep gas predictable; remainder goes to the Vault LP path.
    uint256 public constant MAX_MAKER_FILLS_PER_TX = 5;

    mapping(uint256 => uint256) public escrowedAmount;
    mapping(string => uint256) public assetHashes;
    mapping(uint256 => string) public hashToAsset;
    string[] public supportedAssets;

    event LimitOrderPlaced(uint256 indexed orderId, address indexed user, string asset, bool isLong, uint256 collateral, uint256 leverage, uint256 limitPrice);
    event LimitOrderCancelled(uint256 indexed orderId, address indexed user, uint256 refund);
    event LimitOrderFilled(uint256 indexed orderId, address indexed user, uint256 positionId);
    event OrdersMatched(string asset, uint256 currentPrice, uint256 matchCount);
    event MarketOrderRouted(
        address indexed taker, string asset, bool isLong,
        uint256 collateralIn, uint256 makerFills, uint256 bookFilledSize,
        uint256 fallbackSize, uint256 vwap
    );

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner(), "Router: not keeper");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == mmAgent || msg.sender == owner(), "Router: not agent");
        _;
    }

    constructor(address _aUSD, address _orderBook, address _perps, address _oracle) Ownable(msg.sender) {
        aUSD = IERC20(_aUSD);
        orderBook = IAuraOrderBook(_orderBook);
        perps = IAuraPerps(_perps);
        oracle = IMockOracle(_oracle);
        keeper = msg.sender;
        mmAgent = msg.sender;
    }

    function setKeeper(address _keeper) external onlyOwner { keeper = _keeper; }
    function setMmAgent(address _agent) external onlyOwner { mmAgent = _agent; }
    function setOrderBook(address _ob) external onlyOwner { orderBook = IAuraOrderBook(_ob); }
    function setAuraPerps(address _perps) external onlyOwner { perps = IAuraPerps(_perps); }

    function registerAsset(string calldata asset) external onlyOwner {
        uint256 h = uint256(keccak256(abi.encodePacked(asset)));
        assetHashes[asset] = h;
        hashToAsset[h] = asset;
        supportedAssets.push(asset);
    }

    function getAssetHash(string calldata asset) external view returns (uint256) {
        return assetHashes[asset];
    }

    // ═══════════ USER OPERATIONS ═══════════

    function placeLimitOrder(
        string calldata asset,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 limitPrice
    ) external returns (uint256) {
        return _placeLimit(msg.sender, msg.sender, asset, isLong, collateral, leverage, limitPrice);
    }

    /// @notice Place a limit order funded by `from`. Used by the AI Market Maker
    ///         to draw collateral directly from AuraMMFund. The order's owner
    ///         (and refund destination on cancel) is `from`, NOT msg.sender.
    function placeLimitOrderFor(
        address from,
        string calldata asset,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 limitPrice
    ) external onlyAgent returns (uint256) {
        // Pull from `from` (e.g., MMFund) and own the order from `from`.
        return _placeLimit(from, from, asset, isLong, collateral, leverage, limitPrice);
    }

    function _placeLimit(
        address payer, address ownerAddr,
        string calldata asset, bool isLong,
        uint256 collateral, uint256 leverage, uint256 limitPrice
    ) internal returns (uint256) {
        require(collateral > 0 && leverage > 0 && leverage <= 50 && limitPrice > 0, "Router: invalid params");
        uint256 assetHash = assetHashes[asset];
        require(assetHash != 0, "Router: asset not registered");

        require(aUSD.transferFrom(payer, address(this), collateral), "Router: transfer failed");

        uint256 orderId = orderBook.store_order(ownerAddr, assetHash, isLong, collateral, leverage, limitPrice);
        require(orderId != type(uint256).max, "Router: LOB store failed");

        escrowedAmount[orderId] = collateral;
        emit LimitOrderPlaced(orderId, ownerAddr, asset, isLong, collateral, leverage, limitPrice);
        return orderId;
    }

    function cancelLimitOrder(uint256 orderId) external {
        bool success = orderBook.cancel_order(orderId, msg.sender);
        require(success, "Router: cancel failed");

        uint256 amount = escrowedAmount[orderId];
        if (amount > 0) {
            escrowedAmount[orderId] = 0;
            require(aUSD.transfer(msg.sender, amount), "Router: refund failed");
        }
        emit LimitOrderCancelled(orderId, msg.sender, amount);
    }

    // ═══════════ HYBRID MARKET ORDER ═══════════

    /// @notice True hybrid market open: walks the LOB on the OPPOSITE side first,
    ///         opens both maker(s) and taker at maker limit prices, and falls back
    ///         to the Vault LP path (AuraPerps.openPositionFor) for any remaining
    ///         taker size that didn't get filled by the book.
    /// @param asset       Symbol registered via registerAsset.
    /// @param isLong      Taker side (true → buy, walks ASK side).
    /// @param collateral  Total taker aUSD collateral.
    /// @param leverage    Taker leverage [1..50].
    /// @return positionIds Position ids opened for the TAKER (length 2:
    ///         [bookSide, fallbackSide] — either may be 0 if absent).
    function routedMarketOpen(
        string calldata asset,
        bool isLong,
        uint256 collateral,
        uint256 leverage
    ) external returns (uint256[] memory positionIds) {
        require(collateral > 0 && leverage > 0 && leverage <= 50, "Router: invalid params");
        uint256 assetHash = assetHashes[asset];
        require(assetHash != 0, "Router: asset not registered");

        // Pull taker collateral upfront.
        require(aUSD.transferFrom(msg.sender, address(this), collateral), "Router: transfer failed");

        RouteState memory st = _walkBook(asset, assetHash, isLong, collateral, leverage);
        positionIds = _settleTaker(asset, isLong, collateral, leverage, st);

        emit MarketOrderRouted(
            msg.sender, asset, isLong,
            collateral, st.makerFills, st.takerMatchedSize,
            (collateral - st.takerMatchedCollateral) * leverage,
            st.takerMatchedSize > 0 ? st.vwapNumerator / st.takerMatchedSize : 0
        );
    }

    /// @dev Per-call accumulator. Lives in memory to dodge stack-too-deep.
    struct RouteState {
        uint256 vwapNumerator;
        uint256 takerMatchedSize;
        uint256 takerMatchedCollateral;
        uint256 makerFills;
    }

    function _walkBook(
        string memory asset,
        uint256 assetHash,
        bool isLong,
        uint256 collateral,
        uint256 leverage
    ) internal returns (RouteState memory st) {
        uint256 takerSize = collateral * leverage;
        (uint256[] memory ids, , uint256[] memory mSizes) =
            orderBook.get_active_orders_sorted(assetHash, !isLong, MAX_MAKER_FILLS_PER_TX);

        for (uint256 i = 0; i < ids.length; i++) {
            if (st.takerMatchedSize >= takerSize) break;
            uint256 mSize = mSizes[i];
            if (mSize == 0) continue;
            // No partial fills in v1: skip makers larger than remaining taker capacity.
            if (mSize > takerSize - st.takerMatchedSize) continue;

            uint256 mLimit = _consumeMaker(ids[i], asset);

            st.vwapNumerator += mLimit * mSize;
            st.takerMatchedSize += mSize;
            // Add this maker's contribution to the taker's collateral budget.
            st.takerMatchedCollateral += (mSize / leverage);
            st.makerFills++;
        }
    }

    function _consumeMaker(uint256 orderId, string memory asset) internal returns (uint256 mLimit) {
        // Read maker terms before consuming the order (status will flip).
        (address mOwner, , bool mIsLong, uint256 mCollat, uint256 mLev, uint256 limitPrice, , ) =
            orderBook.get_order(orderId);
        mLimit = limitPrice;

        require(orderBook.consume_order(orderId), "Router: consume failed");
        uint256 escrow = escrowedAmount[orderId];
        require(escrow >= mCollat, "Router: escrow shortfall");
        escrowedAmount[orderId] = 0;

        require(aUSD.approve(address(perps), escrow), "Router: maker approve failed");
        uint256 mPosId = perps.openPositionAtPrice(mOwner, asset, mIsLong, mCollat, mLev, mLimit);
        emit LimitOrderFilled(orderId, mOwner, mPosId);
    }

    function _settleTaker(
        string memory asset,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        RouteState memory st
    ) internal returns (uint256[] memory positionIds) {
        positionIds = new uint256[](2);

        if (st.takerMatchedSize > 0) {
            uint256 matchedCollat = st.takerMatchedCollateral;
            if (matchedCollat > collateral) matchedCollat = collateral;
            uint256 vwap = st.vwapNumerator / st.takerMatchedSize;

            require(aUSD.approve(address(perps), matchedCollat), "Router: taker approve A failed");
            positionIds[0] = perps.openPositionAtPrice(
                msg.sender, asset, isLong, matchedCollat, leverage, vwap
            );
            // Re-anchor remaining collateral against what was actually used above.
            st.takerMatchedCollateral = matchedCollat;
        }

        uint256 fallbackCollateral = collateral - st.takerMatchedCollateral;
        if (fallbackCollateral > 0) {
            require(aUSD.approve(address(perps), fallbackCollateral), "Router: taker approve B failed");
            positionIds[1] = perps.openPositionFor(
                msg.sender, asset, isLong, fallbackCollateral, leverage
            );
        }
    }

    // ═══════════ KEEPER OPERATIONS ═══════════

    function matchAndExecute(string calldata asset) external onlyKeeper {
        uint256 assetHash = assetHashes[asset];
        require(assetHash != 0, "Router: asset not registered");

        uint256 currentPrice = oracle.getPrice(asset);
        require(currentPrice > 0, "Router: invalid price");

        uint256 matchCount = orderBook.match_orders(assetHash, currentPrice);
        emit OrdersMatched(asset, currentPrice, matchCount);

        if (matchCount == 0) return;

        uint256[] memory filledIds = orderBook.get_filled_orders(assetHash);
        for (uint256 i = 0; i < filledIds.length; i++) {
            _executeFilledOrder(filledIds[i], asset);
        }
    }

    function _executeFilledOrder(uint256 orderId, string memory asset) internal {
        (address user, , bool isLong, uint256 collateral, uint256 leverage, , , ) = orderBook.get_order(orderId);
        uint256 escrowed = escrowedAmount[orderId];
        if (escrowed == 0) return;

        escrowedAmount[orderId] = 0;
        aUSD.approve(address(perps), escrowed);

        uint256 positionId = perps.openPositionFor(user, asset, isLong, collateral, leverage);
        orderBook.mark_executed(orderId);

        emit LimitOrderFilled(orderId, user, positionId);
    }

    // ═══════════ VIEW FUNCTIONS ═══════════

    function getOrderBook(string calldata asset) external view returns (uint256[] memory bidIds, uint256[] memory askIds) {
        uint256 h = assetHashes[asset];
        bidIds = orderBook.get_active_orders(h, true);
        askIds = orderBook.get_active_orders(h, false);
    }

    function getOrderBookSorted(string calldata asset, uint256 depth)
        external view
        returns (
            uint256[] memory bidIds, uint256[] memory bidPrices, uint256[] memory bidSizes,
            uint256[] memory askIds, uint256[] memory askPrices, uint256[] memory askSizes
        )
    {
        uint256 h = assetHashes[asset];
        (bidIds, bidPrices, bidSizes) = orderBook.get_active_orders_sorted(h, true, depth);
        (askIds, askPrices, askSizes) = orderBook.get_active_orders_sorted(h, false, depth);
    }

    function getBookDepth(string calldata asset) external view returns (uint256 bids, uint256 asks) {
        return orderBook.get_book_depth(assetHashes[asset]);
    }

    function getStats() external view returns (uint256, uint256, uint256) {
        return orderBook.get_stats();
    }

    function getOrderDetails(uint256 orderId) external view returns (address, uint256, bool, uint256, uint256, uint256, uint256, uint256) {
        return orderBook.get_order(orderId);
    }

    function getSupportedAssetsCount() external view returns (uint256) {
        return supportedAssets.length;
    }
}
