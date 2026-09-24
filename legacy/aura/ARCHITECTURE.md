# Aura -- Architecture Reference

> Full technical reference for the Aura platform: contracts, agents, chains, and data flows.

---

## System Overview

```
+===============================================================================+
|                         USER (single signature)                                |
+==================================+============================================+
|         /chat (NLP)              |              /trade (manual)                |
|                                  |                                            |
|  +----------------------------+  |  +--------------------------------------+  |
|  | Multi-Agent Committee      |  |  | Order Panel                          |  |
|  |  - Executor (Llama 3.1)   |  |  |  - Market -> AuraPerps (Robinhood)   |  |
|  |  - Risk Auditor           |  |  |  - Limit  -> Stylus LOB (Arb Sepolia)|  |
|  |  - Macro Analyzer         |  |  +------------------+-------------------+  |
|  +-----------+----------------+  |                     |                      |
|              |                   |                     v                      |
|              v                   |  +--------------------------------------+  |
|    Synthra V3 Router             |  | Hybrid Execution Engine              |  |
|    (Robinhood Chain)             |  |  routedMarketOpen():                 |  |
|    ETH<->Token swaps             |  |    1. Walk Stylus LOB                |  |
|    DCA automation                |  |    2. Fallback -> Vault LP           |  |
|                                  |  +------------------+-------------------+  |
+==================================+===========================================+
                                                     |
              +--------------------------------------+---------------------------+
              |                                                                  |
              v                                                                  v
+-----------------------------+                     +------------------------------+
| Stylus LOB (WASM)           |                     | AuraPerps + AuraVault (LP)   |
| Arbitrum Sepolia            |                     | Robinhood Chain Testnet      |
| Chain ID: 421614            |                     | Chain ID: 46630              |
|                             |                     |                              |
| - store_order               |                     | - openPosition(For)          |
| - match_orders              |<--- AI Keeper --->  | - closePosition              |
| - consume_order             |     (Pyth feed)     | - liquidatePosition          |
| - cancel_order              |                     | - Pyth MockOracle            |
| - get_active_orders_sorted  |                     | - ERC-4626 Vault (LP)        |
|   (-34% gas vs Solidity)    |                     |                              |
+-----------------------------+                     +------------------------------+

+-----------------------------------------------------------------------+
|                    AI AGENTS (off-chain)                               |
|                                                                       |
|  +------------------------+    +-----------------------------------+  |
|  | AI Market Maker        |    | AI Keeper (lobKeeper.js)          |  |
|  | (marketMaker.js)       |    |                                   |  |
|  |                        |    | - Polls Pyth Hermes every 10s     |  |
|  | - Pyth mid price       |    | - Calls match_orders(hash, px)   |  |
|  | - Spread calc          |    | - Fills triggered limits          |  |
|  | - store_order bid+ask  |    | - Settles on Robinhood Chain      |  |
|  +------------------------+    +-----------------------------------+  |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| Account Abstraction Layer (Robinhood Chain)                           |
|  - AuraAccount (EIP-4337 Smart Wallet)                                |
|  - AuraFactory (deterministic deploy)                                 |
|  - AuraPaymaster (gas sponsorship)                                    |
+-----------------------------------------------------------------------+         
          
```

---

## Chain Topology

| Chain | Role | Contracts |
|---|---|---|
| **Robinhood Chain Testnet** (46630) | Settlement, positions, vault LP, spot swaps | AuraPerps, AuraVault, AuraPerpsRouter, AuraIntelligenceVault, AuraAccount, aUSD, MockOracle |
| **Arbitrum Sepolia** (421614) | Compute-heavy order book (Stylus WASM) | Stylus LOB v2, Solidity LOB (bench reference) |

**Why two chains?**
- Robinhood Chain = retail settlement layer (where positions and funds live)
- Arbitrum Sepolia = Stylus-enabled compute layer (where the sort-heavy LOB runs 34% cheaper)
- The AI Keeper bridges them: matches on Stylus -- settles on Robinhood

---

## Contract Addresses

