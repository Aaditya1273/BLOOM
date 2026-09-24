//! ╔═══════════════════════════════════════════════════════════════════╗
//! ║         AURA ORDER BOOK — Stylus WASM Limit Order Book          ║
//! ║    High-Performance On-Chain LOB for Hybrid Perps Exchange       ║
//! ╚═══════════════════════════════════════════════════════════════════╝
//!
//! Order Lifecycle: Active(1) → Filled(2) → Executed(3) or Cancelled(0)
//! Token escrow handled by Solidity Router, not this contract.
//!
//! ABI parity with `contracts/AuraOrderBook.sol` (Solidity fallback) so the
//! Solidity AuraPerpsRouter can call either the Stylus WASM build or the
//! Solidity LOB transparently via the same `IAuraOrderBook` interface.

#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use stylus_sdk::{
    alloy_primitives::{Address, U256},
    prelude::*,
};
use alloc::vec::Vec;

const STATUS_CANCELLED: u64 = 0;
const STATUS_ACTIVE: u64 = 1;
const STATUS_FILLED: u64 = 2;
const STATUS_EXECUTED: u64 = 3;

sol_storage! {
    #[entrypoint]
    pub struct AuraOrderBook {
        address owner;
        address router;
        address keeper;
        bool initialized;
        uint256 next_order_id;

        // Order fields (parallel maps keyed by order id)
        mapping(uint256 => address) order_owner;
        mapping(uint256 => uint256) order_asset;
        mapping(uint256 => bool) order_is_long;
        mapping(uint256 => uint256) order_collateral;
        mapping(uint256 => uint256) order_leverage;
        mapping(uint256 => uint256) order_limit_price;
        mapping(uint256 => uint256) order_timestamp;
        mapping(uint256 => uint256) order_status;

        // Aggregate counters per asset
        mapping(uint256 => uint256) active_bid_count;
        mapping(uint256 => uint256) active_ask_count;
        uint256 total_orders_placed;
        uint256 total_orders_filled;
    }
}

#[public]
impl AuraOrderBook {
    pub fn initialize(&mut self, router: Address, keeper: Address) {
        if self.initialized.get() { return; }
        let sender = self.vm().msg_sender();
        self.owner.set(sender);
        self.router.set(router);
        self.keeper.set(keeper);
        self.initialized.set(true);
    }

    #[selector(name = "set_router")]
    pub fn set_router(&mut self, router: Address) {
        if self.vm().msg_sender() != self.owner.get() { return; }
        self.router.set(router);
    }

    #[selector(name = "set_keeper")]
    pub fn set_keeper(&mut self, keeper: Address) {
        if self.vm().msg_sender() != self.owner.get() { return; }
        self.keeper.set(keeper);
    }

    // ═══════════ ORDER STORAGE ═══════════

    #[selector(name = "store_order")]
    pub fn store_order(
        &mut self,
        owner: Address,
        asset_hash: U256,
        is_long: bool,
        collateral: U256,
        leverage: U256,
        limit_price: U256,
    ) -> U256 {
        if self.vm().msg_sender() != self.router.get() { return U256::MAX; }
        if collateral.is_zero() || leverage.is_zero() || limit_price.is_zero() { return U256::MAX; }
        if leverage > U256::from(50) { return U256::MAX; }

        let order_id = self.next_order_id.get();

        let timestamp = U256::from(self.vm().block_timestamp());
        self.order_owner.setter(order_id).set(owner);
        self.order_asset.setter(order_id).set(asset_hash);
        self.order_is_long.setter(order_id).set(is_long);
        self.order_collateral.setter(order_id).set(collateral);
        self.order_leverage.setter(order_id).set(leverage);
        self.order_limit_price.setter(order_id).set(limit_price);
        self.order_timestamp.setter(order_id).set(timestamp);
        self.order_status.setter(order_id).set(U256::from(STATUS_ACTIVE));

        if is_long {
            let c = self.active_bid_count.get(asset_hash);
            self.active_bid_count.setter(asset_hash).set(c + U256::from(1));
        } else {
            let c = self.active_ask_count.get(asset_hash);
            self.active_ask_count.setter(asset_hash).set(c + U256::from(1));
        }

        self.next_order_id.set(order_id + U256::from(1));
        let t = self.total_orders_placed.get();
        self.total_orders_placed.set(t + U256::from(1));

        order_id
    }

