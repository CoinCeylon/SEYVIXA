// T7.3 (Preparation) — Mocked unit tests for `buildLockTx` and `DATUM_SPEC.md` helpers.
// Uses fake Preprod addresses, fake UTxOs, an injected mock DB reader, and an injected mock MeshTxBuilder.
// Does NOT invent real validator artifacts or submit any transactions.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { UTxO } from "@meshsdk/core";
import {
  ACTION_COMMITMENT_DOMAIN_TAG,
  LockTxError,
  buildEscrowInlineDatum,
  buildLockTx,
  computeActionCommitment,
  computePreprodValidityWindow,
  tadaToLovelace,
  type LockTxBuilderLike,
  type LockTxDataReader,
  type StoredLockActionRecord,
  type StoredOwnerRecord,
} from "./lock-tx.ts";

// Official CIP-19 testnet vectors (fake test values — no real funds or real validator script).
const FAKE_BUYER_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";
const FAKE_BUYER_KEY_HASH = "9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e";
const FAKE_SUPPLIER_ADDRESS =
  "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";
const FAKE_SUPPLIER_KEY_HASH = "11111111111111111111111111111111111111111111111111111111";
const FAKE_SCRIPT_ADDRESS =
  "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg";
const FAKE_MAINNET_ADDRESS =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
const FAKE_SALT_HEX = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FAKE_UNSIGNED_TX_CBOR = "84a40081825820deadbeef00018182581d60949331";

const FIXED_NOW_MS = Date.parse("2026-11-26T12:00:00.000Z");

const FAKE_UTXOS: UTxO[] = [
  {
    input: {
      txHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outputIndex: 0,
    },
    output: {
      address: FAKE_BUYER_ADDRESS,
      amount: [{ unit: "lovelace", quantity: "25000000" }],
    },
  },
];

function makeCanonicalAction(overrides: {
  action?: Partial<StoredLockActionRecord>;
  payload?: Record<string, unknown>;
} = {}): StoredLockActionRecord {
  const payloadObj = {
    procurement_id: "00000000-0000-4000-8000-000000000010",
    owner_id: "00000000-0000-4000-8000-000000000001",
    supplier_id: "00000000-0000-4000-8000-000000000002",
    payee_address: FAKE_SUPPLIER_ADDRESS,
    items: [{ description: "Linen sets", quantity: 10 }],
    total_lkr: "45000.00",
    settlement_asset: "tADA",
    escrow_amount_tada: "5.000000",
    escrow_script_address: FAKE_SCRIPT_ADDRESS,
    refund_deadline: "2026-12-03T12:00:00.000Z",
    expiry: "2026-11-26T12:30:00.000Z",
    nonce: "nonce-lock-001",
    ...overrides.payload,
  };
  const canonicalPayload = JSON.stringify(payloadObj);
  const actionHash = createHash("sha256").update(canonicalPayload, "utf8").digest("hex");

  return {
    id: "00000000-0000-4000-8000-000000000099",
    owner_id: "00000000-0000-4000-8000-000000000001",
    action_type: "ESCROW_LOCK",
    status: "APPROVED",
    canonical_payload: canonicalPayload,
    action_hash: actionHash,
    commitment_salt: FAKE_SALT_HEX,
    ...overrides.action,
  };
}

function makeOwner(overrides: Partial<StoredOwnerRecord> = {}): StoredOwnerRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    owner_address: FAKE_BUYER_ADDRESS,
    payment_key_hash: FAKE_BUYER_KEY_HASH,
    ...overrides,
  };
}

function createMockDb(
  action: StoredLockActionRecord | null = makeCanonicalAction(),
  owner: StoredOwnerRecord | null = makeOwner(),
): LockTxDataReader {
  return {
    getActionById: async (id) => (action && action.id === id ? action : null),
    getOwnerById: async (id) => (owner && owner.id === id ? owner : null),
  };
}

interface RecordedBuilderCalls {
  txOuts: Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>;
  inlineDatums: Array<{ datum: unknown; type: string | undefined }>;
  changeAddresses: string[];
  selectedUtxos: UTxO[][];
  invalidBeforeSlots: number[];
  invalidAfterSlots: number[];
  completeCalls: number;
}

