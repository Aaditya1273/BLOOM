//! Contract-level tests on stylus-sdk's TestVM.
//!
//! TestVM 0.10.x's `mock_static_call` returns the data of the *last registered* mock for every call
//! (`read_return_data` reads one global buffer), so it cannot serve several distinct external reads in
//! one transaction. External reads therefore go through `mock_static_call` below (cfg(test) only);
//! everything else (storage, msg.sender, timestamp, chain id, logs) runs on TestVM. The ecrecover
//! precompile is emulated with k256 so signature checks are exercised end to end.

use super::*;
use alloy_primitives::{Signature, keccak256};
use alloy_sol_types::{SolError, SolEvent, SolValue};
use k256::ecdsa::SigningKey;
use std::{cell::RefCell, collections::HashMap};
use stylus_sdk::testing::TestVM;

thread_local! {
    static MOCKS: RefCell<HashMap<(Address, Vec<u8>), Option<Vec<u8>>>> = RefCell::new(HashMap::new());
}

pub(crate) fn mock_static_call(to: Address, data: &[u8]) -> Option<Vec<u8>> {
    if to == ECRECOVER {
        return Some(ecrecover_precompile(data));
    }
    // unknown target: like calling an address without code -> success with empty data
    MOCKS.with(|m| m.borrow().get(&(to, data.to_vec())).cloned().unwrap_or(Some(vec![])))
}

/// Precompile 0x01 semantics: empty output on any failure, else left-padded address.
fn ecrecover_precompile(input: &[u8]) -> Vec<u8> {
    let digest = B256::from_slice(&input[..32]);
    let v = U256::from_be_slice(&input[32..64]);
    if v != U256::from(27) && v != U256::from(28) {
        return vec![];
    }
    let mut sig = input[64..128].to_vec();
    sig.push(v.to::<u8>());
    match Signature::try_from(sig.as_slice()).ok().and_then(|s| s.recover_address_from_prehash(&digest).ok()) {
        Some(a) => B256::left_padding_from(a.as_slice()).to_vec(),
        None => vec![],
    }
}

fn mock(to: Address, sel: [u8; 4], ret: Option<Vec<u8>>) {
    MOCKS.with(|m| m.borrow_mut().insert((to, sel.to_vec()), ret));
}

const NOW: u64 = 1_800_000_000;
const OWNER: Address = address!("00000000000000000000000000000000000000A1");
const STRANGER: Address = address!("00000000000000000000000000000000000000B2");
const ASSET: Address = address!("00000000000000000000000000000000000AA91E");
const FEED: Address = address!("00000000000000000000000000000000000FEED1");
const SEQ: Address = address!("00000000000000000000000000000000000005E0");
const ENGINE: Address = address!("00000000000000000000000000000000000B1003");
const CHAIN_ID: u64 = 46630;
const PRICE_8DEC: u64 = 21_241_000_000; // $212.41
fn e18() -> U256 {
    U256::from(10u64).pow(U256::from(18))
}
fn ref_price() -> U256 {
    U256::from(PRICE_8DEC) * U256::from(10_000_000_000u64)
}

fn round(answer: i64, started_at: u64, updated_at: u64) -> Vec<u8> {
    (U256::from(10), I256::try_from(answer).unwrap(), U256::from(started_at), U256::from(updated_at), U256::from(10))
        .abi_encode_params()
}

fn key() -> SigningKey {
    // throwaway test key, never used on any network
    SigningKey::from_slice(&[0x42; 32]).unwrap()
}
fn key_addr(k: &SigningKey) -> Address {
    Address::from_public_key(k.verifying_key())
}

struct Env {
    vm: TestVM,
    c: BloomRiskEngine,
}

fn setup() -> Env {
    MOCKS.with(|m| m.borrow_mut().clear());
    let vm = TestVM::new();
    vm.set_block_timestamp(NOW);
    vm.set_chain_id(CHAIN_ID);
    vm.set_contract_address(ENGINE);
    let mut c = BloomRiskEngine::from(&vm);
    c.constructor(OWNER, 300).ok().unwrap();
    vm.set_sender(OWNER);

    mock(FEED, SEL_DECIMALS, Some(U256::from(8).abi_encode()));
    mock(FEED, SEL_LATEST_ROUND_DATA, Some(round(PRICE_8DEC as i64, NOW - 8, NOW - 8)));
    mock(ASSET, SEL_ORACLE_PAUSED, Some(false.abi_encode()));
    mock(ASSET, SEL_UI_MULTIPLIER, Some(e18().abi_encode()));
    c.set_asset_config(ASSET, FEED, 3600, 500, 7000, true, true).ok().unwrap();
    c.set_reporter(key_addr(&key()), true).ok().unwrap();
    Env { vm, c }
}

