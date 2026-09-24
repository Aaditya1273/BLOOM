// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RiskLib} from "../risk/RiskLib.sol";
import {IRiskEngine} from "../interfaces/IRiskEngine.sol";

/// @notice Test-only harness exposing the pure risk classification for vector tests.
contract RiskLibHarness {
    function classify(RiskLib.Inputs memory i) external pure returns (uint8 state, uint256 price) {
        IRiskEngine.RiskState s;
        (s, price) = RiskLib.classify(i);
        state = uint8(s);
    }
}
