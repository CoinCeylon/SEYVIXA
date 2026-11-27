// T8.3 & T8.3b — Standalone receipt verifier core (Blueprint Section 6.5, 6.8; Section 9 item 12).
// Verifies a SEYVIXA receipt without trusting the web app or database.
//
// Security guarantees (T8.3b):
// - Check 1 stops immediately on failure (pinned Ed25519 receipt key, kid, schema, signature).
// - Check 2 verifies CIP-30 `signData` (COSE_Sign1 + COSE_Key) using pinned `@meshsdk/core` 1.9.1
//   `checkSignature` (Blake2b-224 key hash + COSE Sig_structure Ed25519 signature) AND verifies the
//   COSE_Sign1 protected header (`alg === -8` EdDSA and `address` payment credential === `owner_key_hash`).
// - `owner_key_hash` MUST equal `onChainDatum.buyer` (otherwise REJECTED, unless exact fallback label
//   is present, in which case Check 2 reports a distinct fallback status shown on the verdict line).
// - Reuses `computeActionCommitment` from `services/chain/src/lock-tx.ts` (read-only).
// - Full view cross-checks `approved_action` against chain evidence (script, payee, amount, deadline).
// - Shallow/unconfirmed transactions give UNVERIFIABLE ("not yet confirmed to the required depth");
//   404 not_found gives REJECTED. UNVERIFIABLE is never reported as VERIFIED.

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSignature } from "@meshsdk/core";
import { canonicalize } from "../../../packages/shared/src/canonical.ts";
import { actionHash } from "../../../packages/shared/src/hash.ts";
import { validateReceiptV0 } from "../../../schemas/validate-receipt-v0.mjs";
import { computeActionCommitment, tadaToLovelace } from "../../../services/chain/src/lock-tx.ts";
import {
  createBlockfrostChainReader,
  decodeEscrowInlineDatumCbor,
  encodeTestnetEnterpriseAddress,
  extractTestnetPaymentKeyHash,
  extractTestnetPaymentKeyHashFromBytes,
  preprodSlotToPosixMs,
  type ParsedEscrowDatum,
  type VerifierChainReader,
} from "./chain-reader.ts";

export { computeActionCommitment };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_PUBLIC_KEY_PATH = path.join(REPO_ROOT, "keys/receipt-signing-public.json");

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX_64_RE = /^[0-9a-f]{64}$/;
const EVEN_LOWER_HEX_RE = /^([0-9a-f]{2})+$/;
const APPROVAL_DOMAIN_TAG = "seyvixa-approval-v1";
export const FALLBACK_APPROVAL_LABEL = "approval key not bound to escrow buyer key (fallback)";
export const FALLBACK_CHECK2_STATUS = "pass (fallback: approval key not bound to escrow buyer key)" as const;
export const MIDNIGHT_HONEST_NOTE =
  "Midnight verification rests on SEYVIXA's signature (independent Midnight proof check is not implemented; issuer is simulated).";

const EMBEDDED_KEY_FIELDS = new Set([
  "public_key",
  "publicKey",
  "pubkey",
  "jwk",
  "algorithm",
  "alg",
]);

export type Verdict = "VERIFIED" | "REJECTED" | "UNVERIFIABLE";
export type CheckStatus = "pass" | typeof FALLBACK_CHECK2_STATUS | "fail" | "unverifiable";

export interface CheckResult {
  readonly check: number;
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

export interface VerificationReport {
  readonly verdict: Verdict;
  readonly view: "full" | "verification" | "unknown";
  readonly fallbackLabel: string | null;
  readonly midnightNote: string;
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
  readonly key: string;
  readonly ownerKeyHash: string;
  readonly fallbackLabel?: string;
}) => Promise<boolean> | boolean;

