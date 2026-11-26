// T8.3 — Standalone receipt verifier core (Blueprint Section 6.8; Section 9 item 12).
// Verifies a SEYVIXA receipt without trusting the web app or database.
// Checks 1 to 6 in strict order; stops immediately if Check 1 fails (pinned key / schema / signature).
// Returns VERIFIED, REJECTED, or UNVERIFIABLE (never reports UNVERIFIABLE as VERIFIED).
// Zero new dependencies: reuses packages/shared (read-only), schemas/validate-receipt-v0.mjs,
// keys/receipt-signing-public.json, and services/chain (T7.1, read-only).

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../../../packages/shared/src/canonical.ts";
import { actionHash } from "../../../packages/shared/src/hash.ts";
import { validateReceiptV0 } from "../../../schemas/validate-receipt-v0.mjs";
import {
  createBlockfrostChainReader,
  decodeEscrowInlineDatumCbor,
  extractTestnetPaymentKeyHash,
  preprodSlotToPosixMs,
  type ParsedEscrowDatum,
  type VerifierChainReader,
} from "./chain-reader.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_PUBLIC_KEY_PATH = path.join(REPO_ROOT, "keys/receipt-signing-public.json");

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX_64_RE = /^[0-9a-f]{64}$/;
const APPROVAL_DOMAIN_TAG = "seyvixa-approval-v1";
const ACTION_COMMITMENT_DOMAIN_TAG = "seyvixa-commit-v1";
const FALLBACK_APPROVAL_LABEL = "approval key not bound to escrow buyer key (fallback)";

const EMBEDDED_KEY_FIELDS = new Set([
  "public_key",
  "publicKey",
  "pubkey",
  "jwk",
  "algorithm",
  "alg",
]);

export type Verdict = "VERIFIED" | "REJECTED" | "UNVERIFIABLE";
export type CheckStatus = "pass" | "fail" | "unverifiable";

export interface CheckResult {
  readonly check: number;
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

export interface VerificationReport {
  readonly verdict: Verdict;
  readonly view: "full" | "verification" | "unknown";
  readonly checks: readonly CheckResult[];
}

export interface ApprovalSignaturePayload {
  readonly domain: string;
  readonly action_hash: string;
  readonly nonce: string;
  readonly expires_at: string;
}

export type ApprovalVerifierFn = (input: {
  readonly payload: ApprovalSignaturePayload;
  readonly signature: string;
  readonly ownerKeyHash: string;
  readonly fallbackLabel?: string;
}) => boolean;

export interface VerifyReceiptDeps {
  /** Path to the committed receipt public key JSON (defaults to `keys/receipt-signing-public.json`). */
  readonly publicKeyPath?: string;
  /** Optional already-loaded public key JSON object (useful for unit tests). */
  readonly publicKeyDoc?: unknown;
  /** Chain reader adapter (defaults to Blockfrost Preprod reader using services/chain T7.1 config). */
  readonly chainReader?: VerifierChainReader;
  /**
   * Optional owner approval signature verifier (Check 2).
   * When omitted, verifies `approval.signature` as an Ed25519 signature (`<64-hex-pubkey>:<128-hex-sig>`
   * format for standalone/fallback verification) over canonical `{ domain, action_hash, nonce, expires_at }`.
   */
  readonly verifyOwnerApproval?: ApprovalVerifierFn;
}

interface ReceiptShape {
  schema_version: string;
  view: "full" | "verification";
  receipt_id: string;
  created_at: string;
  kid: string;
  signature: string;
  procurement_id: string;
  approved_action?: Record<string, unknown>;
  action_hash: string;
  approval: {
    nonce: string;
    expires_at: string;
    owner_key_hash: string;
    signature: string;
    fallback_label?: string;
  };
  commitment_salt: string;
  chain: {
    network: string;
    script_address: string;
    escrow_utxo_ref: string;
    lock_tx_id: string;
    locked_lovelace: number;
    outcome: "locked" | "released" | "refunded";
    release_tx_id?: string;
    refund_tx_id?: string;
  };
  midnight: {
    supplier_id: string;
    challenge_id: string;
    verification_reference: string;
    result: string;
    fallback_label?: string;
  };
}

/**
 * Validates that a `--trusted-fingerprint` argument is exactly 64 lowercase hex characters.
 */
export function isValidFingerprint(value: unknown): value is string {
  return typeof value === "string" && HEX_64_RE.test(value);
}

/**
 * Computes `SHA-256("seyvixa-commit-v1" || raw(action_hash) || raw(commitment_salt))` as 64 lowercase hex.
 * Self-contained (does not import from unmerged T7.3 code).
 */
export function computeActionCommitment(actionHashHex: string, commitmentSaltHex: string): string {
  return createHash("sha256")
    .update(Buffer.from(ACTION_COMMITMENT_DOMAIN_TAG, "utf8"))
    .update(Buffer.from(actionHashHex, "hex"))
    .update(Buffer.from(commitmentSaltHex, "hex"))
    .digest("hex");
}

/**
 * Canonicalises a receipt object without its `signature` field (the exact bytes signed by Ed25519).
 */
export function canonicalReceiptPayload(receipt: Record<string, unknown>): string {
  const withoutSig: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(receipt)) {
    if (key !== "signature") {
      withoutSig[key] = val;
    }
  }
  return canonicalize(withoutSig);
}

