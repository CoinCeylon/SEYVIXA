// T8.3 — Unit tests & mutation checks for `tools/verifier` (Blueprint Section 6.8).
// Uses ephemeral Ed25519 keys generated in-memory, simulated demo receipts, and mocked chain APIs.
// Never uses real private keys or submits transactions.

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import { canonicalize } from "../../../packages/shared/src/canonical.ts";
import { actionHash } from "../../../packages/shared/src/hash.ts";
import {
  createBlockfrostChainReader,
  decodeEscrowInlineDatumCbor,
  encodeEscrowInlineDatumCbor,
  extractTestnetPaymentKeyHash,
  type ChainTxDetails,
  type ChainTxLookupResult,
  type ParsedEscrowDatum,
  type VerifierChainReader,
} from "./chain-reader.ts";
import { parseCliArgs } from "./cli.ts";
import {
  canonicalReceiptPayload,
  computeActionCommitment,
  verifyReceipt,
} from "./verify.ts";

// Official CIP-19 testnet vectors (fake demo addresses).
const FAKE_BUYER_ADDR =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";
const FAKE_SUPPLIER_ADDR =
  "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";
const FAKE_OTHER_ADDR =
  "addr_test1vq2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers2r9x4g";
const FAKE_SCRIPT_ADDR =
  "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg";

const BUYER_KEY_HASH = extractTestnetPaymentKeyHash(FAKE_BUYER_ADDR)!;
const SUPPLIER_KEY_HASH = extractTestnetPaymentKeyHash(FAKE_SUPPLIER_ADDR)!;

const LOCK_TX_ID = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const RELEASE_TX_ID = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const REFUND_TX_ID = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const SALT_HEX = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function makeEphemeralKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const fingerprint = createHash("sha256").update(rawPub).digest("hex");
  const kid = fingerprint.slice(0, 16);
  const publicKeyDoc = {
    algorithm: "Ed25519",
    kid,
    fingerprint,
    public_key_hex: rawPub.toString("hex"),
    public_key_base64url: rawPub.toString("base64url"),
  };
  return { privateKey, rawPub, fingerprint, kid, publicKeyDoc };
}

