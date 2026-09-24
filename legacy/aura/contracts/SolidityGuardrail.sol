// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SolidityGuardrail
 * @dev Pure-Solidity reference implementation of the Stylus WASM Guardrail.
 *      Identical logic for gas benchmarking comparison.
 */
contract SolidityGuardrail {
    address public owner;
    address public router;
    bool public initialized;

    uint256 public max_leverage;
    uint256 public max_position_size;
    uint256 public min_collateral;
    uint256 public daily_volume_cap;

    mapping(address => uint256) public user_daily_volume;
    mapping(address => uint256) public user_last_reset_day;
    mapping(uint256 => bool) public allowed_assets;

    uint256 public total_validations;
    uint256 public total_rejections;

    function initialize(
        address _router,
        uint256 _max_leverage,
        uint256 _max_position_size,
        uint256 _min_collateral,
        uint256 _daily_volume_cap
    ) external {
        require(!initialized, "already initialized");
        owner = msg.sender;
        router = _router;
        max_leverage = _max_leverage;
        max_position_size = _max_position_size;
        min_collateral = _min_collateral;
        daily_volume_cap = _daily_volume_cap;
        initialized = true;
    }

    function validate_trade(
        address user,
        uint256 asset_hash,
        uint256 collateral,
        uint256 leverage
    ) external returns (bool, uint256) {
        total_validations++;

        // Check 1: Asset whitelist
        if (!allowed_assets[asset_hash]) {
            total_rejections++;
            return (false, 4);
        }

        // Check 2: Leverage cap
        if (leverage > max_leverage) {
            total_rejections++;
            return (false, 1);
        }

        // Check 3: Min collateral
        if (collateral < min_collateral) {
            total_rejections++;
            return (false, 5);
        }

        // Check 4: Position size
        uint256 position_size = collateral * leverage;
        if (position_size > max_position_size) {
            total_rejections++;
            return (false, 2);
        }

        // Check 5: Daily volume cap
        uint256 current_day = block.timestamp / 86400;
        if (current_day > user_last_reset_day[user]) {
            user_daily_volume[user] = 0;
            user_last_reset_day[user] = current_day;
        }

        uint256 new_vol = user_daily_volume[user] + position_size;
        if (daily_volume_cap > 0 && new_vol > daily_volume_cap) {
            total_rejections++;
            return (false, 3);
        }

        user_daily_volume[user] = new_vol;
        return (true, 0);
    }

    function allow_asset(uint256 asset_hash) external {
        require(msg.sender == owner, "not owner");
        allowed_assets[asset_hash] = true;
    }

    function disallow_asset(uint256 asset_hash) external {
        require(msg.sender == owner, "not owner");
        allowed_assets[asset_hash] = false;
    }

    function set_params(
        uint256 _max_leverage,
        uint256 _max_position_size,
        uint256 _min_collateral,
        uint256 _daily_volume_cap
    ) external {
        require(msg.sender == owner, "not owner");
        max_leverage = _max_leverage;
        max_position_size = _max_position_size;
        min_collateral = _min_collateral;
        daily_volume_cap = _daily_volume_cap;
    }

    function get_params() external view returns (uint256, uint256, uint256, uint256) {
        return (max_leverage, max_position_size, min_collateral, daily_volume_cap);
    }

    function get_stats() external view returns (uint256, uint256) {
        return (total_validations, total_rejections);
    }

    function get_user_daily_volume(address user) external view returns (uint256) {
        return user_daily_volume[user];
    }

    function is_asset_allowed(uint256 asset_hash) external view returns (bool) {
        return allowed_assets[asset_hash];
    }
}