fn err<T>(r: Result<T, Error>) -> Vec<u8> {
    match r {
        Ok(_) => panic!("expected revert"),
        Err(e) => e.into(),
    }
}

#[derive(Clone)]
struct Report {
    halted: bool,
    paused: bool,
    mult: U256,
    reference: U256,
    observed_at: u64,
    nonce: u64,
}
fn report(nonce: u64) -> Report {
    Report { halted: false, paused: false, mult: e18(), reference: ref_price(), observed_at: NOW - 30, nonce }
}

fn sign(c: &BloomRiskEngine, r: &Report, k: &SigningKey) -> Vec<u8> {
    let d = c.report_digest(ASSET, r.halted, r.paused, r.mult, r.reference, r.observed_at, r.nonce);
    let (sig, recid) = k.sign_prehash_recoverable(d.as_slice()).unwrap();
    let mut out = sig.to_bytes().to_vec();
    out.push(27 + recid.to_byte());
    out
}

fn submit(c: &mut BloomRiskEngine, r: &Report, sig: Vec<u8>) -> Result<u8, Error> {
    c.submit_report(ASSET, r.halted, r.paused, r.mult, r.reference, r.observed_at, r.nonce, sig.into())
}
fn submit_signed(c: &mut BloomRiskEngine, r: &Report) -> Result<u8, Error> {
    let sig = sign(c, r, &key());
    submit(c, r, sig)
}

fn state_changes(vm: &TestVM) -> Vec<(u8, u8)> {
    vm.get_emitted_logs()
        .iter()
        .filter(|(t, _)| t.first() == Some(&RiskStateChanged::SIGNATURE_HASH))
        .map(|(t, d)| {
            let e = RiskStateChanged::decode_raw_log(t.iter().copied(), d).unwrap();
            assert_eq!(e.asset, ASSET);
            (e.previousState, e.newState)
        })
        .collect()
}

// ─────────────────────────── plumbing sanity ───────────────────────────

#[test]
fn selectors_match_signatures() {
    let sel = |s: &str| <[u8; 4]>::try_from(&keccak256(s)[..4]).unwrap();
    assert_eq!(SEL_LATEST_ROUND_DATA, sel("latestRoundData()"));
    assert_eq!(SEL_DECIMALS, sel("decimals()"));
    assert_eq!(SEL_ORACLE_PAUSED, sel("oraclePaused()"));
    assert_eq!(SEL_UI_MULTIPLIER, sel("uiMultiplier()"));
}

#[test]
fn contract_digest_matches_eip712_vector() {
    let v: serde_json::Value = serde_json::from_str(include_str!("../../test/vectors/risk-vectors.json")).unwrap();
    let e = &v["eip712"];
    let Env { c, .. } = setup(); // chain id + address match the vector domain
    assert_eq!(c.domain_separator(), e["domainSeparator"].as_str().unwrap().parse::<B256>().unwrap());
    let m = &e["message"];
    let d = c.report_digest(
        m["asset"].as_str().unwrap().parse().unwrap(),
        m["halted"].as_bool().unwrap(),
        m["corporateActionPaused"].as_bool().unwrap(),
        m["uiMultiplier"].as_str().unwrap().parse().unwrap(),
        m["referencePrice"].as_str().unwrap().parse().unwrap(),
        m["observedAt"].as_u64().unwrap(),
        m["nonce"].as_u64().unwrap(),
    );
    assert_eq!(d, e["digest"].as_str().unwrap().parse::<B256>().unwrap());
    assert_eq!(
        c.report_typehash(),
        keccak256("MarketReport(address asset,bool halted,bool corporateActionPaused,uint256 uiMultiplier,uint256 referencePrice,uint64 observedAt,uint64 nonce)")
    );
    // vector signature recovers through the (emulated) precompile path
    let sig = alloy_primitives::hex::decode(e["signature"].as_str().unwrap()).unwrap();
    let out = mock_static_call(ECRECOVER, &eip712::ecrecover_input(d, &sig).unwrap()).unwrap();
    assert_eq!(eip712::parse_ecrecover_output(&out), Some(e["signer"].as_str().unwrap().parse().unwrap()));
}

// ─────────────────────────── admin ───────────────────────────

