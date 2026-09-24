//! ╔═══════════════════════════════════════════════════════════════════╗
//! ║         AURA GUARDRAIL — Stylus WASM Trade Validator            ║
//! ║    On-Chain Safety Layer for AI-Proposed Trades                  ║
//! ╚═══════════════════════════════════════════════════════════════════╝
//!
//! This contract validates trade parameters BEFORE execution. Even if the
//! AI agent is compromised, the WASM guardrail rejects any trade that
//! violates safety invariants (max leverage, position size, daily limits).
//!
//! Rejection Codes:
//!   0x00 = APPROVED
//!   0x01 = REJECTED_LEVERAGE_EXCEEDED
//!   0x02 = REJECTED_POSITION_TOO_LARGE
//!   0x03 = REJECTED_DAILY_VOLUME_EXCEEDED
//!   0x04 = REJECTED_ASSET_NOT_ALLOWED
//!   0x05 = REJECTED_COLLATERAL_BELOW_MINIMUM

#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use stylus_sdk::{
    alloy_primitives::{Address, U256},
    prelude::*,
};

sol_storage! {
    #[entrypoint]
    pub struct AuraGuardrail {
        address owner;
        address router;
        bool initialized;

        // ── Safety Parameters ──
        uint256 max_leverage;           // e.g. 50
        uint256 max_position_size;      // max notional in wei (collateral * leverage)
        uint256 min_collateral;         // minimum collateral per trade
        uint256 daily_volume_cap;       // max total volume per user per day

        // ── Per-user daily tracking ──
        mapping(address => uint256) user_daily_volume;
        mapping(address => uint256) user_last_reset_day;

        // ── Asset whitelist ──
        mapping(uint256 => bool) allowed_assets;

        // ── Stats ──
        uint256 total_validations;
        uint256 total_rejections;
    }
}

#[public]
impl AuraGuardrail {
    /// Initialize the guardrail with safety parameters.
    #[selector(name = "initialize")]
    pub fn initialize(
        &mut self,
        router: Address,
        max_leverage: U256,
        max_position_size: U256,
        min_collateral: U256,
        daily_volume_cap: U256,
    ) {
        if self.initialized.get() {
            return;
        }
        let sender = self.vm().msg_sender();
        self.owner.set(sender);
        self.router.set(router);
        self.max_leverage.set(max_leverage);
        self.max_position_size.set(max_position_size);
        self.min_collateral.set(min_collateral);
        self.daily_volume_cap.set(daily_volume_cap);
        self.initialized.set(true);
    }

    #[selector(name = "validate_trade")]
    pub fn validate_trade(
        &mut self,
        user: Address,
        asset_hash: U256,
        collateral: U256,
        leverage: U256,
    ) -> (bool, U256) {
        self.total_validations.set(self.total_validations.get() + U256::from(1));

        // Check 1: Asset must be whitelisted
        if !self.allowed_assets.get(asset_hash) {
            self.total_rejections.set(self.total_rejections.get() + U256::from(1));
            return (false, U256::from(4));
        }

        // Check 2: Leverage within bounds
        let max_lev = self.max_leverage.get();
        if leverage > max_lev {
            self.total_rejections.set(self.total_rejections.get() + U256::from(1));
            return (false, U256::from(1));
        }

        // Check 3: Minimum collateral
        let min_col = self.min_collateral.get();
        if collateral < min_col {
            self.total_rejections.set(self.total_rejections.get() + U256::from(1));
            return (false, U256::from(5));
        }

        // Check 4: Position size (collateral * leverage) within max
        let position_size = collateral * leverage;
        let max_pos = self.max_position_size.get();
        if position_size > max_pos {
            self.total_rejections.set(self.total_rejections.get() + U256::from(1));
            return (false, U256::from(2));
        }

        // Check 5: Daily volume cap per user
        let current_day = U256::from(self.vm().block_timestamp() / 86400);
        let last_reset = self.user_last_reset_day.get(user);
        let mut daily_vol = self.user_daily_volume.get(user);

        if current_day > last_reset {
            // New day — reset counter
            daily_vol = U256::ZERO;
            self.user_last_reset_day.setter(user).set(current_day);
        }

        let new_vol = daily_vol + position_size;
        let cap = self.daily_volume_cap.get();
        if cap > U256::ZERO && new_vol > cap {
            self.total_rejections.set(self.total_rejections.get() + U256::from(1));
            return (false, U256::from(3));
        }

        // All checks passed — update daily volume
        self.user_daily_volume.setter(user).set(new_vol);

        (true, U256::ZERO)
    }

    // ── Admin Functions ──

    #[selector(name = "allow_asset")]
    pub fn allow_asset(&mut self, asset_hash: U256) {
        let sender = self.vm().msg_sender();
        let owner = self.owner.get();
        if sender != owner {
            return;
        }
        self.allowed_assets.setter(asset_hash).set(true);
    }

    #[selector(name = "disallow_asset")]
    pub fn disallow_asset(&mut self, asset_hash: U256) {
        let sender = self.vm().msg_sender();
        let owner = self.owner.get();
        if sender != owner {
            return;
        }
        self.allowed_assets.setter(asset_hash).set(false);
    }

    #[selector(name = "set_params")]
    pub fn set_params(
        &mut self,
        max_leverage: U256,
        max_position_size: U256,
        min_collateral: U256,
        daily_volume_cap: U256,
    ) {
        let sender = self.vm().msg_sender();
        let owner = self.owner.get();
        if sender != owner {
            return;
        }
        self.max_leverage.set(max_leverage);
        self.max_position_size.set(max_position_size);
        self.min_collateral.set(min_collateral);
        self.daily_volume_cap.set(daily_volume_cap);
    }

    // ── View Functions ──

    #[selector(name = "get_params")]
    pub fn get_params(&self) -> (U256, U256, U256, U256) {
        (
            self.max_leverage.get(),
            self.max_position_size.get(),
            self.min_collateral.get(),
            self.daily_volume_cap.get(),
        )
    }

    #[selector(name = "get_stats")]
    pub fn get_stats(&self) -> (U256, U256) {
        (self.total_validations.get(), self.total_rejections.get())
    }

    #[selector(name = "get_user_daily_volume")]
    pub fn get_user_daily_volume(&self, user: Address) -> U256 {
        self.user_daily_volume.get(user)
    }

    #[selector(name = "is_asset_allowed")]
    pub fn is_asset_allowed(&self, asset_hash: U256) -> bool {
        self.allowed_assets.get(asset_hash)
    }
}
