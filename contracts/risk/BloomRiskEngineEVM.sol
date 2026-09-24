// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IRiskEngine} from "../interfaces/IRiskEngine.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {IStockToken} from "../interfaces/IStockToken.sol";
import {RiskLib} from "./RiskLib.sol";

/// @title BloomRiskEngineEVM
/// @notice EVM reference implementation of the Bloom equity-aware risk engine.
/// @dev Production deployments on Robinhood Chain use the Stylus engine in `stylus-risk-engine/`, which exposes the
///      same ABI, the same EIP-712 domain and the same classification rules (RiskLib). This contract exists so the
///      full system can be exercised in Hardhat (which cannot execute WASM) and so both implementations can be
///      differentially tested against shared vectors.
///
///      Bloom does not replace the price oracle. It interprets Chainlink-style prices together with signed
///      market-status reports (trading halts, corporate actions), freshness, deviation and sequencer uptime.
contract BloomRiskEngineEVM is IRiskEngine, Ownable2Step, EIP712 {
    bytes32 public constant REPORT_TYPEHASH = keccak256(
        "MarketReport(address asset,bool halted,bool corporateActionPaused,uint256 uiMultiplier,uint256 referencePrice,uint64 observedAt,uint64 nonce)"
    );

    uint16 public constant MAX_LTV_CAP_BPS = 8000;
    uint16 public constant MAX_DEVIATION_BPS = 5000;

    struct AssetConfig {
        address feed;
        uint64 heartbeat;
        uint16 deviationBps;
        uint16 maxLtvBps;
        uint8 feedDecimals;
        bool isStockToken;
        bool enabled;
    }

    struct MarketReport {
        bool halted;
        bool corporateActionPaused;
        uint256 uiMultiplier;
        uint256 referencePrice;
        uint64 observedAt;
        uint64 nonce;
    }

    struct Snapshot {
        uint8 state;
        uint256 lastValidPrice;
        uint256 lastUpdatedAt;
    }

    mapping(address => AssetConfig) internal _configs;
    mapping(address => MarketReport) internal _reports;
    mapping(address => Snapshot) internal _snapshots;
    mapping(address => bool) public isReporter;

    address public sequencerFeed;
    uint64 public sequencerGrace;
    bool public sequencerRequired;
    bool public lastSequencerUp;

    uint64 public maxReportAge;

    // ─── events ───
    event RiskStateChanged(address indexed asset, uint8 previousState, uint8 newState);
    event PriceUpdated(address indexed asset, uint256 price, uint256 updatedAt);
    event HaltUpdated(address indexed asset, bool halted, uint64 observedAt, uint64 nonce, address reporter);
    event CorporateActionStateChanged(address indexed asset, bool paused, uint256 uiMultiplier);
    event ReporterUpdated(address indexed reporter, bool allowed);
    event SequencerStateChanged(bool up);
    event SequencerConfigUpdated(address feed, uint64 grace, bool required);
    event AssetConfigured(
        address indexed asset,
        address feed,
        uint64 heartbeat,
        uint16 deviationBps,
        uint16 maxLtvBps,
        bool isStockToken,
        bool enabled
    );
    event MaxReportAgeUpdated(uint64 maxReportAge);

    // ─── errors ───
    error ZeroAddress();
    error InvalidConfig();
    error AssetNotConfigured(address asset);
    error UnauthorizedReporter(address signer);
    error InvalidSignature();
    error ReplayedNonce(uint64 nonce, uint64 lastNonce);
    error ReportFromFuture(uint64 observedAt);
    error StaleReport(uint64 observedAt);
    error OutOfOrderReport(uint64 observedAt, uint64 lastObservedAt);
    error InvalidReferencePrice();

    constructor(address initialOwner, uint64 maxReportAge_)
        Ownable(initialOwner)
        EIP712("BloomRiskEngine", "1")
    {
        if (maxReportAge_ == 0) revert InvalidConfig();
        maxReportAge = maxReportAge_;
        emit MaxReportAgeUpdated(maxReportAge_);
    }

    // ═══════════════════════════ admin ═══════════════════════════

    function setAssetConfig(
        address asset,
        address feed,
        uint64 heartbeat,
        uint16 deviationBps,
        uint16 maxLtvBps,
        bool isStockToken,
        bool enabled
    ) external onlyOwner {
        if (asset == address(0) || feed == address(0)) revert ZeroAddress();
        if (heartbeat == 0 || deviationBps == 0 || deviationBps > MAX_DEVIATION_BPS || maxLtvBps > MAX_LTV_CAP_BPS) {
            revert InvalidConfig();
        }
        uint8 dec = IAggregatorV3(feed).decimals();
        if (dec > 36) revert InvalidConfig();
        _configs[asset] = AssetConfig(feed, heartbeat, deviationBps, maxLtvBps, dec, isStockToken, enabled);
        emit AssetConfigured(asset, feed, heartbeat, deviationBps, maxLtvBps, isStockToken, enabled);
    }

    function setReporter(address reporter, bool allowed) external onlyOwner {
        if (reporter == address(0)) revert ZeroAddress();
        isReporter[reporter] = allowed;
        emit ReporterUpdated(reporter, allowed);
    }

    /// @notice Configure the L2 sequencer uptime feed. `required = false` must be an explicit admin decision
    ///         (e.g. a chain without an official uptime feed) and is visible onchain via SequencerConfigUpdated.
    function setSequencerConfig(address feed, uint64 grace, bool required) external onlyOwner {
        if (required && feed == address(0)) revert ZeroAddress();
        sequencerFeed = feed;
        sequencerGrace = grace;
        sequencerRequired = required;
        emit SequencerConfigUpdated(feed, grace, required);
    }

    function setMaxReportAge(uint64 maxReportAge_) external onlyOwner {
        if (maxReportAge_ == 0) revert InvalidConfig();
        maxReportAge = maxReportAge_;
        emit MaxReportAgeUpdated(maxReportAge_);
    }

    // ═══════════════════════════ reports ═══════════════════════════

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function reportDigest(
        address asset,
        bool halted,
        bool corporateActionPaused,
        uint256 uiMultiplier,
        uint256 referencePrice,
        uint64 observedAt,
        uint64 nonce
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REPORT_TYPEHASH, asset, halted, corporateActionPaused, uiMultiplier, referencePrice, observedAt, nonce
                )
            )
        );
    }

    /// @notice Submit a market-status report signed (EIP-712) by an allowlisted reporter. Anyone may relay it.
    function submitReport(
        address asset,
        bool halted,
        bool corporateActionPaused,
        uint256 uiMultiplier,
        uint256 referencePrice,
        uint64 observedAt,
        uint64 nonce,
        bytes calldata signature
    ) external returns (uint8 state) {
        AssetConfig memory cfg = _configs[asset];
        if (cfg.feed == address(0)) revert AssetNotConfigured(asset);

        MarketReport memory prev = _reports[asset];
        if (nonce <= prev.nonce) revert ReplayedNonce(nonce, prev.nonce);
        if (observedAt > block.timestamp) revert ReportFromFuture(observedAt);
        if (block.timestamp - observedAt > maxReportAge) revert StaleReport(observedAt);
        if (observedAt < prev.observedAt) revert OutOfOrderReport(observedAt, prev.observedAt);
        if (referencePrice > RiskLib.MAX_PRICE) revert InvalidReferencePrice();

        bytes32 digest =
            reportDigest(asset, halted, corporateActionPaused, uiMultiplier, referencePrice, observedAt, nonce);
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) revert InvalidSignature();
        if (!isReporter[signer]) revert UnauthorizedReporter(signer);

        _reports[asset] = MarketReport(halted, corporateActionPaused, uiMultiplier, referencePrice, observedAt, nonce);

        emit HaltUpdated(asset, halted, observedAt, nonce, signer);
        if (prev.corporateActionPaused != corporateActionPaused || prev.uiMultiplier != uiMultiplier) {
            emit CorporateActionStateChanged(asset, corporateActionPaused, uiMultiplier);
        }
        return _refresh(asset);
    }

    // ═══════════════════════════ evaluation ═══════════════════════════

    function getRisk(address asset)
        external
        view
        returns (
            uint8 state,
            uint16 maxLtvBps,
            bool borrowingAllowed,
            bool liquidationAllowed,
            uint256 price,
            uint256 updatedAt
        )
    {
        RiskLib.Inputs memory inp = _inputs(asset);
        (RiskState s, uint256 p) = RiskLib.classify(inp);
        state = uint8(s);
        bool normal = s == RiskState.NORMAL;
        maxLtvBps = normal ? _configs[asset].maxLtvBps : 0;
        borrowingAllowed = normal;
        liquidationAllowed = normal;
        if (RiskLib.priceTrusted(s)) {
            price = p;
            updatedAt = inp.updatedAt;
        }
    }

    function refresh(address asset) external returns (uint8) {
        return _refresh(asset);
    }

    function _refresh(address asset) internal returns (uint8) {
        RiskLib.Inputs memory inp = _inputs(asset);
        (RiskState s, uint256 p) = RiskLib.classify(inp);

        if (sequencerRequired) {
            bool up = inp.sequencerOk && inp.sequencerAnswer == 0;
            if (up != lastSequencerUp) {
                lastSequencerUp = up;
                emit SequencerStateChanged(up);
            }
        }

        Snapshot storage snap = _snapshots[asset];
        if (RiskLib.priceTrusted(s) && (p != snap.lastValidPrice || inp.updatedAt != snap.lastUpdatedAt)) {
            snap.lastValidPrice = p;
            snap.lastUpdatedAt = inp.updatedAt;
            emit PriceUpdated(asset, p, inp.updatedAt);
        }
        uint8 newState = uint8(s);
        if (newState != snap.state) {
            emit RiskStateChanged(asset, snap.state, newState);
            snap.state = newState;
        }
        return newState;
    }

    function _inputs(address asset) internal view returns (RiskLib.Inputs memory i) {
        AssetConfig memory cfg = _configs[asset];
        i.now_ = uint64(block.timestamp);
        i.configured = cfg.feed != address(0) && cfg.enabled;
        if (!i.configured) return i;
        i.isStockToken = cfg.isStockToken;
        i.heartbeat = cfg.heartbeat;
        i.deviationBps = cfg.deviationBps;
        i.feedDecimals = cfg.feedDecimals;

        i.sequencerRequired = sequencerRequired;
        i.sequencerGrace = sequencerGrace;
        if (sequencerRequired) {
            try IAggregatorV3(sequencerFeed).latestRoundData() returns (
                uint80, int256 answer, uint256 startedAt, uint256, uint80
            ) {
                i.sequencerOk = true;
                i.sequencerAnswer = answer;
                i.sequencerStartedAt = startedAt;
            } catch {}
        }

        try IAggregatorV3(cfg.feed).latestRoundData() returns (
            uint80 roundId, int256 answer, uint256, uint256 updatedAt, uint80 answeredInRound
        ) {
            i.feedOk = true;
            i.roundId = roundId;
            i.answer = answer;
            i.updatedAt = updatedAt;
            i.answeredInRound = answeredInRound;
        } catch {}

        MarketReport memory r = _reports[asset];
        i.hasReport = r.nonce != 0;
        i.reportObservedAt = r.observedAt;
        i.maxReportAge = maxReportAge;
        i.halted = r.halted;
        i.reportCorpActionPaused = r.corporateActionPaused;
        i.reportMultiplier = r.uiMultiplier;
        i.referencePrice = r.referencePrice;

        if (cfg.isStockToken) {
            try IStockToken(asset).oraclePaused() returns (bool paused) {
                try IStockToken(asset).uiMultiplier() returns (uint256 m) {
                    i.tokenOk = true;
                    i.tokenOraclePaused = paused;
                    i.tokenMultiplier = m;
                } catch {}
            } catch {}
        }
    }

    // ═══════════════════════════ views ═══════════════════════════

    function getAssetConfig(address asset) external view returns (AssetConfig memory) {
        return _configs[asset];
    }

    function getReport(address asset) external view returns (MarketReport memory) {
        return _reports[asset];
    }

    function getSnapshot(address asset) external view returns (Snapshot memory) {
        return _snapshots[asset];
    }
}
