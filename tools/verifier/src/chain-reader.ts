// T8.3 & T8.3b — Cardano Preprod chain reader for `tools/verifier` (Blueprint Section 6.8).
// Reuses `getTxStatus` and `loadChainConfig` from `services/chain` (T7.1, read-only) so the
// verifier uses the exact same Blockfrost Preprod configuration and confirmation depth rules.
//
// Official Blockfrost OpenAPI field references (https://docs.blockfrost.io/):
//   GET /txs/{hash}                  -> valid_contract (boolean), invalid_before (string|null)
//   GET /txs/{hash}/utxos            -> inputs[]: { tx_hash, output_index, collateral: boolean, reference: boolean }
//                                       outputs[]: { address, output_index, amount[], inline_datum }
//   GET /txs/{hash}/required_signers -> Array<{ witness_hash: string }>
//
// Security rules (T8.3b):
// - Pin `witness_hash` only for required signers (never accept `hash`).
// - Only count inputs with `collateral === false && reference === false` (fail closed if missing).
// - Any malformed/null 200 response gives `unverifiable`, never a thrown error.
// - Found-but-shallow transactions give `not_confirmed_depth` (-> UNVERIFIABLE);
//   404 `not_found` gives `not_found` (-> REJECTED).
// - Never logs or returns API keys. Never submits transactions.

import { SLOT_CONFIG_NETWORK, slotToBeginUnixTime } from "@meshsdk/core";
import { loadChainConfig, type ChainConfig } from "../../../services/chain/src/config.ts";
import { getTxStatus, type TxStatus } from "../../../services/chain/src/tx-status.ts";

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_MAP = new Map<string, number>([...BECH32_CHARSET].map((c, i) => [c, i]));
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;

export interface ParsedEscrowDatum {
  readonly buyer: string;
  readonly supplier: string;
  readonly lockedAmountLovelace: bigint;
  readonly refundDeadlineMs: bigint;
  readonly actionCommitment: string;
}

export interface ChainTxInput {
  readonly txHash: string;
  readonly outputIndex: number;
  /** True only when Blockfrost explicitly reports `collateral === false && reference === false`. */
  readonly isSpendInput: boolean;
}

export interface ChainTxOutput {
  readonly address: string;
  readonly outputIndex: number;
  readonly lovelace: bigint;
  readonly inlineDatumHex: string | null;
}

export interface ChainTxDetails {
  readonly txHash: string;
  readonly validContract: boolean;
  readonly invalidBeforeSlot: bigint | null;
  readonly inputs: readonly ChainTxInput[];
  readonly outputs: readonly ChainTxOutput[];
  readonly requiredSigners: readonly string[];
}

export type ChainTxLookupResult =
  | { readonly kind: "ok"; readonly status: TxStatus; readonly details: ChainTxDetails }
  | { readonly kind: "not_confirmed_depth"; readonly status: TxStatus }
  | { readonly kind: "not_found"; readonly status: TxStatus }
  | { readonly kind: "invalid_contract"; readonly reason: string }
  | { readonly kind: "unverifiable"; readonly reason: string };

export interface VerifierChainReader {
  getTransaction(txHash: string): Promise<ChainTxLookupResult>;
}

/**
 * Converts a Cardano Preprod slot number to POSIXTime in milliseconds using Mesh's
 * official `SLOT_CONFIG_NETWORK.preprod` and `slotToBeginUnixTime`.
 */
export function preprodSlotToPosixMs(slot: bigint): bigint {
  const slotNum = Number(slot);
  if (!Number.isSafeInteger(slotNum) || slotNum < 0) {
    throw new RangeError("Preprod slot must be a non-negative safe integer.");
  }
  return BigInt(slotToBeginUnixTime(slotNum, SLOT_CONFIG_NETWORK.preprod));
}

function bech32Polymod(values: readonly number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i += 1) {
      if (((top >>> i) & 1) !== 0) chk ^= BECH32_GENERATORS[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/**
 * Encodes a 28-byte lowercase hex payment key hash as a Cardano Preprod enterprise Bech32 address (`addr_test1v...`).
 */
export function encodeTestnetEnterpriseAddress(paymentKeyHashHex: string): string {
  if (!/^[0-9a-f]{56}$/.test(paymentKeyHashHex)) {
    throw new Error("paymentKeyHashHex must be 56 lowercase hex characters.");
  }
  const bytes = Buffer.concat([Buffer.from([0x60]), Buffer.from(paymentKeyHashHex, "hex")]);
  let acc = 0;
  let bits = 0;
  const words: number[] = [];
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);

  const hrp = "addr_test";
  const mod = bech32Polymod([...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i += 1) checksum.push((mod >>> (5 * (5 - i))) & 31);

  let out = `${hrp}1`;
  for (const w of [...words, ...checksum]) out += BECH32_CHARSET[w];
  return out;
}

/**
 * Extracts the 28-byte lowercase hex payment key hash from raw CIP-19 Shelley testnet key-hash address bytes.
 * Returns `null` if not a Shelley testnet key-hash payment address.
 */
export function extractTestnetPaymentKeyHashFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 29) return null;
  const header = bytes[0];
  const addrType = (header >>> 4) & 0x0f;
  const networkTag = header & 0x0f;
  // Shelley payment key-hash addresses have even types 0x0, 0x2, 0x4, 0x6 and testnet tag 0.
  if (networkTag !== 0 || addrType > 0x07 || (addrType & 1) !== 0) return null;
  return Buffer.from(bytes.subarray(1, 29)).toString("hex");
}

