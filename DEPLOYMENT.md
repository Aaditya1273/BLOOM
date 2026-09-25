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

## 1. Environment and key separation

```bash
cp .env.example .env.local   # gitignored; never commit it
node scripts/generate-role-keys.js   # writes one fresh key per role into .env.local (mode 600), prints addresses only
```

Every role has its own key. There is **no** generic `PRIVATE_KEY` and no fallback from one role to another; the
backend refuses to start if two roles share a key or a role reuses the deployer/admin key.

| Variable | Role | Needed by | Powers |
| --- | --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | DEPLOYER | deploy scripts only | Deploys, hands every role over, keeps **none** |
| `ADMIN_PRIVATE_KEY` / `ADMIN_ADDRESS` | ADMIN | deploy scripts (accepts ownership) | Owner / `DEFAULT_ADMIN_ROLE` everywhere. Production: a Safe (`ADMIN_ADDRESS`) |
| `REPORTER_PRIVATE_KEY` | REPORTER | backend (reporter) | Risk-engine reporter allowlist only |
| `AGENT_PRIVATE_KEY` | AGENT | backend | Session key inside each goal's onchain `BloomPolicy` |
| `CLAIM_AUTHORITY_PRIVATE_KEY` | CLAIM_AUTHORITY | backend | Signs claim-link authorizations |
| `FAUCET_PRIVATE_KEY` | faucet (testnet) | backend | MockUSDG `MINTER_ROLE`; sponsors account creation gas |
| `MOCK_ORACLE_PRIVATE_KEY` | mock oracle (testnet) | backend (reporter) | `FEED_ADMIN` on mock feeds, `CORP_ACTION` on mock Stock Tokens |
| `DEMO_OWNER_PRIVATE_KEY` | DEMO_OWNER (testnet, optional) | smoke scripts | Owns one demo Bloom account. Never loaded on mainnet |
| `BLOOM_RISK_ENGINE_ADDRESS` | — | deploy | Use the deployed Stylus engine instead of the EVM twin |
| `BLOOM_DEPLOYMENT` | — | backend | `localhost` · `robinhood-testnet` · `robinhood-mainnet` |
| `MAINNET_DEPLOY`, `MAINNET_DEPLOY_CONFIRM` | — | mainnet gate | Must be `true` and `YES_I_UNDERSTAND` |
| `MAINNET_MAX_DEPLOYMENT_USD` | — | mainnet gate | Default `0.01`. Deployment stops if the estimate is ≥ this |

On a local Hardhat chain (31337) the public Hardhat dev accounts are always used, whatever is in `.env.local`.

**Retired key.** The testnet was first deployed with a single key that played every role
(`0x5aB3036C7d0bA7043E0BB531374dC6c732eC4954`). It is **retired and must be treated as compromised**: it was stored
in a plain env file and used for everything. `scripts/rotate-roles.js` moved every role to the new keys and proved
onchain that it holds nothing (`deployments/robinhood-testnet.json → roles`, `rolesRotatedAt`). Never reuse it, and never
reuse any key that has appeared in source code (the old Aura repo had one hardcoded).

## 2. Local (Hardhat)

```bash
npm install
npx hardhat node                                   # terminal 1
npm run deploy:local                               # terminal 2 → deployments/localhost.json
cd backend && npm install && npm start             # terminal 3 (reporter runs in-process)
cd frontend && npm install && npm run dev          # terminal 4 → http://localhost:3000
```

## 3. Testnet (46630)

**Live deployment (2026-09-25):** Stylus engine `0xc464c03bfe7efa388457b8b392454b99fa18b124` plus the full Bloom system;
see `deployments/robinhood-testnet.json`. It cost about 0.00053 ETH in total at 0.01 gwei.

Roles on the live testnet deployment (rotated 2026-09-25, see the manifest): ADMIN `0xaC0e…4c00`, REPORTER `0x87D1…dDaa`,
AGENT `0x04d0…35C7`, CLAIM_AUTHORITY `0x89dF…87B0`, FAUCET `0x33d6…4b18`, MOCK_ORACLE `0x82c2…A340`, DEMO_OWNER `0x785E…0E80`.
A fresh deploy hands roles over by itself (`scripts/lib/roles.js`); for an existing deployment run
`npx hardhat run scripts/rotate-roles.js --network robinhoodTestnet`. The in-process reporter runs every 120s on testnet.

### 3a. Stylus risk engine

```bash
node scripts/deploy-stylus.js testnet   # cargo stylus check + deploy with constructor args (owner, maxReportAge)
# → prints the engine address and writes deployments/stylus-risk-engine-testnet.json
```

The script passes `--no-verify` so it builds natively instead of in the reproducible Docker image (Docker is optional).
See section 8 for the verification status of the live engine.

### 3b. Bloom contracts, wired to the Stylus engine

```bash
BLOOM_RISK_ENGINE_ADDRESS=<address from 3a> npm run deploy:testnet
```

If `BLOOM_RISK_ENGINE_ADDRESS` is omitted, the script deploys the EVM twin (same ABI) and records
`"riskEngineImpl": "evm-reference"` in the manifest.

Testnet deployment never asks for confirmation. It refuses to deploy mocks on any chain except 46630 and 31337.

### 3c. Run the services against testnet

```bash
BLOOM_DEPLOYMENT=robinhood-testnet npm --prefix backend start           # API + reporter (public RPC by default)
npm --prefix frontend run dev                                            # RainbowKit on chain 46630
BLOOM_DEPLOYMENT=robinhood-testnet node backend/scripts/wallet-flow-smoke.ts   # optional: end-to-end wallet check
```

