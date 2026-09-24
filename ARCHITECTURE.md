# Bloom — Architecture

Bloom is a consumer wallet on Robinhood Chain. Users save in USDG, hold and send supported Robinhood Stock
Tokens, and can let an AI agent act for them under explicit onchain rules. An equity-aware risk engine
written in Stylus (Rust) decides when Stock Tokens can safely back borrowing.

```
                              BLOOM
                                |
                 +--------------+--------------+
                 |                             |
            Bloom Chat                    Bloom Agent
      (frontend /chat, backend)     (intent parser + tx builder)
                 |                             |
                 +--------------+--------------+
                                |
                     BloomPolicy (onchain rules)
                                |
              BloomAccount (ERC-4337 smart account,
               policy-scoped agent session keys)
                                |
               +----------------+----------------+
               |                |                |
          BloomVault       StockRouter       BloomClaims
       (USDG savings,    (canonical send,   (claim links)
       risk-gated         approved swaps)
        borrowing)             |
               |        Robinhood Stock Tokens
               |
       Bloom Risk Engine  ── Stylus / Rust (production)
               |              EVM twin (local tests, differential testing)
     +------+------+------+------+------+
     |      |      |      |      |      |
   HALT  STALE DEVIATION CORP  SEQ  INVALID
     +------+------+------+------+------+
                    |
          MAX LTV  →  borrow / liquidation permission
```

## Components

| Component | Path | Role |
| --- | --- | --- |
| BloomRiskEngine (Stylus) | `stylus-risk-engine/` | Production risk state machine. Verifies EIP-712 market reports and reads Chainlink-style feeds, sequencer uptime and the Stock Token corporate-action hooks. |
| BloomRiskEngineEVM | `contracts/risk/BloomRiskEngineEVM.sol` | EVM twin with an identical ABI. Hardhat can't execute WASM, so this twin lets the whole system be tested there. Both implementations are checked against `test/vectors/risk-vectors.json`. |
| RiskLib | `contracts/risk/RiskLib.sol` | Pure classification rules (the specification). |
| BloomAssetRegistry | `contracts/BloomAssetRegistry.sol` | Canonical asset registry (symbol, token, feed, decimals, kind, enabled), bound to one chain id. |
| BloomVault | `contracts/BloomVault.sol` | ERC-4626 USDG savings plus borrowing against Stock Token collateral. Every borrow asks the risk engine first. |
| StockRouter | `contracts/StockRouter.sol` | Sends registered assets. Swaps only through approved venues, with a minimum output and a deadline. |
| BloomClaims | `contracts/BloomClaims.sol` | Claim-link escrow for recipients who don't have Bloom yet. |
| BloomPolicy | `contracts/BloomPolicy.sol` | Goals and agent rules: closed (target, selector) set, per-transaction and daily caps, asset allowlist, allocation ceiling, expiry. |
| BloomAccount / Factory | `contracts/BloomAccount.sol` | ERC-4337 v0.8 smart account (evolved from Aura) with `executeByAgent`. |
| Testnet mocks | `contracts/mocks/` | MockUSDG, MockStockToken, MockAggregatorV3, MockSequencerUptimeFeed, MockLendingAdapter, MockSwapVenue. |
| Reporter | `offchain/reporter/` | Robinhood Stock Token API → validated EIP-712 market reports → risk engine. |
| Backend | `backend/` | Bloom API: agent, chat, goals, claims, risk dashboard, learning streak. |
| Frontend | `frontend/` | Next.js consumer app with the screens `/`, `/chat`, `/agent`, `/risk`, `/activity` and `/claim/[id]`. |

## Consumer flow

```
User ──"Send Sarah $5 of QQQ."──▶ Bloom Chat
                                     │  deterministic intent parser (optional LLM fallback)
                                     ▼
                          typed intent { action: SEND, asset: QQQ, usd: 5, recipient: Sarah }
                                     │  zod validator: asset from the registry, recipient from contacts, never from AI text
                                     ▼
                          BloomPolicy.preview(account, agent, target, 0, calldata)   (dry run)
                                     │  confirmation card: asset · amount · recipient · network · policy ✓ · risk ✓
                                     ▼
                          agent session key → BloomAccount.executeByAgent(agent, target, calldata)
                                     │  BloomPolicy.authorize(...)  (onchain, final authority)
                                     ▼
                          StockRouter.send / BloomVault.deposit / BloomClaims.createClaim
```

The AI never produces calldata that gets executed. The backend's transaction builder only encodes the
closed set of Bloom actions, and the onchain policy re-checks every call.

## Risk flow

