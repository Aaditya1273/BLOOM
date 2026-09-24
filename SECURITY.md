# Bloom — Security Model

Bloom is a hackathon prototype. It has **not** been audited. This document lists what we trust, what we
don't, and how each property is enforced and tested.

**The AI agent is not trusted with unrestricted authority.** It can only propose typed actions. The
backend validates them, the onchain `BloomPolicy` authorises or rejects them, and only a scoped,
expiring session key can submit them.

## Trust assumptions

| Actor / dependency | Trusted for | Not trusted for | Enforcement |
| --- | --- | --- | --- |
| Risk engine owner (governance) | Asset config, reporter allowlist, sequencer config, report max age | — | `Ownable2Step`; config bounds (LTV ≤ 80%, deviation ≤ 50%, heartbeat > 0) |
| Reporter key(s) | Truthful halt / corporate-action / reference-price reports | Replaying, reordering, cross-chain or cross-contract reuse, future or stale data | EIP-712 domain (chainId + verifyingContract), per-asset monotonic nonce, `observedAt` ≤ now, max age, monotonic time, low-s signatures, allowlist |
| Chainlink feeds | Prices (mainnet: Robinhood's documented source of truth) | Liveness, sanity | Heartbeat, answer > 0, round completeness, future timestamps, range bound, deviation vs the signed reference |
| Stock Token issuer | `uiMultiplier()`, `oraclePaused()` | — | Read-only; a failed call means CORP_ACTION_PAUSED |
| Vault admin | Adapter, risk engine address, unpause, bad-debt write-off | Moving user funds | No arbitrary call or delegatecall. The adapter must satisfy `asset()==USDG` and `vault()==this`. The adapter can only be swapped while empty |
| Vault guardian | Emergency pause | Unpause | Separate `GUARDIAN_ROLE`. Only the admin can unpause |
| Claim authority | Proving a claim-link recipient out of band | Choosing amounts or tokens | EIP-712 `ClaimAuthorization(claimId, recipient, amount, deadline)` bound to the contract and chain |
| Account owner | Everything on their own account (execute, upgrade, goals) | — | SimpleAccount v0.8 semantics |
| Agent session key | Actions inside one goal's policy | Anything else | `BloomPolicy` plus `BloomAccount._validateSignature` (see below) |
| AI model (optional) | Parsing natural language | Addresses, calldata, amounts beyond policy | Deterministic parser first. Every LLM output goes through the same zod schema. Addresses come only from contacts and the registry |

## Admin roles

- `BloomRiskEngine` owner: `setAssetConfig`, `setReporter`, `setSequencerConfig`, `setMaxReportAge`, two-step ownership transfer.
- `BloomAssetRegistry` owner: `registerAsset` (checks decimals, rejects duplicate tokens or symbols, allows one stable asset), `setEnabled`, `setPriceFeed`.
- `BloomVault`:
  - `DEFAULT_ADMIN_ROLE`: `setRiskEngine`, `setAdapter`, `unpause`, `writeOffBadDebt`.
  - `GUARDIAN_ROLE`: `pause`.
  - `STRATEGIST_ROLE`: `allocate`, `recall`.
- `StockRouter` owner: approve or revoke swap venues, pause.
- `BloomClaims` owner: rotate the claim authority.
- Testnet mocks: `MINTER_ROLE`, `FEED_ADMIN_ROLE`, `CORP_ACTION_ROLE`. **There is no public mint.**

Mainnet recommendation: put every owner and admin role behind a multisig with a timelock before holding real value.

## Signer model

| Key | Holder | Blast radius if compromised |
| --- | --- | --- |
| Deployer / admin | Team (multisig recommended) | Can reconfigure the risk engine and swap the vault adapter. Can't transfer user collateral directly |
| Reporter | Reporter service | Can mark assets halted or normal within the freshness window. Mitigated by rotation (`setReporter(false)`), and the deviation and staleness checks still apply |
| Claim authority | Backend | Can authorise claiming *open* (not recipient-bound) claims to an arbitrary address before they expire |
| Agent session key | Backend | Limited to each goal's policy (for example $50/day, allowlisted assets, NORMAL state only), until the goal expires or is revoked |
| Demo owner (testnet only) | Backend | Only the demo account. The backend refuses to use it on chain 4663 |

## Oracle assumptions

- Mainnet uses the Chainlink Stock Token feeds listed in Chainlink's Robinhood directory. They have 8 decimals, a 24-hour heartbeat and a 0.5% deviation trigger, update 24/5, and already include the corporate-action multiplier.
- A Stock Token is only NORMAL when the price feed is fresh **and** a fresh signed market report exists. A silent reporter makes assets STALE, never NORMAL.
- `oraclePaused()` is advisory, per Robinhood's documentation. Staleness stays the primary guard.
- The reporter's reference price is derived from Robinhood's `/prices` quote. A large gap between it and the Chainlink price gives DEVIATION (5% by default).

## Sequencer

- **Testnet:** `MockSequencerUptimeFeed` demonstrates the guard: `answer 0` means up, `1` means down, and there's a grace period after recovery.
- **Mainnet:** Chainlink publishes **no** L2 Sequencer Uptime Feed for Robinhood Chain (verified 2026-09-24). The deploy script sets `setSequencerConfig(0, 0, false)`, which is an explicit and visible onchain decision (`SequencerConfigUpdated`). Freshness and report-age checks still apply. We don't fake a production feed address.

## Testnet mocks vs mainnet dependencies

Testnet deploys `MockUSDG`, `MockStockToken`, `MockAggregatorV3`, `MockSequencerUptimeFeed`, `MockLendingAdapter`
and `MockSwapVenue`, all labelled **TESTNET MOCK** in the source. `scripts/deploy.js` refuses to deploy mocks on any
chain other than 46630 or 31337. Mainnet deployment uses canonical addresses only. `scripts/preflight-mainnet.js`
checks each one against the official Robinhood asset API and onchain (code, decimals, feed decimals and liveness).
Integrations that haven't been verified, such as a Morpho adapter or an AMM venue, are **not deployed**.

## Paused states

- `BloomVault` paused: deposit, mint, withdraw, redeem, borrow, liquidate and allocate stop. `repay` keeps working, and so does collateral withdrawal for accounts with no debt.
- `StockRouter` paused: send and swap stop.
- Risk states other than NORMAL work as per-asset pauses. Borrowing and liquidation stop for that asset (protected mode), and the agent refuses to act on it.

## Session-key restrictions

A session key is bound to one account and one goal. It can **only** call `BloomAccount.executeByAgent`.
Before execution, `BloomPolicy.authorize` checks every call:

- the target and selector are in the closed set: capped `approve` to Bloom contracts, `BloomVault.deposit` with the receiver set to the account, `StockRouter.send` / `swap`, and `BloomClaims.createClaim`
- the asset is on the goal's allowlist and its risk state is NORMAL
- the USD value fits the per-transaction and daily caps
- there is no native value
- the goal is active and not expired

After a swap, the account checks the Stock Token allocation ceiling. If the call executes but breaks that
ceiling, the whole action reverts. For ERC-4337, `_validateSignature` rejects session-key UserOperations
that call anything other than `executeByAgent(<same key>, …)`, and it returns the goal's validity window.
The EntryPoint then enforces expiry.

## Threat model and mitigations (tested)

| Threat | Mitigation | Test |
| --- | --- | --- |
| Reentrancy | `ReentrancyGuard` on every state-changing vault, router and claims function. Checks-effects-interactions | `BloomVault.test.js` reentrant token |
| Arbitrary call or delegatecall | Accounts expose no delegatecall. The policy uses a closed selector set. The vault only calls known contracts | policy tests, `BloomPolicy.fuzz.t.sol` |
| Signature replay (nonce, chain, contract) | Per-asset monotonic nonce and an EIP-712 domain with chainId and verifyingContract | `RiskEngine.test.js` report authentication |
| Malleable signatures | OZ `ECDSA.tryRecover` (low-s) / Stylus high-s rejection | `RiskEngine.test.js` high-s |
| Stale, invalid, zero, negative, future oracle data | RiskLib guards → STALE / INVALID_PRICE | vectors + `RiskLib.fuzz.t.sol` |
| Oracle manipulation vs reference | DEVIATION state | vectors, onchain tests |
| Decimal mismatch | Registry checks `decimals()` at registration. Explicit normalisation to 1e18 | registry tests, vectors (8/18/20-decimal feeds) |
| Overflow | Bounded prices (≤ 1e36), amounts > 2¹²⁸ rejected in policy valuation | `BloomPolicyAccount.test.js` unlimited approval |
| ERC-4626 first-depositor inflation or donation | `_decimalsOffset() = 6` (virtual shares) | inflation test, `BloomVault.invariant.t.sol` |
| Rounding in the user's favour | OZ rounding (withdraw rounds shares up, redeem rounds assets down) | rounding test, solvency invariant |
| Fee-on-transfer or rebasing tokens | Balance-delta checks, so they're rejected | `FeeOnTransferToken` test |
| Canonical-token spoofing | Registry by exact address. Symbols and names are ignored | spoof tests (router, vault, claims) |
| Unauthorized reporter | Allowlist, revocable | tests |
| Stale or duplicate halt report | max age, monotonic nonce and time | tests |
| Corporate-action inconsistency | `oraclePaused`, report flag, multiplier mismatch → CORP_ACTION_PAUSED | tests + vectors |
| Liquidation during a halt or a stale price | Protected mode: `LiquidationPaused` unless every collateral asset is NORMAL | liquidation tests |
| Unrestricted or expired agent | Policy scope, `validUntil`, revocation | policy/account + ERC-4337 tests |
| Claim double-spend, expiry, wrong recipient, amount mismatch | Status machine, expiry, recipient binding, EIP-712 authorization | `StockRouterClaims.test.js` |
| Slippage or front-running on swaps | Non-zero `minAmountOut`, deadline, output verified by balance delta | router tests |
| Emergency admin abuse | Guardian can only pause. Admin unpause is separate. No admin path moves user collateral | pause test |
| Paymaster drain (Aura) | The unconditional Aura paymaster was removed | — |

## Known limitations

- **Not audited.** Use testnet only.
- Borrowing is interest-free in the prototype, and USDG is valued at $1. The mainnet USDG/USD feed (`0x61B7…9aD2`) is in the config but not yet wired in.
- Liquidation uses a fixed 15% buffer over max LTV, a 5% bonus and a 50% close factor. There's no auction, and bad debt is socialised to savers through `writeOffBadDebt`.
- The reporter is a single allowlisted key. Multi-reporter quorum is future work.
- No Robinhood Chain sequencer uptime feed exists. The mainnet sequencer guard is disabled explicitly.
- Claim-link recipient verification in the demo is a 6-digit code shared out of band (hashed with a salt server-side, attempts limited). Production should use real contact verification.
- The backend holds the agent session key. A compromised backend can act only within active goal policies.
- ERC-8004 identity is supplementary and plays no part in security decisions.

## Reporting

Please report vulnerabilities privately to the maintainers. Don't open public issues for security bugs.