    #[selector(name = "cancel_order")]
    pub fn cancel_order(&mut self, order_id: U256, caller: Address) -> bool {
        if self.vm().msg_sender() != self.router.get() { return false; }
        let status: u64 = self.order_status.get(order_id).try_into().unwrap_or(0);
        if status != STATUS_ACTIVE { return false; }
        if self.order_owner.get(order_id) != caller { return false; }

        self.order_status.setter(order_id).set(U256::from(STATUS_CANCELLED));

        let asset_hash = self.order_asset.get(order_id);
        if self.order_is_long.get(order_id) {
            let c = self.active_bid_count.get(asset_hash);
            if c > U256::ZERO { self.active_bid_count.setter(asset_hash).set(c - U256::from(1)); }
        } else {
            let c = self.active_ask_count.get(asset_hash);
            if c > U256::ZERO { self.active_ask_count.setter(asset_hash).set(c - U256::from(1)); }
        }
        true
    }

    // ═══════════ MATCHING ENGINE ═══════════

    /// Long (bid): fill when current_price <= limit_price
    /// Short (ask): fill when current_price >= limit_price
    #[selector(name = "match_orders")]
    pub fn match_orders(&mut self, asset_hash: U256, current_price: U256) -> U256 {
        let sender = self.vm().msg_sender();
        if sender != self.router.get() && sender != self.keeper.get() { return U256::ZERO; }
        if current_price.is_zero() { return U256::ZERO; }

        let total: u64 = self.next_order_id.get().try_into().unwrap_or(0);
        let mut matched: u64 = 0;

        for i in 0..total {
            let id = U256::from(i);
            let status: u64 = self.order_status.get(id).try_into().unwrap_or(0);
            if status != STATUS_ACTIVE { continue; }
            if self.order_asset.get(id) != asset_hash { continue; }

            let is_long = self.order_is_long.get(id);
            let limit_price = self.order_limit_price.get(id);

            let should_fill = if is_long {
                current_price <= limit_price
            } else {
                current_price >= limit_price
            };

            if should_fill {
                self.order_status.setter(id).set(U256::from(STATUS_FILLED));
                if is_long {
                    let c = self.active_bid_count.get(asset_hash);
                    if c > U256::ZERO { self.active_bid_count.setter(asset_hash).set(c - U256::from(1)); }
                } else {
                    let c = self.active_ask_count.get(asset_hash);
                    if c > U256::ZERO { self.active_ask_count.setter(asset_hash).set(c - U256::from(1)); }
                }
                matched += 1;
                let tf = self.total_orders_filled.get();
                self.total_orders_filled.set(tf + U256::from(1));
            }
        }
        U256::from(matched)
    }

    #[selector(name = "mark_executed")]
    pub fn mark_executed(&mut self, order_id: U256) -> bool {
        let sender = self.vm().msg_sender();
        if sender != self.router.get() && sender != self.keeper.get() { return false; }
        let status: u64 = self.order_status.get(order_id).try_into().unwrap_or(0);
        if status != STATUS_FILLED { return false; }
        self.order_status.setter(order_id).set(U256::from(STATUS_EXECUTED));
        true
    }

    /// Take a single resting ACTIVE order out of the book and mark it
    /// EXECUTED in one atomic step. Used by `routedMarketOpen` on the
    /// Solidity router to consume makers without going through the
    /// keeper's two-phase Filled→Executed lifecycle.
    #[selector(name = "consume_order")]
    pub fn consume_order(&mut self, order_id: U256) -> bool {
        if self.vm().msg_sender() != self.router.get() { return false; }
        let status: u64 = self.order_status.get(order_id).try_into().unwrap_or(0);
        if status != STATUS_ACTIVE { return false; }

        self.order_status.setter(order_id).set(U256::from(STATUS_EXECUTED));

        let asset_hash = self.order_asset.get(order_id);
        if self.order_is_long.get(order_id) {
            let c = self.active_bid_count.get(asset_hash);
            if c > U256::ZERO { self.active_bid_count.setter(asset_hash).set(c - U256::from(1)); }
        } else {
            let c = self.active_ask_count.get(asset_hash);
            if c > U256::ZERO { self.active_ask_count.setter(asset_hash).set(c - U256::from(1)); }
        }

        let tf = self.total_orders_filled.get();
        self.total_orders_filled.set(tf + U256::from(1));
        true
    }

    // ═══════════ VIEW FUNCTIONS ═══════════

    #[selector(name = "get_order")]
    pub fn get_order(&self, order_id: U256) -> (Address, U256, bool, U256, U256, U256, U256, U256) {
        (
            self.order_owner.get(order_id),
            self.order_asset.get(order_id),
            self.order_is_long.get(order_id),
            self.order_collateral.get(order_id),
            self.order_leverage.get(order_id),
            self.order_limit_price.get(order_id),
            self.order_timestamp.get(order_id),
            self.order_status.get(order_id),
        )
    }

