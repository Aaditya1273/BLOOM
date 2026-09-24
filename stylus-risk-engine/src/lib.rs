//! Bloom Risk Engine — Arbitrum Stylus (production) implementation.
//!
//! ABI / EIP-712 domain / events / errors are identical to `contracts/risk/BloomRiskEngineEVM.sol`.
//! Classification rules live in [`risk`] (mirror of `RiskLib.sol`), EIP-712 helpers in [`eip712`].
//! Both are pure and checked against the shared vectors in `test/vectors/risk-vectors.json`.

#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

pub mod eip712;
pub mod risk;

use alloc::{string::String, vec, vec::Vec};
use alloy_primitives::{Address, B256, FixedBytes, I256, U8, U16, U64, U256, address};
use alloy_sol_types::sol;
use stylus_sdk::{abi::Bytes, prelude::*};

use risk::{Inputs, MAX_PRICE, RiskState, classify};

pub const MAX_LTV_CAP_BPS: u16 = 8000;
pub const MAX_DEVIATION_BPS: u16 = 5000;
const ECRECOVER: Address = address!("0000000000000000000000000000000000000001");

sol! {
    // ─── events (identical to BloomRiskEngineEVM + OZ Ownable2Step) ───
    event RiskStateChanged(address indexed asset, uint8 previousState, uint8 newState);
    event PriceUpdated(address indexed asset, uint256 price, uint256 updatedAt);
    event HaltUpdated(address indexed asset, bool halted, uint64 observedAt, uint64 nonce, address reporter);
    event CorporateActionStateChanged(address indexed asset, bool paused, uint256 uiMultiplier);
    event ReporterUpdated(address indexed reporter, bool allowed);
    event SequencerStateChanged(bool up);
    event SequencerConfigUpdated(address feed, uint64 grace, bool required);
    event AssetConfigured(
        address indexed asset,
        address feed,
        uint64 heartbeat,
        uint16 deviationBps,
        uint16 maxLtvBps,
        bool isStockToken,
        bool enabled
    );
    event MaxReportAgeUpdated(uint64 maxReportAge);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ─── errors ───
    error ZeroAddress();
    error InvalidConfig();
    error AssetNotConfigured(address asset);
    error UnauthorizedReporter(address signer);
    error InvalidSignature();
    error ReplayedNonce(uint64 nonce, uint64 lastNonce);
    error ReportFromFuture(uint64 observedAt);
    error StaleReport(uint64 observedAt);
    error OutOfOrderReport(uint64 observedAt, uint64 lastObservedAt);
    error InvalidReferencePrice();
    error OwnableUnauthorizedAccount(address account);
    error OwnableInvalidOwner(address owner);
}

#[derive(SolidityError)]
pub enum Error {
    ZeroAddress(ZeroAddress),
    InvalidConfig(InvalidConfig),
    AssetNotConfigured(AssetNotConfigured),
    UnauthorizedReporter(UnauthorizedReporter),
    InvalidSignature(InvalidSignature),
    ReplayedNonce(ReplayedNonce),
    ReportFromFuture(ReportFromFuture),
    StaleReport(StaleReport),
    OutOfOrderReport(OutOfOrderReport),
    InvalidReferencePrice(InvalidReferencePrice),
    OwnableUnauthorizedAccount(OwnableUnauthorizedAccount),
    OwnableInvalidOwner(OwnableInvalidOwner),
}

sol_storage! {
    pub struct AssetConfig {
        address feed;
        uint64 heartbeat;
        uint16 deviation_bps;
        uint16 max_ltv_bps;
        uint8 feed_decimals;
        bool is_stock_token;
        bool enabled;
    }

    pub struct MarketReport {
        bool halted;
        bool corporate_action_paused;
        uint256 ui_multiplier;
        uint256 reference_price;
        uint64 observed_at;
        uint64 nonce;
    }

    pub struct Snapshot {
        uint8 state;
        uint256 last_valid_price;
        uint256 last_updated_at;
    }

    #[entrypoint]
    pub struct BloomRiskEngine {
        address owner;
        address pending_owner;
        mapping(address => AssetConfig) configs;
        mapping(address => MarketReport) reports;
        mapping(address => Snapshot) snapshots;
        mapping(address => bool) reporters;
        address sequencer_feed;
        uint64 sequencer_grace;
        bool sequencer_required;
        bool last_sequencer_up;
        uint64 max_report_age;
    }
}

