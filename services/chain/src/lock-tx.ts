// T7.3 (Preparation — blocked on Afnan's T6.3 compiled validator/script address and official
// docs/prompts/divejikan/T7.3.md task card for final integration).
// Blueprint Sections 6.2, 6.5, 6.7; Guide Section 4.3 & Section 6 (T7.3); contracts/cardano/DATUM_SPEC.md (T6.2).
//
// Prototype boundary: builds an UNSIGNED Cardano Preprod lock transaction for a buyer-controlled
// prototype escrow (test ADA has no monetary value). Never signs and never submits transactions.
// Does NOT hardcode or invent any validator artifact or script address: both `scriptAddress` and
// the database reader (`db`) are injected by the caller.

import { createHash } from "node:crypto";
import {
  MeshTxBuilder,
  SLOT_CONFIG_NETWORK,
  mConStr0,
  resolvePaymentKeyHash,
  unixTimeToEnclosingSlot,
  type IEvaluator,
  type IFetcher,
  type UTxO,
} from "@meshsdk/core";
import { z } from "zod";

/** Domain tag from Blueprint Section 6.7 & DATUM_SPEC.md Section 1. */
export const ACTION_COMMITMENT_DOMAIN_TAG = "seyvixa-commit-v1";

/** Default short transaction validity window (5 minutes) for P0-6 reconciliation (Blueprint Section 6.2). */
export const DEFAULT_LOCK_TX_TTL_SECONDS = 300;
const MIN_LOCK_TX_TTL_SECONDS = 60;
const MAX_LOCK_TX_TTL_SECONDS = 1800;

const HEX_28_BYTES_RE = /^[0-9a-f]{56}$/;
const HEX_32_BYTES_RE = /^[0-9a-f]{64}$/;
const TADA_6_DECIMALS_RE = /^(0|[1-9]\d{0,11})\.(\d{6})$/;

export type LockTxErrorCode =
  | "INVALID_SCRIPT_ADDRESS"
  | "NETWORK_NOT_TESTNET"
  | "ACTION_NOT_FOUND"
  | "INVALID_ACTION_TYPE"
  | "ACTION_NOT_APPROVED"
  | "ACTION_HASH_MISMATCH"
  | "INVALID_ACTION_PAYLOAD"
  | "MISSING_COMMITMENT_SALT"
  | "OWNER_NOT_FOUND"
  | "OWNER_MISMATCH"
  | "OWNER_KEY_UNREGISTERED"
  | "INVALID_SUPPLIER_ADDRESS"
  | "INVALID_AMOUNT"
  | "INVALID_DEADLINE"
  | "ACTION_EXPIRED"
  | "INVALID_TTL"
  | "INSUFFICIENT_UTXOS"
  | "TX_BUILD_FAILED";

export class LockTxError extends Error {
  readonly code: LockTxErrorCode;

  constructor(code: LockTxErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LockTxError";
    this.code = code;
  }
}

/** Minimal stored `actions` row fields required to build a lock transaction (Blueprint Section 8). */
export interface StoredLockActionRecord {
  readonly id: string;
  readonly owner_id: string;
  readonly action_type: string;
  readonly status: string;
  readonly canonical_payload: string;
  readonly action_hash: string;
  readonly commitment_salt: string | null;
}

/** Minimal stored `users` (owner) row fields required to bind `buyer = payment_key_hash` (Blueprint Section 6.5). */
export interface StoredOwnerRecord {
  readonly id: string;
  readonly owner_address: string | null;
  readonly payment_key_hash: string | null;
}

/** Injectable read-only database adapter for loading stored action and owner state. */
export interface LockTxDataReader {
  getActionById(actionId: string): Promise<StoredLockActionRecord | null>;
  getOwnerById(ownerId: string): Promise<StoredOwnerRecord | null>;
}

/** Minimal MeshTxBuilder surface used by `buildLockTx` (enables deterministic unit testing without live Blockfrost). */
export interface LockTxBuilderLike {
  txOut(address: string, amount: Array<{ unit: string; quantity: string }>): this;
  txOutInlineDatumValue(datum: unknown, type?: "Mesh" | "CBOR" | "JSON"): this;
  changeAddress(address: string): this;
  selectUtxosFrom(extraInputs: UTxO[]): this;
  invalidBefore(slot: number): this;
  invalidHereafter(slot: number): this;
  complete(): Promise<string>;
}