```
Chainlink price feed ──────────────┐
Robinhood halt / corporate-action ─┤   (signed EIP-712 market report from an allowlisted reporter)
Stock Token oraclePaused() +       │
  uiMultiplier() ──────────────────┤
Freshness (heartbeat) ─────────────┼──▶ Bloom Risk Engine ──▶ RiskState ──▶ max LTV ──▶ BloomVault
Deviation vs signed reference ─────┤        (Stylus)                         borrow / liquidation
Sequencer uptime (+ grace) ────────┘
```

Evaluation order: first match wins, and anything unrecognised is denied by default.

| # | State | Condition | Max LTV | Borrow | Liquidation |
| --- | --- | --- | --- | --- | --- |
| 7 | UNSUPPORTED | asset not configured / disabled | 0 | no | no |
| 5 | SEQUENCER_DOWN | sequencer feed says down, call failed, or still in its grace period | 0 | no | no (protected) |
| 6 | INVALID_PRICE | call failed, answer ≤ 0, updatedAt 0 or in the future, incomplete round, out of range | 0 | no | no |
| 2 | STALE | `now − updatedAt > heartbeat`, or the market report is missing, in the future, or older than `maxReportAge` | 0 | no | no |
| 1 | HALTED | fresh signed report says `isTradingHalt` | 0 | no | no (protected) |
| 4 | CORP_ACTION_PAUSED | token `oraclePaused()`, report flag, multiplier mismatch, or a hook call failed | 0 | no | no (protected) |
| 3 | DEVIATION | `|oracle − reference| × 10⁴ > deviationBps × reference` | 0 | no | no |
| 0 | NORMAL | all guards pass | configured (60%) | yes | yes |

Prices are normalised to 1e18 and bounded by `MAX_PRICE = 1e36`, so no intermediate calculation can
overflow. Division by zero can't happen: a reference of 0 means "no reference". Robinhood's Chainlink
Stock Token feeds already include the corporate-action multiplier, so the vault values collateral as
`balance × price` and never rescales raw balances.

## Reporter flow

```
Robinhood Stock Token API  (GET /rhj/prices/{symbol}, /rhj/assets, /rhj/corporate-actions)
        │ validate (zod) · verify symbol ↔ canonical address (mainnet) · normalise decimals exactly
        ▼
Bloom Reporter ── EIP-712 MarketReport(asset, halted, corporateActionPaused, uiMultiplier,
        │                             referencePrice, observedAt, nonce)
        │         domain = { name: "BloomRiskEngine", version: "1", chainId, verifyingContract }
        ▼
Bloom Risk Engine.submitReport(...)
        checks: asset configured · nonce > last (per asset) · observedAt ≤ now · now − observedAt ≤ maxReportAge
                · observedAt ≥ previous · reference ≤ MAX_PRICE · low-s signature · signer ∈ reporter allowlist
        emits:  HaltUpdated · CorporateActionStateChanged · RiskStateChanged · PriceUpdated
```

The Stylus contract never calls HTTP APIs. Anyone can relay a report, because the signature is what
authorises it.

## Agent permission model

```
Bloom Agent session key (per goal, expires at the goal deadline)
  allowed targets:   BloomVault, StockRouter, BloomClaims, allowlisted asset tokens
  allowed selectors: approve (only to Bloom contracts, capped) · deposit (receiver = own account)
                     · send · swap (then allocation check) · createClaim
  limits:            max per tx (USD) · daily cap (USD) · max Stock Token allocation · allowed assets
                     · only when the asset's risk state is NORMAL
  never:             native value · arbitrary target · arbitrary selector · delegatecall · owner functions · upgrades
```

The same rules apply whether the key sends a transaction directly or signs an ERC-4337 UserOperation.
`BloomAccount._validateSignature` only accepts session-key UserOperations whose callData is
`executeByAgent(<that key>, …)`, and it hands `validAfter`/`validUntil` to the EntryPoint.

## Networks

| | Robinhood Chain Testnet | Robinhood Chain Mainnet |
| --- | --- | --- |
| Chain id | 46630 | 4663 |
| RPC | https://rpc.testnet.chain.robinhood.com | https://rpc.mainnet.chain.robinhood.com |
| Explorer | https://explorer.testnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |
| USDG | MockUSDG (6 decimals) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Stock Tokens | MockStockToken (18 decimals) | canonical, from `config/robinhood-mainnet.json` |
| Price feeds | MockAggregatorV3 | Chainlink (8 decimals, 24/5, include the multiplier) |
| Sequencer | MockSequencerUptimeFeed | no official feed. `required=false`, recorded onchain |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| Stylus | supported (ArbWasm `stylusVersion()` = 3) | supported (ArbWasm `stylusVersion()` = 3) |

Deployment configuration (`config/*.json`) is kept separate from business logic. Contracts never
hardcode asset addresses.