The frontend reads only public values from the root env (`WALLET_CONNECT_PROJECT_ID` / `NEXT_PUBLIC_*`), never a key.

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

## 6. Public hosting topology

Nothing here deploys automatically. The intended topology:

```
Browser (RainbowKit wallet)
   │  HTTPS
   ▼
Frontend (Next.js, static + SSR)  ── no secrets; NEXT_PUBLIC_API_URL, NEXT_PUBLIC_CHAIN_ID, WALLET_CONNECT_PROJECT_ID
   │  HTTPS, Authorization: Bearer <session>   (or same-origin /api via a reverse proxy)
   ▼
Backend API (Node, one instance) ── REPORTER, AGENT, CLAIM_AUTHORITY (+ testnet FAUCET, MOCK_ORACLE) keys only
   │  JSON-RPC (dedicated endpoint recommended)
   ▼
Robinhood Chain RPC ──► Bloom contracts (admin = Safe)
```

| Process | Env it needs | Must NOT have |
| --- | --- | --- |
| Frontend | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHAIN_ID`, `WALLET_CONNECT_PROJECT_ID` | any private key |
| Backend | `BLOOM_DEPLOYMENT`, `NODE_ENV=production`, `FRONTEND_ORIGIN` (exact origins), `AUTH_URI`, `TRUST_PROXY` (behind a proxy), `RPC_URL`, role keys above | `DEPLOYER_PRIVATE_KEY`, `ADMIN_PRIVATE_KEY`, `DEMO_OWNER_PRIVATE_KEY` |
| Deploy (operator laptop / CI with approval) | `DEPLOYER_PRIVATE_KEY`, `ADMIN_ADDRESS` | — |

Backend startup refuses to run when: two roles share a key, the RPC's `eth_chainId` differs from the manifest, or
`NODE_ENV=production` has no explicit non-wildcard `FRONTEND_ORIGIN`. Checks for operators and load balancers:
`GET /api/health` (process + chain summary) and `GET /api/health/chain` (RPC reachability, latency, latest block,
risk engine address and implementation). Neither exposes keys or addresses of role keys.

Current single-instance limits: sessions, nonces and rate-limit counters are in memory (a restart signs everyone out;
more than one replica needs a shared store such as Redis), and the JSON data store lives on local disk (`BLOOM_DATA_DIR`).

## 7. Multisig readiness

- All owner contracts use `Ownable2Step`; the vault and mocks use `AccessControl`. Set `ADMIN_ADDRESS=<Safe>` (and no
  `ADMIN_PRIVATE_KEY`): the deploy/rotation hands every role to the Safe, the deployer renounces its `AccessControl` roles,
  and `transferOwnership` leaves ownership **pending** until the Safe calls `acceptOwnership()` on the risk engine,
  asset registry, stock router and claims contracts. The script prints each pending action.
- Until the Safe accepts, the deployer is still the owner of those four contracts. Accept promptly, then confirm with
  `rolesHeldBy()` (see `test/RoleSeparation.test.js`, "multisig pending acceptance").
- Recommended: a 2-of-3 (or stricter) Safe plus a timelock for `setRiskEngine`, `setAdapter` and reporter changes before real value.

## 8. Stylus risk engine: verification status

| | |
| --- | --- |
| Address | `0xc464c03bfe7efa388457b8b392454b99fa18b124` (Robinhood Chain Testnet, 46630) |
| Contract | `bloom-risk-engine` 0.1.0 (`stylus-risk-engine/`), same ABI as `BloomRiskEngineEVM` |
| Deployment tx | `0xac6995c578721fca26871e031c9a31e5745a6a6016b657aa46b750f7158ce403` (via the cargo-stylus deployer contract `0xcEcb…A990`) |
| Size | 32,795 bytes compressed WASM, stored as 2 fragments; onchain root code (`0xeff002…`, 48 bytes) keccak `0x2921…919e` |
| Source commit | `14a21e3` (`stylus-risk-engine/` unchanged since) |
| Toolchain | Rust 1.91.0 (`rust-toolchain.toml`), stylus-sdk 0.10.6, cargo-stylus 0.10.9 |
| Owner / reporter | ADMIN `0xaC0e…4c00` / REPORTER `0x87D1…dDaa` (verified onchain after rotation) |
| **Source verified** | **No.** It was built natively with `--no-verify`; the explorer reports `is_verified: false`. Reproducible verification needs Docker: `cd stylus-risk-engine && cargo stylus verify --deployment-tx 0xac69…e403 --endpoint https://rpc.testnet.chain.robinhood.com`. Until that succeeds, treat the deployed bytecode as unverified. |

## 9. ERC-8004 identity (optional)

The ERC-8004 Identity Registry (maintained by the ERC-8004 team, not Robinhood) **is deployed on Robinhood Chain Testnet**
at `0x8004A818BFB912233c491871b3d84c89A494BD9e`: an ERC-1967 proxy to `0x7274…9c02` ("AgentIdentity", symbol `AGENT`) whose
implementation exposes `register(string)`, `setAgentURI(uint256,string)` and the `Registered(uint256,string,address)` event
(checked onchain on 2026-09-25). `backend/scripts/register-agent.ts` is compatible with it.

**Bloom is not registered yet.** The registration must point at a publicly reachable `PUBLIC_API_URL/api/agent/metadata`,
and Bloom is not publicly hosted; the script refuses localhost/plain-http URIs. After hosting:

```bash
ERC8004_IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e ERC8004_RPC_URL=https://rpc.testnet.chain.robinhood.com \
ERC8004_OWNER_PRIVATE_KEY=<its own key> PUBLIC_API_URL=https://api.<domain> npm --prefix backend run register-agent
```

ERC-8004 identity is informational only; no security decision depends on it.