#[test]
fn constructor_validation() {
    let vm = TestVM::new();
    let mut c = BloomRiskEngine::from(&vm);
    assert_eq!(err(c.constructor(Address::ZERO, 300)), OwnableInvalidOwner { owner: Address::ZERO }.abi_encode());
    let vm = TestVM::new();
    let mut c = BloomRiskEngine::from(&vm);
    assert_eq!(err(c.constructor(OWNER, 0)), InvalidConfig {}.abi_encode());

    let Env { c, vm } = setup();
    assert_eq!(c.owner(), OWNER);
    assert_eq!(c.max_report_age(), 300);
    assert_eq!(c.max_ltv_cap_bps(), 8000);
    assert_eq!(c.max_deviation_bps(), 5000);
    let first = &vm.get_emitted_logs()[0];
    assert_eq!(first.0[0], OwnershipTransferred::SIGNATURE_HASH);
}

#[test]
fn unauthorized_admin_reverts() {
    let Env { mut c, vm } = setup();
    vm.set_sender(STRANGER);
    let want = OwnableUnauthorizedAccount { account: STRANGER }.abi_encode();
    assert_eq!(err(c.set_asset_config(ASSET, FEED, 3600, 500, 7000, true, true)), want);
    assert_eq!(err(c.set_reporter(STRANGER, true)), want);
    assert_eq!(err(c.set_sequencer_config(SEQ, 3600, true)), want);
    assert_eq!(err(c.set_max_report_age(1)), want);
    assert_eq!(err(c.transfer_ownership(STRANGER)), want);
    assert_eq!(err(c.renounce_ownership()), want);
    assert_eq!(err(c.accept_ownership()), want);
    assert!(!c.is_reporter(STRANGER));
    assert_eq!(c.max_report_age(), 300);
    assert_eq!(c.owner(), OWNER);
}

#[test]
fn two_step_ownership() {
    let Env { mut c, vm } = setup();
    c.transfer_ownership(STRANGER).ok().unwrap();
    assert_eq!(c.owner(), OWNER);
    assert_eq!(c.pending_owner(), STRANGER);
    vm.set_sender(STRANGER);
    c.accept_ownership().ok().unwrap();
    assert_eq!(c.owner(), STRANGER);
    assert_eq!(c.pending_owner(), Address::ZERO);
    vm.set_sender(OWNER);
    assert_eq!(err(c.set_max_report_age(1)), OwnableUnauthorizedAccount { account: OWNER }.abi_encode());
}

#[test]
fn asset_config_validation() {
    let Env { mut c, .. } = setup();
    assert_eq!(err(c.set_asset_config(Address::ZERO, FEED, 1, 1, 0, false, true)), ZeroAddress {}.abi_encode());
    assert_eq!(err(c.set_asset_config(ASSET, Address::ZERO, 1, 1, 0, false, true)), ZeroAddress {}.abi_encode());
    let bad = InvalidConfig {}.abi_encode();
    assert_eq!(err(c.set_asset_config(ASSET, FEED, 0, 1, 0, false, true)), bad);
    assert_eq!(err(c.set_asset_config(ASSET, FEED, 1, 0, 0, false, true)), bad);
    assert_eq!(err(c.set_asset_config(ASSET, FEED, 1, 5001, 0, false, true)), bad);
    assert_eq!(err(c.set_asset_config(ASSET, FEED, 1, 1, 8001, false, true)), bad);
    mock(FEED, SEL_DECIMALS, Some(U256::from(37).abi_encode()));
    assert_eq!(err(c.set_asset_config(ASSET, FEED, 1, 1, 0, false, true)), bad);
    mock(FEED, SEL_DECIMALS, None); // reverting feed
    assert_eq!(err(c.set_asset_config(ASSET, FEED, 1, 1, 0, false, true)), bad);
    // cached config unchanged
    assert_eq!(c.get_asset_config(ASSET), (FEED, 3600, 500, 7000, 8, true, true));
}

// ─────────────────────────── reports ───────────────────────────

