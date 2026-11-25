# Cardano Escrow Datum & Redeemer Specification (T6.2)

> **Task ID:** T6.2 | **Blueprint:** Section 6.5, Section 6.7, Section 13 | **Interface:** `contracts/cardano/DATUM_SPEC.md` (guide Section 4.3)
>
> **Prototype boundary (Blueprint Section 6.7 & 13):** This specifies a **"buyer-controlled prototype escrow"** on **Cardano Preprod** testnet (test ADA only, no monetary value). It is not neutral or trustless, has no dispute resolution or attestor fields, and cannot detect physical delivery.

---

## 1. Inline Datum (`EscrowDatum`)

The escrow UTxO **must** carry an **inline datum** (not a datum hash and not transaction metadata, which the validator cannot read).

- **Plutus Data Constructor:** `0` (`Constr 0 [buyer, supplier, locked_amount, refund_deadline, action_commitment]`)
- **Aiken type:**

```aiken
pub type EscrowDatum {
  buyer: ByteArray,
  supplier: ByteArray,
  locked_amount: Int,
  refund_deadline: Int,
  action_commitment: ByteArray,
}
```

### Field Definitions (exact order, 5 fields only)

| Index | Field Name | Aiken Type | Plutus Data Type | Byte Length | Encoding & Meaning |
|---|---|---|---|---|---|
| `0` | `buyer` | `ByteArray` | `B` (ByteString) | `28` bytes (56 hex chars) | Owner's Ed25519 `payment_key_hash` (`VerificationKeyHash`), taken from the registered owner record (Blueprint §6.5). |
| `1` | `supplier` | `ByteArray` | `B` (ByteString) | `28` bytes (56 hex chars) | Supplier's Ed25519 `payment_key_hash` (`VerificationKeyHash`). |
| `2` | `locked_amount` | `Int` | `I` (Integer) | Variable (`> 0`) | Locked test-ADA amount in **lovelace** (`1 test ADA = 1,000,000 lovelace`). |
| `3` | `refund_deadline` | `Int` | `I` (Integer) | Variable (`> 0`) | Refund deadline as **POSIXTime in milliseconds** since Unix epoch (matches Aiken `validity_range`). |
| `4` | `action_commitment` | `ByteArray` | `B` (ByteString) | `32` bytes (64 hex chars) | `SHA-256("seyvixa-commit-v1" \|\| action_hash \|\| salt)` — raw 32-byte digest. |

> **No extra fields:** Do not put personal data, confidential business data, attestor keys, or dispute fields in the datum (Blueprint §6.7).

---

## 2. Redeemers (`EscrowRedeemer`)

- **Aiken type:**

```aiken
pub type EscrowRedeemer {
  Release
  Refund
}
```

| Variant | Plutus Data Constructor | Fields | Mesh Encoding (`@meshsdk/core` `1.9.1`) |
|---|---|---|---|
| `Release` | `0` (`Constr 0 []`) | None (`[]`) | `mConStr0([])` |
| `Refund` | `1` (`Constr 1 []`) | None (`[]`) | `mConStr1([])` |

---

## 3. Validator Rules (Blueprint Section 6.7 & 6.5)

1. **`Release` (`Constructor 0`):**
   - The transaction is signed by the buyer key (`buyer` is present in `extra_signatories`).
   - An output pays **at least `locked_amount` lovelace** to the `supplier` payment key hash.
2. **`Refund` (`Constructor 1`):**
   - The transaction validity range **starts strictly after `refund_deadline`** (`lower_bound > refund_deadline`, finite inclusive/exclusive lower bound after the deadline).
   - The transaction is signed by the buyer key (`buyer` is present in `extra_signatories`).
   - An output pays the `buyer` payment key hash.
3. **`action_commitment` is not interpreted:**
   - The validator does not parse or verify `action_commitment`. Carrying it in the inline datum fixes it at lock time so it cannot change without spending the escrow UTxO.
4. **Gateway & verifier checks (off-chain, Blueprint §6.5 & §6.7):**
   - Before submitting the lock transaction, the gateway checks that the script output, inline datum (`buyer = payment_key_hash`), `locked_amount`, and keys match the stored approved action.
   - The receipt verifier repeats the equality check between the approval key hash and `buyer` in the on-chain datum.

---

## 4. Worked Example (Fake Values, Mesh `@meshsdk/core` `1.9.1`)

All values below are **fake** example values:

- `buyer` (28 bytes): `00000000000000000000000000000000000000000000000000000001`
- `supplier` (28 bytes): `00000000000000000000000000000000000000000000000000000002`
- `locked_amount`: `5000000n` (`5` test ADA in lovelace)
- `refund_deadline`: `1795600000000n` (fake POSIXTime ms)
- `action_commitment` (32 bytes): `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

```typescript
import { mConStr0, mConStr1 } from "@meshsdk/core";

// Inline datum (Mesh Data format, passed via .txOutInlineDatumValue(datum, "Mesh"))
const escrowDatum = mConStr0([
  "00000000000000000000000000000000000000000000000000000001", // buyer (28-byte hex)
  "00000000000000000000000000000000000000000000000000000002", // supplier (28-byte hex)
  5000000n,                                                   // locked_amount (lovelace)
  1795600000000n,                                             // refund_deadline (POSIXTime ms)
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // action_commitment (32-byte hex)
]);

// Redeemers (passed via .txInRedeemerValue(redeemer, "Mesh"))
const releaseRedeemer = mConStr0([]);
const refundRedeemer = mConStr1([]);
```

---

## 5. On-Chain Public vs Off-Chain Private

| Public On-Chain (in inline datum / tx) | Never On-Chain (off-chain only) |
|---|---|
| `buyer` (payment key hash) | The 32-byte `salt` (kept in database and receipt only) |
| `supplier` (payment key hash) | Personal or confidential business data |
| `locked_amount` (lovelace) | Quote line items, supplier name, hotel details |
| `refund_deadline` (POSIXTime ms) | |
| `action_commitment` (salted SHA-256) | |