export interface VerifyReceiptDeps {
  /** Optional public key path override for unit tests (CLI always uses DEFAULT_PUBLIC_KEY_PATH). */
  readonly publicKeyPath?: string;
  /** Optional already-loaded public key JSON object for unit tests. */
  readonly publicKeyDoc?: unknown;
  /** Chain reader adapter (defaults to Blockfrost Preprod reader using services/chain T7.1 config). */
  readonly chainReader?: VerifierChainReader;
  /** Optional owner approval verifier override for unit tests; defaults to CIP-30 COSE_Sign1 verifier. */
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
  approved_action?: {
    procurement_id: string;
    owner_id: string;
    supplier_id: string;
    payee_address: string;
    items: Array<{ description: string; quantity: number }>;
    total_lkr: string;
    settlement_asset: "tADA";
    escrow_amount_tada: string;
    escrow_script_address: string;
    refund_deadline: string;
    expiry: string;
    nonce: string;
  };
  action_hash: string;
  approval: {
    nonce: string;
    expires_at: string;
    owner_key_hash: string;
    signature: string;
    key: string;
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
 * Parses the COSE_Sign1 protected header map to extract `alg` (header label 1, must be -8 for EdDSA)
 * and `"address"` (CIP-8 raw Cardano address bytes). Fails closed on malformed CBOR.
 */
export function inspectCoseSign1ProtectedHeader(
  coseSign1Hex: string,
): { readonly alg: number | null; readonly addressBytes: Uint8Array | null } | null {
  if (!EVEN_LOWER_HEX_RE.test(coseSign1Hex)) return null;
  const buf = Buffer.from(coseSign1Hex, "hex");
  let offset = 0;

  function readUint(ai: number, src: Buffer, state: { o: number }): number | null {
    if (ai < 24) return ai;
    if (ai === 24 && state.o + 1 <= src.length) {
      const v = src[state.o];
      state.o += 1;
      return v;
    }
    if (ai === 25 && state.o + 2 <= src.length) {
      const v = src.readUInt16BE(state.o);
      state.o += 2;
      return v;
    }
    if (ai === 26 && state.o + 4 <= src.length) {
      const v = src.readUInt32BE(state.o);
      state.o += 4;
      return v;
    }
    return null;
  }

  function skipItem(src: Buffer, state: { o: number }): boolean {
    if (state.o >= src.length) return false;
    const head = src[state.o];
    state.o += 1;
    const major = head >>> 5;
    const ai = head & 0x1f;
    if (major === 0 || major === 1) return readUint(ai, src, state) !== null;
    if (major === 2 || major === 3) {
      const len = readUint(ai, src, state);
      if (len === null || state.o + len > src.length) return false;
      state.o += len;
      return true;
    }
    if (major === 4) {
      const len = readUint(ai, src, state);
      if (len === null) return false;
      for (let i = 0; i < len; i += 1) if (!skipItem(src, state)) return false;
      return true;
    }
    if (major === 5) {
      const len = readUint(ai, src, state);
      if (len === null) return false;
      for (let i = 0; i < len; i += 1) {
        if (!skipItem(src, state) || !skipItem(src, state)) return false;
      }
      return true;
    }
    if (major === 6) {
      if (readUint(ai, src, state) === null) return false;
      return skipItem(src, state);
    }
    if (major === 7) return ai < 24 || readUint(ai, src, state) !== null;
    return false;
  }

  // Optional CBOR tag 18 (COSE_Sign1) followed by 4-element array (0x84).
  const root = { o: offset };
  if (root.o >= buf.length) return null;
  if ((buf[root.o] >>> 5) === 6) {
    const tagAi = buf[root.o] & 0x1f;
    root.o += 1;
    const tag = readUint(tagAi, buf, root);
    if (tag !== 18) return null;
  }
  if (root.o >= buf.length || buf[root.o] !== 0x84) return null;
  root.o += 1;

  // Element 0: protected header byte string (major 2).
  if (root.o >= buf.length || (buf[root.o] >>> 5) !== 2) return null;
  const protAi = buf[root.o] & 0x1f;
  root.o += 1;
  const protLen = readUint(protAi, buf, root);
  if (protLen === null || protLen === 0 || root.o + protLen > buf.length) return null;
  const protBuf = buf.subarray(root.o, root.o + protLen);

  // Decode protected header CBOR map (major 5).
  const mapState = { o: 0 };
  if ((protBuf[mapState.o] >>> 5) !== 5) return null;
  const mapAi = protBuf[mapState.o] & 0x1f;
  mapState.o += 1;
  const entryCount = readUint(mapAi, protBuf, mapState);
  if (entryCount === null) return null;

  let alg: number | null = null;
  let addressBytes: Uint8Array | null = null;

  for (let i = 0; i < entryCount; i += 1) {
    if (mapState.o >= protBuf.length) return null;
    const keyHead = protBuf[mapState.o];
    const keyMajor = keyHead >>> 5;
    const keyAi = keyHead & 0x1f;

    if (keyMajor === 0) {
      mapState.o += 1;
      const k = readUint(keyAi, protBuf, mapState);
      if (k === null) return null;
      if (k === 1) {
        // COSE alg header: EdDSA is -8 (major 1, value 7 -> -1 - 7 = -8).
        if (mapState.o >= protBuf.length) return null;
        const valHead = protBuf[mapState.o];
        const valMajor = valHead >>> 5;
        const valAi = valHead & 0x1f;
        mapState.o += 1;
        const rawVal = readUint(valAi, protBuf, mapState);
        if (rawVal === null) return null;
        if (valMajor === 1) alg = -1 - rawVal;
        else if (valMajor === 0) alg = rawVal;
        else return null;
      } else {
        if (!skipItem(protBuf, mapState)) return null;
      }
    } else if (keyMajor === 3) {
      mapState.o += 1;
      const kLen = readUint(keyAi, protBuf, mapState);
      if (kLen === null || mapState.o + kLen > protBuf.length) return null;
      const kStr = protBuf.subarray(mapState.o, mapState.o + kLen).toString("utf8");
      mapState.o += kLen;
      if (kStr === "address") {
        if (mapState.o >= protBuf.length || (protBuf[mapState.o] >>> 5) !== 2) return null;
        const vAi = protBuf[mapState.o] & 0x1f;
        mapState.o += 1;
        const vLen = readUint(vAi, protBuf, mapState);
        if (vLen === null || mapState.o + vLen > protBuf.length) return null;
        addressBytes = new Uint8Array(protBuf.subarray(mapState.o, mapState.o + vLen));
        mapState.o += vLen;
      } else {
        if (!skipItem(protBuf, mapState)) return null;
      }
    } else {
      if (!skipItem(protBuf, mapState) || !skipItem(protBuf, mapState)) return null;
    }
  }

  return { alg, addressBytes };
}

/**
 * Verifies a CIP-30 `signData` (CIP-8 COSE_Sign1 + COSE_Key) owner approval using pinned
 * `@meshsdk/core` 1.9.1 `checkSignature` plus COSE_Sign1 protected header validation
 * (`alg === -8` EdDSA and protected `"address"` payment credential === `ownerKeyHash`).
 *
 * Security (T8.3b): The COSE_Key is NEVER trusted on its own. Passing the enterprise address
 * derived from `ownerKeyHash` into Mesh's `checkSignature` enforces:
 *   Blake2b-224(pubKeyFromCoseKey) === ownerKeyHash
 * and verifies the Ed25519 signature over the COSE Sig_structure for the exact canonical message.
 */
export async function verifyCip30OwnerApproval(input: {
  readonly payload: ApprovalSignaturePayload;
  readonly signature: string;
  readonly key: string;
  readonly ownerKeyHash: string;
  readonly fallbackLabel?: string;
}): Promise<boolean> {
  if (
    !EVEN_LOWER_HEX_RE.test(input.signature) ||
    !EVEN_LOWER_HEX_RE.test(input.key) ||
    !/^[0-9a-f]{56}$/.test(input.ownerKeyHash)
  ) {
    return false;
  }

  // Step 1 & 5 (Blueprint §6.5): protected header must declare EdDSA (-8) and carry an address
  // whose Shelley testnet payment key hash equals `ownerKeyHash`.
  const header = inspectCoseSign1ProtectedHeader(input.signature);
  if (header === null || header.alg !== -8 || header.addressBytes === null) {
    return false;
  }
  const headerKeyHash = extractTestnetPaymentKeyHashFromBytes(header.addressBytes);
  if (headerKeyHash !== input.ownerKeyHash) {
    return false;
  }

  // Step 2 & 4 (Blueprint §6.5): Mesh `checkSignature` extracts the 32-byte Ed25519 key from COSE_Key,
  // computes Blake2b-224(pubKey), checks it against `expectedEnterpriseAddr` (i.e. === ownerKeyHash),
  // checks payload bytes === canonicalApprovalJson, and verifies Ed25519 over COSE Sig_structure.
  try {
    const expectedEnterpriseAddr = encodeTestnetEnterpriseAddress(input.ownerKeyHash);
    const canonicalMessage = canonicalize(input.payload);
    return await checkSignature(
      canonicalMessage,
      { key: input.key, signature: input.signature },
      expectedEnterpriseAddr,
    );
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

function crossCheckFullViewApprovedAction(
  receipt: ReceiptShape,
  lockDatum: ParsedEscrowDatum,
): string | null {
  const act = receipt.approved_action;
  if (act === undefined) return "Full-view receipt is missing approved_action.";

  if (actionHash(act) !== receipt.action_hash) {
    return "Full-view recomputed action_hash does not match receipt action_hash.";
  }
  if (act.escrow_script_address !== receipt.chain.script_address) {
    return "Full-view approved_action.escrow_script_address does not match receipt chain.script_address.";
  }
  const payeeKeyHash = extractTestnetPaymentKeyHash(act.payee_address);
  if (payeeKeyHash === null || payeeKeyHash !== lockDatum.supplier) {
    return "Full-view approved_action.payee_address does not match on-chain datum supplier key hash.";
  }
  try {
    const approvedLovelace = tadaToLovelace(act.escrow_amount_tada);
    if (approvedLovelace !== BigInt(receipt.chain.locked_lovelace)) {
      return "Full-view approved_action.escrow_amount_tada does not match receipt chain.locked_lovelace.";
    }
  } catch {
    return "Full-view approved_action.escrow_amount_tada is invalid.";
  }
  const approvedDeadlineMs = Date.parse(act.refund_deadline);
  if (!Number.isFinite(approvedDeadlineMs) || BigInt(approvedDeadlineMs) !== lockDatum.refundDeadlineMs) {
    return "Full-view approved_action.refund_deadline does not match on-chain datum refund_deadline.";
  }
  return null;
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
    return { verdict: "REJECTED", view: "unknown", fallbackLabel: null, midnightNote: MIDNIGHT_HONEST_NOTE, checks };
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
    return { verdict: "REJECTED", view: "unknown", fallbackLabel: null, midnightNote: MIDNIGHT_HONEST_NOTE, checks };
  }

  // Check 1b: Basic object check + reject embedded public key or unknown kid before schema check.
  if (receiptInput === null || typeof receiptInput !== "object" || Array.isArray(receiptInput)) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: "Receipt must be a JSON object.",
    });
    return { verdict: "REJECTED", view: "unknown", fallbackLabel: null, midnightNote: MIDNIGHT_HONEST_NOTE, checks };
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
    return { verdict: "REJECTED", view, fallbackLabel: null, midnightNote: MIDNIGHT_HONEST_NOTE, checks };
  }

