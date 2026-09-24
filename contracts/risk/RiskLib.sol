// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiskEngine} from "../interfaces/IRiskEngine.sol";

/// @title RiskLib
/// @notice Pure, deterministic equity-aware risk classification.
/// @dev This is the specification mirrored 1:1 by `stylus-risk-engine/src/risk.rs`.
///      Both implementations are checked against the shared vectors in `test/vectors/risk-vectors.json`.
///      Evaluation order (first match wins, default-deny):
///        UNSUPPORTED -> SEQUENCER_DOWN -> INVALID_PRICE -> STALE(price) -> STALE(report)
///        -> HALTED -> CORP_ACTION_PAUSED -> DEVIATION -> NORMAL
library RiskLib {
    uint256 internal constant BPS = 10_000;

    struct Inputs {
        uint64 now_;
        // asset configuration
        bool configured; // registered and enabled
        bool isStockToken; // requires market-status reports and corporate-action checks
        uint64 heartbeat; // max oracle age, seconds
        uint16 deviationBps; // max |oracle - reference| / reference
        // sequencer uptime feed (Chainlink semantics: answer 0 = up, 1 = down)
        bool sequencerRequired;
        bool sequencerOk; // call succeeded
        int256 sequencerAnswer;
        uint256 sequencerStartedAt;
        uint64 sequencerGrace;
        // price feed
        bool feedOk; // call succeeded
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 answeredInRound;
        uint8 feedDecimals;
        // signed market-status report
        bool hasReport;
        uint64 reportObservedAt;
        uint64 maxReportAge;
        bool halted;
        bool reportCorpActionPaused;
        uint256 reportMultiplier; // 0 = not reported
        uint256 referencePrice; // 1e18, 0 = no reference
        // on-chain stock token hooks
        bool tokenOk; // uiMultiplier()/oraclePaused() calls succeeded
        bool tokenOraclePaused;
        uint256 tokenMultiplier;
    }

    /// @notice Upper bound for any normalised price (1e18 = $1). Larger values are treated as invalid.
    /// @dev Keeps all later arithmetic far from overflow in both the EVM and Stylus implementations.
    uint256 internal constant MAX_PRICE = 1e36;

    /// @notice Normalise a positive feed answer to 1e18. Returns (false, 0) for non-positive, zero-after-scaling
    ///         or out-of-range values.
    function normalize(int256 answer, uint8 decimals_) internal pure returns (bool ok, uint256 price) {
        if (answer <= 0) return (false, 0);
        uint256 a = uint256(answer);
        if (a > MAX_PRICE) return (false, 0); // also bounds the up-scaling below
        if (decimals_ <= 18) {
            price = a * (10 ** (18 - decimals_)); // <= 1e36 * 1e18, cannot overflow
        } else {
            if (decimals_ > 36) return (false, 0);
            price = a / (10 ** (decimals_ - 18));
        }
        if (price == 0 || price > MAX_PRICE) return (false, 0);
        return (true, price);
    }

    /// @notice True when |price - reference| / reference > deviationBps / 10_000.
    ///         A reference above MAX_PRICE is treated as deviating (default-deny). reference == 0 means "no reference".
    function deviates(uint256 price, uint256 ref, uint16 deviationBps) internal pure returns (bool) {
        if (ref == 0) return false;
        if (ref > MAX_PRICE) return true;
        uint256 diff = price > ref ? price - ref : ref - price;
        return diff * BPS > uint256(deviationBps) * ref; // both sides <= 1e40
    }

    function classify(Inputs memory i) internal pure returns (IRiskEngine.RiskState state, uint256 price) {
        if (!i.configured) return (IRiskEngine.RiskState.UNSUPPORTED, 0);

        if (i.sequencerRequired) {
            if (!i.sequencerOk || i.sequencerAnswer != 0 || i.sequencerStartedAt == 0) {
                return (IRiskEngine.RiskState.SEQUENCER_DOWN, 0);
            }
            // grace period after the sequencer comes back up
            if (i.sequencerStartedAt > i.now_ || i.now_ - i.sequencerStartedAt <= i.sequencerGrace) {
                return (IRiskEngine.RiskState.SEQUENCER_DOWN, 0);
            }
        }

        if (!i.feedOk || i.updatedAt == 0 || i.updatedAt > i.now_ || i.answeredInRound < i.roundId) {
            return (IRiskEngine.RiskState.INVALID_PRICE, 0);
        }
        bool ok;
        (ok, price) = normalize(i.answer, i.feedDecimals);
        if (!ok) return (IRiskEngine.RiskState.INVALID_PRICE, 0);

        if (i.now_ - i.updatedAt > i.heartbeat) return (IRiskEngine.RiskState.STALE, price);

        if (i.isStockToken) {
            if (!i.hasReport || i.reportObservedAt > i.now_ || i.now_ - i.reportObservedAt > i.maxReportAge) {
                return (IRiskEngine.RiskState.STALE, price);
            }
            if (i.halted) return (IRiskEngine.RiskState.HALTED, price);
            if (
                !i.tokenOk || i.tokenOraclePaused || i.reportCorpActionPaused
                    || (i.reportMultiplier != 0 && i.reportMultiplier != i.tokenMultiplier)
            ) {
                return (IRiskEngine.RiskState.CORP_ACTION_PAUSED, price);
            }
        }

        if (deviates(price, i.referencePrice, i.deviationBps)) return (IRiskEngine.RiskState.DEVIATION, price);

        return (IRiskEngine.RiskState.NORMAL, price);
    }

    /// @notice Whether the oracle price may still be displayed / used for valuation in this state.
    function priceTrusted(IRiskEngine.RiskState s) internal pure returns (bool) {
        return s != IRiskEngine.RiskState.UNSUPPORTED && s != IRiskEngine.RiskState.SEQUENCER_DOWN
            && s != IRiskEngine.RiskState.INVALID_PRICE;
    }
}
