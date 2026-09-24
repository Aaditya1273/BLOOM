# Security Model

This document describes the trust assumptions, threat model, and security architecture of Aura Protocol.

---

## Trust Architecture

Aura uses a **defense-in-depth** approach with three independent layers of protection between user intent and on-chain execution.

```mermaid
flowchart TD
    User([User Intent - Natural Language])
    Executor[Executor Agent]
    RiskAuditor[Risk Auditor Agent]
    Guardrail[On-Chain Guardrails]
    Signature([User Signature])
    
    User -->|Proposes Action| Executor
    Executor -->|Drafts On-Chain Plan| RiskAuditor
    RiskAuditor -->|Validates Safety & Prices| Guardrail
    Guardrail -->|Enforces Hard Limits| Signature
    
    classDef agent fill:#2d1b2e,stroke:#a64d79,stroke-width:2px,color:#fff;
    classDef contract fill:#1b2e25,stroke:#4caf50,stroke-width:2px,color:#fff;
    classDef user fill:#1e1e2f,stroke:#4a4a6a,stroke-width:2px,color:#fff;
    
    class Executor,RiskAuditor agent;
    class Guardrail contract;
    class User,Signature user;
```

No single component can execute a transaction alone. The user always has final sign-off.

---

## Agent Security

### What the AI Agent CAN do

- Parse natural language into structured transaction parameters
- Propose swap routes, DCA schedules, and limit orders
- Query on-chain state (balances, prices, positions)
- Submit transactions **only** through `AuraAccount.executeBatchByAgent`

### What the AI Agent CANNOT do

- Execute without the user's wallet signature (non-custodial)
- Call contracts not whitelisted in `AuraGuardrailManager`
- Call function selectors not explicitly approved
- Transfer value exceeding the per-transaction cap
- Bypass the Risk Auditor's veto
- Modify its own permissions or the guardrail configuration
- Access the user's private key (key never leaves the browser)

### Dual-Agent Safety

The Executor and Risk Auditor are **independent LLM instances** with different system prompts and objectives:

- **Executor**: optimizes for user intent fulfillment
- **Risk Auditor**: optimizes for capital preservation and safety

A transaction proceeds only if both agents agree. The Risk Auditor checks:

1. Sufficient balance for the proposed action
2. Slippage within acceptable bounds
3. Token allowances are correct
4. No interaction with unverified contracts
5. Macro market conditions (via Pyth + NewsAPI sentiment)
6. Position sizing relative to portfolio

---

## On-Chain Guardrails

### AuraGuardrailManager

Deployed as an immutable policy layer between the AI agent and user funds.

| Control | Description |
|---------|-------------|
| Destination whitelist | Only pre-approved contract addresses can be called |
| Selector whitelist | Only specific function signatures are permitted per destination |
| Value cap | Maximum ETH/token value per agent-initiated transaction |
| Owner-only config | Only the wallet owner can modify guardrail rules |

### AuraAccount (EIP-4337)

- `execute` / `executeBatch` -- owner only, unrestricted
- `executeByAgent` / `executeBatchByAgent` -- AI agent only, guardrail-checked
- Agent address is set by owner and can be revoked at any time
- Guardrail contract is set by owner and can be swapped or disabled

### Stylus Guardrail (WASM -- Arbitrum Sepolia)

A second Stylus contract deployed at `0xd57a35af5ea3176667d79d6e460e39e9ba79bc08` that validates trade parameters on-chain before execution. Even if the AI agent is compromised, the WASM guardrail rejects invalid trades.

| Check | Description |
|-------|-------------|
| Asset whitelist | Only registered asset hashes can be traded |
| Max leverage | Capped at 50x (configurable by owner) |
| Min collateral | Minimum 1 token per trade |
| Max position size | collateral × leverage cannot exceed 500k tokens |
| Daily volume cap | Per-user daily volume limit (10M tokens default) |

The guardrail resets daily volume counters automatically using `block.timestamp / 86400`.

### AuraAuditTrail (On-Chain Reasoning Proof)

Deployed at `0x42D141CBe4aDc46B082D702C2e1bD802236348C4` on Robinhood Chain. Before every gasless execution, the backend records a `keccak256` hash of the full AI reasoning (executor proposal + risk auditor verdict + macro analysis) on-chain.

| Property | Detail |
|----------|--------|
| Permissionless | Any address can record (the `agent` field in the event proves identity) |
| Immutable | Events cannot be modified or deleted after emission |
| Verifiable | Off-chain reasoning JSON can be hashed and compared to the on-chain record |
| Gas efficient | < 50k gas per record (tested) |
| Indexed | Filterable by agent address and user address |

### Slippage Protection (Pyth-Based)

Every swap calculates `minAmountOut` from real-time Pyth Network oracle prices with 1% max slippage by default. This prevents sandwich attacks and excessive slippage on mainnet deployments.

- Price source: Pyth Hermes API (7 feeds: BTC, ETH, TSLA, AMZN, NFLX, AMD, PLTR)
- Formula: `minOut = amountIn × (priceIn / priceOut) × (1 - slippageBps / 10000)`
- Enforcement: active on mainnet (`ENABLE_SLIPPAGE_ENFORCEMENT=1`), logged-only on testnet (pool prices diverge from oracle)

---

### AuraIntelligenceVault (ERC-4626)