// ─── calldata selectors of the external views we read ───
const SEL_LATEST_ROUND_DATA: [u8; 4] = [0xfe, 0xaf, 0x96, 0x8c]; // latestRoundData()
const SEL_DECIMALS: [u8; 4] = [0x31, 0x3c, 0xe5, 0x67]; // decimals()
const SEL_ORACLE_PAUSED: [u8; 4] = [0x77, 0x06, 0xba, 0x52]; // oraclePaused()
const SEL_UI_MULTIPLIER: [u8; 4] = [0xa6, 0x0b, 0xf1, 0x3d]; // uiMultiplier()

fn word(d: &[u8], i: usize) -> U256 {
    U256::from_be_slice(&d[i * 32..i * 32 + 32])
}
fn fits(v: U256, bits: usize) -> bool {
    v.bit_len() <= bits
}

/// Strictly decoded `latestRoundData()` (uint80, int256, uint256, uint256, uint80). `None` if malformed,
/// which the engine treats exactly like a failed call (default-deny).
struct Round {
    round_id: u128,
    answer: I256,
    started_at: U256,
    updated_at: U256,
    answered_in_round: u128,
}
fn decode_round(d: &[u8]) -> Option<Round> {
    if d.len() < 160 || !fits(word(d, 0), 80) || !fits(word(d, 4), 80) {
        return None;
    }
    Some(Round {
        round_id: word(d, 0).to(),
        answer: I256::from_raw(word(d, 1)),
        started_at: word(d, 2),
        updated_at: word(d, 3),
        answered_in_round: word(d, 4).to(),
    })
}
fn decode_word(d: Option<Vec<u8>>, bits: usize) -> Option<U256> {
    let d = d?;
    if d.len() < 32 {
        return None;
    }
    let w = word(&d, 0);
    fits(w, bits).then_some(w)
}

type GetRisk = (u8, u16, bool, bool, U256, U256);

impl BloomRiskEngine {
    /// Static call; any failure (revert, no code, ...) is `None` — never a revert of this contract.
    fn view_call(&self, to: Address, data: &[u8]) -> Option<Vec<u8>> {
        #[cfg(test)]
        {
            let _ = self;
            tests::mock_static_call(to, data)
        }
        #[cfg(not(test))]
        {
            stylus_sdk::call::static_call(self.vm(), stylus_sdk::stylus_core::calls::Call::new(), to, data).ok()
        }
    }

    fn only_owner(&self) -> Result<(), Error> {
        let sender = self.vm().msg_sender();
        if sender != self.owner.get() {
            return Err(Error::OwnableUnauthorizedAccount(OwnableUnauthorizedAccount { account: sender }));
        }
        Ok(())
    }

    fn transfer_ownership_internal(&mut self, new_owner: Address) {
        self.pending_owner.set(Address::ZERO);
        let prev = self.owner.get();
        self.owner.set(new_owner);
        self.vm().log(OwnershipTransferred { previousOwner: prev, newOwner: new_owner });
    }

    fn domain_sep(&self) -> B256 {
        eip712::domain_separator(self.vm().chain_id(), self.vm().contract_address())
    }

    fn inputs(&self, asset: Address) -> Inputs {
        let cfg = self.configs.get(asset);
        let feed = cfg.feed.get();
        let mut i = Inputs { now: self.vm().block_timestamp(), ..Default::default() };
        i.configured = feed != Address::ZERO && cfg.enabled.get();
        if !i.configured {
            return i;
        }
        i.is_stock_token = cfg.is_stock_token.get();
        i.heartbeat = cfg.heartbeat.get().to();
        i.deviation_bps = cfg.deviation_bps.get().to();
        i.feed_decimals = cfg.feed_decimals.get().to();

        i.sequencer_required = self.sequencer_required.get();
        i.sequencer_grace = self.sequencer_grace.get().to();
        if i.sequencer_required {
            if let Some(r) = self.view_call(self.sequencer_feed.get(), &SEL_LATEST_ROUND_DATA).as_deref().and_then(decode_round) {
                i.sequencer_ok = true;
                i.sequencer_answer = r.answer;
                i.sequencer_started_at = r.started_at;
            }
        }

        if let Some(r) = self.view_call(feed, &SEL_LATEST_ROUND_DATA).as_deref().and_then(decode_round) {
            i.feed_ok = true;
            i.round_id = r.round_id;
            i.answer = r.answer;
            i.updated_at = r.updated_at;
            i.answered_in_round = r.answered_in_round;
        }

        let r = self.reports.get(asset);
        i.has_report = r.nonce.get() != U64::ZERO;
        i.report_observed_at = r.observed_at.get().to();
        i.max_report_age = self.max_report_age.get().to();
        i.halted = r.halted.get();
        i.report_corp_action_paused = r.corporate_action_paused.get();
        i.report_multiplier = r.ui_multiplier.get();
        i.reference_price = r.reference_price.get();

        if i.is_stock_token {
            let paused = decode_word(self.view_call(asset, &SEL_ORACLE_PAUSED), 1);
            let mult = decode_word(self.view_call(asset, &SEL_UI_MULTIPLIER), 256);
            if let (Some(p), Some(m)) = (paused, mult) {
                i.token_ok = true;
                i.token_oracle_paused = !p.is_zero();
                i.token_multiplier = m;
            }
        }
        i
    }

