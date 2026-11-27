// T8.4 — Tests for demo tamper script (P0-7: altered receipt fails verification).
// Verifies:
// 1. Each listed field (locked_lovelace, total_lkr, outcome, release_tx_id), altered, gives REJECTED.
// 2. Control: the untouched simulated receipt fixture gives VERIFIED.
// 3. The original receipt file is unchanged after every tamper run (SHA-256 hash compared).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  encodeEscrowInlineDatumCbor,
  extractTestnetPaymentKeyHash,
  type ChainTxLookupResult,
  type VerifierChainReader,
} from "../src/chain-reader.ts";
import { computeActionCommitment, verifyReceipt } from "../src/verify.ts";
import {
  DEFAULT_FIXTURE_PUBLIC_KEY_PATH,
  DEFAULT_FIXTURE_RECEIPT_PATH,
  TAMPERABLE_FIELDS,
  runTamperDemo,
} from "./tamper-receipt.ts";

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("T8.4 — Demo tamper script (P0-7)", () => {
  it("control: untouched simulated receipt fixture gives VERIFIED", async () => {
    const receipt = JSON.parse(readFileSync(DEFAULT_FIXTURE_RECEIPT_PATH, "utf8"));
    const pubDoc = JSON.parse(readFileSync(DEFAULT_FIXTURE_PUBLIC_KEY_PATH, "utf8"));

    const supplierKeyHash = extractTestnetPaymentKeyHash(receipt.approved_action.payee_address)!;
    const commitment = computeActionCommitment(receipt.action_hash, receipt.commitment_salt);
    const inlineDatumHex = encodeEscrowInlineDatumCbor({
      buyer: receipt.approval.owner_key_hash,
      supplier: supplierKeyHash,
      lockedAmountLovelace: BigInt(receipt.chain.locked_lovelace),
      refundDeadlineMs: BigInt(Date.parse(receipt.approved_action.refund_deadline)),
      actionCommitment: commitment,
    });

    const lockTxId: string = receipt.chain.lock_tx_id;
    const releaseTxId: string = receipt.chain.release_tx_id;

    const mockChainReader: VerifierChainReader = {
      async getTransaction(txHash: string): Promise<ChainTxLookupResult> {
        if (txHash === lockTxId) {
          return {
            kind: "ok",
            status: { status: "confirmed", confirmations: 5, blockHeight: 100 },
            details: {
              txHash: lockTxId,
              validContract: true,
              invalidBeforeSlot: null,
              inputs: [{ txHash: "11".repeat(32), outputIndex: 0 }],
              outputs: [
                {
                  address: receipt.chain.script_address,
                  outputIndex: 0,
                  lovelace: BigInt(receipt.chain.locked_lovelace),
                  inlineDatumHex,
                },
              ],
              requiredSigners: [],
            },
          };
        }
        if (txHash === releaseTxId) {
          return {
            kind: "ok",
            status: { status: "confirmed", confirmations: 4, blockHeight: 101 },
            details: {
              txHash: releaseTxId,
              validContract: true,
              invalidBeforeSlot: null,
              inputs: [{ txHash: lockTxId, outputIndex: 0 }],
              outputs: [
                {
                  address: receipt.approved_action.payee_address,
                  outputIndex: 0,
                  lovelace: BigInt(receipt.chain.locked_lovelace),
                  inlineDatumHex: null,
                },
              ],
              requiredSigners: [receipt.approval.owner_key_hash],
            },
          };
        }
        return { kind: "not_confirmed", status: { status: "not_found" } };
      },
    };

    const report = await verifyReceipt(receipt, pubDoc.fingerprint, {
      publicKeyDoc: pubDoc,
      chainReader: mockChainReader,
    });
    assert.equal(report.verdict, "VERIFIED", JSON.stringify(report.checks));
  });

  it("P0-7: altering each listed field gives REJECTED from the verifier CLI and leaves original file unchanged", () => {
    const beforeHash = sha256File(DEFAULT_FIXTURE_RECEIPT_PATH);
    const tempDir = mkdtempSync(path.join(tmpdir(), "seyvixa-t84-"));

    try {
      for (const field of TAMPERABLE_FIELDS) {
        const outPath = path.join(tempDir, `tampered-${field}.json`);
        const result = runTamperDemo({
          field,
          receiptPath: DEFAULT_FIXTURE_RECEIPT_PATH,
          outPath,
          publicKeyPath: DEFAULT_FIXTURE_PUBLIC_KEY_PATH,
        });

        assert.equal(result.verifierVerdict, "REJECTED", `Expected REJECTED for field ${field}`);
        assert.equal(result.verifierExitCode, 1);
        assert.equal(result.summaryLine, `Altered field ${field}; verifier result REJECTED.`);
        assert.equal(
          sha256File(DEFAULT_FIXTURE_RECEIPT_PATH),
          beforeHash,
          `Original receipt file must remain unchanged after tampering ${field}`,
        );
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite the original receipt file", () => {
    assert.throws(
      () =>
        runTamperDemo({
          field: "locked_lovelace",
          receiptPath: DEFAULT_FIXTURE_RECEIPT_PATH,
          outPath: DEFAULT_FIXTURE_RECEIPT_PATH,
        }),
      /Refusing to overwrite/i,
    );
  });
});
