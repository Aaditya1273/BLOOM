// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RiskLib} from "../../contracts/risk/RiskLib.sol";
import {IRiskEngine} from "../../contracts/interfaces/IRiskEngine.sol";

/// Property-based tests for the risk classification (default-deny safety properties).
contract RiskLibFuzzTest is Test {
    function _classify(RiskLib.Inputs memory i) external pure returns (uint8, uint256) {
        (IRiskEngine.RiskState s, uint256 p) = RiskLib.classify(i);
        return (uint8(s), p);
    }

    /// classify is total: it never reverts, whatever the (possibly hostile) oracle / report inputs are.
    function testFuzz_neverReverts(RiskLib.Inputs memory i) public view {
        this._classify(i);
    }

    /// NORMAL implies every guard holds (the core default-deny property).
    function testFuzz_normalImpliesAllGuards(RiskLib.Inputs memory i) public view {
        (uint8 s, uint256 price) = this._classify(i);
        if (s != uint8(IRiskEngine.RiskState.NORMAL)) return;
        assertTrue(i.configured, "unconfigured asset was NORMAL");
        assertTrue(i.feedOk && i.answer > 0 && i.updatedAt != 0 && i.updatedAt <= i.now_, "invalid price was NORMAL");
        assertLe(i.now_ - i.updatedAt, i.heartbeat, "stale price was NORMAL");
        assertGe(i.answeredInRound, i.roundId, "incomplete round was NORMAL");
        assertGt(price, 0);
        assertLe(price, RiskLib.MAX_PRICE);
        if (i.sequencerRequired) {
            assertTrue(i.sequencerOk && i.sequencerAnswer == 0, "sequencer down was NORMAL");
            assertGt(i.now_ - i.sequencerStartedAt, i.sequencerGrace, "grace period was NORMAL");
        }
        if (i.isStockToken) {
            assertTrue(i.hasReport && i.reportObservedAt <= i.now_, "missing/future report was NORMAL");
            assertLe(i.now_ - i.reportObservedAt, i.maxReportAge, "stale report was NORMAL");
            assertFalse(i.halted, "halted was NORMAL");
            assertTrue(i.tokenOk && !i.tokenOraclePaused && !i.reportCorpActionPaused, "corporate action was NORMAL");
            assertTrue(i.reportMultiplier == 0 || i.reportMultiplier == i.tokenMultiplier, "multiplier mismatch was NORMAL");
        }
        if (i.referencePrice != 0) {
            uint256 diff = price > i.referencePrice ? price - i.referencePrice : i.referencePrice - price;
            assertLe(diff * 10_000, uint256(i.deviationBps) * i.referencePrice, "deviation was NORMAL");
        }
    }

    /// A halt on an otherwise healthy stock always yields HALTED (never NORMAL / DEVIATION).
    function testFuzz_haltAlwaysDetected(uint64 now_, uint64 age, int128 answer) public view {
        now_ = uint64(bound(now_, 1_000_000, type(uint64).max / 2));
        age = uint64(bound(age, 0, 3600));
        answer = int128(bound(answer, 1, 1e20));
        RiskLib.Inputs memory i;
        i.now_ = now_;
        i.configured = true;
        i.isStockToken = true;
        i.heartbeat = 3600;
        i.deviationBps = 500;
        i.feedOk = true;
        i.roundId = 1;
        i.answeredInRound = 1;
        i.answer = answer;
        i.updatedAt = now_ - age;
        i.feedDecimals = 8;
        i.hasReport = true;
        i.reportObservedAt = now_;
        i.maxReportAge = 300;
        i.halted = true;
        i.tokenOk = true;
        (uint8 s,) = this._classify(i);
        assertEq(s, uint8(IRiskEngine.RiskState.HALTED));
    }

    /// normalize never overflows and stays within [1, MAX_PRICE] when ok.
    function testFuzz_normalizeBounded(int256 answer, uint8 dec) public pure {
        (bool ok, uint256 p) = RiskLib.normalize(answer, dec);
        if (ok) {
            assertGt(p, 0);
            assertLe(p, RiskLib.MAX_PRICE);
        } else {
            assertEq(p, 0);
        }
    }
}