    #[selector(name = "get_filled_orders")]
    pub fn get_filled_orders(&self, asset_hash: U256) -> Vec<U256> {
        let total: u64 = self.next_order_id.get().try_into().unwrap_or(0);
        let mut result = Vec::new();
        for i in 0..total {
            let id = U256::from(i);
            let s: u64 = self.order_status.get(id).try_into().unwrap_or(0);
            if s == STATUS_FILLED && self.order_asset.get(id) == asset_hash {
                result.push(id);
            }
        }
        result
    }

    #[selector(name = "get_active_orders")]
    pub fn get_active_orders(&self, asset_hash: U256, is_long: bool) -> Vec<U256> {
        let total: u64 = self.next_order_id.get().try_into().unwrap_or(0);
        let mut result = Vec::new();
        for i in 0..total {
            let id = U256::from(i);
            let s: u64 = self.order_status.get(id).try_into().unwrap_or(0);
            if s == STATUS_ACTIVE && self.order_asset.get(id) == asset_hash && self.order_is_long.get(id) == is_long {
                result.push(id);
            }
        }
        result
    }

    /// Top-N active orders for `asset_hash` on the `is_long` side, sorted
    /// best-first. Bids: descending price (highest first). Asks: ascending
    /// (lowest first). Returns parallel `(ids, prices, sizes)` vectors.
    /// Bounded insertion-sort O(N * cap). Cap defaults to 20, capped at 256.
    #[selector(name = "get_active_orders_sorted")]
    pub fn get_active_orders_sorted(
        &self,
        asset_hash: U256,
        is_long: bool,
        max_results: U256,
    ) -> (Vec<U256>, Vec<U256>, Vec<U256>) {
        let cap: usize = if max_results.is_zero() {
            20usize
        } else {
            let raw: u64 = max_results.try_into().unwrap_or(256);
            core::cmp::min(raw as usize, 256usize)
        };

        let mut ids: Vec<U256> = Vec::with_capacity(cap);
        let mut prices: Vec<U256> = Vec::with_capacity(cap);
        let mut sizes: Vec<U256> = Vec::with_capacity(cap);

        let total: u64 = self.next_order_id.get().try_into().unwrap_or(0);

        for i in 0..total {
            let id = U256::from(i);
            let status: u64 = self.order_status.get(id).try_into().unwrap_or(0);
            if status != STATUS_ACTIVE { continue; }
            if self.order_asset.get(id) != asset_hash { continue; }
            if self.order_is_long.get(id) != is_long { continue; }

            let p = self.order_limit_price.get(id);
            let s = self.order_collateral.get(id).saturating_mul(self.order_leverage.get(id));

            // Insertion-sort: best entries earlier.
            //   bid (is_long): higher price first → shift while prev < p
            //   ask         : lower price first  → shift while prev > p
            let mut pos = prices.len();
            while pos > 0 {
                let prev = prices[pos - 1];
                let should_shift = if is_long { prev < p } else { prev > p };
                if !should_shift { break; }
                pos -= 1;
            }

            if pos < cap {
                if prices.len() < cap {
                    ids.push(U256::ZERO);
                    prices.push(U256::ZERO);
                    sizes.push(U256::ZERO);
                }
                let mut k = prices.len() - 1;
                while k > pos {
                    ids[k] = ids[k - 1];
                    prices[k] = prices[k - 1];
                    sizes[k] = sizes[k - 1];
                    k -= 1;
                }
                ids[pos] = id;
                prices[pos] = p;
                sizes[pos] = s;
            }
        }

        (ids, prices, sizes)
    }

    #[selector(name = "get_book_depth")]
    pub fn get_book_depth(&self, asset_hash: U256) -> (U256, U256) {
        (self.active_bid_count.get(asset_hash), self.active_ask_count.get(asset_hash))
    }

    #[selector(name = "get_stats")]
    pub fn get_stats(&self) -> (U256, U256, U256) {
        (self.next_order_id.get(), self.total_orders_placed.get(), self.total_orders_filled.get())
    }

    #[selector(name = "next_id")]
    pub fn next_id(&self) -> U256 { self.next_order_id.get() }

    #[selector(name = "get_router")]
    pub fn get_router(&self) -> Address { self.router.get() }

    #[selector(name = "get_keeper")]
    pub fn get_keeper(&self) -> Address { self.keeper.get() }
}
