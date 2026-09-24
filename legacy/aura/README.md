# Archived: Aura

This directory preserves the original **Aura** codebase (AI perpetual-trading terminal) that Bloom evolved from.
It is **not built, tested or deployed** by Bloom and is excluded from the Hardhat source path.

Kept for attribution and reference only (MIT, see the root LICENSE). Reused and hardened in Bloom:
- `AuraAccount` / `AuraFactory` → `contracts/BloomAccount.sol` / `contracts/BloomAccountFactory.sol`
  (the unrestricted `aiAgent` path was replaced by policy-scoped session keys)
- `AuraVault` (ERC-4626) → `contracts/BloomVault.sol` (rewritten: inflation-attack offset, risk-gated borrowing)
- Stylus crate conventions (`stylus-guardrail/`) → `stylus-risk-engine/`

Removed from the product: perpetual futures, leverage, order book, copy trading, market maker, keepers,
liquidation-alert UX, and the unconditional `AuraPaymaster` (it sponsored every UserOperation without verification).
Hardcoded private keys that existed in archived debug scripts were replaced with `process.env.PRIVATE_KEY`;
treat any key that was ever committed to this code as compromised.
