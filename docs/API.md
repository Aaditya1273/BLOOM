# Bloom backend API (v1)

Base URL: `http://localhost:3001` (env `PORT`). JSON in/out. All amounts are **decimal strings** in human units
(e.g. `"100"` USDG, `"0.0087"` QQQ) unless the field name ends in `Raw` (integer string in token base units).
Errors: HTTP 4xx/5xx with `{ "error": { "code": "RISK_BLOCKED" | "POLICY_REJECTED" | "UNSUPPORTED_ASSET" | "INSUFFICIENT_BALANCE" | "BAD_REQUEST" | "NOT_FOUND" | "TESTNET_ONLY" | "CHAIN_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED" | "INTERNAL", "message": "plain English", "details"?: {} } }`.

**Identity.** Every account endpoint acts for the wallet of the signed-in session, never for a supplied address:
- `GET /api/auth/nonce?wallet=0x..` → `{ domain, types, primaryType: "BloomLogin", message }` (EIP-712 challenge, 5 min, single use)
- `POST /api/auth/verify { message, signature }` → `{ token, wallet, role: "user"|"admin", expiresAt }`
- `GET /api/auth/me` → `{ wallet, role, expiresAt }` · `POST /api/auth/logout` revokes the token
- Send `Authorization: Bearer <token>`. Without it: 401 `UNAUTHORIZED`. An `owner`/`recipient` field that differs from
  the session wallet: 403 `FORBIDDEN`. `owner` fields in the endpoints below are optional and only checked, never trusted.
- Owner actions return a **sign request** `{ sign: { chainId, label, txs: [{ to, data }], next? } }` that the wallet signs.
- `POST /api/risk/simulate` is admin-only (onchain `DEFAULT_ADMIN_ROLE` on BloomVault, or `ADMIN_ADDRESSES`).
- The agent uses its own policy-scoped session key (`AGENT_PRIVATE_KEY`).

## System
- `GET /api/health` → `{ ok, chainId, network, block, riskEngineImpl: "stylus"|"evm-reference", reporter }`
- `GET /api/health/chain` → `{ ok, chainId, rpcChainId, rpcReachable, rpcLatencyMs, latestBlock, latestBlockTime, riskEngine: { address, impl }, rpcHost }`
- `GET /api/config` → `{ chainId, explorer, contracts: {...}, assets: [{ symbol, token, decimals, kind: "STABLE"|"STOCK_TOKEN" }] }`

## Account / portfolio
- `GET /api/account?owner=0x..` →
  `{ owner, account, deployed, usdg: { balance, valueUsd }, savings: { shares, valueUsd, apyBps, earnedTodayUsd },
     stocks: [{ symbol, balance, priceUsd, valueUsd, riskState }], totalUsd, streak: { days, lastLessonAt, completedToday } }`
- `POST /api/faucet { owner? }` → mints 1,000 test USDG to the smart account (testnet only, 1/day/owner) → `{ txHash, amount }`
- `POST /api/deposit { owner?, amount }` → owner-signed approve+deposit into BloomVault → `{ txHash, shares }`
- `POST /api/invest { owner?, amount, allocation?: [{ symbol, bps }] }` → default conservative 70% savings / 30% QQQ
  via StockRouter swap on the approved venue → `{ steps: [{ label, txHash, status }] }`

## Goals / agent (BloomPolicy)
- `POST /api/goals/preview { owner?, text }` → parse a goal sentence into typed params, no tx:
  `{ goal: { name, targetAmount, asset: "USDG", deadline (ISO), maxDailySpend, maxPerTx, maxStockAllocationBps, allowedAssets: [symbols] } }`
- `POST /api/goals { owner?, goal }` → owner creates goal + activates the agent session key → `{ goalId, txHashes, sessionKey, expiresAt }`
- `GET /api/goals?owner=0x..` → `[{ goalId, name, targetAmount, progressUsd, deadline, maxDailySpend, spentTodayUsd, maxStockAllocationBps, allowedAssets, active, agent }]`
- `POST /api/goals/:id/revoke { owner? }` → `{ txHash }`

## Chat (Bloom Agent)
- `POST /api/chat { owner?, message }` →
  ```
  { reply: "Ready to send $5 of QQQ to Sarah.",
    intent: { action: "SEND" | "CREATE_GOAL" | "INVEST" | "DEPOSIT" | "EXPLAIN_RISK" | "EXPLAIN_BORROW" | "BALANCE" | "UNKNOWN", ...typed fields },
    card?: { kind: "send"|"goal"|"invest"|"deposit"|"risk",
             asset, amount, amountUsd, recipient: { name, address?, viaClaimLink: boolean }, network: "Robinhood Chain Testnet",
             policyCheck: { ok, reason?, message }, riskCheck: { ok, state, message } },
    actionId?: "uuid" (present when the action can be confirmed) }
  ```
- `POST /api/chat/confirm { owner?, actionId }` → executes through `BloomAccount.executeByAgent` →
  `{ status: "executed" | "rejected" | "reverted", txHashes: [], reason?, message, claim?: { claimId, url, code, expiresAt } }`
  `message` explains rejections in plain English, e.g. "I didn't execute this action because QQQ entered a halted-risk state."