/**
 * Extracts the 28-byte lowercase hex payment key hash from a Cardano Preprod Bech32 address (`addr_test1...`).
 * Returns `null` if the address is not a valid Shelley testnet key-hash payment address.
 */
export function extractTestnetPaymentKeyHash(bech32Address: string): string | null {
  const trimmed = bech32Address.trim();
  if (trimmed.length < 16) return null;
  const hasLower = /[a-z]/.test(trimmed);
  const hasUpper = /[A-Z]/.test(trimmed);
  if (hasLower && hasUpper) return null;

  const lower = trimmed.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) return null;

  const hrp = lower.slice(0, sep);
  if (hrp !== "addr_test") return null;

  const dataStr = lower.slice(sep + 1);
  const words: number[] = [];
  for (const ch of dataStr) {
    const val = BECH32_MAP.get(ch);
    if (val === undefined) return null;
    words.push(val);
  }

  if (bech32Polymod([...bech32HrpExpand(hrp), ...words]) !== 1) return null;

  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words.slice(0, -6)) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) return null;

  return extractTestnetPaymentKeyHashFromBytes(new Uint8Array(out));
}

/**
 * Decodes a Plutus `Constr 0 [buyer, supplier, locked_amount, refund_deadline, action_commitment]`
 * CBOR hex inline datum per `contracts/cardano/DATUM_SPEC.md`.
 */
export function decodeEscrowInlineDatumCbor(cborHex: string): ParsedEscrowDatum | null {
  if (typeof cborHex !== "string" || cborHex.length === 0 || cborHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cborHex)) {
    return null;
  }
  const buf = Buffer.from(cborHex, "hex");
  let offset = 0;

  function readUint(additionalInfo: number): bigint | null {
    if (additionalInfo < 24) return BigInt(additionalInfo);
    if (additionalInfo === 24 && offset + 1 <= buf.length) {
      const v = BigInt(buf[offset]);
      offset += 1;
      return v;
    }
    if (additionalInfo === 25 && offset + 2 <= buf.length) {
      const v = BigInt(buf.readUInt16BE(offset));
      offset += 2;
      return v;
    }
    if (additionalInfo === 26 && offset + 4 <= buf.length) {
      const v = BigInt(buf.readUInt32BE(offset));
      offset += 4;
      return v;
    }
    if (additionalInfo === 27 && offset + 8 <= buf.length) {
      const v = buf.readBigUInt64BE(offset);
      offset += 8;
      return v;
    }
    return null;
  }

  function readBytes(): Buffer | null {
    if (offset >= buf.length) return null;
    const head = buf[offset];
    offset += 1;
    const major = head >>> 5;
    const ai = head & 0x1f;
    if (major !== 2) return null;
    const len = readUint(ai);
    if (len === null || len > 1024n) return null;
    const n = Number(len);
    if (offset + n > buf.length) return null;
    const slice = buf.subarray(offset, offset + n);
    offset += n;
    return slice;
  }

  function readPositiveInt(): bigint | null {
    if (offset >= buf.length) return null;
    const head = buf[offset];
    offset += 1;
    const major = head >>> 5;
    const ai = head & 0x1f;
    if (major !== 0) return null;
    const val = readUint(ai);
    if (val === null || val <= 0n) return null;
    return val;
  }

  if (offset >= buf.length) return null;
  const tagHead = buf[offset];
  offset += 1;
  if ((tagHead >>> 5) !== 6) return null;
  const tagNum = readUint(tagHead & 0x1f);
  if (tagNum !== 121n) return null;

  if (offset >= buf.length) return null;
  const arrHead = buf[offset];
  offset += 1;
  if ((arrHead >>> 5) !== 4) return null;
  const arrAi = arrHead & 0x1f;
  const isIndefinite = arrAi === 31;
  if (!isIndefinite) {
    const arrLen = readUint(arrAi);
    if (arrLen !== 5n) return null;
  }

  const buyerBytes = readBytes();
  const supplierBytes = readBytes();
  const lockedAmountLovelace = readPositiveInt();
  const refundDeadlineMs = readPositiveInt();
  const commitmentBytes = readBytes();

  if (
    buyerBytes === null ||
    buyerBytes.length !== 28 ||
    supplierBytes === null ||
    supplierBytes.length !== 28 ||
    lockedAmountLovelace === null ||
    refundDeadlineMs === null ||
    commitmentBytes === null ||
    commitmentBytes.length !== 32
  ) {
    return null;
  }

  if (isIndefinite) {
    if (offset >= buf.length || buf[offset] !== 0xff) return null;
    offset += 1;
  }

  if (offset !== buf.length) return null;

  return {
    buyer: buyerBytes.toString("hex"),
    supplier: supplierBytes.toString("hex"),
    lockedAmountLovelace,
    refundDeadlineMs,
    actionCommitment: commitmentBytes.toString("hex"),
  };
}