function makeFixture(options: {
  view?: "full" | "verification";
  outcome?: "released" | "refunded" | "locked";
  fallbackLabel?: string;
} = {}) {
  const view = options.view ?? "full";
  const outcome = options.outcome ?? "released";
  const receiptKey = makeEphemeralKeyPair();
  const ownerKey = makeEphemeralKeyPair();

  const approvedAction = {
    procurement_id: "00000000-0000-4000-8000-000000000010",
    owner_id: "00000000-0000-4000-8000-000000000001",
    supplier_id: "00000000-0000-4000-8000-000000000002",
    payee_address: FAKE_SUPPLIER_ADDR,
    items: [{ description: "Simulated hotel linen", quantity: 10 }],
    total_lkr: "45000.00",
    settlement_asset: "tADA",
    escrow_amount_tada: "5.000000",
    escrow_script_address: FAKE_SCRIPT_ADDR,
    refund_deadline: "2026-12-03T12:00:00.000Z",
    expiry: "2026-11-26T12:30:00.000Z",
    nonce: "demo-nonce-001",
  };

  const computedActionHash = actionHash(approvedAction);
  const commitment = computeActionCommitment(computedActionHash, SALT_HEX);
  const refundDeadlineMs = BigInt(Date.parse(approvedAction.refund_deadline));

  const approvalPayload = {
    domain: "seyvixa-approval-v1",
    action_hash: computedActionHash,
    nonce: "demo-nonce-001",
    expires_at: "2026-11-26T12:30:00.000Z",
  };
  const ownerSigHex = sign(
    null,
    Buffer.from(canonicalize(approvalPayload), "utf8"),
    ownerKey.privateKey,
  ).toString("hex");
  const ownerApprovalSig = `${ownerKey.rawPub.toString("hex")}:${ownerSigHex}`;

  const chain: Record<string, unknown> = {
    network: "preprod",
    script_address: FAKE_SCRIPT_ADDR,
    escrow_utxo_ref: `${LOCK_TX_ID}#0`,
    lock_tx_id: LOCK_TX_ID,
    locked_lovelace: 5_000_000,
    outcome,
  };
  if (outcome === "released") chain.release_tx_id = RELEASE_TX_ID;
  if (outcome === "refunded") chain.refund_tx_id = REFUND_TX_ID;

  const unsignedReceipt: Record<string, unknown> = {
    schema_version: "receipt.v0",
    view,
    receipt_id: "00000000-0000-4000-8000-000000000201",
    created_at: "2026-11-26T12:15:00.000Z",
    kid: receiptKey.kid,
    procurement_id: approvedAction.procurement_id,
    action_hash: computedActionHash,
    approval: {
      nonce: approvalPayload.nonce,
      expires_at: approvalPayload.expires_at,
      owner_key_hash: BUYER_KEY_HASH,
      signature: ownerApprovalSig,
      ...(options.fallbackLabel ? { fallback_label: options.fallbackLabel } : {}),
    },
    commitment_salt: SALT_HEX,
    chain,
    midnight: {
      supplier_id: approvedAction.supplier_id,
      challenge_id: "00000000-0000-4000-8000-000000000020",
      verification_reference: "simulated-midnight-ref-001",
      result: "VALID",
      fallback_label: "Midnight toolchain demo (example contract). Supplier eligibility is simulated.",
    },
    policy_summary:
      view === "full"
        ? {
            decisions: [
              {
                agent: "procurement-agent",
                action_type: "PROPOSE_PURCHASE",
                decision: "APPROVAL_REQUIRED",
                resource: "quotes/supplier-a",
                reason_code: "APPROVAL_REQUIRED",
              },
            ],
          }
        : {
            counts: { allow: 1, deny: 0, approval_required: 1 },
            reason_codes: ["ALLOW", "APPROVAL_REQUIRED"],
          },
  };

  if (view === "full") {
    unsignedReceipt.approved_action = approvedAction;
  }

  const signReceipt = (obj: Record<string, unknown>) => {
    const canonical = canonicalReceiptPayload(obj);
    const sig = sign(null, Buffer.from(canonical, "utf8"), receiptKey.privateKey).toString("hex");
    return { ...obj, signature: sig };
  };

  const receipt = signReceipt(unsignedReceipt);

  const datum: ParsedEscrowDatum = {
    buyer: BUYER_KEY_HASH,
    supplier: SUPPLIER_KEY_HASH,
    lockedAmountLovelace: 5_000_000n,
    refundDeadlineMs,
    actionCommitment: commitment,
  };
  const inlineDatumHex = encodeEscrowInlineDatumCbor(datum);

  const lockDetails: ChainTxDetails = {
    txHash: LOCK_TX_ID,
    validContract: true,
    invalidBeforeSlot: null,
    inputs: [{ txHash: "1111111111111111111111111111111111111111111111111111111111111111", outputIndex: 0 }],
    outputs: [
      {
        address: FAKE_SCRIPT_ADDR,
        outputIndex: 0,
        lovelace: 5_000_000n,
        inlineDatumHex,
      },
    ],
    requiredSigners: [],
  };

  const releaseDetails: ChainTxDetails = {
    txHash: RELEASE_TX_ID,
    validContract: true,
    invalidBeforeSlot: null,
    inputs: [{ txHash: LOCK_TX_ID, outputIndex: 0 }],
    outputs: [
      {
        address: FAKE_SUPPLIER_ADDR,
        outputIndex: 0,
        lovelace: 5_000_000n,
        inlineDatumHex: null,
      },
    ],
    requiredSigners: [BUYER_KEY_HASH],
  };

  // Preprod slot strictly after 2026-12-03T12:00:00.000Z:
  // (1796299200000 - 1655769600000) / 1000 + 86400 = 140616000 -> +60s = 140616060n
  const refundDetails: ChainTxDetails = {
    txHash: REFUND_TX_ID,
    validContract: true,
    invalidBeforeSlot: 140_616_060n,
    inputs: [{ txHash: LOCK_TX_ID, outputIndex: 0 }],
    outputs: [
      {
        address: FAKE_BUYER_ADDR,
        outputIndex: 0,
        lovelace: 5_000_000n,
        inlineDatumHex: null,
      },
    ],
    requiredSigners: [BUYER_KEY_HASH],
  };

  const txMap = new Map<string, ChainTxLookupResult>([
    [LOCK_TX_ID, { kind: "ok", status: { status: "confirmed", confirmations: 5, blockHeight: 100 }, details: lockDetails }],
    [RELEASE_TX_ID, { kind: "ok", status: { status: "confirmed", confirmations: 4, blockHeight: 101 }, details: releaseDetails }],
    [REFUND_TX_ID, { kind: "ok", status: { status: "confirmed", confirmations: 4, blockHeight: 102 }, details: refundDetails }],
  ]);

  const chainReader: VerifierChainReader = {
    async getTransaction(txHash: string): Promise<ChainTxLookupResult> {
      return (
        txMap.get(txHash) ?? {
          kind: "not_confirmed",
          status: { status: "not_found" },
        }
      );
    },
  };

  return {
    receipt,
    unsignedReceipt,
    signReceipt,
    receiptKey,
    datum,
    lockDetails,
    releaseDetails,
    refundDetails,
    txMap,
    chainReader,
  };
}

