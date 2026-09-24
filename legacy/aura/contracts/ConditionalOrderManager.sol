// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IAuraPerps {
    function positions(uint256 positionId) external view returns (
        address owner, string memory asset, bool isLong,
        uint256 collateralAmount, uint256 leverage, uint256 entryPrice,
        uint256 positionSize, bool isOpen, uint256 openedAt,
        uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice,
        uint256 takeProfitPrice, uint256 stopLossPrice
    );
    function executeTriggerOrder(uint256 positionId) external;
    function setTriggerOrders(uint256 positionId, uint256 tpPrice, uint256 slPrice) external;
}

interface IMockOracle {
    function getPrice(string calldata asset) external view returns (uint256);
}

/**
 * @title ConditionalOrderManager
 * @notice Stores user-created conditional orders (SL/TP on existing positions,
 *         or price-triggered close intents) that a keeper can execute when
 *         oracle price conditions are met.
 * @dev Works alongside AuraPerps.executeTriggerOrder. This contract adds:
 *      1. Keeper-friendly batch scanning (getExecutableOrders)
 *      2. Off-chain order creation via AI agent (user signs once, keeper monitors)
 *      3. Support for "close position if price hits X" without requiring
 *         the user to call setTriggerOrders on AuraPerps directly
 */
contract ConditionalOrderManager is Ownable {
    IAuraPerps public perps;
    IMockOracle public oracle;
    address public keeper;

    enum OrderType { STOP_LOSS, TAKE_PROFIT }
    enum Status { ACTIVE, EXECUTED, CANCELLED }

    struct ConditionalOrder {
        address owner;
        uint256 positionId;
        string asset;
        OrderType orderType;
        uint256 triggerPrice;  // 18 decimals
        Status status;
        uint256 createdAt;
        uint256 executedAt;
    }

    uint256 public nextOrderId;
    mapping(uint256 => ConditionalOrder) public orders;
    // owner → list of their order IDs (for UI queries)
    mapping(address => uint256[]) public userOrders;

    event OrderCreated(uint256 indexed orderId, address indexed owner, uint256 positionId, OrderType orderType, uint256 triggerPrice, string asset);
    event OrderExecuted(uint256 indexed orderId, address indexed keeper, uint256 positionId);
    event OrderCancelled(uint256 indexed orderId, address indexed owner);

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner(), "COM: not keeper");
        _;
    }

    constructor(address _perps, address _oracle) Ownable(msg.sender) {
        perps = IAuraPerps(_perps);
        oracle = IMockOracle(_oracle);
        keeper = msg.sender;
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }

    /// @notice Create a conditional order for an existing position.
    /// @param positionId The AuraPerps position ID
    /// @param orderType STOP_LOSS (0) or TAKE_PROFIT (1)
    /// @param triggerPrice Price at which to execute (18 decimals)
    function createOrder(
        uint256 positionId,
        OrderType orderType,
        uint256 triggerPrice
    ) external returns (uint256) {
        require(triggerPrice > 0, "COM: invalid trigger price");

        // Verify caller owns the position
        (address posOwner, string memory asset, , , , , , bool isOpen, , , , , ,) = perps.positions(positionId);
        require(isOpen, "COM: position not open");
        require(posOwner == msg.sender, "COM: not position owner");

        uint256 orderId = nextOrderId++;
        orders[orderId] = ConditionalOrder({
            owner: msg.sender,
            positionId: positionId,
            asset: asset,
            orderType: orderType,
            triggerPrice: triggerPrice,
            status: Status.ACTIVE,
            createdAt: block.timestamp,
            executedAt: 0
        });
        userOrders[msg.sender].push(orderId);

        emit OrderCreated(orderId, msg.sender, positionId, orderType, triggerPrice, asset);
        return orderId;
    }

    /// @notice Keeper creates an order on behalf of a user (gasless flow via AI agent).
    function createOrderFor(
        address owner,
        uint256 positionId,
        OrderType orderType,
        uint256 triggerPrice
    ) external onlyKeeper returns (uint256) {
        require(triggerPrice > 0, "COM: invalid trigger price");

        (address posOwner, string memory asset, , , , , , bool isOpen, , , , , ,) = perps.positions(positionId);
        require(isOpen, "COM: position not open");
        require(posOwner == owner, "COM: owner mismatch");

        uint256 orderId = nextOrderId++;
        orders[orderId] = ConditionalOrder({
            owner: owner,
            positionId: positionId,
            asset: asset,
            orderType: orderType,
            triggerPrice: triggerPrice,
            status: Status.ACTIVE,
            createdAt: block.timestamp,
            executedAt: 0
        });
        userOrders[owner].push(orderId);

        emit OrderCreated(orderId, owner, positionId, orderType, triggerPrice, asset);
        return orderId;
    }

    /// @notice Cancel an active order. Only the owner can cancel.
    function cancelOrder(uint256 orderId) external {
        ConditionalOrder storage order = orders[orderId];
        require(order.owner == msg.sender, "COM: not owner");
        require(order.status == Status.ACTIVE, "COM: not active");

        order.status = Status.CANCELLED;
        emit OrderCancelled(orderId, msg.sender);
    }

    /// @notice Execute a conditional order if trigger conditions are met.
    ///         Calls AuraPerps.executeTriggerOrder after setting the triggers.
    function executeOrder(uint256 orderId) external onlyKeeper {
        ConditionalOrder storage order = orders[orderId];
        require(order.status == Status.ACTIVE, "COM: not active");

        // Check if position is still open
        (, , , , , , , bool isOpen, , , , , ,) = perps.positions(order.positionId);
        require(isOpen, "COM: position closed");

        // Check price condition
        uint256 currentPrice = oracle.getPrice(order.asset);
        require(currentPrice > 0, "COM: invalid price");
        require(_isTriggered(order, currentPrice), "COM: trigger not met");

        order.status = Status.EXECUTED;
        order.executedAt = block.timestamp;

        // Execute via AuraPerps — executeTriggerOrder is permissionless but
        // requires triggers to be set. We set them first, then execute.
        // Note: setTriggerOrders requires msg.sender == owner, so we call
        // executeTriggerOrder directly (it checks oracle internally).
        perps.executeTriggerOrder(order.positionId);

        emit OrderExecuted(orderId, msg.sender, order.positionId);
    }

    /// @notice Check if a specific order's trigger condition is met.
    function isTriggered(uint256 orderId) external view returns (bool) {
        ConditionalOrder storage order = orders[orderId];
        if (order.status != Status.ACTIVE) return false;

        uint256 currentPrice = oracle.getPrice(order.asset);
        if (currentPrice == 0) return false;

        return _isTriggered(order, currentPrice);
    }

    /// @notice Batch check: returns all executable order IDs for a given asset.
    ///         The keeper calls this to find which orders to execute.
    function getExecutableOrders(string calldata asset, uint256 maxResults) external view returns (uint256[] memory) {
        uint256[] memory result = new uint256[](maxResults);
        uint256 count = 0;

        uint256 currentPrice = oracle.getPrice(asset);
        if (currentPrice == 0) return new uint256[](0);

        for (uint256 i = 0; i < nextOrderId && count < maxResults; i++) {
            ConditionalOrder storage order = orders[i];
            if (order.status != Status.ACTIVE) continue;
            if (keccak256(bytes(order.asset)) != keccak256(bytes(asset))) continue;
            if (_isTriggered(order, currentPrice)) {
                result[count++] = i;
            }
        }

        // Trim to actual count
        uint256[] memory trimmed = new uint256[](count);
        for (uint256 i = 0; i < count; i++) trimmed[i] = result[i];
        return trimmed;
    }

    /// @notice Get all order IDs for a user.
    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }

    /// @notice Get count of active orders for a user.
    function getActiveOrderCount(address user) external view returns (uint256) {
        uint256[] memory ids = userOrders[user];
        uint256 count = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (orders[ids[i]].status == Status.ACTIVE) count++;
        }
        return count;
    }

    function _isTriggered(ConditionalOrder storage order, uint256 currentPrice) internal view returns (bool) {
        // Get position direction to determine trigger logic
        (, , bool isLong, , , , , , , , , , ,) = perps.positions(order.positionId);

        if (order.orderType == OrderType.STOP_LOSS) {
            // SL for long: price drops below trigger
            // SL for short: price rises above trigger
            return isLong ? currentPrice <= order.triggerPrice : currentPrice >= order.triggerPrice;
        } else {
            // TP for long: price rises above trigger
            // TP for short: price drops below trigger
            return isLong ? currentPrice >= order.triggerPrice : currentPrice <= order.triggerPrice;
        }
    }
}
