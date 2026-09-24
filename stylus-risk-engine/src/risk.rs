//! Pure risk classification. 1:1 mirror of `contracts/risk/RiskLib.sol`
//! (same evaluation order, same boundaries), checked against `test/vectors/risk-vectors.json`.
//!
//! Order (first match wins, default-deny):
//! UNSUPPORTED -> SEQUENCER_DOWN -> INVALID_PRICE -> STALE(price) -> STALE(report)
//! -> HALTED -> CORP_ACTION_PAUSED -> DEVIATION -> NORMAL

use alloy_primitives::{I256, U256};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum RiskState {
    Normal = 0,
    Halted = 1,
    Stale = 2,
    Deviation = 3,
    CorpActionPaused = 4,
    SequencerDown = 5,
    InvalidPrice = 6,
    Unsupported = 7,
}

impl RiskState {
    /// Whether the oracle price may still be displayed / used for valuation in this state.
    pub fn price_trusted(self) -> bool {
        !matches!(self, Self::Unsupported | Self::SequencerDown | Self::InvalidPrice)
    }
}

pub const BPS: u64 = 10_000;

/// 1e36: upper bound for any normalised (1e18) price.
pub const MAX_PRICE: U256 = U256::from_limbs([0xb34b_9f10_0000_0000, 0x00c0_97ce_7bc9_0715, 0, 0]);

#[derive(Clone, Debug, Default)]
pub struct Inputs {
    pub now: u64,
    pub configured: bool,
    pub is_stock_token: bool,
    pub heartbeat: u64,
    pub deviation_bps: u16,
    pub sequencer_required: bool,
    pub sequencer_ok: bool,
    pub sequencer_answer: I256,
    pub sequencer_started_at: U256,
    pub sequencer_grace: u64,
    pub feed_ok: bool,
    pub round_id: u128, // uint80
    pub answer: I256,
    pub updated_at: U256,
    pub answered_in_round: u128, // uint80
    pub feed_decimals: u8,
    pub has_report: bool,
    pub report_observed_at: u64,
    pub max_report_age: u64,
    pub halted: bool,
    pub report_corp_action_paused: bool,
    pub report_multiplier: U256,
    pub reference_price: U256,
    pub token_ok: bool,
    pub token_oracle_paused: bool,
    pub token_multiplier: U256,
}

fn pow10(e: u8) -> U256 {
    U256::from(10u8).pow(U256::from(e))
}

/// Normalise a positive feed answer to 1e18. `None` for non-positive, zero-after-scaling or out-of-range.
pub fn normalize(answer: I256, decimals: u8) -> Option<U256> {
    if answer <= I256::ZERO {
        return None;
    }
    let a = answer.into_raw();
    if a > MAX_PRICE {
        return None;
    }
    let price = if decimals <= 18 {
        a * pow10(18 - decimals) // <= 1e54, no overflow
    } else {
        if decimals > 36 {
            return None;
        }
        a / pow10(decimals - 18)
    };
    if price.is_zero() || price > MAX_PRICE {
        return None;
    }
    Some(price)
}

/// |price - reference| / reference > deviationBps / 10_000. reference == 0 means "no reference";
/// reference above MAX_PRICE deviates (default-deny).
pub fn deviates(price: U256, reference: U256, deviation_bps: u16) -> bool {
    if reference.is_zero() {
        return false;
    }
    if reference > MAX_PRICE {
        return true;
    }
    let diff = if price > reference { price - reference } else { reference - price };
    diff * U256::from(BPS) > U256::from(deviation_bps) * reference // both sides <= 1e40
}

