// T8.5 — Unit tests for schemas/receipt.v0.schema.json (Blueprint Section 6.8).
// All sample receipts below use simulated demo data only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RECEIPT_V0_SCHEMA, validateReceiptV0 } from "./validate-receipt-v0.mjs";

const SIMULATED_SCRIPT_ADDRESS =
  "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg";
const SIMULATED_PAYEE_ADDRESS =
  "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";
const SIMULATED_LOCK_TX = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const SIMULATED_RELEASE_TX = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const SIMULATED_REFUND_TX = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

function makeVerificationReceipt() {
  return {
    schema_version: "receipt.v0",
    view: "verification",
    receipt_id: "00000000-0000-4000-8000-000000000101",
    created_at: "2026-11-26T12:15:00.000Z",
    kid: "0123456789abcdef",
    signature: "simulated-ed25519-receipt-signature-hex",
    procurement_id: "00000000-0000-4000-8000-000000000010",
    action_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    approval: {
      nonce: "demo-nonce-001",
      expires_at: "2026-11-26T12:30:00.000Z",
      owner_key_hash: "9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e",
      signature: "845846a2012767616464726573735839009493315cd92eb5",
      key: "a4010103272006215820deadbeefcafebabe0123456789abcdef0123456789abcdef",
    },
    commitment_salt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    chain: {
      network: "preprod",
      script_address: SIMULATED_SCRIPT_ADDRESS,
      escrow_utxo_ref: `${SIMULATED_LOCK_TX}#0`,
      lock_tx_id: SIMULATED_LOCK_TX,
      locked_lovelace: 5000000,
      outcome: "released",
      release_tx_id: SIMULATED_RELEASE_TX,
    },
    midnight: {
      supplier_id: "00000000-0000-4000-8000-000000000002",
      challenge_id: "00000000-0000-4000-8000-000000000020",
      verification_reference: "simulated-midnight-proof-ref-001",
      result: "VALID",
      fallback_label: "Midnight toolchain demo (example contract). Supplier eligibility is simulated.",
    },
    policy_summary: {
      counts: { allow: 2, deny: 1, approval_required: 1 },
      reason_codes: ["ALLOW", "RESOURCE_OUT_OF_SCOPE", "APPROVAL_REQUIRED"],
    },
  };
}

function makeFullReceipt() {
  return {
    ...makeVerificationReceipt(),
    view: "full",
    receipt_id: "00000000-0000-4000-8000-000000000102",
    approved_action: {
      procurement_id: "00000000-0000-4000-8000-000000000010",
      owner_id: "00000000-0000-4000-8000-000000000001",
      supplier_id: "00000000-0000-4000-8000-000000000002",
      payee_address: SIMULATED_PAYEE_ADDRESS,
      items: [{ description: "Cotton bed linen sets (simulated)", quantity: 10 }],
      total_lkr: "45000.00",
      settlement_asset: "tADA",
      escrow_amount_tada: "5.000000",
      escrow_script_address: SIMULATED_SCRIPT_ADDRESS,
      refund_deadline: "2026-12-03T12:00:00.000Z",
      expiry: "2026-11-26T12:30:00.000Z",
      nonce: "demo-nonce-001",
    },
    policy_summary: {
      decisions: [
        {
          agent: "procurement-agent",
          action_type: "FILE_READ",
          decision: "DENY",
          resource: "payroll.csv",
          reason_code: "RESOURCE_OUT_OF_SCOPE",
        },
      ],
    },
  };
}

describe("T8.5 — receipt.v0.schema.json validation", () => {
  it("declares Draft 2020-12 and labels the format v0, prototype format", () => {
    assert.equal(RECEIPT_V0_SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(RECEIPT_V0_SCHEMA.title, /v0, prototype format/);
  });

  it("accepts valid simulated full and verification receipts (released, refunded, locked)", () => {
    assert.equal(validateReceiptV0(makeVerificationReceipt()).valid, true);
    assert.equal(validateReceiptV0(makeFullReceipt()).valid, true);

    const refunded = makeVerificationReceipt();
    refunded.chain.outcome = "refunded";
    delete refunded.chain.release_tx_id;
    refunded.chain.refund_tx_id = SIMULATED_REFUND_TX;
    assert.equal(validateReceiptV0(refunded).valid, true);

    const locked = makeVerificationReceipt();
    locked.chain.outcome = "locked";
    delete locked.chain.release_tx_id;
    assert.equal(validateReceiptV0(locked).valid, true);
  });

  it("rejects receipts missing a required field", () => {
    const missingKid = makeVerificationReceipt();
    delete missingKid.kid;
    assert.equal(validateReceiptV0(missingKid).valid, false);

    const missingApprovedAction = makeFullReceipt();
    delete missingApprovedAction.approved_action;
    assert.equal(validateReceiptV0(missingApprovedAction).valid, false);

    const releasedWithoutTx = makeVerificationReceipt();
    delete releasedWithoutTx.chain.release_tx_id;
    assert.equal(validateReceiptV0(releasedWithoutTx).valid, false);

    const missingApprovalKey = makeVerificationReceipt();
    delete missingApprovalKey.approval.key;
    assert.equal(validateReceiptV0(missingApprovalKey).valid, false);
  });

  it("rejects a verification view containing Group 6 business details or resource names", () => {
    const withBusinessDetails = {
      ...makeVerificationReceipt(),
      approved_action: makeFullReceipt().approved_action,
    };
    assert.equal(validateReceiptV0(withBusinessDetails).valid, false);

    const withResourceNames = makeVerificationReceipt();
    withResourceNames.policy_summary = makeFullReceipt().policy_summary;
    assert.equal(validateReceiptV0(withResourceNames).valid, false);
  });

  it("rejects embedded public keys, invalid kid, or Mainnet script addresses", () => {
    const withEmbeddedKey = {
      ...makeVerificationReceipt(),
      public_key: "deadbeef",
    };
    assert.equal(validateReceiptV0(withEmbeddedKey).valid, false);

    const badKid = makeVerificationReceipt();
    badKid.kid = "not-16-hex";
    assert.equal(validateReceiptV0(badKid).valid, false);

    const mainnetReceipt = makeVerificationReceipt();
    mainnetReceipt.chain.script_address =
      "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
    assert.equal(validateReceiptV0(mainnetReceipt).valid, false);
  });
});