#[test]
fn halted_then_recovery() {
    let Env { mut c, vm } = setup();
    // no report yet: stock token is STALE (default-deny)
    assert_eq!(c.get_risk(ASSET).0, RiskState::Stale as u8);

    assert_eq!(submit_signed(&mut c, &report(1)).ok(), Some(0));
    assert_eq!(c.get_risk(ASSET), (0, 7000, true, true, ref_price(), U256::from(NOW - 8)));
    assert_eq!(c.get_snapshot(ASSET), (0, ref_price(), U256::from(NOW - 8)));

    vm.clear_mocks(); // clears TestVM logs only
    let halted = Report { halted: true, observed_at: NOW - 20, ..report(2) };
    assert_eq!(submit_signed(&mut c, &halted).ok(), Some(RiskState::Halted as u8));
    assert_eq!(state_changes(&vm), vec![(0, 1)]);
    let (s, ltv, borrow, liq, price, _) = c.get_risk(ASSET);
    assert_eq!((s, ltv, borrow, liq, price), (1, 0, false, false, ref_price())); // price still trusted
    assert_eq!(c.get_report(ASSET), (true, false, e18(), ref_price(), NOW - 20, 2));
    let halt_logs = vm.get_emitted_logs().iter().filter(|(t, _)| t[0] == HaltUpdated::SIGNATURE_HASH).count();
    assert_eq!(halt_logs, 1);

    vm.clear_mocks();
    let recovered = Report { observed_at: NOW - 10, ..report(3) };
    assert_eq!(submit_signed(&mut c, &recovered).ok(), Some(0));
    assert_eq!(state_changes(&vm), vec![(1, 0)]);
    assert_eq!(c.get_snapshot(ASSET).0, 0);
}

#[test]
fn corporate_action_event_and_state() {
    let Env { mut c, vm } = setup();
    submit_signed(&mut c, &report(1)).ok().unwrap();
    vm.clear_mocks();
    let split = Report { mult: e18() * U256::from(2), ..report(2) }; // report says 2:1 split, token still 1x
    assert_eq!(submit_signed(&mut c, &split).ok(), Some(RiskState::CorpActionPaused as u8));
    assert!(vm.get_emitted_logs().iter().any(|(t, _)| t[0] == CorporateActionStateChanged::SIGNATURE_HASH));
}

#[test]
fn report_validation_errors() {
    let Env { mut c, vm } = setup();
    submit_signed(&mut c, &report(5)).ok().unwrap();

    // replayed / non-increasing nonce
    assert_eq!(err(submit_signed(&mut c, &report(5))), ReplayedNonce { nonce: 5, lastNonce: 5 }.abi_encode());
    assert_eq!(err(submit_signed(&mut c, &report(4))), ReplayedNonce { nonce: 4, lastNonce: 5 }.abi_encode());
    // from the future
    let fut = Report { observed_at: NOW + 1, ..report(6) };
    assert_eq!(err(submit_signed(&mut c, &fut)), ReportFromFuture { observedAt: NOW + 1 }.abi_encode());
    // stale (maxReportAge = 300); exactly 300 is accepted below
    let stale = Report { observed_at: NOW - 301, ..report(6) };
    assert_eq!(err(submit_signed(&mut c, &stale)), StaleReport { observedAt: NOW - 301 }.abi_encode());
    // out of order (previous observedAt = NOW - 30)
    let ooo = Report { observed_at: NOW - 31, ..report(6) };
    assert_eq!(
        err(submit_signed(&mut c, &ooo)),
        OutOfOrderReport { observedAt: NOW - 31, lastObservedAt: NOW - 30 }.abi_encode()
    );
    // reference price bound
    let big = Report { reference: MAX_PRICE + U256::from(1), ..report(6) };
    assert_eq!(err(submit_signed(&mut c, &big)), InvalidReferencePrice {}.abi_encode());
    // unconfigured asset
    let r = report(6);
    assert_eq!(
        err(c.submit_report(FEED, false, false, r.mult, r.reference, r.observed_at, 6, vec![0u8; 65].into())),
        AssetNotConfigured { asset: FEED }.abi_encode()
    );

    // signature checks
    let r = report(6);
    let good = sign(&c, &r, &key());
    let inv = InvalidSignature {}.abi_encode();
    assert_eq!(err(submit(&mut c, &r, good[..64].to_vec())), inv); // wrong length
    let mut bad_v = good.clone();
    bad_v[64] = 0;
    assert_eq!(err(submit(&mut c, &r, bad_v)), inv);
    // high-s twin: valid ECDSA, recovers the same signer, still rejected
    let n: U256 = "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141".parse().unwrap();
    let mut high_s = good.clone();
    let s = U256::from_be_slice(&good[32..64]);
    high_s[32..64].copy_from_slice(&(n - s).to_be_bytes::<32>());
    high_s[64] = if good[64] == 27 { 28 } else { 27 };
    assert_eq!(err(submit(&mut c, &r, high_s)), inv);
    assert_eq!(err(submit(&mut c, &r, vec![0u8; 65])), inv); // r = s = 0

    // well-formed signature from a non-reporter
    let other = SigningKey::from_slice(&[0x07; 32]).unwrap();
    let sig = sign(&c, &r, &other);
    assert_eq!(err(submit(&mut c, &r, sig)), UnauthorizedReporter { signer: key_addr(&other) }.abi_encode());
    // signature over different content recovers some other address -> unauthorized
    let tampered = Report { halted: true, ..r.clone() };
    let sig = sign(&c, &r, &key());
    assert!(err(submit(&mut c, &tampered, sig))[..4] == UnauthorizedReporter::SELECTOR);
    // de-listed reporter
    c.set_reporter(key_addr(&key()), false).ok().unwrap();
    assert_eq!(err(submit_signed(&mut c, &r)), UnauthorizedReporter { signer: key_addr(&key()) }.abi_encode());
    c.set_reporter(key_addr(&key()), true).ok().unwrap();

    // boundary: report exactly maxReportAge old is accepted (observedAt == previous is allowed too)
    vm.set_block_timestamp(NOW + 270);
    let edge = Report { observed_at: NOW - 30, ..report(6) };
    assert!(submit_signed(&mut c, &edge).is_ok());
    assert_eq!(c.get_report(ASSET).5, 6);
}