## Risk engine
- `GET /api/risk` → `{ sequencer: { up, required, sinceSec }, assets: [{ symbol, token, priceUsd, oracleUpdatedAt, oracleAgeSec,
     halted, corporateActionPaused, uiMultiplier, deviationBps, referencePriceUsd, state: 0..7, stateName, borrowingAllowed,
     liquidationAllowed, maxLtvBps, reason, lastReport: { observedAt, nonce } | null }] }`
  `stateName` ∈ NORMAL, HALTED, STALE, DEVIATION, CORP_ACTION_PAUSED, SEQUENCER_DOWN, INVALID_PRICE, UNSUPPORTED.
  `reason` examples: "Equity market trading halt detected.", "Oracle price is older than its heartbeat.",
  "Oracle price deviates more than 5% from the reference price.", "Corporate action in progress; oracle paused.",
  "L2 sequencer is down or in its grace period.", "Borrowing paused because the asset is currently outside Bloom's risk policy."
- `POST /api/risk/simulate { symbol, scenario: "HALT"|"STALE"|"DEVIATION"|"CORP_ACTION"|"SEQUENCER_DOWN"|"RESET" }` (testnet/local only;
  refuses on chainId 4663 with TESTNET_ONLY) → performs the real onchain transactions (signed EIP-712 halt report, mock feed update,
  mock token oraclePaused, mock sequencer) → `{ txHashes: [], state, stateName }`
- `GET /api/risk/borrow-check?owner=0x..&symbol=AAPL` → `{ borrowingAllowed, maxLtvBps, state, stateName, message }`

## Claims (claim links)
- `GET /api/claims/:claimId` → `{ claimId, token, symbol, amount, sender, expiresAt, status: "OPEN"|"CLAIMED"|"EXPIRED"|"CANCELLED" }` (no secrets)
- `POST /api/claims/:claimId/redeem { recipient, code }` → verifies the out-of-band code (hashed server-side, attempt-limited),
  signs `ClaimAuthorization` as claim authority and relays `BloomClaims.claim` → `{ txHash }`
  Claim URLs contain only the public claimId: `/claim/<claimId>`. The 6-digit code is shown once to the sender and never logged.

## Learning / streak
- `GET /api/learn?owner=0x..` → `{ lessons: [{ id, title, body, quiz: { question, options, answerIndex? (omitted) } }], todayLessonId, streak: { days, completedToday } }`
- `POST /api/learn/complete { owner?, lessonId, answerIndex }` → `{ correct, streak, reward: { amount: "0.10", label: "Sponsored learning rewards" } | null }`

## Activity
- `GET /api/activity?owner=0x..` → `[{ type, title, detail, txHash, blockNumber, timestamp }]` built from onchain events
  (Deposit, Sent, Swapped, ClaimCreated/Claimed, GoalCreated/Activated, ActionExecuted/Rejected, RiskStateChanged, BorrowBlocked).

## Implementation notes (backend v1) — additive only, no breaking changes
- **Owner**: every `owner` param is optional and defaults to the demo owner (testnet/local). Owner-signed actions
  (faucet, deposit, invest, goals, chat confirm for goals) only work for the demo owner; on chain 4663 they return `TESTNET_ONLY`.
- **Timestamps**: user-facing dates (`deadline`, `expiresAt`, `lastLessonAt`) are ISO-8601 strings; chain telemetry
  (`oracleUpdatedAt`, `lastReport.observedAt`, activity `timestamp`) is unix seconds. `oracleAgeSec`/`sinceSec` are seconds.
- **Risk state**: wherever a state appears, both the number (`state`, 0–7) and the name (`stateName`/`riskState`) are sent.
  `GET /api/account` → `stocks[]` has `riskState` (name) and `state` (number).
- **Errors**: `RISK_BLOCKED` errors carry `details: { symbol, state, stateName }`.
- **Chat**: `card.steps` lists the human-readable steps that will run; `card.policyCheck` may include `reason`
  (BloomPolicy code) and `stateName`; `card.riskCheck.stateId` is the numeric state. `actionId` is omitted when the policy
  preview or risk check fails (the reply explains why). A `SEND` of a Stock Token the account doesn't hold yet first buys it
  (approve + swap on the approved venue, 2% USDG buffer) inside the same confirmed action. Agent INVEST/DEPOSIT obey the goal's
  per-tx/daily caps (e.g. "$100 into my portfolio" exceeds the default $50 cap → use `POST /api/invest`, which the owner signs).
- **Confirm**: on `rejected`, `reason` is the risk `stateName` when the rejection was risk-related (e.g. `"HALTED"`), otherwise
  the BloomPolicy code; `policyReason` (e.g. `"ASSET_RISK_BLOCKED"`) and `stateName` are also included. Goal confirms return `goalId`.
  If an asset leaves NORMAL between preview and confirm, buy steps are skipped so the policy rejects the action onchain.
- **Goals list**: also includes `maxPerTx`.
- **Learn**: `GET /api/learn` adds `rewardLabel`; a reward includes the mint `txHash`. The reward is granted once per day on
  the first correct answer.
- **Extra endpoints**: `GET /api/agent/metadata` (ERC-8004 registration file). `/api/health` adds `reporter { mode, activeScenarios }`;
  `/api/config` adds `demoOwner`; `explorer` is `null` on a local chain.

## Portfolio history (added for the home chart)
- `GET /api/account/history?owner=0x..` → `{ points: [{ t (unix s), totalUsd }], windowChangeUsd: number|null, windowSinceSec: number|null,
   assetChanges: { [symbol]: { changeBps: number|null, sinceSec: number|null } } }`
  Built only from real snapshots recorded (≤ every 5 min) when the account view is computed. The last point is "now".
  `windowChangeUsd` is the change in total value over up to 30 days and INCLUDES deposits/withdrawals — label it as
  "change in total value", not as earnings. `changeBps` compares each Stock Token price with the snapshot ~24h ago
  (or the oldest available); null when no earlier snapshot exists.