/**
 * Default Ed25519 owner approval verifier over canonical `{ domain, action_hash, nonce, expires_at }`.
 * Accepts `<64-hex-raw-ed25519-pubkey>:<128-hex-ed25519-sig>` and fails closed on any malformed or invalid signature.
 */
export function defaultVerifyOwnerApproval(input: {
  readonly payload: ApprovalSignaturePayload;
  readonly signature: string;
  readonly ownerKeyHash: string;
  readonly fallbackLabel?: string;
}): boolean {
  const parts = input.signature.split(":");
  if (parts.length !== 2) return false;
  const [pubKeyHex, sigHex] = parts;
  if (!/^[0-9a-f]{64}$/.test(pubKeyHex) || !/^[0-9a-f]{128}$/.test(sigHex)) {
    return false;
  }

  try {
    const rawPub = Buffer.from(pubKeyHex, "hex");
    const pubKeyObj = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPub]),
      format: "der",
      type: "spki",
    });
    const canonicalMsg = Buffer.from(canonicalize(input.payload), "utf8");
    return cryptoVerify(null, canonicalMsg, pubKeyObj, Buffer.from(sigHex, "hex"));
  } catch {
    return false;
  }
}

function hasEmbeddedKeyField(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    if (EMBEDDED_KEY_FIELDS.has(key)) return key;
  }
  return null;
}

function loadAndPinPublicKey(
  trustedFingerprint: string,
  deps: VerifyReceiptDeps,
): { ok: true; rawPublicKey: Buffer; fingerprint: string; kid: string } | { ok: false; message: string } {
  let doc: unknown;
  try {
    if (deps.publicKeyDoc !== undefined) {
      doc = deps.publicKeyDoc;
    } else {
      const keyPath = deps.publicKeyPath ?? DEFAULT_PUBLIC_KEY_PATH;
      doc = JSON.parse(readFileSync(keyPath, "utf8"));
    }
  } catch {
    return { ok: false, message: "Failed to load receipt public key file." };
  }

  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, message: "Receipt public key file is not a JSON object." };
  }
  const rec = doc as Record<string, unknown>;
  if (rec.algorithm !== "Ed25519") {
    return { ok: false, message: "Receipt public key algorithm must be Ed25519." };
  }
  if (typeof rec.public_key_hex !== "string" || !HEX_64_RE.test(rec.public_key_hex)) {
    return { ok: false, message: "Receipt public key file is missing a valid 32-byte public_key_hex." };
  }

  const rawPublicKey = Buffer.from(rec.public_key_hex, "hex");
  const recomputedFingerprint = createHash("sha256").update(rawPublicKey).digest("hex");
  if (recomputedFingerprint !== trustedFingerprint) {
    return {
      ok: false,
      message: "Trusted fingerprint mismatch: recomputed public key fingerprint does not match --trusted-fingerprint.",
    };
  }

  return {
    ok: true,
    rawPublicKey,
    fingerprint: recomputedFingerprint,
    kid: recomputedFingerprint.slice(0, 16),
  };
}