export interface EscrowDatumFields {
  /** 28-byte lowercase hex Ed25519 payment key hash from the owner record. */
  readonly buyer: string;
  /** 28-byte lowercase hex Ed25519 payment key hash for the supplier. */
  readonly supplier: string;
  /** Locked test-ADA amount in lovelace (> 0n). */
  readonly lockedAmountLovelace: bigint;
  /** Refund deadline as POSIXTime in milliseconds (> 0n). */
  readonly refundDeadlineMs: bigint;
  /** 32-byte lowercase hex SHA-256("seyvixa-commit-v1" || action_hash || salt). */
  readonly actionCommitment: string;
}

export interface PreprodValidityWindow {
  readonly invalidBeforeSlot: number;
  readonly invalidAfterSlot: number;
  readonly validUntilIso: string;
}

export interface BuildLockTxDeps {
  /** Injectable Preprod escrow validator script address (`addr_test1...`, from T6.3 once available). */
  readonly scriptAddress: string;
  /** Injectable DB reader for stored approved action and registered owner record. */
  readonly db: LockTxDataReader;
  /** Injectable buyer UTxO lookup (defaults to `fetcher.fetchAddressUTxOs(owner_address)`). */
  readonly getBuyerUtxos?: (ownerAddress: string) => Promise<UTxO[]>;
  /** Optional Mesh fetcher (e.g. `BlockfrostProvider` from T7.1) for default UTxO lookup / MeshTxBuilder. */
  readonly fetcher?: IFetcher;
  /** Optional Mesh evaluator for default MeshTxBuilder. */
  readonly evaluator?: IEvaluator;
  /** Optional builder factory for unit tests; defaults to `new MeshTxBuilder(...)`. */
  readonly createTxBuilder?: () => LockTxBuilderLike;
  /** Optional address-to-key-hash resolver override for unit tests; defaults to Mesh `resolvePaymentKeyHash`. */
  readonly resolveKeyHash?: (address: string) => string;
  /** Optional clock override in Unix ms for deterministic testing (defaults to `Date.now`). */
  readonly nowMs?: () => number;
  /** Short transaction TTL in seconds (60..1800, defaults to 300). */
  readonly ttlSeconds?: number;
}

export interface BuiltLockTx {
  /** Unsigned Cardano transaction CBOR hex (for the wallet to sign; never submitted here). */
  readonly unsignedTxCborHex: string;
  readonly scriptAddress: string;
  readonly datumFields: EscrowDatumFields;
  readonly inlineDatum: ReturnType<typeof mConStr0>;
  readonly invalidBeforeSlot: number;
  readonly invalidAfterSlot: number;
  readonly validUntilIso: string;
}

const storedActionPayloadSchema = z.object({
  procurement_id: z.string().min(1),
  owner_id: z.string().min(1),
  supplier_id: z.string().min(1),
  payee_address: z.string().min(1),
  settlement_asset: z.literal("tADA"),
  escrow_amount_tada: z.string().regex(TADA_6_DECIMALS_RE),
  escrow_script_address: z.string().min(1),
  refund_deadline: z.iso.datetime(),
  expiry: z.iso.datetime(),
  nonce: z.string().min(1),
});

function assertTestnetAddress(address: string, codeOnInvalid: LockTxErrorCode, label: string): string {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    throw new LockTxError(codeOnInvalid, `${label} must not be empty.`);
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("addr1") || lower.startsWith("stake1")) {
    throw new LockTxError(
      "NETWORK_NOT_TESTNET",
      `Refusing Mainnet address for ${label}. Cardano Preprod testnet only (addr_test1...).`,
    );
  }
  if (!lower.startsWith("addr_test1")) {
    throw new LockTxError(
      codeOnInvalid,
      `${label} must be a Cardano Preprod testnet Bech32 address (addr_test1...).`,
    );
  }
  return trimmed;
}

/**
 * Converts a stored `escrow_amount_tada` string with exactly 6 decimals (e.g. `"5.000000"`)
 * into lovelace (`bigint`) using exact integer arithmetic (no floats, no LKR conversion).
 */
export function tadaToLovelace(escrowAmountTada: string): bigint {
  const match = TADA_6_DECIMALS_RE.exec(escrowAmountTada.trim());
  if (!match) {
    throw new LockTxError(
      "INVALID_AMOUNT",
      "escrow_amount_tada must be a positive decimal string with exactly 6 decimals.",
    );
  }
  const whole = BigInt(match[1]);
  const frac = BigInt(match[2]);
  const lovelace = whole * 1_000_000n + frac;
  if (lovelace <= 0n) {
    throw new LockTxError("INVALID_AMOUNT", "escrow_amount_tada must be greater than zero.");
  }
  return lovelace;
}

