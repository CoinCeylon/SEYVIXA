# SEYVIXA TrustOS Verifiable Receipt Format — v0, prototype format

> **Task ID:** T8.5 | **Blueprint:** Section 6.8, Section 13, Section 16 | **Schema:** [`schemas/receipt.v0.schema.json`](../schemas/receipt.v0.schema.json)
>
> **Status:** **v0, prototype format.** This is not a standard, and no other tool uses it yet. Its purpose is to document the receipt structure for SEYVIXA TrustOS (UniHack 2026) and support the staged adoption path (Blueprint Section 15.4, stage 2). All sample receipts in this repository use **simulated demo data only**.

---

## 1. Purpose and Honest Boundaries

SEYVIXA TrustOS generates signed receipts after a procurement workflow so an independent verifier (`tools/verifier`, T8.3) can check the off-chain approval and on-chain Cardano Preprod testnet escrow evidence.

- **Prototype escrow:** Cardano testnet holds a **buyer-controlled prototype escrow** (*Cardano testnet — test ADA has no monetary value*). It is not neutral or trustless.
- **Simulated budget:** LKR figures are a **Simulated LKR budget — not real money**. Test ADA is not payment for LKR and no conversion is computed.
- **Simulated Midnight issuer:** Supplier eligibility proofs rely on a **simulated issuer** in the prototype.

### What a verified receipt proves
- SEYVIXA's trusted receipt-signing key signed this record, and it has not been altered since.
- The holder of the registered owner key signed approval of this exact action (or the labelled demo-key fallback if `signData` fallback was used).
- A confirmed Cardano Preprod testnet escrow exists whose inline datum commits to that action (`action_commitment`).
- If `chain.outcome === "released"`: a confirmed transaction signed by the buyer key spent `chain.escrow_utxo_ref` and paid at least `chain.locked_lovelace` to the supplier key hash from the datum. **This does not prove that goods were delivered.**