    fn refresh_internal(&mut self, asset: Address) -> u8 {
        let inp = self.inputs(asset);
        let (s, p) = classify(&inp);

        if self.sequencer_required.get() {
            let up = inp.sequencer_ok && inp.sequencer_answer.is_zero();
            if up != self.last_sequencer_up.get() {
                self.last_sequencer_up.set(up);
                self.vm().log(SequencerStateChanged { up });
            }
        }

        let (last_price, last_updated, prev) = {
            let snap = self.snapshots.get(asset);
            (snap.last_valid_price.get(), snap.last_updated_at.get(), snap.state.get().to::<u8>())
        };
        if s.price_trusted() && (p != last_price || inp.updated_at != last_updated) {
            let mut snap = self.snapshots.setter(asset);
            snap.last_valid_price.set(p);
            snap.last_updated_at.set(inp.updated_at);
            self.vm().log(PriceUpdated { asset, price: p, updatedAt: inp.updated_at });
        }
        let new_state = s as u8;
        if new_state != prev {
            self.snapshots.setter(asset).state.set(U8::from(new_state));
            self.vm().log(RiskStateChanged { asset, previousState: prev, newState: new_state });
        }
        new_state
    }

    fn set_max_report_age_internal(&mut self, age: u64) -> Result<(), Error> {
        if age == 0 {
            return Err(Error::InvalidConfig(InvalidConfig {}));
        }
        self.max_report_age.set(U64::from(age));
        self.vm().log(MaxReportAgeUpdated { maxReportAge: age });
        Ok(())
    }
}

#[public]
impl BloomRiskEngine {
    #[constructor]
    pub fn constructor(&mut self, initial_owner: Address, max_report_age: u64) -> Result<(), Error> {
        if initial_owner == Address::ZERO {
            return Err(Error::OwnableInvalidOwner(OwnableInvalidOwner { owner: Address::ZERO }));
        }
        self.transfer_ownership_internal(initial_owner);
        self.set_max_report_age_internal(max_report_age)
    }

    // ═══════════════════════ constants ═══════════════════════

    #[selector(name = "REPORT_TYPEHASH")]
    pub fn report_typehash(&self) -> B256 {
        eip712::report_typehash()
    }

    #[selector(name = "MAX_LTV_CAP_BPS")]
    pub fn max_ltv_cap_bps(&self) -> u16 {
        MAX_LTV_CAP_BPS
    }

    #[selector(name = "MAX_DEVIATION_BPS")]
    pub fn max_deviation_bps(&self) -> u16 {
        MAX_DEVIATION_BPS
    }

    // ═══════════════════════ ownership (OZ Ownable2Step) ═══════════════════════

    pub fn owner(&self) -> Address {
        self.owner.get()
    }

    pub fn pending_owner(&self) -> Address {
        self.pending_owner.get()
    }

    pub fn transfer_ownership(&mut self, new_owner: Address) -> Result<(), Error> {
        self.only_owner()?;
        self.pending_owner.set(new_owner);
        self.vm().log(OwnershipTransferStarted { previousOwner: self.owner.get(), newOwner: new_owner });
        Ok(())
    }

    pub fn accept_ownership(&mut self) -> Result<(), Error> {
        let sender = self.vm().msg_sender();
        if sender != self.pending_owner.get() {
            return Err(Error::OwnableUnauthorizedAccount(OwnableUnauthorizedAccount { account: sender }));
        }
        self.transfer_ownership_internal(sender);
        Ok(())
    }

    pub fn renounce_ownership(&mut self) -> Result<(), Error> {
        self.only_owner()?;
        self.transfer_ownership_internal(Address::ZERO);
        Ok(())
    }

    // ═══════════════════════ admin ═══════════════════════

