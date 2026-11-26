# Midnight Supplier Eligibility Credential & Claim Design (T5.3)

> **Task ID:** T5.3 | **Blueprint:** Section 6.6, Section 13 | **Interface:** `issueChallenge(procurementId, supplierId)`, `verifyProof(challengeId, proof)` → `{valid, reason}` (guide Section 4.3)
>
> **Simulated Authority (Blueprint §6.6):** The issuer is a **simulated authority**, **"SEYVIXA Demo Supplier Registry"**, operated by the team for the prototype (demo key only, never reused elsewhere). It is not a real recognised organisation and must be labelled as simulated in the UI, README, and demo. This demonstrates the privacy mechanism, **not** real-world supplier eligibility.

---

## 1. Credential: `"Registered Supplier (simulated)"`

Issued by the seed script to each mock supplier. All four fields are bound together by the issuer's attestation so changing any field invalidates the credential:

| Field | Compact Type | Meaning | Visibility |
|---|---|---|---|
| `subject_id` | `Bytes<32>` | SEYVIXA's internal supplier identifier (matching the quote record) | **Private witness** |
| `credential_id` | `Bytes<32>` | Unique credential identifier | **Private witness** |
| `issue_date` | `Uint<64>` | Issue timestamp (Unix seconds) | **Private witness** |
| `expiry_date` | `Uint<64>` | Expiry timestamp (Unix seconds) | **Private witness** |

---

## 2. Simplest Issuer Mechanism (Compact `0.36.0`)

- **Registry Commitment (`persistentHash` + `merkleTreePathRoot`):**
  - The seed script hashes each credential's 4 fields into a leaf (`leaf = persistentHash([subject_id, credential_id, issue_date, expiry_date])`) in a fixed-depth Merkle tree representing the allowlisted `"SEYVIXA Demo Supplier Registry"`.
  - The **issuer registry root (`issuer_ref`)** is fixed in the Compact contract's ledger state at deployment and in the backend allowlist.
  - A credential from any other issuer/registry fails the Merkle root equality assertion.
- **Revocation:** **Revocation is not supported in the prototype.** (Registry root is fixed at deployment for the demo; do not imply revocation.)

---

## 3. Public Inputs, Private Witnesses, and Circuit Assertions

**Claim proven:** *"The supplier identified by `supplier_id` holds a credential issued to that subject by the allowlisted issuer, not expired as of the verification date."*

- **Public inputs (supplied by the backend, never the proof submitter):**
  1. `supplier_id: Bytes<32>` — set by the backend from its own quote record.
  2. `issuer_ref: Bytes<32>` — allowlisted issuer registry commitment (`MerkleTreeDigest`).
  3. `verification_date: Uint<64>` — backend clock timestamp (not an independent time source).
  4. `challenge: Bytes<32>` — single-use challenge nonce for replay protection.
- **Private witnesses (never revealed on-chain or to the verifier):**
  1. `credential` (`subject_id`, `credential_id`, `issue_date`, `expiry_date`).
  2. `merkle_path: MerkleTreePath<N, SupplierCredential>` — membership proof in the allowlisted registry.
- **Circuit assertions (all required for Level 1):**
  1. **Subject binding:** `assert(credential.subject_id == supplier_id)` — binds the proof to the quoted supplier.
  2. **Issuer check:** `assert(merkleTreePathRoot(merkle_path) == issuer_ref)` and `issuer_ref == ledger.allowlisted_issuer_ref` — confirms attestation by the allowlisted simulated issuer across all 4 fields.
  3. **Expiry check:** `assert(credential.expiry_date >= verification_date)` — confirms not expired as of `verification_date`.
  4. **Challenge binding:** `challenge` is bound as a public input to the circuit call so the proof cannot be replayed across procurements.

---

## 4. Challenge & Replay Protection (`POST /api/suppliers/:id/verify`)

1. **Challenge mode (no proof):** `issueChallenge(procurementId, supplierId)` generates a random single-use `challenge` nonce bound to `(procurement_id, supplier_id)` with a short expiry.
2. **Verify mode (with proof):** `verifyProof(challengeId, proof)` verifies the proof against the backend's `supplier_id`, `issuer_ref`, `verification_date`, and `challenge`. The backend rejects expired, unknown, mismatched, or already-used challenges and marks the challenge used **atomically**.

---

## 5. What the Verifier Learns vs. What Stays Private (Blueprint §6.6)

| The verifier learns (public) | Stays private |
|---|---|
| `supplier_id`, the issuer reference, the verification date, the challenge, and the result (valid or not) | The credential identifier, the issue and expiry dates, and the other credential details |

- **What this proves:** The requested supplier holds a valid, unexpired credential from the allowlisted issuer without revealing the private credential fields.
- **What this does NOT prove:** That real-world supplier information is true, or that the issuer was honest or careful. At fallback Levels 2 and 3, Screen 3 must show the required Blueprint Section 13 fallback label and must not present simulated data as a Midnight result.
