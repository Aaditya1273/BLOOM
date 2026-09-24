# Bloom — Deployment

| | Testnet | Mainnet |
| --- | --- | --- |
| Chain id | **46630** | **4663** |
| RPC | `https://rpc.testnet.chain.robinhood.com` | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | https://explorer.testnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |
| Faucets (third-party) | https://faucets.chain.link/robinhood-testnet · https://faucet.quicknode.com/robinhood/testnet | — |
| Assets | testnet mocks (deployed by the script) | canonical (`config/robinhood-mainnet.json`) |
| Output manifest | `deployments/robinhood-testnet.json` | `deployments/robinhood-mainnet.json` |

The public RPCs are rate-limited. Set `RH_TESTNET_RPC_URL` / `RH_MAINNET_RPC_URL` to a dedicated endpoint if you have one.

## 1. Environment

```bash
cp .env.example .env      # never commit .env
```

| Variable | Used by | Notes |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | Hardhat, Stylus deploy | Admin/owner of every contract (use a multisig handover on mainnet) |
| `REPORTER_PRIVATE_KEY` / `REPORTER_ADDRESS` | deploy (allowlist), reporter | Signs EIP-712 market reports |
| `CLAIM_AUTHORITY_PRIVATE_KEY` / `CLAIM_AUTHORITY_ADDRESS` | deploy, backend | Signs claim-link authorizations |
| `AGENT_SESSION_PRIVATE_KEY` | backend | Bloom Agent session key (policy-scoped) |
| `DEMO_OWNER_PRIVATE_KEY` | backend (testnet only) | Owner of the demo smart account |
| `BLOOM_RISK_ENGINE_ADDRESS` | deploy | Use the deployed Stylus engine instead of the EVM twin |
| `BLOOM_DEPLOYMENT` | backend | `localhost` · `robinhood-testnet` · `robinhood-mainnet` |
| `MAINNET_DEPLOY`, `MAINNET_DEPLOY_CONFIRM` | mainnet gate | Must be `true` and `YES_I_UNDERSTAND` |
| `MAINNET_MAX_DEPLOYMENT_USD` | mainnet gate | Default `0.01`. Deployment stops if the estimate is ≥ this |
| `ALLOW_EVM_RISK_ENGINE` | mainnet | Only if you deliberately deploy the EVM twin instead of Stylus |

Generate fresh keys, and never reuse a key that has ever appeared in source code:

```bash
node -e "const w=require('ethers').Wallet.createRandom();console.log(w.address, w.privateKey)"
```

Fund the deployer, reporter and agent addresses with testnet ETH from a faucet.

## 2. Local (Hardhat)

```bash
npm install
npx hardhat node                                   # terminal 1
npm run deploy:local                               # terminal 2 → deployments/localhost.json
cd backend && npm install && npm start             # terminal 3 (reporter runs in-process)
cd frontend && npm install && npm run dev          # terminal 4 → http://localhost:3000
```

## 3. Testnet (46630)

### 3a. Stylus risk engine

```bash
cd stylus-risk-engine
cargo stylus check  --endpoint $RH_TESTNET_RPC_URL
node ../scripts/deploy-stylus.js testnet           # wraps `cargo stylus deploy` with constructor args (owner, maxReportAge)
# → prints the engine address and writes deployments/stylus-risk-engine-testnet.json
```

### 3b. Bloom contracts, wired to the Stylus engine

```bash
BLOOM_RISK_ENGINE_ADDRESS=<address from 3a> npm run deploy:testnet
```

If `BLOOM_RISK_ENGINE_ADDRESS` is omitted, the script deploys the EVM twin (same ABI) and records
`"riskEngineImpl": "evm-reference"` in the manifest.

Testnet deployment never asks for confirmation. It refuses to deploy mocks on any chain except 46630 and 31337.

### 3c. Run the services against testnet

```bash
BLOOM_DEPLOYMENT=robinhood-testnet npm --prefix backend start
NEXT_PUBLIC_API_URL=http://localhost:3001 npm --prefix frontend run dev
```

## 4. Mainnet (4663) — gated

Mainnet never deploys automatically, even if everything compiles.

```bash
npm run preflight:mainnet            # read-only; safe to run any time
```

The preflight:
1. Checks every configured Stock Token address against the official Robinhood asset API
   (`https://api.robinhood.com/rhj/assets`, deployments for chain 4663). It also checks onchain that each
   address has code and 18 decimals, that USDG has 6, and that the Chainlink feed has 8 decimals and a positive answer.
2. Dry-runs the whole production deployment on an **in-process fork of mainnet** and records every transaction.
3. Estimates `cost = Σ(L2 gasUsed + L1 data gas from NodeInterface.gasEstimateL1Component) × live gas price × ETH/USD`.
   ETH/USD comes from the onchain Chainlink ETH/USD feed on Robinhood Chain (`0x78F3…d3A9`), not from a hardcoded price or a scraped website.
4. Prints `Estimated deployment cost: $X.XXXX` and **exits non-zero** if the cost is ≥ `MAINNET_MAX_DEPLOYMENT_USD`.

Result on 2026-09-24: 18 transactions, 13,351,117 L2 gas, 0 L1 data gas, gas price 0.04187 gwei,
ETH/USD $2,675.90, **estimated cost ≈ $1.50**. That is above the default $0.01 limit, so the gate stops.
To actually deploy, raise the limit explicitly:

```bash
MAINNET_DEPLOY=true MAINNET_DEPLOY_CONFIRM=YES_I_UNDERSTAND MAINNET_MAX_DEPLOYMENT_USD=3 \
BLOOM_RISK_ENGINE_ADDRESS=<mainnet Stylus engine> npm run deploy:mainnet
```

Mainnet deploys **only** production components: the registry with canonical USDG and Stock Tokens, the
risk engine config (Chainlink feeds, no sequencer feed, recorded explicitly), the vault with **no**
lending adapter, the router with **no** swap venue, claims, policy and the account factory. It uses the
canonical EntryPoint v0.8. No mock is ever deployed on mainnet.

Integrations deliberately **not** deployed on mainnet until verified: a Morpho Blue lending adapter
(Morpho `0x9D53…1010` exists, but no adapter has been audited) and an AMM swap venue.

## 5. Verification

- Every run writes the manifest (`deployments/<network>.json`) with contract addresses, assets and roles.
- Explorer: `https://explorer.testnet.chain.robinhood.com/address/<address>` or `https://robinhoodchain.blockscout.com/address/<address>`.
- Blockscout source verification: `npx hardhat verify --network robinhoodTestnet <address> <constructor args…>` (needs a Blockscout-compatible `etherscan.customChains` entry if you enable it). For Stylus: `cargo stylus verify --deployment-tx <hash>`.
- Smoke-test a deployment: `GET /api/health` and `GET /api/risk` on the backend.