/**
 * Computes `action_commitment = SHA-256("seyvixa-commit-v1" || action_hash || salt)` as 32-byte
 * lowercase hex per Blueprint Section 6.7 and `contracts/cardano/DATUM_SPEC.md` Section 1.
 *
 * `actionHashHex` and `saltHex` are 32-byte lowercase hex strings decoded to raw bytes before
 * concatenation with the UTF-8 domain tag. The salt stays off-chain (DB and receipt only).
 */
export function computeActionCommitment(actionHashHex: string, saltHex: string): string {
  if (!HEX_32_BYTES_RE.test(actionHashHex)) {
    throw new LockTxError("ACTION_HASH_MISMATCH", "action_hash must be a 32-byte lowercase SHA-256 hex string.");
  }
  if (!HEX_32_BYTES_RE.test(saltHex)) {
    throw new LockTxError("MISSING_COMMITMENT_SALT", "commitment_salt must be a 32-byte lowercase hex string.");
  }

  return createHash("sha256")
    .update(Buffer.from(ACTION_COMMITMENT_DOMAIN_TAG, "utf8"))
    .update(Buffer.from(actionHashHex, "hex"))
    .update(Buffer.from(saltHex, "hex"))
    .digest("hex");
}

/**
 * Builds the exact 5-field Plutus inline datum (`Constr 0 [...]`) specified in
 * `contracts/cardano/DATUM_SPEC.md` using Mesh `@meshsdk/core` `1.9.1` `mConStr0`.
 */
export function buildEscrowInlineDatum(fields: EscrowDatumFields): ReturnType<typeof mConStr0> {
  if (!HEX_28_BYTES_RE.test(fields.buyer)) {
    throw new LockTxError("OWNER_KEY_UNREGISTERED", "buyer must be a 28-byte lowercase hex payment key hash.");
  }
  if (!HEX_28_BYTES_RE.test(fields.supplier)) {
    throw new LockTxError("INVALID_SUPPLIER_ADDRESS", "supplier must be a 28-byte lowercase hex payment key hash.");
  }
  if (fields.lockedAmountLovelace <= 0n) {
    throw new LockTxError("INVALID_AMOUNT", "locked_amount must be greater than 0 lovelace.");
  }
  if (fields.refundDeadlineMs <= 0n) {
    throw new LockTxError("INVALID_DEADLINE", "refund_deadline must be a positive POSIXTime in milliseconds.");
  }
  if (!HEX_32_BYTES_RE.test(fields.actionCommitment)) {
    throw new LockTxError("ACTION_HASH_MISMATCH", "action_commitment must be a 32-byte lowercase hex digest.");
  }

  // Exact field order per DATUM_SPEC.md Section 1:
  // [0: buyer, 1: supplier, 2: locked_amount, 3: refund_deadline, 4: action_commitment]
  return mConStr0([
    fields.buyer,
    fields.supplier,
    fields.lockedAmountLovelace,
    fields.refundDeadlineMs,
    fields.actionCommitment,
  ]);
}

/**
 * Computes a short Cardano Preprod slot validity window (`invalidBefore`..`invalidHereafter`)
 * using Mesh's official `SLOT_CONFIG_NETWORK.preprod` and `unixTimeToEnclosingSlot`.
 */
export function computePreprodValidityWindow(
  nowMs: number,
  ttlSeconds: number = DEFAULT_LOCK_TX_TTL_SECONDS,
): PreprodValidityWindow {
  if (!Number.isFinite(nowMs) || nowMs < SLOT_CONFIG_NETWORK.preprod.zeroTime) {
    throw new LockTxError("INVALID_TTL", "Current timestamp is before Cardano Preprod zeroTime.");
  }
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < MIN_LOCK_TX_TTL_SECONDS ||
    ttlSeconds > MAX_LOCK_TX_TTL_SECONDS
  ) {
    throw new LockTxError(
      "INVALID_TTL",
      `Lock transaction TTL must be an integer between ${String(MIN_LOCK_TX_TTL_SECONDS)} and ${String(MAX_LOCK_TX_TTL_SECONDS)} seconds.`,
    );
  }

  const validUntilMs = nowMs + ttlSeconds * 1000;
  const invalidBeforeSlot = unixTimeToEnclosingSlot(nowMs, SLOT_CONFIG_NETWORK.preprod);
  const invalidAfterSlot = unixTimeToEnclosingSlot(validUntilMs, SLOT_CONFIG_NETWORK.preprod);

  return {
    invalidBeforeSlot,
    invalidAfterSlot,
    validUntilIso: new Date(validUntilMs).toISOString(),
  };
}