| Control | Description |
|---------|-------------|
| Role-based access | `AI_EXECUTOR_ROLE` required for strategy execution |
| Risk score ceiling | Strategies above the threshold are rejected |
| Protocol whitelist | Only approved DeFi protocols can receive vault funds |
| Selector whitelist | Only approved function calls per protocol |
| Emergency pause | Admin can halt all AI execution; user withdrawals remain open |
| Stylus guardrail hook | Optional external validation before each execution |

---

## Oracle Security

### Price Feeds

- **Primary**: Pyth Network Hermes (sub-second latency, signed price attestations)
- **On-chain**: MockOracle on testnet (owner-controlled for demo; production would use Pyth push oracle)

### Oracle Failure Modes

| Scenario | Mitigation |
|----------|------------|
| Zero price returned | `openPosition` reverts with "Invalid oracle price" |
| Stale price | Risk Auditor checks price freshness before proposing |
| Extreme price swing | Vault caps payout to available liquidity; positions cannot extract more than TVL |
| Oracle front-running | Liquidation bounty is capped at 5% of collateral, limiting MEV incentive |

---

## Perps Security

### Position Lifecycle

- Positions can only be opened by the owner or the authorized router
- Positions can only be closed by the owner
- Liquidation is permissionless but requires mathematical proof of insolvency (loss + funding >= collateral)
- Double-close and double-liquidation are prevented by the `isOpen` flag check

### Invariants (tested)

- `positionSize = effectiveCollateral * leverage` (always)
- `totalLongOI` and `totalShortOI` are decremented on every close/liquidation
- Leverage is capped at 50x at the contract level
- Trading fee (0.1%) is deducted before position sizing

### Vault as Counterparty

- Trader losses flow to the vault (increasing LP share value)
- Trader profits are paid from vault assets
- Vault rejects payouts exceeding `totalAssets()` -- no unbacked profit extraction
- LP depositors benefit from trader losses proportionally to their share

---

## Stylus Order Book Security

### Access Control

- `store_order`: only callable by the registered `router` address
- `cancel_order`: only callable by the router, and only if the caller matches the order owner
- `match_orders`: only callable by the router or keeper
- `consume_order`: only callable by the router
- `initialize`: one-shot, cannot be called twice

### Cross-Asset Isolation

Orders are keyed by `asset_hash = keccak256(symbol)`. The matching engine only processes orders for the specified asset hash, preventing cross-contamination between order books.

### Overflow Protection

- All counters use `U256` with explicit bounds checking
- Insertion sort in `get_active_orders_sorted` is bounded by `max_results` (capped at 256)
- Full scan in `match_orders` is bounded by `next_order_id`

---

## Account Abstraction Security

### AuraAccount

- Inherits from OpenZeppelin's `SimpleAccount` (audited EIP-4337 implementation)
- Proxy pattern (ERC-1967) allows upgrades only by owner
- `AuraFactory` uses `CREATE2` for deterministic addresses

### AuraPaymaster

- Verifier address is set at deployment and validates UserOperation signatures
- Prevents gas griefing by requiring valid verifier signature before sponsoring

---

## Known Limitations (Testnet)

1. **MockOracle** has no access control on `setPrice` -- production would use Pyth's signed price updates
2. **No timelock** on guardrail configuration changes -- production should add a delay
3. **Single keeper EOA** for order matching -- production would use a decentralized keeper network
4. **NVIDIA NIM API dependency** -- if the API is down, the chat agent is unavailable (manual trading via /trade still works)
5. **No formal verification** -- invariants are tested but not mathematically proven

---

## MCP Server Security

### Delegation Model (No Private Keys)

The MCP server allows any AI (Claude, ChatGPT, etc.) to trade on behalf of a user **without ever accessing their private key**.

| Property | Detail |
|----------|--------|
| Auth method | User signs `setAiAgent(mcpAgentAddress)` via MetaMask — on-chain delegation |
| Execution | Agent calls `executeBatchByAgent` on the user's AuraAccount |
| Revocation | User can call `setAiAgent(address(0))` at any time to revoke |
| API key scope | Maps to an AuraAccount address only — cannot extract funds without on-chain authorization |
| Private key exposure | Never — the MCP server uses its own agent wallet, authorized by the user's smart account |

### What the MCP Agent CAN do (when authorized)

- Execute trades on the user's AuraAccount via `executeBatchByAgent`
- Read prices, order book, and positions (public data)
- Place limit orders on the Stylus LOB

### What the MCP Agent CANNOT do

- Transfer arbitrary tokens (guardrail blocks non-whitelisted selectors)
- Exceed leverage/position limits (Stylus Guardrail enforces on-chain)
- Act without on-chain authorization (`setAiAgent` must be signed first)
- Access the user's private key (delegation model — key never leaves the browser)

### x402 Protocol (DDoS & Spam Prevention)

To prevent spam and resource exhaustion on the MCP server and Express API endpoints by remote AI agents, Aura Protocol has integrated the **x402 protocol** (HTTP 402 Payment Required). 

By requiring a micro-payment (e.g., in USDC on Arbitrum) for compute-heavy endpoints (like `get_market_analysis` which aggregates Pyth and NewsAPI data), the x402 protocol acts as a programmable economic shield against DDoS attacks. AI agents are required to attach a valid cryptographic payment receipt for their requests to be processed, ensuring sustainable infrastructure costs.

---

## Responsible Disclosure

If you find a vulnerability, please open a private issue or contact the team directly. Do not exploit testnet deployments -- other hackathon participants may be using the same infrastructure.