    #[allow(clippy::too_many_arguments)]
    pub fn set_asset_config(
        &mut self,
        asset: Address,
        feed: Address,
        heartbeat: u64,
        deviation_bps: u16,
        max_ltv_bps: u16,
        is_stock_token: bool,
        enabled: bool,
    ) -> Result<(), Error> {
        self.only_owner()?;
        if asset == Address::ZERO || feed == Address::ZERO {
            return Err(Error::ZeroAddress(ZeroAddress {}));
        }
        if heartbeat == 0 || deviation_bps == 0 || deviation_bps > MAX_DEVIATION_BPS || max_ltv_bps > MAX_LTV_CAP_BPS {
            return Err(Error::InvalidConfig(InvalidConfig {}));
        }
        // ponytail: a failing/malformed decimals() reverts InvalidConfig (EVM twin bubbles the feed's revert data).
        let dec = decode_word(self.view_call(feed, &SEL_DECIMALS), 8).ok_or(Error::InvalidConfig(InvalidConfig {}))?;
        if dec > U256::from(36) {
            return Err(Error::InvalidConfig(InvalidConfig {}));
        }
        let mut c = self.configs.setter(asset);
        c.feed.set(feed);
        c.heartbeat.set(U64::from(heartbeat));
        c.deviation_bps.set(U16::from(deviation_bps));
        c.max_ltv_bps.set(U16::from(max_ltv_bps));
        c.feed_decimals.set(U8::from(dec.to::<u8>()));
        c.is_stock_token.set(is_stock_token);
        c.enabled.set(enabled);
        self.vm().log(AssetConfigured {
            asset,
            feed,
            heartbeat,
            deviationBps: deviation_bps,
            maxLtvBps: max_ltv_bps,
            isStockToken: is_stock_token,
            enabled,
        });
        Ok(())
    }

    pub fn set_reporter(&mut self, reporter: Address, allowed: bool) -> Result<(), Error> {
        self.only_owner()?;
        if reporter == Address::ZERO {
            return Err(Error::ZeroAddress(ZeroAddress {}));
        }
        self.reporters.setter(reporter).set(allowed);
        self.vm().log(ReporterUpdated { reporter, allowed });
        Ok(())
    }

    pub fn set_sequencer_config(&mut self, feed: Address, grace: u64, required: bool) -> Result<(), Error> {
        self.only_owner()?;
        if required && feed == Address::ZERO {
            return Err(Error::ZeroAddress(ZeroAddress {}));
        }
        self.sequencer_feed.set(feed);
        self.sequencer_grace.set(U64::from(grace));
        self.sequencer_required.set(required);
        self.vm().log(SequencerConfigUpdated { feed, grace, required });
        Ok(())
    }

    pub fn set_max_report_age(&mut self, max_report_age: u64) -> Result<(), Error> {
        self.only_owner()?;
        self.set_max_report_age_internal(max_report_age)
    }

    // ═══════════════════════ reports ═══════════════════════

    pub fn domain_separator(&self) -> B256 {
        self.domain_sep()
    }

