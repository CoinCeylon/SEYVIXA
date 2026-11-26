// T8.3 — Cardano Preprod chain reader for `tools/verifier` (Blueprint Section 6.8).
// Reuses `getTxStatus` and `loadChainConfig` from `services/chain` (T7.1, read-only) so the
// verifier uses the exact same Blockfrost Preprod configuration and confirmation depth rules.
// Never logs or returns API keys. Never submits transactions.

import { loadChainConfig, type ChainConfig } from "../../../services/chain/src/config.ts";
import { getTxStatus, type TxStatus } from "../../../services/chain/src/tx-status.ts";

// Cardano Preprod slot config (matches SLOT_CONFIG_NETWORK.preprod: zeroTime 1655769600000, zeroSlot 86400, 1000ms/slot).
const PREPROD_ZERO_TIME_MS = 1_655_769_600_000n;
const PREPROD_ZERO_SLOT = 86_400n;
const PREPROD_SLOT_LENGTH_MS = 1_000n;

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
  | { readonly kind: "not_confirmed"; readonly status: TxStatus }
  | { readonly kind: "invalid_contract"; readonly reason: string }
  | { readonly kind: "unverifiable"; readonly reason: string };

export interface VerifierChainReader {
  getTransaction(txHash: string): Promise<ChainTxLookupResult>;
}

/**
 * Converts a Cardano Preprod slot number to POSIXTime in milliseconds.
 */
export function preprodSlotToPosixMs(slot: bigint): bigint {
  return PREPROD_ZERO_TIME_MS + (slot - PREPROD_ZERO_SLOT) * PREPROD_SLOT_LENGTH_MS;
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

  // Verify BIP-173 polymod checksum.
  const expanded: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) expanded.push(hrp.charCodeAt(i) >>> 5);
  expanded.push(0);
  for (let i = 0; i < hrp.length; i += 1) expanded.push(hrp.charCodeAt(i) & 31);
  let chk = 1;
  for (const v of [...expanded, ...words]) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i += 1) {
      if (((top >>> i) & 1) !== 0) chk ^= BECH32_GENERATORS[i];
    }
  }
  if (chk !== 1) return null;

  // Convert 5-bit payload words (excluding 6-word checksum) to bytes.
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
  if (out.length < 29) return null;

  const header = out[0];
  const addrType = (header >>> 4) & 0x0f;
  const networkTag = header & 0x0f;
  // Shelley payment key-hash addresses have even types 0x0, 0x2, 0x4, 0x6 and testnet tag 0.
  if (networkTag !== 0 || addrType > 0x07 || (addrType & 1) !== 0) return null;

  return Buffer.from(out.slice(1, 29)).toString("hex");
}

/**
 * Decodes a Plutus `Constr 0 [buyer, supplier, locked_amount, refund_deadline, action_commitment]`
 * CBOR hex inline datum per `contracts/cardano/DATUM_SPEC.md`.
 * Returns `null` if the CBOR does not match the exact 5-field `EscrowDatum` structure.
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

  // Expect Plutus Constr 0 = CBOR Tag 121 (major 6, tag 121: 0xd8 0x79).
  if (offset >= buf.length) return null;
  const tagHead = buf[offset];
  offset += 1;
  if ((tagHead >>> 5) !== 6) return null;
  const tagNum = readUint(tagHead & 0x1f);
  if (tagNum !== 121n) return null;

  // Expect CBOR array (definite length 5 or indefinite length 0x9f ... 0xff).
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
    Buffer.from([0x85]), // 5-element definite array
    encodeBstr(datum.buyer),
    encodeBstr(datum.supplier),
    encodeUint(0, datum.lockedAmountLovelace),
    encodeUint(0, datum.refundDeadlineMs),
    encodeBstr(datum.actionCommitment),
  ]).toString("hex");
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
 * and `getTxStatus` (T7.1). Never leaks secrets in error messages.
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
          return { kind: "invalid_contract", reason: "Transaction failed Plutus script validation (valid_contract=false)." };
        }
        if (status.reason === "invalid_tx_id") {
          return { kind: "not_confirmed", status };
        }
        return { kind: "unverifiable", reason: `Chain API unavailable (${status.reason}).` };
      }

      if (status.status !== "confirmed") {
        return { kind: "not_confirmed", status };
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

      const txObj = txRes.body as Record<string, unknown>;
      if (txObj.valid_contract !== true) {
        return { kind: "invalid_contract", reason: "Transaction failed Plutus script validation (valid_contract!=true)." };
      }

      const invalidBeforeRaw = txObj.invalid_before;
      const invalidBeforeSlot =
        typeof invalidBeforeRaw === "string" && /^\d+$/.test(invalidBeforeRaw)
          ? BigInt(invalidBeforeRaw)
          : typeof invalidBeforeRaw === "number" && Number.isInteger(invalidBeforeRaw)
            ? BigInt(invalidBeforeRaw)
            : null;

      const utxosObj = utxosRes.body as {
        inputs?: Array<{ tx_hash?: unknown; output_index?: unknown }>;
        outputs?: Array<{
          address?: unknown;
          output_index?: unknown;
          amount?: Array<{ unit?: unknown; quantity?: unknown }>;
          inline_datum?: unknown;
        }>;
      };

      const inputs: ChainTxInput[] = (Array.isArray(utxosObj.inputs) ? utxosObj.inputs : [])
        .filter((i) => typeof i.tx_hash === "string" && typeof i.output_index === "number")
        .map((i) => ({ txHash: i.tx_hash as string, outputIndex: i.output_index as number }));

      const outputs: ChainTxOutput[] = (Array.isArray(utxosObj.outputs) ? utxosObj.outputs : [])
        .filter((o) => typeof o.address === "string" && typeof o.output_index === "number")
        .map((o) => {
          const lovelaceEntry = Array.isArray(o.amount)
            ? o.amount.find((a) => a.unit === "lovelace" && typeof a.quantity === "string")
            : undefined;
          const lovelace =
            lovelaceEntry && /^\d+$/.test(lovelaceEntry.quantity as string)
              ? BigInt(lovelaceEntry.quantity as string)
              : 0n;
          return {
            address: o.address as string,
            outputIndex: o.output_index as number,
            lovelace,
            inlineDatumHex: typeof o.inline_datum === "string" ? o.inline_datum : null,
          };
        });

      const signersBody = signersRes.ok ? signersRes.body : [];
      const requiredSigners: string[] = Array.isArray(signersBody)
        ? signersBody
            .map((s) =>
              typeof s === "string"
                ? s
                : s && typeof s === "object" && typeof (s as { hash?: unknown }).hash === "string"
                  ? ((s as { hash: string }).hash)
                  : null,
            )
            .filter((s): s is string => s !== null)
            .map((s) => s.toLowerCase())
        : [];

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