pub fn classify(i: &Inputs) -> (RiskState, U256) {
    use RiskState::*;
    let now = U256::from(i.now);
    if !i.configured {
        return (Unsupported, U256::ZERO);
    }

    if i.sequencer_required {
        if !i.sequencer_ok || !i.sequencer_answer.is_zero() || i.sequencer_started_at.is_zero() {
            return (SequencerDown, U256::ZERO);
        }
        if i.sequencer_started_at > now || now - i.sequencer_started_at <= U256::from(i.sequencer_grace) {
            return (SequencerDown, U256::ZERO);
        }
    }

    if !i.feed_ok || i.updated_at.is_zero() || i.updated_at > now || i.answered_in_round < i.round_id {
        return (InvalidPrice, U256::ZERO);
    }
    let Some(price) = normalize(i.answer, i.feed_decimals) else {
        return (InvalidPrice, U256::ZERO);
    };

    if now - i.updated_at > U256::from(i.heartbeat) {
        return (Stale, price);
    }

    if i.is_stock_token {
        if !i.has_report || i.report_observed_at > i.now || i.now - i.report_observed_at > i.max_report_age {
            return (Stale, price);
        }
        if i.halted {
            return (Halted, price);
        }
        if !i.token_ok
            || i.token_oracle_paused
            || i.report_corp_action_paused
            || (!i.report_multiplier.is_zero() && i.report_multiplier != i.token_multiplier)
        {
            return (CorpActionPaused, price);
        }
    }

    if deviates(price, i.reference_price, i.deviation_bps) {
        return (Deviation, price);
    }
    (Normal, price)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../test/vectors/risk-vectors.json");

    fn u(v: &Value) -> U256 {
        match v {
            Value::String(s) => s.parse().unwrap(),
            Value::Number(n) => U256::from(n.as_u64().unwrap()),
            _ => panic!("bad uint {v}"),
        }
    }
    fn i(v: &Value) -> I256 {
        match v {
            Value::String(s) => s.parse().unwrap(),
            Value::Number(n) => I256::try_from(n.as_i64().unwrap()).unwrap(),
            _ => panic!("bad int {v}"),
        }
    }
    fn n64(v: &Value) -> u64 {
        u(v).to::<u64>()
    }

    fn inputs(j: &Value) -> Inputs {
        let b = |k: &str| j[k].as_bool().unwrap();
        Inputs {
            now: n64(&j["now"]),
            configured: b("configured"),
            is_stock_token: b("isStockToken"),
            heartbeat: n64(&j["heartbeat"]),
            deviation_bps: n64(&j["deviationBps"]) as u16,
            sequencer_required: b("sequencerRequired"),
            sequencer_ok: b("sequencerOk"),
            sequencer_answer: i(&j["sequencerAnswer"]),
            sequencer_started_at: u(&j["sequencerStartedAt"]),
            sequencer_grace: n64(&j["sequencerGrace"]),
            feed_ok: b("feedOk"),
            round_id: u(&j["roundId"]).to(),
            answer: i(&j["answer"]),
            updated_at: u(&j["updatedAt"]),
            answered_in_round: u(&j["answeredInRound"]).to(),
            feed_decimals: n64(&j["feedDecimals"]) as u8,
            has_report: b("hasReport"),
            report_observed_at: n64(&j["reportObservedAt"]),
            max_report_age: n64(&j["maxReportAge"]),
            halted: b("halted"),
            report_corp_action_paused: b("reportCorpActionPaused"),
            report_multiplier: u(&j["reportMultiplier"]),
            reference_price: u(&j["referencePrice"]),
            token_ok: b("tokenOk"),
            token_oracle_paused: b("tokenOraclePaused"),
            token_multiplier: u(&j["tokenMultiplier"]),
        }
    }

    #[test]
    fn max_price_is_1e36() {
        assert_eq!(MAX_PRICE, pow10(36));
    }

    #[test]
    fn shared_vectors() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        let cases = v["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 43);
        for c in cases {
            let (state, price) = classify(&inputs(&c["input"]));
            let name = c["name"].as_str().unwrap();
            assert_eq!(state as u64, c["expected"]["state"].as_u64().unwrap(), "state: {name}");
            assert_eq!(price, u(&c["expected"]["price"]), "price: {name}");
        }
    }
}
