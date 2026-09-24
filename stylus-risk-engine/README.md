# bloom-risk-engine (Arbitrum Stylus)

Production Bloom Risk Engine: an equity-aware risk layer that interprets Chainlink-style prices together with
EIP-712-signed market-status reports (halts, corporate actions), freshness, deviation and L2 sequencer uptime,
and returns one of `NORMAL 0, HALTED 1, STALE 2, DEVIATION 3, CORP_ACTION_PAUSED 4, SEQUENCER_DOWN 5,
INVALID_PRICE 6, UNSUPPORTED 7`.

- `src/risk.rs` – pure `classify` / `normalize` / `deviates`, a 1:1 mirror of `contracts/risk/RiskLib.sol`.
- `src/eip712.rs` – domain separator / struct hash / digest, signature length, `v`, high-`s` checks.
- `src/lib.rs` – the `#[entrypoint]` contract: storage, admin, report ingestion, external reads.

**EVM twin.** `contracts/risk/BloomRiskEngineEVM.sol` exposes the same ABI, EIP-712 domain
(`BloomRiskEngine`, `1`, chainId, this contract), events and custom errors. Both are tested against the shared
vectors in `test/vectors/risk-vectors.json` (43 classification cases + one EIP-712 vector).

## ABI

| function | notes |
|---|---|
| `constructor(address initialOwner, uint64 maxReportAge)` | Stylus `#[constructor]`, runs atomically at deploy |
| `owner()`, `pendingOwner()`, `transferOwnership(address)`, `acceptOwnership()`, `renounceOwnership()` | OZ Ownable2Step semantics + errors |
| `setAssetConfig(address asset, address feed, uint64 heartbeat, uint16 deviationBps, uint16 maxLtvBps, bool isStockToken, bool enabled)` | onlyOwner; caches `feed.decimals()` |
| `setReporter(address, bool)`, `setSequencerConfig(address feed, uint64 grace, bool required)`, `setMaxReportAge(uint64)` | onlyOwner |
| `submitReport(address asset, bool halted, bool corporateActionPaused, uint256 uiMultiplier, uint256 referencePrice, uint64 observedAt, uint64 nonce, bytes signature) → uint8` | permissionless relay, signer must be allowlisted |
| `getRisk(address) → (uint8 state, uint16 maxLtvBps, bool borrowingAllowed, bool liquidationAllowed, uint256 price, uint256 updatedAt)` | live view |
| `refresh(address) → uint8` | persists snapshot, emits transitions |
| `domainSeparator()`, `eip712Domain()`, `reportDigest(...)`, `REPORT_TYPEHASH()`, `MAX_LTV_CAP_BPS()`, `MAX_DEVIATION_BPS()` | |
| `isReporter`, `getAssetConfig`, `getReport`, `getSnapshot`, `sequencerFeed`, `sequencerGrace`, `sequencerRequired`, `lastSequencerUp`, `maxReportAge` | views |

Failed or malformed external reads (price feed, sequencer feed, stock token hooks) never revert: they map to the
"call failed" inputs and the classifier default-denies. `ecrecover` goes through the precompile at `0x01`.

## Test

```sh
cargo test                                            # vectors, EIP-712 parity, contract tests on TestVM
cargo build --release --target wasm32-unknown-unknown
cargo stylus check --endpoint https://rpc.testnet.chain.robinhood.com
cargo stylus export-abi                               # Solidity interface
```

## Deploy

```sh
cargo stylus deploy --endpoint https://rpc.testnet.chain.robinhood.com \
  --private-key-path <key-file> \
  --constructor-args <initialOwner> <maxReportAge>
```

Then, as owner: `setSequencerConfig`, `setReporter`, `setAssetConfig` for each asset.
