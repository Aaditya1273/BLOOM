// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BloomPolicy} from "../../contracts/BloomPolicy.sol";
import {BloomAssetRegistry} from "../../contracts/BloomAssetRegistry.sol";
import {BloomRiskEngineEVM} from "../../contracts/risk/BloomRiskEngineEVM.sol";
import {MockUSDG} from "../../contracts/mocks/MockUSDG.sol";
import {IBloomAssetRegistry} from "../../contracts/interfaces/IBloomAssetRegistry.sol";
import {IRiskEngine} from "../../contracts/interfaces/IRiskEngine.sol";

/// Fuzzes arbitrary agent calldata: nothing outside the closed (target, selector) set may ever be authorised.
contract BloomPolicyFuzzTest is Test {
    BloomPolicy policy;
    MockUSDG usdg;
    address constant VAULT = address(0x7A017);
    address constant ROUTER = address(0x7A018);
    address constant CLAIMS = address(0x7A019);
    address account = address(this); // this contract acts as the smart account
    address agent = address(0xA9E17);

    function owner() external view returns (address) {
        return address(this);
    }

    function setUp() public {
        usdg = new MockUSDG(address(this));
        BloomAssetRegistry registry = new BloomAssetRegistry(address(this), block.chainid);
        registry.registerAsset("USDG", address(usdg), address(0), 6, IBloomAssetRegistry.AssetKind.STABLE);
        BloomRiskEngineEVM engine = new BloomRiskEngineEVM(address(this), 3600);
        policy = new BloomPolicy(registry, IRiskEngine(address(engine)), VAULT, ROUTER, CLAIMS);
        address[] memory assets = new address[](1);
        assets[0] = address(usdg);
        policy.createGoal(
            account,
            BloomPolicy.GoalParams("Laptop", 500e6, uint64(block.timestamp + 30 days), 50e18, 50e18, 3000, assets)
        );
        policy.activateGoal(1, agent);
    }

    function testFuzz_onlyAllowedSurface(address target, bytes calldata data, uint256 value) public view {
        (bool ok,,,) = policy.preview(account, agent, target, value, data);
        if (!ok) return;
        assertEq(value, 0, "native value authorised");
        bytes4 sel = bytes4(data[:4]);
        bool allowed = (target == address(usdg) && sel == 0x095ea7b3)
            || (target == VAULT && sel == 0x6e553f65)
            || (target == ROUTER && (sel == bytes4(keccak256("send(address,address,uint256,bytes32)"))
                || sel == bytes4(keccak256("swap(address,address,address,uint256,uint256,uint256)"))))
            || (target == CLAIMS && sel == bytes4(keccak256("createClaim(bytes32,address,uint256,address,uint64)")));
        assertTrue(allowed, "call outside the closed agent surface was authorised");
    }

    function testFuzz_otherAgentsNeverAuthorised(address otherAgent, address target, bytes calldata data) public view {
        vm.assume(otherAgent != agent);
        (bool ok,,,) = policy.preview(account, otherAgent, target, 0, data);
        assertFalse(ok);
    }

    function testFuzz_depositOnlyToSelf(address receiver, uint256 amount) public view {
        vm.assume(receiver != account);
        bytes memory data = abi.encodeWithSelector(0x6e553f65, amount, receiver);
        (bool ok,,,) = policy.preview(account, agent, VAULT, 0, data);
        assertFalse(ok);
    }

    function testFuzz_capsEnforced(uint256 amount) public view {
        bytes memory data = abi.encodeWithSelector(0x6e553f65, amount, account);
        (bool ok,,, uint256 spend) = policy.preview(account, agent, VAULT, 0, data);
        if (ok) {
            assertLe(spend, 50e18);
            assertGt(amount, 0);
        } else if (amount > 0 && amount <= 50e6) {
            revert("in-cap deposit rejected");
        }
    }
}