function parseUtxoRef(ref: string): { txHash: string; outputIndex: number } | null {
  const parts = ref.split("#");
  if (parts.length !== 2 || !HEX_64_RE.test(parts[0]) || !/^(0|[1-9][0-9]*)$/.test(parts[1])) {
    return null;
  }
  return { txHash: parts[0], outputIndex: Number(parts[1]) };
}

function deriveVerdict(checks: readonly CheckResult[]): Verdict {
  if (checks.some((c) => c.status === "fail")) return "REJECTED";
  if (checks.some((c) => c.status === "unverifiable")) return "UNVERIFIABLE";
  return "VERIFIED";
}

/**
 * Runs Checks 1 to 6 from Blueprint Section 6.8 on a parsed receipt object.
 * Stops immediately on Check 1 failure (trusted fingerprint, kid, schema, or receipt signature).
 */
export async function verifyReceipt(
  receiptInput: unknown,
  trustedFingerprint: string,
  deps: VerifyReceiptDeps = {},
): Promise<VerificationReport> {
  const checks: CheckResult[] = [];

  if (!isValidFingerprint(trustedFingerprint)) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: "Missing or malformed --trusted-fingerprint (expected 64 lowercase hex characters).",
    });
    return { verdict: "REJECTED", view: "unknown", checks };
  }

  // Check 1a: Load pinned public key and compare recomputed fingerprint against --trusted-fingerprint.
  const keyResult = loadAndPinPublicKey(trustedFingerprint, deps);
  if (!keyResult.ok) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: keyResult.message,
    });
    return { verdict: "REJECTED", view: "unknown", checks };
  }

  // Check 1b: Basic object check + reject embedded public key or unknown kid before schema check.
  if (receiptInput === null || typeof receiptInput !== "object" || Array.isArray(receiptInput)) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: "Receipt must be a JSON object.",
    });
    return { verdict: "REJECTED", view: "unknown", checks };
  }

  const rawReceipt = receiptInput as Record<string, unknown>;
  const view: "full" | "verification" | "unknown" =
    rawReceipt.view === "full" || rawReceipt.view === "verification" ? rawReceipt.view : "unknown";

  const embeddedField = hasEmbeddedKeyField(rawReceipt);
  if (embeddedField !== null) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: `Receipt embeds disallowed key/algorithm field "${embeddedField}".`,
    });
    return { verdict: "REJECTED", view, checks };
  }

  if (rawReceipt.kid !== keyResult.kid) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: `Unknown or mismatched receipt kid (expected "${keyResult.kid}").`,
    });
    return { verdict: "REJECTED", view, checks };
  }

  // Check 1c: Validate receipt against schemas/receipt.v0.schema.json (T8.5).
  const schemaResult = validateReceiptV0(rawReceipt);
  if (!schemaResult.valid) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: `Schema validation failed: ${schemaResult.errors[0] ?? "invalid receipt"}`,
    });
    return { verdict: "REJECTED", view, checks };
  }

  const receipt = rawReceipt as unknown as ReceiptShape;

  // Check 1d: Canonicalise receipt payload (excluding signature) and verify Ed25519 signature.
  let sigValid = false;
  try {
    if (/^[0-9a-f]{128}$/.test(receipt.signature)) {
      const pubKeyObj = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, keyResult.rawPublicKey]),
        format: "der",
        type: "spki",
      });
      const canonical = canonicalReceiptPayload(rawReceipt);
      sigValid = cryptoVerify(
        null,
        Buffer.from(canonical, "utf8"),
        pubKeyObj,
        Buffer.from(receipt.signature, "hex"),
      );
    }
  } catch {
    sigValid = false;
  }

  if (!sigValid) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: "Ed25519 receipt signature verification failed.",
    });
    return { verdict: "REJECTED", view: receipt.view, checks };
  }

  checks.push({
    check: 1,
    name: "Trusted key, schema & receipt signature",
    status: "pass",
    message: `Pinned Ed25519 key (${keyResult.kid}), receipt.v0 schema (${receipt.view} view), and signature verified.`,
  });

  // Check 3 (fetched before finalizing Check 2's buyer key binding so we have the on-chain datum).
  const chainReader = deps.chainReader ?? createBlockfrostChainReader();
  let lockDatum: ParsedEscrowDatum | null = null;
  let lockCheck: CheckResult;

  const utxoRef = parseUtxoRef(receipt.chain.escrow_utxo_ref);
  if (receipt.chain.network !== "preprod") {
    lockCheck = {
      check: 3,
      name: "Lock transaction & inline datum",
      status: "fail",
      message: `Unexpected network "${receipt.chain.network}" (expected "preprod").`,
    };
  } else if (utxoRef === null || utxoRef.txHash !== receipt.chain.lock_tx_id) {
    lockCheck = {
      check: 3,
      name: "Lock transaction & inline datum",
      status: "fail",
      message: "escrow_utxo_ref does not match lock_tx_id.",
    };
  } else {
    const lockLookup = await chainReader.getTransaction(receipt.chain.lock_tx_id);
    if (lockLookup.kind === "unverifiable") {
      lockCheck = {
        check: 3,
        name: "Lock transaction & inline datum",
        status: "unverifiable",
        message: lockLookup.reason,
      };
    } else if (lockLookup.kind === "invalid_contract") {
      lockCheck = {
        check: 3,
        name: "Lock transaction & inline datum",
        status: "fail",
        message: lockLookup.reason,
      };
    } else if (lockLookup.kind === "not_confirmed") {
      lockCheck = {
        check: 3,
        name: "Lock transaction & inline datum",
        status: "fail",
        message: `Lock transaction is not confirmed (status: ${lockLookup.status.status}).`,
      };
    } else {
      const targetOutput = lockLookup.details.outputs.find(
        (o) => o.outputIndex === utxoRef.outputIndex,
      );
      if (targetOutput === undefined) {
        lockCheck = {
          check: 3,
          name: "Lock transaction & inline datum",
          status: "fail",
          message: `Output ${receipt.chain.escrow_utxo_ref} was not found in lock transaction.`,
        };
      } else if (targetOutput.address !== receipt.chain.script_address) {
        lockCheck = {
          check: 3,
          name: "Lock transaction & inline datum",
          status: "fail",
          message: "Lock output address does not match receipt script_address.",
        };
      } else if (targetOutput.lovelace < BigInt(receipt.chain.locked_lovelace)) {
        lockCheck = {
          check: 3,
          name: "Lock transaction & inline datum",
          status: "fail",
          message: "Lock output lovelace is less than receipt locked_lovelace.",
        };
      } else if (targetOutput.inlineDatumHex === null) {
        lockCheck = {
          check: 3,
          name: "Lock transaction & inline datum",
          status: "fail",
          message: "Lock output is missing an inline datum.",
        };
      } else {
        const parsedDatum = decodeEscrowInlineDatumCbor(targetOutput.inlineDatumHex);
        if (parsedDatum === null) {
          lockCheck = {
            check: 3,
            name: "Lock transaction & inline datum",
            status: "fail",
            message: "Lock output inline datum does not match DATUM_SPEC.md 5-field Constr 0.",
          };
        } else if (parsedDatum.lockedAmountLovelace !== BigInt(receipt.chain.locked_lovelace)) {
          lockCheck = {
            check: 3,
            name: "Lock transaction & inline datum",
            status: "fail",
            message: "Inline datum locked_amount does not match receipt locked_lovelace.",
          };
        } else {
          lockDatum = parsedDatum;
          lockCheck = {
            check: 3,
            name: "Lock transaction & inline datum",
            status: "pass",
            message: `Lock tx confirmed on preprod; ${receipt.chain.escrow_utxo_ref} sits at script_address with valid inline datum.`,
          };
        }
      }
    }
  }

  // Check 2: Owner approval signature, full-view action_hash recomputation, and buyer key hash binding.
  const approvalVerifier = deps.verifyOwnerApproval ?? defaultVerifyOwnerApproval;
  const approvalPayload: ApprovalSignaturePayload = {
    domain: APPROVAL_DOMAIN_TAG,
    action_hash: receipt.action_hash,
    nonce: receipt.approval.nonce,
    expires_at: receipt.approval.expires_at,
  };

  let check2: CheckResult;
  const approvalSigOk = approvalVerifier({
    payload: approvalPayload,
    signature: receipt.approval.signature,
    ownerKeyHash: receipt.approval.owner_key_hash,
    fallbackLabel: receipt.approval.fallback_label,
  });

  if (!approvalSigOk) {
    check2 = {
      check: 2,
      name: "Owner approval & action hash",
      status: "fail",
      message: "Owner approval signature verification failed.",
    };
  } else if (
    receipt.view === "full" &&
    receipt.approved_action !== undefined &&
    actionHash(receipt.approved_action) !== receipt.action_hash
  ) {
    check2 = {
      check: 2,
      name: "Owner approval & action hash",
      status: "fail",
      message: "Full-view recomputed action_hash does not match receipt action_hash.",
    };
  } else if (receipt.approval.fallback_label === FALLBACK_APPROVAL_LABEL) {
    check2 = {
      check: 2,
      name: "Owner approval & action hash",
      status: "pass",
      message: `Owner approval signature verified (${FALLBACK_APPROVAL_LABEL}).`,
    };
  } else if (lockDatum === null) {
    check2 = {
      check: 2,
      name: "Owner approval & action hash",
      status: lockCheck.status === "unverifiable" ? "unverifiable" : "fail",
      message:
        lockCheck.status === "unverifiable"
          ? "Cannot confirm owner_key_hash === on-chain buyer key hash while chain API is unreachable."
          : "Cannot confirm owner_key_hash === on-chain buyer key hash because lock datum check failed.",
    };
  } else if (receipt.approval.owner_key_hash !== lockDatum.buyer) {
    check2 = {
      check: 2,
      name: "Owner approval & action hash",
      status: "fail",
      message: "Approval owner_key_hash does not equal buyer key hash in on-chain datum.",
    };
  } else {
    check2 = {
      check: 2,
      name: "Owner approval & action hash",
      status: "pass",
      message:
        receipt.view === "full"
          ? "Owner approval signature, full-view action_hash, and owner_key_hash === datum.buyer verified."
          : "Owner approval signature and owner_key_hash === datum.buyer verified (verification view).",
    };
  }

  checks.push(check2);
  checks.push(lockCheck);

  // Check 4: Action commitment matches on-chain datum.
  let check4: CheckResult;
  if (lockDatum === null) {
    check4 = {
      check: 4,
      name: "Action commitment",
      status: lockCheck.status === "unverifiable" ? "unverifiable" : "fail",
      message:
        lockCheck.status === "unverifiable"
          ? "Cannot verify action commitment while chain API is unreachable."
          : "Cannot verify action commitment without a valid on-chain lock datum.",
    };
  } else {
    const recomputedCommitment = computeActionCommitment(
      receipt.action_hash,
      receipt.commitment_salt,
    );
    if (recomputedCommitment !== lockDatum.actionCommitment) {
      check4 = {
        check: 4,
        name: "Action commitment",
        status: "fail",
        message: "Recomputed action_commitment does not match on-chain datum.",
      };
    } else {
      check4 = {
        check: 4,
        name: "Action commitment",
        status: "pass",
        message: "Recomputed salted action_commitment matches on-chain inline datum.",
      };
    }
  }
  checks.push(check4);

  // Check 5: Settlement (released / refunded / locked).
  let check5: CheckResult;
  if (receipt.chain.outcome === "locked") {
    check5 = {
      check: 5,
      name: "Settlement",
      status: "pass",
      message: "locked, not settled (no release claim).",
    };
  } else if (lockDatum === null) {
    check5 = {
      check: 5,
      name: "Settlement",
      status: lockCheck.status === "unverifiable" ? "unverifiable" : "fail",
      message:
        lockCheck.status === "unverifiable"
          ? "Cannot verify settlement while chain API is unreachable."
          : "Cannot verify settlement without a valid on-chain lock datum.",
    };
  } else if (receipt.chain.outcome === "released") {
    const releaseTxId = receipt.chain.release_tx_id;
    if (typeof releaseTxId !== "string" || !HEX_64_RE.test(releaseTxId)) {
      check5 = {
        check: 5,
        name: "Settlement",
        status: "fail",
        message: 'Outcome is "released" but release_tx_id is missing.',
      };
    } else {
      const relLookup = await chainReader.getTransaction(releaseTxId);
      if (relLookup.kind === "unverifiable") {
        check5 = { check: 5, name: "Settlement", status: "unverifiable", message: relLookup.reason };
      } else if (relLookup.kind === "invalid_contract") {
        check5 = { check: 5, name: "Settlement", status: "fail", message: relLookup.reason };
      } else if (relLookup.kind === "not_confirmed") {
        check5 = {
          check: 5,
          name: "Settlement",
          status: "fail",
          message: `Release transaction is not confirmed (status: ${relLookup.status.status}).`,
        };
      } else {
        const spendsEscrow =
          utxoRef !== null &&
          relLookup.details.inputs.some(
            (i) => i.txHash === utxoRef.txHash && i.outputIndex === utxoRef.outputIndex,
          );
        const paysSupplier = relLookup.details.outputs.some(
          (o) =>
            o.lovelace >= lockDatum!.lockedAmountLovelace &&
            extractTestnetPaymentKeyHash(o.address) === lockDatum!.supplier,
        );
        const signedByBuyer = relLookup.details.requiredSigners.includes(lockDatum.buyer);

        if (!spendsEscrow) {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "fail",
            message: `Release transaction does not spend escrow UTxO ${receipt.chain.escrow_utxo_ref}.`,
          };
        } else if (!paysSupplier) {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "fail",
            message: "Release transaction has no output paying at least locked_lovelace to the supplier key hash.",
          };
        } else if (!signedByBuyer) {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "fail",
            message: "Release transaction required_signers does not include the buyer key hash.",
          };
        } else {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "pass",
            message: "Release tx confirmed, spends escrow_utxo_ref, pays supplier >= locked_lovelace, and includes buyer required signer.",
          };
        }
      }
    }
  } else {
    // refunded
    const refundTxId = receipt.chain.refund_tx_id;
    if (typeof refundTxId !== "string" || !HEX_64_RE.test(refundTxId)) {
      check5 = {
        check: 5,
        name: "Settlement",
        status: "fail",
        message: 'Outcome is "refunded" but refund_tx_id is missing.',
      };
    } else {
      const refLookup = await chainReader.getTransaction(refundTxId);
      if (refLookup.kind === "unverifiable") {
        check5 = { check: 5, name: "Settlement", status: "unverifiable", message: refLookup.reason };
      } else if (refLookup.kind === "invalid_contract") {
        check5 = { check: 5, name: "Settlement", status: "fail", message: refLookup.reason };
      } else if (refLookup.kind === "not_confirmed") {
        check5 = {
          check: 5,
          name: "Settlement",
          status: "fail",
          message: `Refund transaction is not confirmed (status: ${refLookup.status.status}).`,
        };
      } else {
        const spendsEscrow =
          utxoRef !== null &&
          refLookup.details.inputs.some(
            (i) => i.txHash === utxoRef.txHash && i.outputIndex === utxoRef.outputIndex,
          );
        const paysBuyer = refLookup.details.outputs.some(
          (o) => extractTestnetPaymentKeyHash(o.address) === lockDatum!.buyer,
        );
        const signedByBuyer = refLookup.details.requiredSigners.includes(lockDatum.buyer);
        const afterDeadline =
          refLookup.details.invalidBeforeSlot !== null &&
          preprodSlotToPosixMs(refLookup.details.invalidBeforeSlot) > lockDatum.refundDeadlineMs;

        if (!spendsEscrow) {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "fail",
            message: `Refund transaction does not spend escrow UTxO ${receipt.chain.escrow_utxo_ref}.`,
          };
        } else if (!paysBuyer) {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "fail",
            message: "Refund transaction has no output paying the buyer key hash.",
          };
        } else if (!signedByBuyer) {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "fail",
            message: "Refund transaction required_signers does not include the buyer key hash.",
          };
        } else if (!afterDeadline) {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "fail",
            message: "Refund transaction validity range does not start strictly after refund_deadline.",
          };
        } else {
          check5 = {
            check: 5,
            name: "Settlement",
            status: "pass",
            message: "Refund tx confirmed, spends escrow_utxo_ref, pays buyer after refund_deadline, and includes buyer required signer.",
          };
        }
      }
    }
  }
  checks.push(check5);

  // Check 6: Midnight verification (honest boundary per Blueprint §6.8 & T8.3 decision #2).
  checks.push({
    check: 6,
    name: "Midnight eligibility reference",
    status: "pass",
    message:
      "Midnight verification rests on SEYVIXA's signature (independent Midnight proof check is not implemented; issuer is simulated).",
  });

  return {
    verdict: deriveVerdict(checks),
    view: receipt.view,
    checks,
  };
}
