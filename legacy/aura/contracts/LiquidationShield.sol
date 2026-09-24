// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IAuraPerps {
    function positions(uint256 positionId) external view returns (
        address owner, string memory asset, bool isLong,
        uint256 collateralAmount, uint256 leverage, uint256 entryPrice,
        uint256 positionSize, bool isOpen, uint256 openedAt,
        uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice,
        uint256 takeProfitPrice, uint256 stopLossPrice
    );
}

/**
 * @title LiquidationShield
 * @notice On-chain mandate registry where users record their auto-protection
 *         preferences for perpetual positions. Pairs with an off-chain keeper
 *         that monitors Pyth prices and emits SSE alerts to the frontend when
 *         a position's health factor drops below the user's mandated threshold.
 *
 * @dev Why is execution off-chain?
 *      AuraPerps.addMargin enforces msg.sender == pos.owner, so the shield
 *      can't add margin on the user's behalf without invasive AuraPerps
 *      modifications. Instead this contract serves as the on-chain commitment
 *      record, and the user signs the (one-click, prefilled) top-up tx in
 *      response to the alert. The mandate is immutable evidence of the user's
 *      protection intent and is queryable by the keeper.
 */
contract LiquidationShield is Ownable {
    IAuraPerps public perps;
    address public keeper;

    /// Default health threshold (in basis points of remaining health) below
    /// which the keeper should fire an alert. 2000 bps = 20% remaining health.
    uint256 public constant DEFAULT_THRESHOLD_BPS = 2000;

    struct Mandate {
        bool armed;                   // shield active for this position
        uint256 thresholdBps;         // alert when remainingHealthBps < this (e.g., 2000 = 20%)
        uint256 recommendedTopUp;     // recommended top-up amount in aUSD (18 decimals)
        uint256 maxTopUpPerEvent;     // safety cap on what the keeper proposes per alert
        uint256 createdAt;
        uint256 updatedAt;
    }

    /// positionId → mandate. Mandates are keyed by AuraPerps position id.
    mapping(uint256 => Mandate) public mandates;
    /// owner → list of position ids they have armed (for UI queries)
    mapping(address => uint256[]) public userMandates;
    mapping(uint256 => bool) private _userMandateRegistered;

    event ShieldArmed(uint256 indexed positionId, address indexed owner, uint256 thresholdBps, uint256 recommendedTopUp, uint256 maxTopUpPerEvent);
    event ShieldDisarmed(uint256 indexed positionId, address indexed owner);
    event AlertEmitted(uint256 indexed positionId, address indexed owner, uint256 healthBps, uint256 recommendedTopUp);

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner(), "Shield: not keeper");
        _;
    }

    constructor(address _perps) Ownable(msg.sender) {
        perps = IAuraPerps(_perps);
        keeper = msg.sender;
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }

    // ═══════════════════ USER OPERATIONS ═══════════════════

    /// @notice Arm the shield for a position. Re-arming overwrites existing mandate.
    /// @param positionId       AuraPerps position id; caller must own it
    /// @param thresholdBps     Alert when remaining health < this (bps). 0 = use default.
    /// @param recommendedTopUp Suggested aUSD amount to add when alert fires
    /// @param maxTopUpPerEvent Hard cap on per-event top-up (anti-fat-finger)
    function armShield(
        uint256 positionId,
        uint256 thresholdBps,
        uint256 recommendedTopUp,
        uint256 maxTopUpPerEvent
    ) external {
        (address posOwner, , , , , , , bool isOpen, , , , , ,) = perps.positions(positionId);
        require(isOpen, "Shield: position not open");
        require(posOwner == msg.sender, "Shield: not position owner");
        require(recommendedTopUp > 0, "Shield: invalid recommended amount");
        require(maxTopUpPerEvent >= recommendedTopUp, "Shield: max < recommended");
        require(thresholdBps <= 9000, "Shield: threshold too high"); // sanity cap at 90%

        uint256 effectiveThreshold = thresholdBps == 0 ? DEFAULT_THRESHOLD_BPS : thresholdBps;

        bool wasArmed = mandates[positionId].armed;
        mandates[positionId] = Mandate({
            armed: true,
            thresholdBps: effectiveThreshold,
            recommendedTopUp: recommendedTopUp,
            maxTopUpPerEvent: maxTopUpPerEvent,
            createdAt: wasArmed ? mandates[positionId].createdAt : block.timestamp,
            updatedAt: block.timestamp
        });

        if (!_userMandateRegistered[positionId]) {
            userMandates[msg.sender].push(positionId);
            _userMandateRegistered[positionId] = true;
        }

        emit ShieldArmed(positionId, msg.sender, effectiveThreshold, recommendedTopUp, maxTopUpPerEvent);
    }

    /// @notice Disarm the shield for a position (owner only).
    function disarmShield(uint256 positionId) external {
        Mandate storage m = mandates[positionId];
        require(m.armed, "Shield: not armed");
        (address posOwner, , , , , , , , , , , , ,) = perps.positions(positionId);
        require(posOwner == msg.sender, "Shield: not position owner");

        m.armed = false;
        m.updatedAt = block.timestamp;

        emit ShieldDisarmed(positionId, msg.sender);
    }

    // ═══════════════════ KEEPER OPERATIONS ═══════════════════

    /// @notice Keeper records that an alert has been fired for this position.
    ///         The actual notification goes via SSE; this on-chain record is
    ///         for auditability ("the shield warned the user").
    function recordAlert(uint256 positionId, uint256 healthBps) external onlyKeeper {
        Mandate storage m = mandates[positionId];
        require(m.armed, "Shield: not armed");
        require(healthBps < m.thresholdBps, "Shield: threshold not breached");

        (address posOwner, , , , , , , bool isOpen, , , , , ,) = perps.positions(positionId);
        require(isOpen, "Shield: position not open");

        emit AlertEmitted(positionId, posOwner, healthBps, m.recommendedTopUp);
    }

    // ═══════════════════ VIEW FUNCTIONS ═══════════════════

    function getMandate(uint256 positionId) external view returns (Mandate memory) {
        return mandates[positionId];
    }

    function getUserMandates(address user) external view returns (uint256[] memory) {
        return userMandates[user];
    }

    function getActiveMandates(address user) external view returns (uint256[] memory) {
        uint256[] memory ids = userMandates[user];
        uint256 count = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (mandates[ids[i]].armed) count++;
        }
        uint256[] memory out = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (mandates[ids[i]].armed) {
                out[j++] = ids[i];
            }
        }
        return out;
    }
}