// ─────────────────────────── failing external reads never revert ───────────────────────────

#[test]
fn failed_external_calls_map_to_flags() {
    let Env { mut c, .. } = setup();
    submit_signed(&mut c, &report(1)).ok().unwrap();

    mock(ASSET, SEL_UI_MULTIPLIER, None); // token hook reverts
    assert_eq!(c.get_risk(ASSET).0, RiskState::CorpActionPaused as u8);
    mock(ASSET, SEL_UI_MULTIPLIER, Some(e18().abi_encode()));
    mock(ASSET, SEL_ORACLE_PAUSED, Some(U256::from(2).abi_encode())); // dirty bool
    assert_eq!(c.get_risk(ASSET).0, RiskState::CorpActionPaused as u8);
    mock(ASSET, SEL_ORACLE_PAUSED, Some(false.abi_encode()));

    mock(FEED, SEL_LATEST_ROUND_DATA, None); // feed reverts
    assert_eq!(c.get_risk(ASSET), (6, 0, false, false, U256::ZERO, U256::ZERO));
    mock(FEED, SEL_LATEST_ROUND_DATA, Some(vec![0u8; 64])); // short return data
    assert_eq!(c.refresh(ASSET), RiskState::InvalidPrice as u8);
    mock(FEED, SEL_LATEST_ROUND_DATA, Some(round(PRICE_8DEC as i64, NOW - 8, NOW - 8)));
    assert_eq!(c.refresh(ASSET), 0);
}

#[test]
fn sequencer_handling() {
    let Env { mut c, vm } = setup();
    submit_signed(&mut c, &report(1)).ok().unwrap();
    c.set_sequencer_config(SEQ, 3600, true).ok().unwrap();
    assert_eq!(err(c.set_sequencer_config(Address::ZERO, 3600, true)), ZeroAddress {}.abi_encode());

    // no code at SEQ -> empty return data -> call failed -> SEQUENCER_DOWN, price untrusted
    assert_eq!(c.get_risk(ASSET), (5, 0, false, false, U256::ZERO, U256::ZERO));

    mock(SEQ, SEL_LATEST_ROUND_DATA, Some(round(0, NOW - 100, NOW - 100))); // up, inside grace
    vm.clear_mocks();
    assert_eq!(c.refresh(ASSET), RiskState::SequencerDown as u8);
    assert!(c.last_sequencer_up());
    assert!(vm.get_emitted_logs().iter().any(|(t, _)| t[0] == SequencerStateChanged::SIGNATURE_HASH));

    mock(SEQ, SEL_LATEST_ROUND_DATA, Some(round(0, NOW - 3601, NOW - 3601))); // up, past grace
    assert_eq!(c.refresh(ASSET), 0);

    mock(SEQ, SEL_LATEST_ROUND_DATA, Some(round(1, NOW - 5000, NOW - 5000))); // down
    assert_eq!(c.refresh(ASSET), RiskState::SequencerDown as u8);
    assert!(!c.last_sequencer_up());
}

#[test]
fn disabled_asset_is_unsupported() {
    let Env { mut c, .. } = setup();
    c.set_asset_config(ASSET, FEED, 3600, 500, 7000, true, false).ok().unwrap();
    assert_eq!(c.get_risk(ASSET), (7, 0, false, false, U256::ZERO, U256::ZERO));
    assert_eq!(c.get_risk(STRANGER).0, 7);
}
