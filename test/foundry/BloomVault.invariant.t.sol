// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BloomVault} from "../../contracts/BloomVault.sol";
import {BloomAssetRegistry} from "../../contracts/BloomAssetRegistry.sol";
import {BloomRiskEngineEVM} from "../../contracts/risk/BloomRiskEngineEVM.sol";
import {MockUSDG} from "../../contracts/mocks/MockUSDG.sol";
import {IBloomAssetRegistry} from "../../contracts/interfaces/IBloomAssetRegistry.sol";
import {IRiskEngine} from "../../contracts/interfaces/IRiskEngine.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Random deposits, withdrawals, redemptions and direct donations by several actors.
contract VaultHandler is Test {
    BloomVault public vault;
    MockUSDG public usdg;
    address[] public actors;
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalDonated;

    constructor(BloomVault v, MockUSDG u) {
        vault = v;
        usdg = u;
        for (uint256 i; i < 4; ++i) actors.push(address(uint160(0xA11CE + i)));
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = bound(amount, 1, 1_000_000e6);
        usdg.mint(a, amount);
        vm.startPrank(a);
        usdg.approve(address(vault), amount);
        vault.deposit(amount, a);
        vm.stopPrank();
        totalDeposited += amount;
    }

    function withdraw(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 max = vault.maxWithdraw(a);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(a);
        vault.withdraw(amount, a, a);
        totalWithdrawn += amount;
    }

    function redeem(uint256 seed, uint256 shares) external {
        address a = _actor(seed);
        uint256 max = vault.maxRedeem(a);
        if (max == 0) return;
        shares = bound(shares, 1, max);
        vm.prank(a);
        totalWithdrawn += vault.redeem(shares, a, a);
    }

    function donate(uint256 amount) external {
        amount = bound(amount, 1, 100_000e6);
        usdg.mint(address(this), amount);
        usdg.transfer(address(vault), amount);
        totalDonated += amount;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}

contract BloomVaultInvariantTest is Test {
    BloomVault vault;
    MockUSDG usdg;
    VaultHandler handler;

    function setUp() public {
        usdg = new MockUSDG(address(this));
        BloomAssetRegistry registry = new BloomAssetRegistry(address(this), block.chainid);
        registry.registerAsset("USDG", address(usdg), address(0), 6, IBloomAssetRegistry.AssetKind.STABLE);
        BloomRiskEngineEVM engine = new BloomRiskEngineEVM(address(this), 3600);
        vault = new BloomVault(IERC20(address(usdg)), registry, IRiskEngine(address(engine)), address(this));
        handler = new VaultHandler(vault, usdg);
        usdg.grantRole(usdg.MINTER_ROLE(), address(handler));
        targetContract(address(handler));
    }

    /// The vault always holds enough to redeem every share (solvency, rounding in the vault's favour).
    function invariant_solvent() public view {
        uint256 claims;
        for (uint256 i; i < handler.actorCount(); ++i) {
            claims += vault.previewRedeem(vault.balanceOf(handler.actors(i)));
        }
        assertLe(claims, vault.totalAssets());
    }

    /// totalAssets is exactly idle USDG (no adapter, no debt in this handler).
    function invariant_accounting() public view {
        assertEq(vault.totalAssets(), usdg.balanceOf(address(vault)));
        assertEq(vault.totalAssets(), handler.totalDeposited() + handler.totalDonated() - handler.totalWithdrawn());
    }

    /// Share price never drops below 1 USDG per 1e6 shares (offset) — deposits/withdrawals cannot dilute holders.
    function invariant_sharePriceNonDecreasing() public view {
        if (vault.totalSupply() == 0) return;
        assertGe(vault.convertToAssets(1e18), 1e12 - 1);
    }
}
