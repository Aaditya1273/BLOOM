//! EIP-712 hashing for market reports + ECDSA signature sanity checks.
//! Must match OpenZeppelin `EIP712("BloomRiskEngine", "1")` / `ECDSA.tryRecover` used by BloomRiskEngineEVM.

use alloy_primitives::{Address, B256, U256, keccak256};
use alloy_sol_types::SolValue;

pub const REPORT_TYPE: &[u8] = b"MarketReport(address asset,bool halted,bool corporateActionPaused,uint256 uiMultiplier,uint256 referencePrice,uint64 observedAt,uint64 nonce)";
const DOMAIN_TYPE: &[u8] = b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
pub const NAME: &str = "BloomRiskEngine";
pub const VERSION: &str = "1";

/// secp256k1n / 2 — signatures with s above this are malleable and rejected.
const HALF_N: U256 = U256::from_limbs([
    0xdfe9_2f46_681b_20a0,
    0x5d57_6e73_57a4_501d,
    0xffff_ffff_ffff_ffff,
    0x7fff_ffff_ffff_ffff,
]);

pub fn report_typehash() -> B256 {
    keccak256(REPORT_TYPE)
}

pub fn domain_separator(chain_id: u64, verifying_contract: Address) -> B256 {
    keccak256(
        (
            keccak256(DOMAIN_TYPE),
            keccak256(NAME),
            keccak256(VERSION),
            U256::from(chain_id),
            verifying_contract,
        )
            .abi_encode(),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn struct_hash(
    asset: Address,
    halted: bool,
    corporate_action_paused: bool,
    ui_multiplier: U256,
    reference_price: U256,
    observed_at: u64,
    nonce: u64,
) -> B256 {
    keccak256(
        (report_typehash(), asset, halted, corporate_action_paused, ui_multiplier, reference_price, observed_at, nonce)
            .abi_encode(),
    )
}

pub fn typed_digest(domain_separator: B256, struct_hash: B256) -> B256 {
    let mut buf = [0u8; 66];
    buf[0] = 0x19;
    buf[1] = 0x01;
    buf[2..34].copy_from_slice(domain_separator.as_slice());
    buf[34..].copy_from_slice(struct_hash.as_slice());
    keccak256(buf)
}

/// Validate a 65-byte `r || s || v` signature and build the ecrecover precompile (0x01) input
/// `digest || v || r || s`. Rejects wrong length, v not in {27, 28}, high-s, and r/s == 0.
pub fn ecrecover_input(digest: B256, sig: &[u8]) -> Option<[u8; 128]> {
    if sig.len() != 65 {
        return None;
    }
    let v = sig[64];
    let r = U256::from_be_slice(&sig[0..32]);
    let s = U256::from_be_slice(&sig[32..64]);
    if (v != 27 && v != 28) || s > HALF_N || s.is_zero() || r.is_zero() {
        return None;
    }
    let mut input = [0u8; 128];
    input[..32].copy_from_slice(digest.as_slice());
    input[63] = v;
    input[64..].copy_from_slice(&sig[..64]);
    Some(input)
}

/// Parse the precompile output: 32-byte left-padded address; empty / zero means failure.
pub fn parse_ecrecover_output(out: &[u8]) -> Option<Address> {
    if out.len() != 32 || out[..12].iter().any(|b| *b != 0) {
        return None;
    }
    let a = Address::from_slice(&out[12..]);
    (a != Address::ZERO).then_some(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::{Signature, hex};
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../test/vectors/risk-vectors.json");

    fn b256(v: &Value) -> B256 {
        v.as_str().unwrap().parse().unwrap()
    }

    #[test]
    fn half_n() {
        let n: U256 = "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141".parse().unwrap();
        assert_eq!(HALF_N, n / U256::from(2));
    }

    #[test]
    fn eip712_vector() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        let e = &v["eip712"];
        let d = &e["domain"];
        assert_eq!(d["name"], NAME);
        assert_eq!(d["version"], VERSION);
        let ds = domain_separator(d["chainId"].as_u64().unwrap(), d["verifyingContract"].as_str().unwrap().parse().unwrap());
        assert_eq!(ds, b256(&e["domainSeparator"]));

        let m = &e["message"];
        let u = |k: &str| m[k].as_str().unwrap().parse::<U256>().unwrap();
        let sh = struct_hash(
            m["asset"].as_str().unwrap().parse().unwrap(),
            m["halted"].as_bool().unwrap(),
            m["corporateActionPaused"].as_bool().unwrap(),
            u("uiMultiplier"),
            u("referencePrice"),
            m["observedAt"].as_u64().unwrap(),
            m["nonce"].as_u64().unwrap(),
        );
        assert_eq!(sh, b256(&e["structHash"]));
        let digest = typed_digest(ds, sh);
        assert_eq!(digest, b256(&e["digest"]));

        // signature parses, passes malleability checks, and recovers the expected signer
        let sig = hex::decode(e["signature"].as_str().unwrap()).unwrap();
        let input = ecrecover_input(digest, &sig).expect("valid sig");
        assert_eq!(&input[..32], digest.as_slice());
        let signer: Address = e["signer"].as_str().unwrap().parse().unwrap();
        let rec = Signature::try_from(sig.as_slice()).unwrap().recover_address_from_prehash(&digest).unwrap();
        assert_eq!(rec, signer);

        // malleability / format rejections
        let mut high_s = sig.clone();
        let s = U256::from_be_slice(&sig[32..64]);
        let n = HALF_N * U256::from(2) + U256::from(1);
        high_s[32..64].copy_from_slice(&(n - s).to_be_bytes::<32>());
        high_s[64] ^= 1; // flipped-parity twin is a valid ECDSA sig, must still be rejected
        assert!(ecrecover_input(digest, &high_s).is_none());
        let mut bad_v = sig.clone();
        bad_v[64] = 1;
        assert!(ecrecover_input(digest, &bad_v).is_none());
        assert!(ecrecover_input(digest, &sig[..64]).is_none());
        assert!(parse_ecrecover_output(&[]).is_none());
        assert!(parse_ecrecover_output(&[0u8; 32]).is_none());
    }
}
