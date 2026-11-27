# Midnight Privacy Panel Specification (T5.8)

> **Task ID:** T5.8 | **Blueprint:** Section 6.6, Section 13 | **Consumers:** Shahnas (T9.7b, Screen 3 layout), Prabhath (Screen 2/3 wiring)
>
> **Prototype Boundary (Blueprint §6.6 & §13):**
> 1. **Simulated Authority:** The issuer is the **"SEYVIXA Demo Supplier Registry"** (simulated authority operated by the team for the prototype; demo key only). It is **not** a real government or licensing body.
> 2. **Current Status (Level 2):** Per [`docs/DECISIONS.md`](../../docs/DECISIONS.md) (T5.7), Midnight is currently at **Level 2** (*"Midnight toolchain demo (example contract). Supplier eligibility is simulated."*).
> 3. **Never Overclaim:** Simulated supplier eligibility must **never** be presented as a verified Midnight production result. The UI must clearly display the required fallback banner.

---

## 1. Two-Column Privacy Disclosure (Screen 3 Layout)

Per Blueprint Section 6.6, Screen 3 (Settlement & Proof Centre) displays a dedicated **two-column Privacy Panel** contrasting what is publicly verifiable versus what remains completely confidential under zero-knowledge:

| Column 1: What the Verifier Learns (Public) | Column 2: What Stays Private (Zero-Knowledge) |
|---|---|
| **Supplier Identifier (`supplier_id`)**<br>Quoted supplier ID matched directly against the purchase record. | **Credential Identifier (`credential_id`)**<br>Unique credential ID issued to the supplier; never revealed. |
| **Issuer Reference (`issuer_ref`)**<br>Hash/commitment of the allowlisted registry (`"SEYVIXA Demo Supplier Registry (simulated)"`). | **Issuance & Expiry Timestamps (`issue_date`, `expiry_date`)**<br>Exact validity dates remain confidential; the circuit only proves `expiry_date >= verification_date`. |
| **Verification Timestamp (`verification_date`)**<br>Unix epoch timestamp from the verifying system's clock. | **Private Attestation & Registry Path (`merkle_path`)**<br>Cryptographic signature / Merkle membership proof remains in private state. |
| **Single-Use Challenge (`challenge_nonce`)**<br>Single-use 32-byte cryptographic nonce preventing replay across procurements. | **Subject Binding Witness (`credential.subject_id`)**<br>In-circuit proof verifies `credential.subject_id == supplier_id` without exposing private record links. |
| **Verification Outcome (`valid: true`)**<br>Cryptographic confirmation that the supplier holds an unexpired credential from the allowlisted registry. | **Sensitive Business Data**<br>Tax IDs, corporate registration documents, beneficial owner names, bank balances, and proprietary pricing structures. |

---

## 2. Technical Field Specification

### 2.1 Public Inputs (Provided by Verifier / Backend)
These values are visible to anyone inspecting the verification transaction:

1. **`supplier_id` (`Bytes<32>` / string):** Internal identifier of the supplier submitting the quote. Sourced directly from backend database records (never from the proving party).
2. **`issuer_ref` (`Bytes<32>` / hex):** Commitment to the allowlisted issuer registry root. Fixed in contract ledger state.
3. **`verification_date` (`Uint<64>` / timestamp):** Current timestamp when verification is requested.
4. **`challenge` (`Bytes<32>` / hex):** Single-use challenge nonce issued via `POST /api/suppliers/:id/verify`. Bound to `(procurement_id, supplier_id)` to prevent replay attacks across purchases.
5. **`result` (`boolean`):** Verification outcome: `true` if all in-circuit constraints pass; `false` otherwise.

### 2.2 Private Witnesses (Held Solely in Private State)
These values are processed exclusively inside the client-side prover (Midnight Proof Server / Lace) and never leave the prover's local environment:

1. **`credential.subject_id`:** Private subject identifier asserted against `supplier_id`.
2. **`credential.credential_id`:** Unique identifier issued by the simulated registry.
3. **`credential.issue_date`:** Exact timestamp when credential was granted.
4. **`credential.expiry_date`:** Expiry timestamp (circuit proves `expiry_date >= verification_date`).
5. **`merkle_path`:** Merkle membership proof binding the 4 credential fields to `issuer_ref`.
6. **Proprietary enterprise metadata:** Tax ID numbers, beneficial owners, credit ratings, bank balances, and margin schedules.

---

## 3. What the Proof Proves vs. What It Does NOT Prove

### What It Proves:
- The quoted supplier holds a valid, unexpired credential issued by the allowlisted registry.
- The proof was freshly generated for this specific purchase request (due to single-use `challenge`).
- The confidential fields have not been altered or tampered with.

### What It Does NOT Prove:
- It does **not** prove that the supplier's real-world information is legally authentic (the issuer is a simulated registry operated for the prototype).
- It does **not** prove delivery of physical items or real-world quality of goods.
- At Level 2, it demonstrates the Midnight toolchain capability via an example contract while supplier eligibility is simulated.

---

## 4. UI Implementation Guidance for Shahnas (Screen 3 / `T9.7b`)

### 4.1 Required Fallback Label (Blueprint Section 13)
Because Midnight is currently at **Level 2**, Screen 3 **must** render this exact label prominently:

> **Label:** `"Midnight toolchain demo (example contract). Supplier eligibility is simulated."`  
> **Variant:** Warning / Amber badge or notice.  
> **Constraint:** Do **not** claim a live production Midnight supplier verification.

### 4.2 React Component Props & Data Fixture

```tsx
export interface PrivacyPanelProps {
  supplierId: string;
  verificationDate: string;
  challengeNonce: string;
  isVerified: boolean;
  level: 1 | 2 | 3;
}

export const mockPrivacyData: PrivacyPanelProps = {
  supplierId: "sup_acme_industrial_01",
  verificationDate: "2026-11-27T18:00:00Z",
  challengeNonce: "0x4f8a9b2c...e13d",
  isVerified: true,
  level: 2,
};
```