  if (rawReceipt.kid !== keyResult.kid) {
    checks.push({
      check: 1,
      name: "Trusted key, schema & receipt signature",
      status: "fail",
      message: `Unknown or mismatched receipt kid (expected "${keyResult.kid}").`,
    });
    return { verdict: "REJECTED", view, fallbackLabel: null, midnightNote: MIDNIGHT_HONEST_NOTE, checks };
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
    return { verdict: "REJECTED", view, fallbackLabel: null, midnightNote: MIDNIGHT_HONEST_NOTE, checks };
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
    return { verdict: "REJECTED", view: receipt.view, fallbackLabel: null, midnightNote: MIDNIGHT_HONEST_NOTE, checks };
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
    } else if (lockLookup.kind === "not_confirmed_depth") {
      lockCheck = {
        check: 3,
        name: "Lock transaction & inline datum",
        status: "unverifiable",
        message: "Lock transaction not yet confirmed to the required depth.",
      };
    } else if (lockLookup.kind === "not_found") {
      lockCheck = {
        check: 3,
        name: "Lock transaction & inline datum",
        status: "fail",
        message: "Lock transaction was not found on Preprod (404).",
      };
    } else if (lockLookup.kind === "invalid_contract") {
      lockCheck = {
        check: 3,
        name: "Lock transaction & inline datum",
        status: "fail",
        message: lockLookup.reason,
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

  // Check 2: Owner CIP-30 COSE_Sign1 approval, key-hash binding, and full-view cross-checks.
  const approvalVerifier = deps.verifyOwnerApproval ?? verifyCip30OwnerApproval;
  const approvalPayload: ApprovalSignaturePayload = {
    domain: APPROVAL_DOMAIN_TAG,
    action_hash: receipt.action_hash,
    nonce: receipt.approval.nonce,
    expires_at: receipt.approval.expires_at,
  };

  let fallbackLabel: string | null = null;
  let check2: CheckResult;
  const approvalSigOk = await approvalVerifier({
    payload: approvalPayload,
    signature: receipt.approval.signature,
    key: receipt.approval.key,
    ownerKeyHash: receipt.approval.owner_key_hash,
    fallbackLabel: receipt.approval.fallback_label,
  });

  if (!approvalSigOk) {
    check2 = {
      check: 2,
      name: "Owner approval & action hash",
      status: "fail",
      message: "Owner CIP-30 COSE_Sign1 approval signature or key-hash binding failed.",
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
  } else if (lockDatum === null) {
    check2 = {
      check: 2,
      name: "Owner approval & action hash",
      status: lockCheck.status === "unverifiable" ? "unverifiable" : "fail",
      message:
        lockCheck.status === "unverifiable"
          ? "Cannot confirm owner_key_hash === on-chain buyer key hash while lock tx is unverifiable."
          : "Cannot confirm owner_key_hash === on-chain buyer key hash because lock datum check failed.",
    };
  } else {
    const fullViewMismatch =
      receipt.view === "full" ? crossCheckFullViewApprovedAction(receipt, lockDatum) : null;
    if (fullViewMismatch !== null) {
      check2 = {
        check: 2,
        name: "Owner approval & action hash",
        status: "fail",
        message: fullViewMismatch,
      };
    } else if (receipt.approval.fallback_label === FALLBACK_APPROVAL_LABEL) {
      fallbackLabel = FALLBACK_APPROVAL_LABEL;
      check2 = {
        check: 2,
        name: "Owner approval & action hash",
        status: FALLBACK_CHECK2_STATUS,
        message: `Owner approval signature verified (${FALLBACK_APPROVAL_LABEL}).`,
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
            ? "Owner COSE_Sign1 approval, full-view action_hash + chain cross-checks, and owner_key_hash === datum.buyer verified."
            : "Owner COSE_Sign1 approval and owner_key_hash === datum.buyer verified (verification view).",
      };
    }
  }

  checks.push(check2);
  checks.push(lockCheck);

  // Check 4: Action commitment matches on-chain datum (using services/chain computeActionCommitment).
  let check4: CheckResult;
  if (lockDatum === null) {
    check4 = {
      check: 4,
      name: "Action commitment",
      status: lockCheck.status === "unverifiable" ? "unverifiable" : "fail",
      message:
        lockCheck.status === "unverifiable"
          ? "Cannot verify action commitment while lock tx is unverifiable."
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
          ? "Cannot verify settlement while lock tx is unverifiable."
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
      } else if (relLookup.kind === "not_confirmed_depth") {
        check5 = {
          check: 5,
          name: "Settlement",
          status: "unverifiable",
          message: "Release transaction not yet confirmed to the required depth.",
        };
      } else if (relLookup.kind === "not_found") {
        check5 = {
          check: 5,
          name: "Settlement",
          status: "fail",
          message: "Release transaction was not found on Preprod (404).",
        };
      } else if (relLookup.kind === "invalid_contract") {
        check5 = { check: 5, name: "Settlement", status: "fail", message: relLookup.reason };
      } else {
        // T8.3b Blocker 4: only count real spend inputs (collateral === false && reference === false).
        const spendsEscrow =
          utxoRef !== null &&
          relLookup.details.inputs.some(
            (i) => i.isSpendInput && i.txHash === utxoRef.txHash && i.outputIndex === utxoRef.outputIndex,
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
      } else if (refLookup.kind === "not_confirmed_depth") {
        check5 = {
          check: 5,
          name: "Settlement",
          status: "unverifiable",
          message: "Refund transaction not yet confirmed to the required depth.",
        };
      } else if (refLookup.kind === "not_found") {
        check5 = {
          check: 5,
          name: "Settlement",
          status: "fail",
          message: "Refund transaction was not found on Preprod (404).",
        };
      } else if (refLookup.kind === "invalid_contract") {
        check5 = { check: 5, name: "Settlement", status: "fail", message: refLookup.reason };
      } else {
        const spendsEscrow =
          utxoRef !== null &&
          refLookup.details.inputs.some(
            (i) => i.isSpendInput && i.txHash === utxoRef.txHash && i.outputIndex === utxoRef.outputIndex,
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

  // Check 6: Midnight verification (honest boundary per Blueprint §6.8 & T8.3b Step 11).
  checks.push({
    check: 6,
    name: "Midnight eligibility reference",
    status: "pass",
    message: MIDNIGHT_HONEST_NOTE,
  });

  return {
    verdict: deriveVerdict(checks),
    view: receipt.view,
    fallbackLabel,
    midnightNote: MIDNIGHT_HONEST_NOTE,
    checks,
  };
}