describe("T8.3 — CBOR inline datum & CLI argument pre-flight", () => {
  it("round-trips 5-field Constr 0 EscrowDatum CBOR per DATUM_SPEC.md", () => {
    const datum: ParsedEscrowDatum = {
      buyer: BUYER_KEY_HASH,
      supplier: SUPPLIER_KEY_HASH,
      lockedAmountLovelace: 5_000_000n,
      refundDeadlineMs: 1_796_299_200_000n,
      actionCommitment: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const encoded = encodeEscrowInlineDatumCbor(datum);
    assert.deepEqual(decodeEscrowInlineDatumCbor(encoded), datum);
    assert.equal(decodeEscrowInlineDatumCbor("deadbeef"), null);
  });

  it("rejects missing or malformed --trusted-fingerprint before reading any file", () => {
    assert.equal(parseCliArgs(["--receipt", "a.json"]).ok, false);
    assert.equal(parseCliArgs(["--receipt", "a.json", "--trusted-fingerprint", "not-hex"]).ok, false);
    assert.equal(
      parseCliArgs([
        "--receipt",
        "a.json",
        "--trusted-fingerprint",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ]).ok,
      true,
    );
  });
});

describe("T8.3 — Core verifier Checks 1 to 6 (Step 7 required tests)", () => {
  it("valid simulated receipts give VERIFIED (full, verification, released, refunded, locked)", async () => {
    for (const view of ["full", "verification"] as const) {
      for (const outcome of ["released", "refunded", "locked"] as const) {
        const fx = makeFixture({ view, outcome });
        const report = await verifyReceipt(fx.receipt, fx.receiptKey.fingerprint, {
          publicKeyDoc: fx.receiptKey.publicKeyDoc,
          chainReader: fx.chainReader,
        });
        assert.equal(report.verdict, "VERIFIED", `Expected VERIFIED for ${view}/${outcome}: ${JSON.stringify(report.checks)}`);
        assert.equal(report.view, view);
        assert.equal(report.checks.length, 6);
        assert.match(report.checks[5].message, /rests on SEYVIXA's signature/i);
        if (outcome === "locked") {
          assert.match(report.checks[4].message, /locked, not settled/i);
        }
      }
    }
  });

  it("wrong --trusted-fingerprint stops immediately at Check 1", async () => {
    const fx = makeFixture();
    const wrongFp = "0000000000000000000000000000000000000000000000000000000000000000";
    const report = await verifyReceipt(fx.receipt, wrongFp, {
      publicKeyDoc: fx.receiptKey.publicKeyDoc,
      chainReader: fx.chainReader,
    });
    assert.equal(report.verdict, "REJECTED");
    assert.equal(report.checks.length, 1);
    assert.equal(report.checks[0].check, 1);
    assert.equal(report.checks[0].status, "fail");
  });

  it("rejects a receipt with an embedded public key or an unknown kid", async () => {
    const fx = makeFixture();
    const withEmbeddedKey = { ...fx.receipt, public_key: fx.receiptKey.rawPub.toString("hex") };
    const r1 = await verifyReceipt(withEmbeddedKey, fx.receiptKey.fingerprint, {
      publicKeyDoc: fx.receiptKey.publicKeyDoc,
      chainReader: fx.chainReader,
    });
    assert.equal(r1.verdict, "REJECTED");
    assert.equal(r1.checks.length, 1);

    const withUnknownKid = fx.signReceipt({ ...fx.unsignedReceipt, kid: "ffffffffffffffff" });
    const r2 = await verifyReceipt(withUnknownKid, fx.receiptKey.fingerprint, {
      publicKeyDoc: fx.receiptKey.publicKeyDoc,
      chainReader: fx.chainReader,
    });
    assert.equal(r2.verdict, "REJECTED");
    assert.equal(r2.checks.length, 1);
  });

  it("rejects a released receipt whose release transaction does not spend escrow_utxo_ref", async () => {
    const fx = makeFixture({ outcome: "released" });
    fx.txMap.set(RELEASE_TX_ID, {
      kind: "ok",
      status: { status: "confirmed", confirmations: 4, blockHeight: 101 },
      details: {
        ...fx.releaseDetails,
        inputs: [{ txHash: "9999999999999999999999999999999999999999999999999999999999999999", outputIndex: 0 }],
      },
    });
    const report = await verifyReceipt(fx.receipt, fx.receiptKey.fingerprint, {
      publicKeyDoc: fx.receiptKey.publicKeyDoc,
      chainReader: fx.chainReader,
    });
    assert.equal(report.verdict, "REJECTED");
    assert.equal(report.checks[4].status, "fail");
    assert.match(report.checks[4].message, /does not spend escrow UTxO/i);
  });

  it("rejects a released receipt with no output paying the supplier", async () => {
    const fx = makeFixture({ outcome: "released" });
    fx.txMap.set(RELEASE_TX_ID, {
      kind: "ok",
      status: { status: "confirmed", confirmations: 4, blockHeight: 101 },
      details: {
        ...fx.releaseDetails,
        outputs: [{ address: FAKE_OTHER_ADDR, outputIndex: 0, lovelace: 5_000_000n, inlineDatumHex: null }],
      },
    });
    const report = await verifyReceipt(fx.receipt, fx.receiptKey.fingerprint, {
      publicKeyDoc: fx.receiptKey.publicKeyDoc,
      chainReader: fx.chainReader,
    });
    assert.equal(report.verdict, "REJECTED");
    assert.equal(report.checks[4].status, "fail");
    assert.match(report.checks[4].message, /supplier key hash/i);
  });

  it("rejects a released receipt with the wrong network", async () => {
    const fx = makeFixture({ outcome: "released" });
    const wrongNet = fx.signReceipt({
      ...fx.unsignedReceipt,
      chain: { ...(fx.unsignedReceipt.chain as Record<string, unknown>), network: "mainnet" },
    });
    const report = await verifyReceipt(wrongNet, fx.receiptKey.fingerprint, {
      publicKeyDoc: fx.receiptKey.publicKeyDoc,
      chainReader: fx.chainReader,
    });
    assert.equal(report.verdict, "REJECTED");
  });

  it("never reports an unconfirmed transaction or invalid-contract transaction as VERIFIED", async () => {
    const fx1 = makeFixture({ outcome: "released" });
    fx1.txMap.set(LOCK_TX_ID, {
      kind: "not_confirmed",
      status: { status: "found", confirmations: 1, blockHeight: 100 },
    });
    const r1 = await verifyReceipt(fx1.receipt, fx1.receiptKey.fingerprint, {
      publicKeyDoc: fx1.receiptKey.publicKeyDoc,
      chainReader: fx1.chainReader,
    });
    assert.equal(r1.verdict, "REJECTED");

    const fx2 = makeFixture({ outcome: "released" });
    fx2.txMap.set(RELEASE_TX_ID, {
      kind: "invalid_contract",
      reason: "Transaction failed Plutus script validation (valid_contract=false).",
    });
    const r2 = await verifyReceipt(fx2.receipt, fx2.receiptKey.fingerprint, {
      publicKeyDoc: fx2.receiptKey.publicKeyDoc,
      chainReader: fx2.chainReader,
    });
    assert.equal(r2.verdict, "REJECTED");
    assert.equal(r2.checks[4].status, "fail");
  });

  it("gives UNVERIFIABLE (never VERIFIED) when the chain API is down", async () => {
    const fx = makeFixture({ outcome: "released" });
    const downReader = createBlockfrostChainReader({
      config: {
        network: "preprod",
        baseUrl: "https://cardano-preprod.blockfrost.io/api/v0",
        projectId: "mock-preprod-key",
        confirmationDepth: 3,
        timeoutMs: 1000,
      },
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const report = await verifyReceipt(fx.receipt, fx.receiptKey.fingerprint, {
      publicKeyDoc: fx.receiptKey.publicKeyDoc,
      chainReader: downReader,
    });
    assert.equal(report.verdict, "UNVERIFIABLE");
    assert.notEqual(report.verdict, "VERIFIED");
  });

  it("mutation check: breaking each check 1..5 individually causes VERIFIED -> REJECTED", async () => {
    // Mutation 1: corrupt receipt signature -> Check 1 fails
    const m1 = makeFixture();
    const badSigReceipt = { ...m1.receipt, signature: "00".repeat(64) };
    const r1 = await verifyReceipt(badSigReceipt, m1.receiptKey.fingerprint, {
      publicKeyDoc: m1.receiptKey.publicKeyDoc,
      chainReader: m1.chainReader,
    });
    assert.equal(r1.verdict, "REJECTED");
    assert.equal(r1.checks[0].status, "fail");

    // Mutation 2: corrupt owner approval signature -> Check 2 fails
    const m2 = makeFixture();
    const badApproval = m2.signReceipt({
      ...m2.unsignedReceipt,
      approval: {
        ...(m2.unsignedReceipt.approval as Record<string, unknown>),
        signature: `${"aa".repeat(32)}:${"bb".repeat(64)}`,
      },
    });
    const r2 = await verifyReceipt(badApproval, m2.receiptKey.fingerprint, {
      publicKeyDoc: m2.receiptKey.publicKeyDoc,
      chainReader: m2.chainReader,
    });
    assert.equal(r2.verdict, "REJECTED");
    assert.equal(r2.checks[1].status, "fail");

    // Mutation 3: wrong script_address on lock output -> Check 3 fails
    const m3 = makeFixture();
    m3.txMap.set(LOCK_TX_ID, {
      kind: "ok",
      status: { status: "confirmed", confirmations: 5, blockHeight: 100 },
      details: {
        ...m3.lockDetails,
        outputs: [{ ...m3.lockDetails.outputs[0], address: FAKE_OTHER_ADDR }],
      },
    });
    const r3 = await verifyReceipt(m3.receipt, m3.receiptKey.fingerprint, {
      publicKeyDoc: m3.receiptKey.publicKeyDoc,
      chainReader: m3.chainReader,
    });
    assert.equal(r3.verdict, "REJECTED");
    assert.equal(r3.checks[2].status, "fail");

    // Mutation 4: altered commitment_salt -> Check 4 fails
    const m4 = makeFixture();
    const badSalt = m4.signReceipt({
      ...m4.unsignedReceipt,
      commitment_salt: "11".repeat(32),
    });
    const r4 = await verifyReceipt(badSalt, m4.receiptKey.fingerprint, {
      publicKeyDoc: m4.receiptKey.publicKeyDoc,
      chainReader: m4.chainReader,
    });
    assert.equal(r4.verdict, "REJECTED");
    assert.equal(r4.checks[3].status, "fail");

    // Mutation 5: missing buyer required signer on release tx -> Check 5 fails
    const m5 = makeFixture({ outcome: "released" });
    m5.txMap.set(RELEASE_TX_ID, {
      kind: "ok",
      status: { status: "confirmed", confirmations: 4, blockHeight: 101 },
      details: { ...m5.releaseDetails, requiredSigners: [] },
    });
    const r5 = await verifyReceipt(m5.receipt, m5.receiptKey.fingerprint, {
      publicKeyDoc: m5.receiptKey.publicKeyDoc,
      chainReader: m5.chainReader,
    });
    assert.equal(r5.verdict, "REJECTED");
    assert.equal(r5.checks[4].status, "fail");
  });
});