function createRecordingTxBuilder(resultHex: string = FAKE_UNSIGNED_TX_CBOR): {
  builder: LockTxBuilderLike;
  calls: RecordedBuilderCalls;
} {
  const calls: RecordedBuilderCalls = {
    txOuts: [],
    inlineDatums: [],
    changeAddresses: [],
    selectedUtxos: [],
    invalidBeforeSlots: [],
    invalidAfterSlots: [],
    completeCalls: 0,
  };

  const builder: LockTxBuilderLike = {
    txOut(address, amount) {
      calls.txOuts.push({ address, amount });
      return this;
    },
    txOutInlineDatumValue(datum, type) {
      calls.inlineDatums.push({ datum, type });
      return this;
    },
    changeAddress(address) {
      calls.changeAddresses.push(address);
      return this;
    },
    selectUtxosFrom(extraInputs) {
      calls.selectedUtxos.push(extraInputs);
      return this;
    },
    invalidBefore(slot) {
      calls.invalidBeforeSlots.push(slot);
      return this;
    },
    invalidHereafter(slot) {
      calls.invalidAfterSlots.push(slot);
      return this;
    },
    async complete() {
      calls.completeCalls += 1;
      return resultHex;
    },
  };

  return { builder, calls };
}

function mockResolveKeyHash(address: string): string {
  if (address === FAKE_BUYER_ADDRESS) return FAKE_BUYER_KEY_HASH;
  if (address === FAKE_SUPPLIER_ADDRESS) return FAKE_SUPPLIER_KEY_HASH;
  throw new Error(`Unexpected address: ${address}`);
}

