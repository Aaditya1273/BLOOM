/**
 * Health factor calculation utility — mirrors AuraPerps liquidation logic.
 *
 * Formula:
 *   PnL = positionSize * |currentPrice - entryPrice| / entryPrice
 *   isProfit = (long && current > entry) || (short && current < entry)
 *   fundingFee = positionSize * timeElapsed * FUNDING_RATE_PER_SECOND / 1e18
 *
 *   if isProfit:        health = 10000 bps (100%)
 *   else:               health = max(0, (collateral - pnl - fundingFee) / collateral * 10000)
 *
 * Liquidation triggers when health = 0 (i.e., losses ≥ collateral).
 * The shield should alert BEFORE that — typical threshold: health < 2000 bps (20%).
 */

const FUNDING_RATE_PER_SECOND = 10000000000n; // matches AuraPerps constant
const BPS_DENOM = 10000n;

/**
 * @param {object} pos - { isLong, collateralAmount, leverage, entryPrice, positionSize, openedAt }
 *                      All numeric fields as BigInt (18-decimal wei) except booleans
 * @param {bigint} currentPriceWei - 18-decimal price in wei
 * @param {bigint} nowSeconds - block.timestamp in seconds (BigInt)
 * @returns {{ healthBps: number, pnlWei: bigint, isProfit: boolean, fundingFeeWei: bigint }}
 */
function computeHealth(pos, currentPriceWei, nowSeconds) {
    const { isLong, collateralAmount, entryPrice, positionSize, openedAt } = pos;

    if (entryPrice === 0n || currentPriceWei === 0n) {
        return { healthBps: 10000, pnlWei: 0n, isProfit: true, fundingFeeWei: 0n };
    }

    let isProfit;
    let priceDiff;
    if (isLong) {
        isProfit = currentPriceWei > entryPrice;
        priceDiff = isProfit ? currentPriceWei - entryPrice : entryPrice - currentPriceWei;
    } else {
        isProfit = currentPriceWei < entryPrice;
        priceDiff = isProfit ? entryPrice - currentPriceWei : currentPriceWei - entryPrice;
    }

    const pnlWei = (positionSize * priceDiff) / entryPrice;

    const timeElapsed = nowSeconds - BigInt(openedAt);
    const fundingFeeWei = timeElapsed > 0n
        ? (positionSize * timeElapsed * FUNDING_RATE_PER_SECOND) / 10n ** 18n
        : 0n;

    if (isProfit) {
        return { healthBps: 10000, pnlWei, isProfit: true, fundingFeeWei };
    }

    const totalLoss = pnlWei + fundingFeeWei;
    if (totalLoss >= collateralAmount) {
        return { healthBps: 0, pnlWei, isProfit: false, fundingFeeWei };
    }

    const remaining = collateralAmount - totalLoss;
    const healthBps = Number((remaining * BPS_DENOM) / collateralAmount);
    return { healthBps, pnlWei, isProfit: false, fundingFeeWei };
}

/**
 * Recommended top-up amount to bring health back to a safe level.
 * Returns the aUSD amount needed to push remaining health up to `targetBps`
 * (default 5000 = 50%). Capped by `maxTopUp`.
 */
function recommendTopUp(pos, currentPriceWei, nowSeconds, targetBps = 5000, maxTopUp = null) {
    const { healthBps, pnlWei, isProfit, fundingFeeWei } = computeHealth(pos, currentPriceWei, nowSeconds);
    if (isProfit || healthBps >= targetBps) return 0n;

    // We want: (newCollateral - pnl - fundingFee) / newCollateral >= target/10000
    // Solve: newCollateral >= (pnl + fundingFee) / (1 - target/10000)
    // Therefore added = newCollateral - pos.collateralAmount
    const totalLoss = pnlWei + fundingFeeWei;
    const safeFactor = BigInt(10000 - targetBps); // e.g., 5000 for 50% target
    const newCollateral = (totalLoss * BPS_DENOM) / safeFactor;

    let added = newCollateral > pos.collateralAmount ? newCollateral - pos.collateralAmount : 0n;
    if (maxTopUp !== null && added > maxTopUp) added = maxTopUp;
    return added;
}

module.exports = {
    computeHealth,
    recommendTopUp,
    FUNDING_RATE_PER_SECOND,
};