### Arbitrum Sepolia
| Contract | Address | Notes |
|---|---|---|
| **Stylus LOB v2** | `0x3346abe000118b25aca953f48deb1978a069e7de` | Rust/WASM, cached in ArbOS, snake_case selectors |
| Solidity LOB (bench) | `0x030839d7AC5Df159dB38ACa99CF8258BF9EC447E` | Reference for gas comparison |

### Robinhood Chain Testnet
| Contract | Address |
|---|---|
| AuraPerps | `0x8AECF449B27BB41E34C04D8C99F4348FF38bB9a2` |
| AuraVault (LP) | `0x4Ae6Ab5BCAb4F0f2FAcAA47aD2ea5832eBDF5792` |
| AuraIntelligenceVault (ERC-4626) | `0x69A88c72eAda96A515e0dc57632A6Abf59EA2E38` |
| AuraPerpsRouter (Hybrid) | `0x5F88E57fBDC5B83827273d2ab8843226F40d0E13` |
| AuraAccount Factory | `0x95Aa20d53EB26f292a71D8B38515BBeC8905b550` |
| AuraMMFund | `0x0581B992cdeD8C739ac9A26eC629014838549018` |
| aUSD | `0x359961489f069F16E5dbA46d9b174bBF7b25147B` |
| Pyth MockOracle | `0x097AeB196366317cf97986A04f32Df312c96ABa1` |

---

## Three Execution Paths

### Path 1: Spot Swap (via `/chat`)
```
User  "Swap 0.001 ETH to AMZN"
   Executor Agent (Llama 3.1 70B) parses intent
   Risk Auditor checks balance + macro sentiment
   Calldata: Synthra V3 Router (Robinhood Chain)
   User signs -- confirmed in ~8s
```

### Path 2: Perp Market Order (via `/trade`)
```
User -- clicks LONG BTC 50x
   Oracle update (fire-and-forget)
   aUSD approve (MAX_UINT, one-time)
   routedMarketOpen(asset, isLong, collateral, leverage)
     walks Stylus LOB for resting asks
     unfilled remainder -- AuraPerps.openPositionFor (Vault LP)
   Position opened at Pyth-fresh entry price
```

### Path 3: Perp Limit Order (via `/trade`)
```
User -- switches to LIMIT mode, enters price
   MetaMask auto-switches to Arbitrum Sepolia (421614)
   store_order(owner, asset_hash, is_long, collateral, leverage, limit_price)
   Order rests in Stylus LOB
   AI Keeper polls Pyth every 10s
   When price crosses limit -- match_orders fills it
   Order appears/disappears in live OrderBook widget
```

---

## AI Agent Architecture

### Multi-Agent Committee (`/chat`)
```

                   runAuraCommittee()                     
                                                         
  1. Intent Classification                               
      isLimitOrderRequest?  LIMIT_ORDER pipeline      
      else -- SWAP pipeline                             
                                                         
  2. Executor Agent (NVIDIA Llama 3.1 70B)               
      Parses NL -- structured JSON                      
      Builds calldata (swap routing / DCA scheduling)  
                                                         
  3. Macro Analyzer                                      
      Pyth Hermes prices (BTC, ETH, TSLA, AMZN...)    
      Correlation matrix (cross-asset risk)            
      NewsAPI sentiment (15 real articles)             
      Score: -100 (bearish) to +100 (bullish)         
                                                         
  4. Risk Auditor                                        
      On-chain balance/allowance check                 
      Macro context integration                        
      Parameter sanity (leverage 50, price drift)     
      Verdict: APPROVE / REJECT with rationale         
                                                         
  Output: { proposal, audit, macroAnalysis }             

```

### AI Market Maker (`marketMaker.js`)
- **Target**: Stylus LOB on Arbitrum Sepolia (direct `store_order`)
- **Strategy**: Symmetric quotes around Pyth mid, configurable spread (default 30 bps)
- **Levels**: 3 per side, 20 bps step between levels
- **Hard cap**: MAX_ACTIVE_PER_SIDE = 12 (prevents unbounded book growth)
- **Cycle**: Every 30s

### AI Keeper (`lobKeeper.js`)
- **Target**: Stylus LOB on Arbitrum Sepolia (direct `match_orders`)
- **Feed**: Pyth Hermes (BTC, ETH)
- **Logic**: `match_orders(asset_hash, current_price_wei)`  the WASM contract flips every ACTIVE order whose limit triggers
- **Cycle**: Every 10s
- **Optimization**: Skips `match_orders` call if `get_book_depth` returns 0 active orders (saves gas)