describe("T7.3 helpers — DATUM_SPEC.md compliance", () => {
  it("converts exact 6-decimal tADA strings to lovelace bigint without floats", () => {
    assert.equal(tadaToLovelace("5.000000"), 5_000_000n);
    assert.equal(tadaToLovelace("0.000001"), 1n);
    assert.equal(tadaToLovelace("12.345678"), 12_345_678n);

    for (const bad of ["0.000000", "5", "5.0", "-1.000000", "abc"]) {
      assert.throws(
        () => tadaToLovelace(bad),
        (err: unknown) => err instanceof LockTxError && err.code === "INVALID_AMOUNT",
      );
    }
  });

  it("computes salted action_commitment = SHA-256('seyvixa-commit-v1' || action_hash || salt)", () => {
    const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const expected = createHash("sha256")
      .update(Buffer.from(ACTION_COMMITMENT_DOMAIN_TAG, "utf8"))
      .update(Buffer.from(hash, "hex"))
      .update(Buffer.from(FAKE_SALT_HEX, "hex"))
      .digest("hex");

    assert.equal(computeActionCommitment(hash, FAKE_SALT_HEX), expected);
    assert.equal(expected.length, 64);
  });

  it("builds the exact 5-field Constr 0 inline datum matching DATUM_SPEC.md", () => {
    const datum = buildEscrowInlineDatum({
      buyer: FAKE_BUYER_KEY_HASH,
      supplier: FAKE_SUPPLIER_KEY_HASH,
      lockedAmountLovelace: 5_000_000n,
      refundDeadlineMs: 1795600000000n,
      actionCommitment: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    assert.deepEqual(datum, {
      alternative: 0,
      fields: [
        FAKE_BUYER_KEY_HASH,
        FAKE_SUPPLIER_KEY_HASH,
        5_000_000n,
        1795600000000n,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
    });
  });

  it("computes a bounded short Preprod slot validity window", () => {
    const win = computePreprodValidityWindow(FIXED_NOW_MS, 300);
    assert.equal(win.invalidAfterSlot - win.invalidBeforeSlot, 300);
    assert.equal(win.validUntilIso, "2026-11-26T12:05:00.000Z");

    assert.throws(
      () => computePreprodValidityWindow(FIXED_NOW_MS, 10),
      (err: unknown) => err instanceof LockTxError && err.code === "INVALID_TTL",
    );
    assert.throws(
      () => computePreprodValidityWindow(FIXED_NOW_MS, 7200),
      (err: unknown) => err instanceof LockTxError && err.code === "INVALID_TTL",
    );
  });
});

describe("T7.3 — buildLockTx(actionId, deps)", () => {
  it("builds an unsigned lock transaction from stored action and owner records with inline datum and short TTL", async () => {
    const action = makeCanonicalAction();
    const { builder, calls } = createRecordingTxBuilder();

    const result = await buildLockTx(action.id, {
      scriptAddress: FAKE_SCRIPT_ADDRESS,
      db: createMockDb(action, makeOwner()),
      getBuyerUtxos: async () => FAKE_UTXOS,
      createTxBuilder: () => builder,
      resolveKeyHash: mockResolveKeyHash,
      nowMs: () => FIXED_NOW_MS,
      ttlSeconds: 300,
    });

    assert.equal(result.unsignedTxCborHex, FAKE_UNSIGNED_TX_CBOR);
    assert.equal(result.scriptAddress, FAKE_SCRIPT_ADDRESS);
    assert.equal(result.datumFields.buyer, FAKE_BUYER_KEY_HASH);
    assert.equal(result.datumFields.supplier, FAKE_SUPPLIER_KEY_HASH);
    assert.equal(result.datumFields.lockedAmountLovelace, 5_000_000n);
    assert.equal(result.datumFields.refundDeadlineMs, BigInt(Date.parse("2026-12-03T12:00:00.000Z")));

    assert.deepEqual(calls.txOuts, [
      { address: FAKE_SCRIPT_ADDRESS, amount: [{ unit: "lovelace", quantity: "5000000" }] },
    ]);
    assert.equal(calls.inlineDatums.length, 1);
    assert.equal(calls.inlineDatums[0].type, "Mesh");
    assert.deepEqual(calls.inlineDatums[0].datum, result.inlineDatum);
    assert.deepEqual(calls.changeAddresses, [FAKE_BUYER_ADDRESS]);
    assert.equal(calls.selectedUtxos.length, 1);
    assert.equal(calls.invalidAfterSlots[0] - calls.invalidBeforeSlots[0], 300);
    assert.equal(calls.completeCalls, 1);
  });

  it("fails closed on Mainnet script address, mismatched script address, non-APPROVED status, or tampered hash", async () => {
    const action = makeCanonicalAction();
    const baseDeps = {
      scriptAddress: FAKE_SCRIPT_ADDRESS,
      db: createMockDb(action, makeOwner()),
      getBuyerUtxos: async () => FAKE_UTXOS,
      createTxBuilder: () => createRecordingTxBuilder().builder,
      resolveKeyHash: mockResolveKeyHash,
      nowMs: () => FIXED_NOW_MS,
    };

    await assert.rejects(
      () => buildLockTx(action.id, { ...baseDeps, scriptAddress: FAKE_MAINNET_ADDRESS }),
      (err: unknown) => err instanceof LockTxError && err.code === "NETWORK_NOT_TESTNET",
    );

    const mismatchedScriptAction = makeCanonicalAction({
      payload: { escrow_script_address: FAKE_BUYER_ADDRESS },
    });
    await assert.rejects(
      () =>
        buildLockTx(mismatchedScriptAction.id, {
          ...baseDeps,
          db: createMockDb(mismatchedScriptAction, makeOwner()),
        }),
      (err: unknown) => err instanceof LockTxError && err.code === "INVALID_SCRIPT_ADDRESS",
    );

    const pendingAction = makeCanonicalAction({ action: { status: "PENDING_APPROVAL" } });
    await assert.rejects(
      () =>
        buildLockTx(pendingAction.id, {
          ...baseDeps,
          db: createMockDb(pendingAction, makeOwner()),
        }),
      (err: unknown) => err instanceof LockTxError && err.code === "ACTION_NOT_APPROVED",
    );

    const tamperedAction = makeCanonicalAction({
      action: { action_hash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
    });
    await assert.rejects(
      () =>
        buildLockTx(tamperedAction.id, {
          ...baseDeps,
          db: createMockDb(tamperedAction, makeOwner()),
        }),
      (err: unknown) => err instanceof LockTxError && err.code === "ACTION_HASH_MISMATCH",
    );
  });

  it("fails closed on unregistered owner key hash, expired action, or empty UTxOs", async () => {
    const action = makeCanonicalAction();
    const baseDeps = {
      scriptAddress: FAKE_SCRIPT_ADDRESS,
      db: createMockDb(action, makeOwner()),
      getBuyerUtxos: async () => FAKE_UTXOS,
      createTxBuilder: () => createRecordingTxBuilder().builder,
      resolveKeyHash: mockResolveKeyHash,
      nowMs: () => FIXED_NOW_MS,
    };

    await assert.rejects(
      () =>
        buildLockTx(action.id, {
          ...baseDeps,
          db: createMockDb(action, makeOwner({ payment_key_hash: null })),
        }),
      (err: unknown) => err instanceof LockTxError && err.code === "OWNER_KEY_UNREGISTERED",
    );

    await assert.rejects(
      () =>
        buildLockTx(action.id, {
          ...baseDeps,
          nowMs: () => Date.parse("2026-11-26T13:00:00.000Z"),
        }),
      (err: unknown) => err instanceof LockTxError && err.code === "ACTION_EXPIRED",
    );

    await assert.rejects(
      () => buildLockTx(action.id, { ...baseDeps, getBuyerUtxos: async () => [] }),
      (err: unknown) => err instanceof LockTxError && err.code === "INSUFFICIENT_UTXOS",
    );
  });
});