/**
 * Encodes an `EscrowDatum` as canonical Plutus `Constr 0` CBOR hex (used in tests and fixture generation).
 */
export function encodeEscrowInlineDatumCbor(datum: ParsedEscrowDatum): string {
  function encodeUint(major: number, val: bigint): Buffer {
    const m = major << 5;
    if (val < 24n) return Buffer.from([m | Number(val)]);
    if (val <= 0xffn) return Buffer.from([m | 24, Number(val)]);
    if (val <= 0xffffn) {
      const b = Buffer.alloc(3);
      b[0] = m | 25;
      b.writeUInt16BE(Number(val), 1);
      return b;
    }
    if (val <= 0xffffffffn) {
      const b = Buffer.alloc(5);
      b[0] = m | 26;
      b.writeUInt32BE(Number(val), 1);
      return b;
    }
    const b = Buffer.alloc(9);
    b[0] = m | 27;
    b.writeBigUInt64BE(val, 1);
    return b;
  }

  function encodeBstr(hex: string): Buffer {
    const raw = Buffer.from(hex, "hex");
    return Buffer.concat([encodeUint(2, BigInt(raw.length)), raw]);
  }

  return Buffer.concat([
    encodeUint(6, 121n),
    Buffer.from([0x85]),
    encodeBstr(datum.buyer),
    encodeBstr(datum.supplier),
    encodeUint(0, datum.lockedAmountLovelace),
    encodeUint(0, datum.refundDeadlineMs),
    encodeBstr(datum.actionCommitment),
  ]).toString("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function fetchBlockfrostJson(
  urlPath: string,
  config: ChainConfig,
  doFetch: typeof fetch,
): Promise<{ ok: true; body: unknown } | { ok: false; status?: number; reason: string }> {
  let res: Response;
  try {
    res = await doFetch(`${config.baseUrl}${urlPath}`, {
      method: "GET",
      headers: { project_id: config.projectId },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    return { ok: false, reason: "Chain API unreachable or timed out." };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, reason: `Chain API returned HTTP ${String(res.status)}.` };
  }
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, reason: "Chain API returned invalid JSON." };
  }
}

/**
 * Creates a Blockfrost Preprod `VerifierChainReader` reusing `services/chain` `loadChainConfig`
 * and `getTxStatus` (T7.1). Fails closed on malformed responses, missing input flags, and invalid contracts.
 */
