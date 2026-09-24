// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MockUSDG — TESTNET MOCK
/// @notice 6-decimal stand-in for Paxos USDG on Robinhood Chain testnet, where no official USDG exists.
///         Minting is restricted to MINTER_ROLE (the Bloom testnet faucet key). Never deploy on mainnet:
///         mainnet uses canonical USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168.
contract MockUSDG is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant MAX_MINT_PER_CALL = 1_000_000e6;

    event TestnetMint(address indexed minter, address indexed to, uint256 amount);

    error MintTooLarge(uint256 amount);

    constructor(address admin) ERC20("Mock USDG (testnet)", "USDG") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (amount > MAX_MINT_PER_CALL) revert MintTooLarge(amount);
        _mint(to, amount);
        emit TestnetMint(msg.sender, to, amount);
    }
}