    /// EIP-5267 (as exposed by OpenZeppelin EIP712).
    #[selector(name = "eip712Domain")]
    pub fn eip712_domain(&self) -> (FixedBytes<1>, String, String, U256, Address, B256, Vec<U256>) {
        (
            FixedBytes([0x0f]),
            eip712::NAME.into(),
            eip712::VERSION.into(),
            U256::from(self.vm().chain_id()),
            self.vm().contract_address(),
            B256::ZERO,
            vec![],
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn report_digest(
        &self,
        asset: Address,
        halted: bool,
        corporate_action_paused: bool,
        ui_multiplier: U256,
        reference_price: U256,
        observed_at: u64,
        nonce: u64,
    ) -> B256 {
        let sh = eip712::struct_hash(asset, halted, corporate_action_paused, ui_multiplier, reference_price, observed_at, nonce);
        eip712::typed_digest(self.domain_sep(), sh)
    }

    /// Submit a market-status report signed (EIP-712) by an allowlisted reporter. Anyone may relay it.
    #[allow(clippy::too_many_arguments)]
    pub fn submit_report(
        &mut self,
        asset: Address,
        halted: bool,
        corporate_action_paused: bool,
        ui_multiplier: U256,
        reference_price: U256,
        observed_at: u64,
        nonce: u64,
        signature: Bytes,
    ) -> Result<u8, Error> {
        if self.configs.get(asset).feed.get() == Address::ZERO {
            return Err(Error::AssetNotConfigured(AssetNotConfigured { asset }));
        }
        let prev = self.reports.get(asset);
        let prev_nonce: u64 = prev.nonce.get().to();
        let prev_observed: u64 = prev.observed_at.get().to();
        let prev_paused = prev.corporate_action_paused.get();
        let prev_mult = prev.ui_multiplier.get();
        let now = self.vm().block_timestamp();

        if nonce <= prev_nonce {
            return Err(Error::ReplayedNonce(ReplayedNonce { nonce, lastNonce: prev_nonce }));
        }
        if observed_at > now {
            return Err(Error::ReportFromFuture(ReportFromFuture { observedAt: observed_at }));
        }
        if now - observed_at > self.max_report_age.get().to::<u64>() {
            return Err(Error::StaleReport(StaleReport { observedAt: observed_at }));
        }
        if observed_at < prev_observed {
            return Err(Error::OutOfOrderReport(OutOfOrderReport { observedAt: observed_at, lastObservedAt: prev_observed }));
        }
        if reference_price > MAX_PRICE {
            return Err(Error::InvalidReferencePrice(InvalidReferencePrice {}));
        }

        let digest = self.report_digest(asset, halted, corporate_action_paused, ui_multiplier, reference_price, observed_at, nonce);
        let signer = eip712::ecrecover_input(digest, &signature)
            .and_then(|input| self.view_call(ECRECOVER, &input))
            .and_then(|out| eip712::parse_ecrecover_output(&out))
            .ok_or(Error::InvalidSignature(InvalidSignature {}))?;
        if !self.reporters.get(signer) {
            return Err(Error::UnauthorizedReporter(UnauthorizedReporter { signer }));
        }

        let mut r = self.reports.setter(asset);
        r.halted.set(halted);
        r.corporate_action_paused.set(corporate_action_paused);
        r.ui_multiplier.set(ui_multiplier);
        r.reference_price.set(reference_price);
        r.observed_at.set(U64::from(observed_at));
        r.nonce.set(U64::from(nonce));

        self.vm().log(HaltUpdated { asset, halted, observedAt: observed_at, nonce, reporter: signer });
        if prev_paused != corporate_action_paused || prev_mult != ui_multiplier {
            self.vm().log(CorporateActionStateChanged { asset, paused: corporate_action_paused, uiMultiplier: ui_multiplier });
        }
        Ok(self.refresh_internal(asset))
    }

    // ═══════════════════════ evaluation ═══════════════════════

    /// Live (non-cached) risk evaluation.
    pub fn get_risk(&self, asset: Address) -> GetRisk {
        let inp = self.inputs(asset);
        let (s, p) = classify(&inp);
        let normal = s == RiskState::Normal;
        let max_ltv: u16 = if normal { self.configs.get(asset).max_ltv_bps.get().to() } else { 0 };
        let (price, updated_at) = if s.price_trusted() { (p, inp.updated_at) } else { (U256::ZERO, U256::ZERO) };
        (s as u8, max_ltv, normal, normal, price, updated_at)
    }

    /// Recompute and persist the state, emitting events on transitions. Permissionless.
    pub fn refresh(&mut self, asset: Address) -> u8 {
        self.refresh_internal(asset)
    }

    // ═══════════════════════ views ═══════════════════════

    pub fn is_reporter(&self, reporter: Address) -> bool {
        self.reporters.get(reporter)
    }

    pub fn sequencer_feed(&self) -> Address {
        self.sequencer_feed.get()
    }

    pub fn sequencer_grace(&self) -> u64 {
        self.sequencer_grace.get().to()
    }

    pub fn sequencer_required(&self) -> bool {
        self.sequencer_required.get()
    }

    pub fn last_sequencer_up(&self) -> bool {
        self.last_sequencer_up.get()
    }

    pub fn max_report_age(&self) -> u64 {
        self.max_report_age.get().to()
    }

    /// Same encoding as Solidity `AssetConfig` (all-static struct == flat tuple on the wire).
    pub fn get_asset_config(&self, asset: Address) -> (Address, u64, u16, u16, u8, bool, bool) {
        let c = self.configs.get(asset);
        (
            c.feed.get(),
            c.heartbeat.get().to(),
            c.deviation_bps.get().to(),
            c.max_ltv_bps.get().to(),
            c.feed_decimals.get().to(),
            c.is_stock_token.get(),
            c.enabled.get(),
        )
    }

    pub fn get_report(&self, asset: Address) -> (bool, bool, U256, U256, u64, u64) {
        let r = self.reports.get(asset);
        (
            r.halted.get(),
            r.corporate_action_paused.get(),
            r.ui_multiplier.get(),
            r.reference_price.get(),
            r.observed_at.get().to(),
            r.nonce.get().to(),
        )
    }

    pub fn get_snapshot(&self, asset: Address) -> (u8, U256, U256) {
        let s = self.snapshots.get(asset);
        (s.state.get().to(), s.last_valid_price.get(), s.last_updated_at.get())
    }
}

#[cfg(test)]
mod tests;
