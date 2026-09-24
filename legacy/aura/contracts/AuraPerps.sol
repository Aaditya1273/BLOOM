// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IAuraVault {
    function receiveLoss(uint256 amount) external;
    function payoutProfit(address to, uint256 amount) external;
    function totalAssets() external view returns (uint256);
}

interface IMockOracle {
    function getPrice(string calldata asset) external view returns (uint256);
}

interface IAuraStylusMath {
    function calculatePnL(bool isLong, uint256 positionSize, uint256 entryPrice, uint256 currentPrice) external pure returns (uint256 pnl, bool isProfit);
    function calculateFundingFee(uint256 positionSize, uint256 timeElapsed, uint256 longOI, uint256 shortOI) external pure returns (uint256);
    function calculatePriceImpact(uint256 positionSize, uint256 vaultTVL, uint256 currentPrice) external pure returns (uint256);
}

/// @notice Interface for AuraAccount — checks ownership chain for MCP delegation
interface IAuraAccount {
    function owner() external view returns (address);
}

contract AuraPerps is Ownable {
    IERC20 public aUSD;
    IMockOracle public oracle;
    IAuraVault public vault;
    IAuraStylusMath public stylusMath;
    address public router;

    uint256 public constant FUNDING_RATE_PER_SECOND = 10000000000; 
    uint256 public constant LIQUIDATION_BOUNTY_PERCENT = 5; 
    uint256 public constant TRADING_FEE_BPS = 10; // 0.1%

    struct Position {
        address owner;
        string asset;
        bool isLong;
        uint256 collateralAmount;
        uint256 leverage;
        uint256 entryPrice;
        uint256 positionSize; 
        bool isOpen;
        uint256 openedAt;
        uint256 realizedPnl;
        bool isProfitRealized;
        uint256 exitPrice;
        uint256 takeProfitPrice;
        uint256 stopLossPrice;
    }

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;

    // Dynamic Funding / Skew tracking
    mapping(string => uint256) public totalLongOI;
    mapping(string => uint256) public totalShortOI;

    event PositionOpened(uint256 indexed positionId, address indexed owner, string asset, bool isLong, uint256 collateral, uint256 leverage, uint256 entryPrice, uint256 openedAt);
    event PositionClosed(uint256 indexed positionId, address indexed owner, uint256 pnl, bool isProfit, uint256 exitPrice, uint256 fundingFee);
    event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, address indexed owner, uint256 bounty);
    event MarginAdded(uint256 indexed positionId, uint256 amount);
    event TriggersUpdated(uint256 indexed positionId, uint256 tpPrice, uint256 slPrice);

    constructor(address _aUSD, address _oracle, address _vault) Ownable(msg.sender) {
        aUSD = IERC20(_aUSD);
        oracle = IMockOracle(_oracle);
        vault = IAuraVault(_vault);
    }

    function setStylusMath(address _stylusMath) external onlyOwner {
        stylusMath = IAuraStylusMath(_stylusMath);
    }

    function setRouter(address _router) external onlyOwner {
        router = _router;
    }

    /// @notice Open a position on behalf of a user (called by LOB Router)
    function openPositionFor(
        address user, string calldata asset, bool isLong,
        uint256 collateralAmount, uint256 leverage
    ) external returns (uint256) {
        require(msg.sender == router, "AuraPerps: Only router");
        require(collateralAmount > 0, "AuraPerps: Invalid collateral");
        require(leverage > 0 && leverage <= 50, "AuraPerps: Max 50x");

        uint256 fee = (collateralAmount * TRADING_FEE_BPS) / 10000;
        uint256 effectiveCollateral = collateralAmount - fee;
        uint256 positionSize = effectiveCollateral * leverage;

        require(aUSD.transferFrom(msg.sender, address(this), collateralAmount), "AuraPerps: Transfer failed");

        if (fee > 0) {
            require(aUSD.approve(address(vault), fee), "AuraPerps: Approve fee failed");
            vault.receiveLoss(fee);
        }

        uint256 currentPrice = oracle.getPrice(asset);
        require(currentPrice > 0, "AuraPerps: Invalid oracle price");

        uint256 tvl = vault.totalAssets();
        uint256 impact = address(stylusMath) != address(0)
            ? stylusMath.calculatePriceImpact(positionSize, tvl, currentPrice)
            : (tvl > 0 ? (currentPrice * positionSize * 10) / (tvl * 10000) : 0);
        uint256 entryPrice = isLong ? currentPrice + impact : currentPrice - impact;

        if (isLong) { totalLongOI[asset] += positionSize; }
        else { totalShortOI[asset] += positionSize; }

        uint256 positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: user, asset: asset, isLong: isLong,
            collateralAmount: effectiveCollateral, leverage: leverage,
            entryPrice: entryPrice, positionSize: positionSize,
            isOpen: true, openedAt: block.timestamp,
            realizedPnl: 0, isProfitRealized: false, exitPrice: 0,
            takeProfitPrice: 0, stopLossPrice: 0
        });

        emit PositionOpened(positionId, user, asset, isLong, effectiveCollateral, leverage, entryPrice, block.timestamp);
        return positionId;
    }

    /// @notice Open a position on behalf of a user with a CALLER-SPECIFIED entry price.
    /// @dev Used by the hybrid router when matching a market taker against a resting
    ///      limit order. Both maker and taker open at the maker's limit price (the
    ///      router computes the VWAP for the taker if multiple makers were matched).
    ///      Skips the oracle read + vault price-impact, since the price is determined
    ///      by the limit order book, not the AMM.
    function openPositionAtPrice(
        address user, string calldata asset, bool isLong,
        uint256 collateralAmount, uint256 leverage, uint256 entryPrice
    ) external returns (uint256) {
        require(msg.sender == router, "AuraPerps: Only router");
        require(collateralAmount > 0, "AuraPerps: Invalid collateral");
        require(leverage > 0 && leverage <= 50, "AuraPerps: Max 50x");
        require(entryPrice > 0, "AuraPerps: Invalid entry price");

        uint256 fee = (collateralAmount * TRADING_FEE_BPS) / 10000;
        uint256 effectiveCollateral = collateralAmount - fee;
        uint256 positionSize = effectiveCollateral * leverage;

        require(aUSD.transferFrom(msg.sender, address(this), collateralAmount), "AuraPerps: Transfer failed");

        if (fee > 0) {
            require(aUSD.approve(address(vault), fee), "AuraPerps: Approve fee failed");
            vault.receiveLoss(fee);
        }

        if (isLong) { totalLongOI[asset] += positionSize; }
        else { totalShortOI[asset] += positionSize; }

        uint256 positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: user, asset: asset, isLong: isLong,
            collateralAmount: effectiveCollateral, leverage: leverage,
            entryPrice: entryPrice, positionSize: positionSize,
            isOpen: true, openedAt: block.timestamp,
            realizedPnl: 0, isProfitRealized: false, exitPrice: 0,
            takeProfitPrice: 0, stopLossPrice: 0
        });

        emit PositionOpened(positionId, user, asset, isLong, effectiveCollateral, leverage, entryPrice, block.timestamp);
        return positionId;
    }

    function openPosition(string calldata asset, bool isLong, uint256 collateralAmount, uint256 leverage) external returns (uint256) {
        require(collateralAmount > 0, "AuraPerps: Invalid collateral");
        require(leverage > 0 && leverage <= 50, "AuraPerps: Max 50x leverage allowed");

        // Take fee
        uint256 fee = (collateralAmount * TRADING_FEE_BPS) / 10000;
        uint256 effectiveCollateral = collateralAmount - fee;
        uint256 positionSize = effectiveCollateral * leverage;

        require(aUSD.transferFrom(msg.sender, address(this), collateralAmount), "AuraPerps: Transfer failed");
        
        // Send fee to vault
        if (fee > 0) {
            require(aUSD.approve(address(vault), fee), "AuraPerps: Approve fee failed");
            vault.receiveLoss(fee);
        }

        uint256 currentPrice = oracle.getPrice(asset);
        require(currentPrice > 0, "AuraPerps: Invalid oracle price");

        // Price Impact (Slippage) via Stylus
        uint256 tvl = vault.totalAssets();
        uint256 impact = 0;
        if (address(stylusMath) != address(0)) {
            impact = stylusMath.calculatePriceImpact(positionSize, tvl, currentPrice);
        } else {
            impact = tvl > 0 ? (currentPrice * positionSize * 10) / (tvl * 10000) : 0;
        }
        uint256 entryPrice = isLong ? currentPrice + impact : currentPrice - impact;

        // Update OI
        if (isLong) {
            totalLongOI[asset] += positionSize;
        } else {
            totalShortOI[asset] += positionSize;
        }

        uint256 positionId = nextPositionId++;

        positions[positionId] = Position({
            owner: msg.sender,
            asset: asset,
            isLong: isLong,
            collateralAmount: effectiveCollateral,
            leverage: leverage,
            entryPrice: entryPrice,
            positionSize: positionSize,
            isOpen: true,
            openedAt: block.timestamp,
            realizedPnl: 0,
            isProfitRealized: false,
            exitPrice: 0,
            takeProfitPrice: 0,
            stopLossPrice: 0
        });

        emit PositionOpened(positionId, msg.sender, asset, isLong, effectiveCollateral, leverage, entryPrice, block.timestamp);
        return positionId;
    }

    /// @dev Returns true if msg.sender is the position owner OR is an AuraAccount
    ///      whose owner() is the position owner. This allows the MCP agent to manage
    ///      positions opened by the user's EOA wallet through the AuraAccount delegation.
    function _isOwnerOrDelegate(address posOwner) internal view returns (bool) {
        if (posOwner == msg.sender) return true;
        // Check if msg.sender is a contract whose owner() matches the position owner
        if (msg.sender.code.length > 0) {
            try IAuraAccount(msg.sender).owner() returns (address accountOwner) {
                return accountOwner == posOwner;
            } catch {
                return false;
            }
        }
        return false;
    }

    function addMargin(uint256 positionId, uint256 additionalCollateral) external {
        Position storage pos = positions[positionId];
        require(pos.isOpen, "AuraPerps: Position not open");
        require(_isOwnerOrDelegate(pos.owner), "AuraPerps: Not owner");

        require(aUSD.transferFrom(msg.sender, address(this), additionalCollateral), "AuraPerps: Transfer failed");
        pos.collateralAmount += additionalCollateral;

        emit MarginAdded(positionId, additionalCollateral);
    }

    function setTriggerOrders(uint256 positionId, uint256 tpPrice, uint256 slPrice) external {
        Position storage pos = positions[positionId];
        require(pos.isOpen, "AuraPerps: Position not open");
        require(_isOwnerOrDelegate(pos.owner), "AuraPerps: Not owner");

        pos.takeProfitPrice = tpPrice;
        pos.stopLossPrice = slPrice;

        emit TriggersUpdated(positionId, tpPrice, slPrice);
    }

    function executeTriggerOrder(uint256 positionId) external {
        Position storage pos = positions[positionId];
        require(pos.isOpen, "AuraPerps: Position not open");

        uint256 currentPrice = oracle.getPrice(pos.asset);
        bool shouldExecute = false;

        if (pos.isLong) {
            if (pos.takeProfitPrice > 0 && currentPrice >= pos.takeProfitPrice) shouldExecute = true;
            if (pos.stopLossPrice > 0 && currentPrice <= pos.stopLossPrice) shouldExecute = true;
        } else {
            if (pos.takeProfitPrice > 0 && currentPrice <= pos.takeProfitPrice) shouldExecute = true;
            if (pos.stopLossPrice > 0 && currentPrice >= pos.stopLossPrice) shouldExecute = true;
        }

        require(shouldExecute, "AuraPerps: Triggers not met");

        _close(positionId, pos.positionSize);
    }

    function closePosition(uint256 positionId) external {
        Position storage pos = positions[positionId];
        require(pos.isOpen, "AuraPerps: Position not open");
        require(_isOwnerOrDelegate(pos.owner), "AuraPerps: Not the position owner");

        _close(positionId, pos.positionSize);
    }

    function closePositionPartially(uint256 positionId, uint256 closeSize) external {
        Position storage pos = positions[positionId];
        require(pos.isOpen, "AuraPerps: Position not open");
        require(_isOwnerOrDelegate(pos.owner), "AuraPerps: Not owner");
        require(closeSize > 0 && closeSize <= pos.positionSize, "AuraPerps: Invalid close size");

        _close(positionId, closeSize);
    }

    function liquidatePosition(uint256 positionId) external {
        Position storage pos = positions[positionId];
        require(pos.isOpen, "AuraPerps: Position not open");

        uint256 currentPrice = oracle.getPrice(pos.asset);
        (uint256 pnl, bool isProfit) = _calculatePnL(pos.isLong, pos.positionSize, pos.entryPrice, currentPrice);
        uint256 fundingFee = _calculateFundingFee(pos.asset, pos.isLong, pos.positionSize, block.timestamp - pos.openedAt);

        require(!isProfit && (pnl + fundingFee) >= pos.collateralAmount, "AuraPerps: Position is safe");

        if (pos.isLong) {
            totalLongOI[pos.asset] -= pos.positionSize;
        } else {
            totalShortOI[pos.asset] -= pos.positionSize;
        }

        pos.isOpen = false;
        pos.realizedPnl = pnl;
        pos.isProfitRealized = false;
        pos.exitPrice = currentPrice;

        uint256 bounty = (pos.collateralAmount * LIQUIDATION_BOUNTY_PERCENT) / 100;
        uint256 vaultShare = pos.collateralAmount > bounty ? pos.collateralAmount - bounty : 0;

        if (bounty > 0) {
            require(aUSD.transfer(msg.sender, bounty), "AuraPerps: Bounty transfer failed");
        }
        
        if (vaultShare > 0) {
            require(aUSD.approve(address(vault), vaultShare), "AuraPerps: Approve vault failed");
            vault.receiveLoss(vaultShare);
        }

        emit PositionLiquidated(positionId, msg.sender, pos.owner, bounty);
    }

    function _close(uint256 positionId, uint256 closeSize) internal {
        Position storage pos = positions[positionId];
        
        uint256 currentPrice = oracle.getPrice(pos.asset);
        require(currentPrice > 0, "AuraPerps: Invalid oracle price");

        uint256 proportion = (closeSize * 1e18) / pos.positionSize;

        (uint256 fullPnl, bool isProfit) = _calculatePnL(pos.isLong, pos.positionSize, pos.entryPrice, currentPrice);
        uint256 pnl = (fullPnl * proportion) / 1e18;
        
        uint256 fullFundingFee = _calculateFundingFee(pos.asset, pos.isLong, pos.positionSize, block.timestamp - pos.openedAt);
        uint256 fundingFee = (fullFundingFee * proportion) / 1e18;

        uint256 collateralToClose = (pos.collateralAmount * proportion) / 1e18;
        uint256 fee = (closeSize * TRADING_FEE_BPS) / 10000;

        pos.realizedPnl += pnl;
        pos.isProfitRealized = isProfit;
        pos.exitPrice = currentPrice;

        if (isProfit) {
            uint256 userPayout = collateralToClose + pnl;
            uint256 totalDeductions = fundingFee + fee;
            
            if (userPayout > totalDeductions) {
                userPayout -= totalDeductions;
            } else {
                userPayout = 0;
            }

            if (userPayout > collateralToClose) {
                vault.payoutProfit(pos.owner, userPayout - collateralToClose);
                require(aUSD.transfer(pos.owner, collateralToClose), "AuraPerps: Collateral return failed");
            } else {
                if (userPayout > 0) {
                    require(aUSD.transfer(pos.owner, userPayout), "AuraPerps: Collateral return failed");
                }
            }

            if (totalDeductions > 0 && totalDeductions <= (collateralToClose + pnl)) {
                 require(aUSD.approve(address(vault), totalDeductions), "AuraPerps: Approve fee failed");
                 vault.receiveLoss(totalDeductions);
            }
        } else {
            uint256 totalLoss = pnl + fundingFee + fee;
            if (totalLoss < collateralToClose) {
                uint256 userPayout = collateralToClose - totalLoss;
                require(aUSD.transfer(pos.owner, userPayout), "AuraPerps: Payout failed");
                
                require(aUSD.approve(address(vault), totalLoss), "AuraPerps: Approve vault failed");
                vault.receiveLoss(totalLoss);
            } else {
                require(aUSD.approve(address(vault), collateralToClose), "AuraPerps: Approve vault failed");
                vault.receiveLoss(collateralToClose);
            }
        }

        if (pos.isLong) {
            totalLongOI[pos.asset] -= closeSize;
        } else {
            totalShortOI[pos.asset] -= closeSize;
        }

        if (closeSize == pos.positionSize) {
            pos.isOpen = false;
        } else {
            pos.positionSize -= closeSize;
            pos.collateralAmount -= collateralToClose;
            pos.openedAt = block.timestamp;
        }

        emit PositionClosed(positionId, pos.owner, pnl, isProfit, currentPrice, fundingFee);
    }

    function _calculatePnL(bool isLong, uint256 positionSize, uint256 entryPrice, uint256 currentPrice) internal view returns (uint256 pnl, bool isProfit) {
        if (address(stylusMath) != address(0)) {
            return stylusMath.calculatePnL(isLong, positionSize, entryPrice, currentPrice);
        }

        if (entryPrice == currentPrice) return (0, true);

        uint256 priceDiff;
        if (isLong) {
            isProfit = currentPrice > entryPrice;
            priceDiff = isProfit ? currentPrice - entryPrice : entryPrice - currentPrice;
        } else {
            isProfit = currentPrice < entryPrice;
            priceDiff = isProfit ? entryPrice - currentPrice : currentPrice - entryPrice;
        }
        pnl = (positionSize * priceDiff) / entryPrice;
    }

    function _calculateFundingFee(string memory asset, bool isLong, uint256 positionSize, uint256 timeElapsed) internal view returns (uint256) {
        if (address(stylusMath) != address(0)) {
            return stylusMath.calculateFundingFee(positionSize, timeElapsed, totalLongOI[asset], totalShortOI[asset]);
        }
        uint256 dynamicRate = getCurrentFundingRate(asset, isLong);
        return (positionSize * timeElapsed * dynamicRate) / 1e18;
    }

    function calculatePnL(uint256 positionId, uint256 currentPrice) public view returns (uint256 pnl, bool isProfit) {
        Position memory pos = positions[positionId];
        return _calculatePnL(pos.isLong, pos.positionSize, pos.entryPrice, currentPrice);
    }

    function getCurrentFundingRate(string memory asset, bool isLong) public view returns (uint256) {
        uint256 longOI = totalLongOI[asset];
        uint256 shortOI = totalShortOI[asset];
        uint256 totalOI = longOI + shortOI;
        
        if (totalOI == 0) return FUNDING_RATE_PER_SECOND;
        
        uint256 mySideOI = isLong ? longOI : shortOI;
        uint256 otherSideOI = isLong ? shortOI : longOI;
        
        if (mySideOI <= otherSideOI) {
            // Minority side or balanced: pays base rate (or even less, but let's stick to base for safety)
            return FUNDING_RATE_PER_SECOND / 2; // Discounted rate for balancing the protocol
        } else {
            // Majority side: pays premium based on skew
            uint256 diff = mySideOI - otherSideOI;
            uint256 skewFactor = (diff * 1e18) / totalOI; // 1e18 = 100%
            
            // Base_Rate + (Base_Rate * SkewFactor)
            return FUNDING_RATE_PER_SECOND + (FUNDING_RATE_PER_SECOND * skewFactor) / 1e18;
        }
    }
}
