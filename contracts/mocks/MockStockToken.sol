// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MockStockToken — TESTNET MOCK
/// @notice 18-decimal stand-in for a Robinhood Stock Token on testnet (no official testnet Stock Tokens exist).
///         Mirrors the verified mainnet read surface: uiMultiplier(), newUIMultiplier(), effectiveAt(), oraclePaused().
///         CORP_ACTION_ROLE simulates corporate actions for the demo. Raw balances are never rescaled.
contract MockStockToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant CORP_ACTION_ROLE = keccak256("CORP_ACTION_ROLE");

    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier = 1e18;
    uint256 public effectiveAt;
    bool public oraclePaused;

    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
    event OraclePausedSet(bool paused);

    error InvalidMultiplier();

    constructor(string memory name_, string memory symbol_, address admin) ERC20(name_, symbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(CORP_ACTION_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function setOraclePaused(bool paused) external onlyRole(CORP_ACTION_ROLE) {
        oraclePaused = paused;
        emit OraclePausedSet(paused);
    }

    /// @notice Apply a multiplier change immediately (e.g. a simulated 2:1 split => 2e18).
    function setUIMultiplier(uint256 multiplier) external onlyRole(CORP_ACTION_ROLE) {
        if (multiplier == 0) revert InvalidMultiplier();
        emit UIMultiplierUpdated(uiMultiplier, multiplier, block.timestamp);
        uiMultiplier = multiplier;
        newUIMultiplier = multiplier;
        effectiveAt = block.timestamp;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return balanceOf(account) * uiMultiplier / 1e18;
    }
}