/**
 * T7.3 — Builds an UNSIGNED Cardano Preprod escrow lock transaction from stored action and owner
 * records only (Blueprint Sections 6.2, 6.5, 6.7; Guide Section 4.3; `DATUM_SPEC.md`).
 *
 * - Takes `buyer` (`payment_key_hash`) strictly from the registered owner record.
 * - Attaches the 5-field inline datum to the injected Preprod `scriptAddress` output.
 * - Sets a short Preprod validity window (`invalidBefore` / `invalidHereafter`).
 * - Never signs and never submits transactions.
 */
export async function buildLockTx(actionId: string, deps: BuildLockTxDeps): Promise<BuiltLockTx> {
  if (typeof actionId !== "string" || actionId.trim().length === 0) {
    throw new LockTxError("ACTION_NOT_FOUND", "actionId must be a non-empty string.");
  }

  const scriptAddress = assertTestnetAddress(
    deps.scriptAddress,
    "INVALID_SCRIPT_ADDRESS",
    "escrow scriptAddress",
  );

  const action = await deps.db.getActionById(actionId);
  if (action === null) {
    throw new LockTxError("ACTION_NOT_FOUND", `Stored action "${actionId}" was not found.`);
  }
  if (action.action_type !== "ESCROW_LOCK") {
    throw new LockTxError(
      "INVALID_ACTION_TYPE",
      `Expected action_type "ESCROW_LOCK", got "${action.action_type}".`,
    );
  }
  if (action.status !== "APPROVED") {
    throw new LockTxError(
      "ACTION_NOT_APPROVED",
      `Refusing to build lock transaction for action in status "${action.status}" (expected "APPROVED").`,
    );
  }
  if (action.commitment_salt === null || !HEX_32_BYTES_RE.test(action.commitment_salt)) {
    throw new LockTxError(
      "MISSING_COMMITMENT_SALT",
      "Stored action is missing a valid 32-byte lowercase hex commitment_salt.",
    );
  }

  const recomputedHash = createHash("sha256")
    .update(Buffer.from(action.canonical_payload, "utf8"))
    .digest("hex");
  if (recomputedHash !== action.action_hash) {
    throw new LockTxError(
      "ACTION_HASH_MISMATCH",
      "Stored canonical_payload SHA-256 does not match stored action_hash.",
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(action.canonical_payload);
  } catch (err) {
    throw new LockTxError("INVALID_ACTION_PAYLOAD", "Stored canonical_payload is not valid JSON.", {
      cause: err,
    });
  }

  const payloadResult = storedActionPayloadSchema.safeParse(parsedJson);
  if (!payloadResult.success) {
    throw new LockTxError(
      "INVALID_ACTION_PAYLOAD",
      "Stored canonical_payload failed schema validation.",
    );
  }
  const payload = payloadResult.data;

  if (payload.owner_id !== action.owner_id) {
    throw new LockTxError("OWNER_MISMATCH", "Stored payload owner_id does not match action owner_id.");
  }
  if (payload.escrow_script_address !== scriptAddress) {
    throw new LockTxError(
      "INVALID_SCRIPT_ADDRESS",
      "Injected scriptAddress does not match stored payload escrow_script_address.",
    );
  }

  const nowMs = (deps.nowMs ?? Date.now)();
  const expiryMs = Date.parse(payload.expiry);
  if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) {
    throw new LockTxError("ACTION_EXPIRED", "Stored action approval expiry has passed.");
  }

  const refundDeadlineMsNum = Date.parse(payload.refund_deadline);
  if (!Number.isFinite(refundDeadlineMsNum) || refundDeadlineMsNum <= nowMs) {
    throw new LockTxError("INVALID_DEADLINE", "Stored refund_deadline must be in the future.");
  }

  const owner = await deps.db.getOwnerById(action.owner_id);
  if (owner === null) {
    throw new LockTxError("OWNER_NOT_FOUND", `Registered owner "${action.owner_id}" was not found.`);
  }
  if (
    owner.payment_key_hash === null ||
    !HEX_28_BYTES_RE.test(owner.payment_key_hash) ||
    owner.owner_address === null
  ) {
    throw new LockTxError(
      "OWNER_KEY_UNREGISTERED",
      "Owner record is missing a registered testnet owner_address or 28-byte payment_key_hash.",
    );
  }

  const ownerAddress = assertTestnetAddress(
    owner.owner_address,
    "OWNER_KEY_UNREGISTERED",
    "owner_address",
  );
  const supplierAddress = assertTestnetAddress(
    payload.payee_address,
    "INVALID_SUPPLIER_ADDRESS",
    "payee_address",
  );

  const resolveKeyHash = deps.resolveKeyHash ?? resolvePaymentKeyHash;

  let ownerDerivedKeyHash: string;
  try {
    ownerDerivedKeyHash = resolveKeyHash(ownerAddress).toLowerCase();
  } catch (err) {
    throw new LockTxError(
      "OWNER_KEY_UNREGISTERED",
      "Failed to resolve payment key hash from registered owner_address.",
      { cause: err },
    );
  }
  if (ownerDerivedKeyHash !== owner.payment_key_hash) {
    throw new LockTxError(
      "OWNER_KEY_UNREGISTERED",
      "Registered owner_address payment key hash does not match owner.payment_key_hash.",
    );
  }

  let supplierKeyHash: string;
  try {
    supplierKeyHash = resolveKeyHash(supplierAddress).toLowerCase();
  } catch (err) {
    throw new LockTxError(
      "INVALID_SUPPLIER_ADDRESS",
      "Failed to resolve supplier payment key hash from stored payee_address.",
      { cause: err },
    );
  }

  const lockedAmountLovelace = tadaToLovelace(payload.escrow_amount_tada);
  const refundDeadlineMs = BigInt(Math.trunc(refundDeadlineMsNum));
  const actionCommitment = computeActionCommitment(action.action_hash, action.commitment_salt);

  const datumFields: EscrowDatumFields = {
    buyer: owner.payment_key_hash,
    supplier: supplierKeyHash,
    lockedAmountLovelace,
    refundDeadlineMs,
    actionCommitment,
  };
  const inlineDatum = buildEscrowInlineDatum(datumFields);
  const validity = computePreprodValidityWindow(nowMs, deps.ttlSeconds);

  const getBuyerUtxos =
    deps.getBuyerUtxos ??
    (deps.fetcher !== undefined
      ? (addr: string) => deps.fetcher!.fetchAddressUTxOs(addr)
      : undefined);

  if (getBuyerUtxos === undefined) {
    throw new LockTxError(
      "INSUFFICIENT_UTXOS",
      "No UTxO fetcher configured (provide deps.getBuyerUtxos or deps.fetcher).",
    );
  }

  const buyerUtxos = await getBuyerUtxos(ownerAddress);
  if (!Array.isArray(buyerUtxos) || buyerUtxos.length === 0) {
    throw new LockTxError(
      "INSUFFICIENT_UTXOS",
      "Buyer testnet address has no spendable UTxOs to fund the escrow lock transaction.",
    );
  }

  const txBuilder =
    deps.createTxBuilder?.() ??
    new MeshTxBuilder({
      fetcher: deps.fetcher,
      evaluator: deps.evaluator,
      verbose: false,
    });

  let unsignedTxCborHex: string;
  try {
    unsignedTxCborHex = await txBuilder
      .txOut(scriptAddress, [{ unit: "lovelace", quantity: lockedAmountLovelace.toString() }])
      .txOutInlineDatumValue(inlineDatum, "Mesh")
      .changeAddress(ownerAddress)
      .selectUtxosFrom(buyerUtxos)
      .invalidBefore(validity.invalidBeforeSlot)
      .invalidHereafter(validity.invalidAfterSlot)
      .complete();
  } catch (err) {
    throw new LockTxError("TX_BUILD_FAILED", "Failed to build unsigned escrow lock transaction.", {
      cause: err,
    });
  }

  if (typeof unsignedTxCborHex !== "string" || !/^[0-9a-fA-F]+$/.test(unsignedTxCborHex) || unsignedTxCborHex.length % 2 !== 0) {
    throw new LockTxError("TX_BUILD_FAILED", "Transaction builder returned invalid unsigned CBOR hex.");
  }

  return {
    unsignedTxCborHex,
    scriptAddress,
    datumFields,
    inlineDatum,
    invalidBeforeSlot: validity.invalidBeforeSlot,
    invalidAfterSlot: validity.invalidAfterSlot,
    validUntilIso: validity.validUntilIso,
  };
}
