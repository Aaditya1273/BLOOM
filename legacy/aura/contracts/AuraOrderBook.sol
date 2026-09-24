// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuraOrderBook
 * @dev Solidity implementation of the Aura Order Book (Fallback for Stylus).
 */
contract AuraOrderBook is Ownable {
    enum Status { CANCELLED, ACTIVE, FILLED, EXECUTED }

    struct Order {
        address owner;
        uint256 assetHash;
        bool isLong;
        uint256 collateral;
        uint256 leverage;
        uint256 limitPrice;
        uint256 timestamp;
        Status status;
    }

    address public router;
    address public keeper;
    bool public initialized;
    uint256 public nextOrderId;

    mapping(uint256 => Order) public orders;
    mapping(uint256 => uint256) public activeBidCount; // assetHash => count
    mapping(uint256 => uint256) public activeAskCount; // assetHash => count
    
    uint256 public totalOrdersPlaced;
    uint256 public totalOrdersFilled;

    event OrderStored(uint256 indexed orderId, address indexed owner, uint256 assetHash, bool isLong);
    event OrderCancelled(uint256 indexed orderId);
    event OrderFilled(uint256 indexed orderId);
    event OrderExecuted(uint256 indexed orderId);

    constructor() Ownable(msg.sender) {}

    function initialize(address _router, address _keeper) external {
        require(!initialized, "Already initialized");
        router = _router;
        keeper = _keeper;
        initialized = true;
    }

    function setRouter(address _router) external onlyOwner {
        router = _router;
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }

    // ═══════════ ORDER STORAGE ═══════════

    function store_order(
        address owner,
        uint256 asset_hash,
        bool is_long,
        uint256 collateral,
        uint256 leverage,
        uint256 limit_price
    ) external returns (uint256) {
        require(msg.sender == router, "Only router");
        require(collateral > 0 && leverage > 0 && limit_price > 0, "Invalid params");
        require(leverage <= 50, "Max leverage 50x");

        uint256 orderId = nextOrderId++;
        orders[orderId] = Order({
            owner: owner,
            assetHash: asset_hash,
            isLong: is_long,
            collateral: collateral,
            leverage: leverage,
            limitPrice: limit_price,
            timestamp: block.timestamp,
            status: Status.ACTIVE
        });

        if (is_long) {
            activeBidCount[asset_hash]++;
        } else {
            activeAskCount[asset_hash]++;
        }

        totalOrdersPlaced++;
        emit OrderStored(orderId, owner, asset_hash, is_long);
        return orderId;
    }

    function cancel_order(uint256 order_id, address caller) external returns (bool) {
        require(msg.sender == router, "Only router");
        Order storage order = orders[order_id];
        if (order.status != Status.ACTIVE) return false;
        if (order.owner != caller) return false;

        order.status = Status.CANCELLED;

        if (order.isLong) {
            if (activeBidCount[order.assetHash] > 0) activeBidCount[order.assetHash]--;
        } else {
            if (activeAskCount[order.assetHash] > 0) activeAskCount[order.assetHash]--;
        }

        emit OrderCancelled(order_id);
        return true;
    }

    // ═══════════ MATCHING ENGINE ═══════════

    function match_orders(uint256 asset_hash, uint256 current_price) external returns (uint256) {
        require(msg.sender == router || msg.sender == keeper || msg.sender == owner(), "Unauthorized");
        require(current_price > 0, "Invalid price");

        uint256 matched = 0;
        for (uint256 i = 0; i < nextOrderId; i++) {
            Order storage order = orders[i];
            if (order.status != Status.ACTIVE) continue;
            if (order.assetHash != asset_hash) continue;

            bool shouldFill = order.isLong ? (current_price <= order.limitPrice) : (current_price >= order.limitPrice);

            if (shouldFill) {
                order.status = Status.FILLED;
                if (order.isLong) {
                    if (activeBidCount[asset_hash] > 0) activeBidCount[asset_hash]--;
                } else {
                    if (activeAskCount[asset_hash] > 0) activeAskCount[asset_hash]--;
                }
                matched++;
                totalOrdersFilled++;
                emit OrderFilled(i);
            }
        }
        return matched;
    }

    function mark_executed(uint256 order_id) external returns (bool) {
        require(msg.sender == router || msg.sender == keeper || msg.sender == owner(), "Unauthorized");
        Order storage order = orders[order_id];
        if (order.status != Status.FILLED) return false;
        order.status = Status.EXECUTED;
        emit OrderExecuted(order_id);
        return true;
    }

    /// @notice Take a single resting ACTIVE order out of the book and mark it
    ///         EXECUTED in one atomic step. Used by routedMarketOpen to consume
    ///         makers without going through the keeper's two-phase Filled→Executed
    ///         lifecycle.
    function consume_order(uint256 order_id) external returns (bool) {
        require(msg.sender == router, "Only router");
        Order storage order = orders[order_id];
        if (order.status != Status.ACTIVE) return false;

        order.status = Status.EXECUTED;
        if (order.isLong) {
            if (activeBidCount[order.assetHash] > 0) activeBidCount[order.assetHash]--;
        } else {
            if (activeAskCount[order.assetHash] > 0) activeAskCount[order.assetHash]--;
        }
        totalOrdersFilled++;
        emit OrderExecuted(order_id);
        return true;
    }

    // ═══════════ VIEW FUNCTIONS ═══════════

    function get_order(uint256 order_id) external view returns (address, uint256, bool, uint256, uint256, uint256, uint256, uint256) {
        Order memory o = orders[order_id];
        return (o.owner, o.assetHash, o.isLong, o.collateral, o.leverage, o.limitPrice, o.timestamp, uint256(o.status));
    }

    function get_filled_orders(uint256 asset_hash) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nextOrderId; i++) {
            if (orders[i].status == Status.FILLED && orders[i].assetHash == asset_hash) count++;
        }

        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < nextOrderId; i++) {
            if (orders[i].status == Status.FILLED && orders[i].assetHash == asset_hash) {
                result[idx++] = i;
            }
        }
        return result;
    }

    function get_active_orders(uint256 asset_hash, bool is_long) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nextOrderId; i++) {
            if (orders[i].status == Status.ACTIVE && orders[i].assetHash == asset_hash && orders[i].isLong == is_long) count++;
        }

        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < nextOrderId; i++) {
            if (orders[i].status == Status.ACTIVE && orders[i].assetHash == asset_hash && orders[i].isLong == is_long) {
                result[idx++] = i;
            }
        }
        return result;
    }

    function get_book_depth(uint256 asset_hash) external view returns (uint256, uint256) {
        return (activeBidCount[asset_hash], activeAskCount[asset_hash]);
    }

    /// @notice Top-N active orders for `asset_hash` on `is_long` side, sorted best-first.
    ///         Bids: descending price (highest first). Asks: ascending (lowest first).
    /// @dev Bounded insertion-sort keyed on `limitPrice`. O(N * cap) where N is the
    ///      total order id range and cap = max_results. Front-end uses cap=12.
    function get_active_orders_sorted(uint256 asset_hash, bool is_long, uint256 max_results)
        external view
        returns (uint256[] memory ids, uint256[] memory prices, uint256[] memory sizes)
    {
        uint256 cap = max_results == 0 ? 20 : max_results;
        ids = new uint256[](cap);
        prices = new uint256[](cap);
        sizes = new uint256[](cap);
        uint256 count = 0;

        for (uint256 i = 0; i < nextOrderId; i++) {
            Order storage o = orders[i];
            if (o.status != Status.ACTIVE) continue;
            if (o.assetHash != asset_hash) continue;
            if (o.isLong != is_long) continue;

            uint256 p = o.limitPrice;
            uint256 s = o.collateral * o.leverage;

            // Insertion sort: keep the buffer ordered best-first.
            uint256 pos = count < cap ? count : cap; // start past the end if buffer is full
            // shift up to find insertion point
            while (pos > 0) {
                bool shouldShift = is_long
                    ? prices[pos - 1] < p   // bid: higher comes earlier
                    : prices[pos - 1] > p;  // ask: lower comes earlier
                if (!shouldShift) break;
                if (pos < cap) {
                    ids[pos] = ids[pos - 1];
                    prices[pos] = prices[pos - 1];
                    sizes[pos] = sizes[pos - 1];
                }
                pos--;
            }

            if (pos < cap) {
                ids[pos] = i;
                prices[pos] = p;
                sizes[pos] = s;
                if (count < cap) count++;
            }
            // else: entry is worse than the worst slot → drop
        }

        // Trim to actual count
        if (count < cap) {
            assembly {
                mstore(ids, count)
                mstore(prices, count)
                mstore(sizes, count)
            }
        }
    }

    function get_stats() external view returns (uint256, uint256, uint256) {
        return (nextOrderId, totalOrdersPlaced, totalOrdersFilled);
    }
}