### What a receipt cannot prove
- That policy decisions and logs are complete or honest (attested only by SEYVIXA's signature).
- That goods were delivered, were of the stated quality, or that the escrow outcome was fair to the supplier.
- That a supplier's credential reflects real-world facts (the issuer is simulated).
- That a real person, rather than the key holder, gave the approval.
- That any real LKR payment happened.

---

## 2. Receipt Views and Field Classification (Blueprint Section 6.8)

The receipt generator (`generateReceipt(procurementId, view)`, T8.1) produces two signed receipts from the same stored data using the `view` discriminator (`"full"` or `"verification"`). Both views share [`schemas/receipt.v0.schema.json`](../schemas/receipt.v0.schema.json).

| Field group | Fields | Sensitivity | Full view | Verification view | Publish openly? |
|---|---|---|---|---|---|
| 1. Metadata | `schema_version`, `view`, `receipt_id`, `created_at`, `kid`, `signature` | Public-safe | Yes | Yes | Yes |
| 2. On-chain evidence | `network`, `script_address`, `escrow_utxo_ref`, `lock_tx_id`, `release_tx_id` or `refund_tx_id`, `locked_lovelace`, `outcome` | Already public on the blockchain | Yes | Yes | Yes (publishing it links the receipt to these on-chain items) |
| 3. Binding evidence | `action_hash`, `nonce`, `expires_at`, `owner_key_hash`, approval `signature` (COSE_Sign1) & `key` (COSE_Key), `commitment_salt` | Linkable. Lets anyone connect the receipt to the escrow and test guesses about the action | Yes | Yes | No |
| 4. Midnight evidence | `supplier_id`, `challenge_id`, `verification_reference`, `result` | Links a supplier to a procurement | Yes | Yes | No |
| 5. Policy summary | Decisions with agent, action type, resource name and reason code | Resource names and grants can be confidential | Full detail | Counts and reason codes only | No |
| 6. Business details | `approved_action` (supplier, items, quantities, simulated LKR total and prices, deadlines), budget figures, quote contents | Confidential business information | Yes | **No** | **No** |
| 7. Never in any receipt | Credential private fields, private keys, seed phrases, API keys, session data | Secret | Never | Never | Never |

### External sharing rules
- **Openly (public repo, README, demo video):** Group 1 and Group 2 fields, verifier output, and sample receipts generated from simulated demo data only.
- **With a counterparty, auditor, or verifier:** the `verification` view.
- **Owner only (and auditors under agreement):** the `full` view.

---

## 3. Signing Key, `kid`, and Trusted Fingerprint

- Receipts are signed with one server-held Ed25519 key (generated once in T8.2).
- **Fingerprint:** `SHA-256(raw 32-byte Ed25519 public key)` in lowercase hex (64 hex chars).
- **`kid`:** First 16 lowercase hex characters of the fingerprint.
- **Never embed a public key in a receipt:** The schema sets `additionalProperties: false` on every object, so any receipt embedding `public_key`, `jwk`, or unknown fields is rejected.
- **Verification:** The verifier loads the public key from the repository (`keys/receipt-signing-public.json`), recomputes its SHA-256 fingerprint, compares it against the out-of-band `--trusted-fingerprint`, checks `receipt.kid === trustedFingerprint.slice(0, 16)`, validates the receipt against `schemas/receipt.v0.schema.json`, canonicalises the payload, and verifies the Ed25519 signature.

---

## 4. Schema Rules Enforced by `schemas/receipt.v0.schema.json`

1. `schema_version` must equal `"receipt.v0"`.
2. `view` must be `"full"` or `"verification"`.
3. `chain.network` must be `"preprod"` and `chain.script_address` must be a testnet address (`addr_test1...`).
4. `chain.outcome` rules:
   - `"released"` requires `release_tx_id` and forbids `refund_tx_id`.
   - `"refunded"` requires `refund_tx_id` and forbids `release_tx_id`.
   - `"locked"` forbids both `release_tx_id` and `refund_tx_id`.
5. `verification` view strictly forbids `approved_action` (Group 6 business details) and `policy_summary.decisions` / `resource` names (Group 5 sensitive details).
6. All objects use `additionalProperties: false` to block embedded public keys and Group 7 secrets.

---

## 5. Sample Receipts (Simulated Demo Data Only)

> **Warning:** All IDs, hashes, addresses, and signatures below are **simulated demo values** for schema illustration only — not real transactions or real keys.

### 5.1 `verification` view (simulated demo sample)

```json
{
  "schema_version": "receipt.v0",
  "view": "verification",
  "receipt_id": "00000000-0000-4000-8000-000000000101",
  "created_at": "2026-11-26T12:15:00.000Z",
  "kid": "0123456789abcdef",
  "signature": "simulated-ed25519-receipt-signature-hex",
  "procurement_id": "00000000-0000-4000-8000-000000000010",
  "action_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approval": {
    "nonce": "demo-nonce-001",
    "expires_at": "2026-11-26T12:30:00.000Z",
    "owner_key_hash": "9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e",
    "signature": "845846a2012767616464726573735839009493315cd92eb5",
    "key": "a4010103272006215820deadbeefcafebabe0123456789abcdef0123456789abcdef"
  },
  "commitment_salt": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "chain": {
    "network": "preprod",
    "script_address": "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg",
    "escrow_utxo_ref": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc#0",
    "lock_tx_id": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "locked_lovelace": 5000000,
    "outcome": "released",
    "release_tx_id": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  },
  "midnight": {
    "supplier_id": "00000000-0000-4000-8000-000000000002",
    "challenge_id": "00000000-0000-4000-8000-000000000020",
    "verification_reference": "simulated-midnight-proof-ref-001",
    "result": "VALID",
    "fallback_label": "Midnight toolchain demo (example contract). Supplier eligibility is simulated."
  },
  "policy_summary": {
    "counts": {
      "allow": 2,
      "deny": 1,
      "approval_required": 1
    },
    "reason_codes": ["ALLOW", "RESOURCE_OUT_OF_SCOPE", "APPROVAL_REQUIRED"]
  }
}
```

### 5.2 `full` view (simulated demo sample)

```json
{
  "schema_version": "receipt.v0",
  "view": "full",
  "receipt_id": "00000000-0000-4000-8000-000000000102",
  "created_at": "2026-11-26T12:15:00.000Z",
  "kid": "0123456789abcdef",
  "signature": "simulated-ed25519-receipt-signature-hex",
  "procurement_id": "00000000-0000-4000-8000-000000000010",
  "approved_action": {
    "procurement_id": "00000000-0000-4000-8000-000000000010",
    "owner_id": "00000000-0000-4000-8000-000000000001",
    "supplier_id": "00000000-0000-4000-8000-000000000002",
    "payee_address": "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz",
    "items": [{ "description": "Cotton bed linen sets (simulated)", "quantity": 10 }],
    "total_lkr": "45000.00",
    "settlement_asset": "tADA",
    "escrow_amount_tada": "5.000000",
    "escrow_script_address": "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg",
    "refund_deadline": "2026-12-03T12:00:00.000Z",
    "expiry": "2026-11-26T12:30:00.000Z",
    "nonce": "demo-nonce-001"
  },
  "action_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approval": {
    "nonce": "demo-nonce-001",
    "expires_at": "2026-11-26T12:30:00.000Z",
    "owner_key_hash": "9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e",
    "signature": "845846a2012767616464726573735839009493315cd92eb5",
    "key": "a4010103272006215820deadbeefcafebabe0123456789abcdef0123456789abcdef"
  },
  "commitment_salt": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "chain": {
    "network": "preprod",
    "script_address": "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg",
    "escrow_utxo_ref": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc#0",
    "lock_tx_id": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "locked_lovelace": 5000000,
    "outcome": "released",
    "release_tx_id": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  },
  "midnight": {
    "supplier_id": "00000000-0000-4000-8000-000000000002",
    "challenge_id": "00000000-0000-4000-8000-000000000020",
    "verification_reference": "simulated-midnight-proof-ref-001",
    "result": "VALID",
    "fallback_label": "Midnight toolchain demo (example contract). Supplier eligibility is simulated."
  },
  "policy_summary": {
    "decisions": [
      {
        "agent": "procurement-agent",
        "action_type": "FILE_READ",
        "decision": "DENY",
        "resource": "payroll.csv",
        "reason_code": "RESOURCE_OUT_OF_SCOPE"
      },
      {
        "agent": "procurement-agent",
        "action_type": "PROPOSE_PURCHASE",
        "decision": "APPROVAL_REQUIRED",
        "resource": "quotes/supplier-a",
        "reason_code": "APPROVAL_REQUIRED"
      }
    ]
  }
}
```

---

## 6. Running Schema Validation Tests

```bash
node --test schemas/receipt.v0.schema.test.mjs
```