export function createBlockfrostChainReader(deps: {
  config?: ChainConfig;
  fetch?: typeof fetch;
} = {}): VerifierChainReader {
  const doFetch = deps.fetch ?? fetch;

  return {
    async getTransaction(txHash: string): Promise<ChainTxLookupResult> {
      let config: ChainConfig;
      try {
        config = deps.config ?? loadChainConfig();
      } catch {
        return { kind: "unverifiable", reason: "Chain API configuration missing or invalid." };
      }

      const status = await getTxStatus(txHash, { config, fetch: doFetch });
      if (status.status === "error") {
        if (status.reason === "contract_validation_failed") {
          return {
            kind: "invalid_contract",
            reason: "Transaction failed Plutus script validation (valid_contract=false).",
          };
        }
        if (status.reason === "invalid_tx_id") {
          return { kind: "not_found", status };
        }
        return { kind: "unverifiable", reason: `Chain API unavailable (${status.reason}).` };
      }

      if (status.status === "not_found") {
        return { kind: "not_found", status };
      }

      if (status.status !== "confirmed") {
        return { kind: "not_confirmed_depth", status };
      }

      const [txRes, utxosRes, signersRes] = await Promise.all([
        fetchBlockfrostJson(`/txs/${txHash}`, config, doFetch),
        fetchBlockfrostJson(`/txs/${txHash}/utxos`, config, doFetch),
        fetchBlockfrostJson(`/txs/${txHash}/required_signers`, config, doFetch),
      ]);

      if (!txRes.ok) return { kind: "unverifiable", reason: txRes.reason };
      if (!utxosRes.ok) return { kind: "unverifiable", reason: utxosRes.reason };
      if (!signersRes.ok && signersRes.status !== 404) {
        return { kind: "unverifiable", reason: signersRes.reason };
      }

      // Guard against null, non-object, or missing required fields on 200 JSON responses (T8.3b Step 5).
      if (!isPlainObject(txRes.body) || typeof txRes.body.valid_contract !== "boolean") {
        return { kind: "unverifiable", reason: "Chain API returned malformed transaction response." };
      }
      if (txRes.body.valid_contract !== true) {
        return {
          kind: "invalid_contract",
          reason: "Transaction failed Plutus script validation (valid_contract=false).",
        };
      }

      const invalidBeforeRaw = txRes.body.invalid_before;
      let invalidBeforeSlot: bigint | null;
      if (invalidBeforeRaw === null || invalidBeforeRaw === undefined) {
        invalidBeforeSlot = null;
      } else if (typeof invalidBeforeRaw === "string" && /^\d+$/.test(invalidBeforeRaw)) {
        invalidBeforeSlot = BigInt(invalidBeforeRaw);
      } else if (typeof invalidBeforeRaw === "number" && Number.isInteger(invalidBeforeRaw) && invalidBeforeRaw >= 0) {
        invalidBeforeSlot = BigInt(invalidBeforeRaw);
      } else {
        return { kind: "unverifiable", reason: "Chain API returned malformed invalid_before slot." };
      }

      if (
        !isPlainObject(utxosRes.body) ||
        !Array.isArray(utxosRes.body.inputs) ||
        !Array.isArray(utxosRes.body.outputs)
      ) {
        return { kind: "unverifiable", reason: "Chain API returned malformed UTxO response." };
      }

      // T8.3b Blocker 4: Only count inputs where Blockfrost explicitly sets
      // `collateral === false && reference === false`. Missing flags fail closed (isSpendInput: false).
      const inputs: ChainTxInput[] = [];
      for (const rawInput of utxosRes.body.inputs) {
        if (!isPlainObject(rawInput)) {
          return { kind: "unverifiable", reason: "Chain API returned non-object UTxO input." };
        }
        if (typeof rawInput.tx_hash !== "string" || typeof rawInput.output_index !== "number") {
          return { kind: "unverifiable", reason: "Chain API returned UTxO input missing tx_hash or output_index." };
        }
        const isSpendInput = rawInput.collateral === false && rawInput.reference === false;
        inputs.push({
          txHash: rawInput.tx_hash,
          outputIndex: rawInput.output_index,
          isSpendInput,
        });
      }

      const outputs: ChainTxOutput[] = [];
      for (const rawOutput of utxosRes.body.outputs) {
        if (!isPlainObject(rawOutput)) {
          return { kind: "unverifiable", reason: "Chain API returned non-object UTxO output." };
        }
        if (
          typeof rawOutput.address !== "string" ||
          typeof rawOutput.output_index !== "number" ||
          !Array.isArray(rawOutput.amount)
        ) {
          return { kind: "unverifiable", reason: "Chain API returned malformed UTxO output." };
        }
        const lovelaceEntry = rawOutput.amount.find(
          (a) => isPlainObject(a) && a.unit === "lovelace" && typeof a.quantity === "string",
        ) as { quantity?: string } | undefined;
        const lovelace =
          lovelaceEntry?.quantity && /^\d+$/.test(lovelaceEntry.quantity)
            ? BigInt(lovelaceEntry.quantity)
            : 0n;
        outputs.push({
          address: rawOutput.address,
          outputIndex: rawOutput.output_index,
          lovelace,
          inlineDatumHex: typeof rawOutput.inline_datum === "string" ? rawOutput.inline_datum : null,
        });
      }

      // T8.3b Blocker 3: Pin official Blockfrost field `witness_hash` only (never accept `hash`).
      const requiredSigners: string[] = [];
      if (signersRes.ok) {
        if (!Array.isArray(signersRes.body)) {
          return { kind: "unverifiable", reason: "Chain API returned malformed required_signers response." };
        }
        for (const entry of signersRes.body) {
          if (!isPlainObject(entry) || typeof entry.witness_hash !== "string") {
            return {
              kind: "unverifiable",
              reason: "Chain API required_signers entry missing documented witness_hash field.",
            };
          }
          requiredSigners.push(entry.witness_hash.toLowerCase());
        }
      }

      return {
        kind: "ok",
        status,
        details: {
          txHash,
          validContract: true,
          invalidBeforeSlot,
          inputs,
          outputs,
          requiredSigners,
        },
      };
    },
  };
}