---

## Stylus vs Solidity Benchmark

Measured on Arbitrum Sepolia with 60 resting orders (30 bids + 30 asks):

| Operation | Stylus (WASM) | Solidity | Savings |
|---|---|---|---|
| `get_active_orders_sorted` cap=20 | 759,447 | 1,103,053 | **31%**  |
| `get_active_orders_sorted` cap=30 | 761,585 | 1,159,369 | **34%**  |
| `match_orders` (0 hits) | 788,052 | 792,359 | ~0% |
| `match_orders` (16 hits) | 529,860 | 526,694 | ~0% |
| `store_order` (60 cumul) | 13,740,458 | 12,662,016 | +8% |

**Conclusion**: Stylus wins on compute-heavy hot paths (sort, bounded insertion). Storage-only ops break even. We deploy Stylus exactly where it matters -- the order book depth query hit on every frontend render.

---

## Test Coverage

**55 passing tests** across 4 test files:

| Suite | Tests | Coverage |
|---|---|---|
| AuraIntelligenceVault | 25 | ERC-4626, risk ceiling, selectors, pause, guardrail |
| AuraOrderBook | 24 | store, cancel, match, consume, sorted view, stats |
| HybridRouter | 4 | routedMarketOpen, placeLimitOrderFor, auth |
| AuraAccount | 2 | executeBatch, factory |

Run: `npx hardhat test`

---

## Repository Structure

```
arbitrum_hackathon/
 contracts/                 Solidity (Perps, Vault, Account, Router, LOB)
    AuraPerps.sol          Perpetuals engine (oracle + vault LP)
    AuraPerpsRouter.sol    Hybrid LOB+AMM router
    AuraOrderBook.sol      Solidity LOB (bench reference)
    AuraIntelligenceVault.sol -- ERC-4626 AI-managed vault
    AuraAccount.sol        EIP-4337 smart wallet
    aUSD.sol               Stablecoin with faucet
 stylus-orderbook/          Rust/WASM order book (Stylus SDK 0.10.6)
    src/lib.rs             331 lines, 16 #[selector] annotations
    Cargo.toml             alloy 1.5.7, edition 2024
    rust-toolchain.toml    Rust 1.91 + wasm32
 backend/                   Node.js multi-agent backend
    agent.js               Executor + Risk Auditor + Macro Analyzer
    marketMaker.js         AI MM -- Stylus LOB (Arb Sepolia)
    lobKeeper.js           AI Keeper -- match_orders (Arb Sepolia)
    index.js               Express API (chat, orderbook, vault, oracle)
    macroAnalyzer.js       Pyth + NewsAPI + correlations
 frontend/                  Next.js 15 + React 19
    app/trade/             Perp trading (LOB + market orders)
    app/chat/              Multi-agent chat (swaps + DCA)
    app/vault/             ERC-4626 deposit/withdraw
    app/whitepaper/        Technical documentation page
 scripts/                   Deploy + bench + init scripts
 test/                      55 Hardhat tests
 README.md                  Project overview
```

---

## Security Model

| Layer | Mechanism |
|---|---|
| **User funds** | Self-custody via EIP-4337 AuraAccount (user is sole owner) |
| **AI execution** | Dual-agent committee: Executor proposes, Auditor validates |
| **Vault** | ERC-4626 with risk score ceiling, protocol whitelist, function selector whitelist, emergency pause |
| **Stylus LOB** | Router-gated writes (only authorized EOA can store/cancel/match) |
| **Oracle** | Pyth Network Hermes (off-chain freshness) + MockOracle (on-chain settlement) |

---

## Running the Full Stack

```bash
# Terminal 1: Backend API
cd backend && node index.js

# Terminal 2: AI Market Maker (populates the Stylus LOB)
cd backend && node marketMaker.js

# Terminal 3: AI Keeper (matches orders when Pyth price crosses limits)
cd backend && node lobKeeper.js

# Terminal 4: Frontend
cd frontend && npm run dev
```

Open http://localhost:3000 -- Connect MetaMask -- Trade.
