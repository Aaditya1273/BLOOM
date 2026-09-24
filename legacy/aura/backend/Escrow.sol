pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IOrderBook {
    function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256);
    function cancel_order(uint256 order_id, address caller) external returns (bool);
    function get_order(uint256 order_id) external view returns (address, uint256, bool, uint256, uint256, uint256, uint256, uint256);
    function mark_executed(uint256 order_id) external returns (bool);
}

contract AuraCrossChainEscrow {
    address public ausd;
    address public orderbook;
    address public keeper;
    address public owner;

    event CrossChainSettlementRequested(uint256 indexed order_id, address indexed owner, uint256 collateral, bool is_long, uint256 leverage, uint256 asset_hash);
    event OrderPlaced(uint256 indexed order_id, address indexed owner);
    event OrderCancelled(uint256 indexed order_id, address indexed owner);

    function init(address _ausd, address _orderbook, address _keeper) external {
        require(owner == address(0), "Already initialized");
        owner = msg.sender;
        ausd = _ausd;
        orderbook = _orderbook;
        keeper = _keeper;
    }

    function place_limit_order(uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256) {
        require(IERC20(ausd).transferFrom(msg.sender, address(this), collateral), "TransferFrom failed");
        uint256 order_id = IOrderBook(orderbook).store_order(msg.sender, asset_hash, is_long, collateral, leverage, limit_price);
        require(order_id != type(uint256).max, "OrderBook rejected order");
        return order_id;
    }

    function cancel_order(uint256 order_id, address caller) external {
        require(msg.sender == caller, "Not caller");
        (address owner_addr, , , uint256 collateral, , , , ) = IOrderBook(orderbook).get_order(order_id);
        require(msg.sender == owner_addr, "Not owner");
        
        require(IOrderBook(orderbook).cancel_order(order_id, msg.sender), "OrderBook cancel failed");
        
        require(IERC20(ausd).transfer(msg.sender, collateral), "Refund failed");
        emit OrderCancelled(order_id, msg.sender);
    }

    function execute_and_bridge(uint256 order_id) external {
        require(msg.sender == keeper || msg.sender == owner, "Only keeper or owner");
        (address owner_addr, , bool is_long, uint256 collateral, uint256 leverage, , , ) = IOrderBook(orderbook).get_order(order_id);
        
        require(IOrderBook(orderbook).mark_executed(order_id), "OrderBook mark_executed failed");
        
        // Transfer collateral to keeper so it can be bridged
        require(IERC20(ausd).transfer(keeper, collateral), "Transfer to keeper failed");
        emit CrossChainSettlementRequested(order_id, owner_addr, collateral, is_long, leverage, 0);
    }
}
