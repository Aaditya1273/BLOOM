const dotenv = require("dotenv");
dotenv.config();

/**
 * @dev Prepare execution params for the frontend SignModal / TransactionCard.
 *      Propagates limit-order extras (chainId, kind, limitOrder, …) so the
 *      frontend can route the tx to the right chain (Arbitrum Sepolia for
 *      Stylus LOB) and label the tx correctly.
 */
async function prepareExecution(intent) {
  return {
    targets: intent.targets,
    values: intent.values,
    datas: intent.datas,
    description: intent.description,
    tokenInSymbol: intent.tokenInSymbol,
    tokenOutSymbol: intent.tokenOutSymbol,
    automation: intent.automation,
    requiredApproval: intent.requiredApproval,
    riskManagement: intent.riskManagement || { trailingStopPct: 0, takeProfitPct: 0 },

    // ── Wave 4 / Limit Order extensions ──
    // `kind` defaults to "SWAP" for back-compat with the existing chat flow.
    kind: intent.kind || "SWAP",
    chainId: intent.chainId,                   // 421614 for LIMIT_ORDER, undefined for SWAP (frontend defaults to Robinhood Chain)
    limitOrder: intent.limitOrder,             // { asset, isLong, leverage, limitPrice, collateral } when applicable
    contractAddress: intent.contractAddress,   // direct call target for non-batched flows
    encodedCalldata: intent.encodedCalldata,   // single calldata blob (mirrors datas[0] for LIMIT_ORDER)
    ethValue: intent.ethValue,                 // explicit msg.value for non-batched flows
  };
}


module.exports = { prepareExecution };
