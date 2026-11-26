// T7.2a — CIP-19 / BIP-173 Bech32 encoder for CIP-30 hex-encoded Cardano testnet payment addresses.
// Blueprint Section 6.5: server T2.2 validates key-hash vs script addresses; this encoder only
// checks the CIP-19 header needed to format a testnet payment address (`addr_test1...`).

import { WalletError } from "./types.ts";

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;
const TESTNET_PAYMENT_HRP = "addr_test";

function polymod(values: readonly number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if (((top >>> i) & 1) !== 0) {
        chk ^= BECH32_GENERATORS[i];
      }
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const expanded: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) {
    expanded.push(hrp.charCodeAt(i) >>> 5);
  }
  expanded.push(0);
  for (let i = 0; i < hrp.length; i += 1) {
    expanded.push(hrp.charCodeAt(i) & 31);
  }
  return expanded;
}

function createChecksum(hrp: string, data: readonly number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    checksum.push((mod >>> (5 * (5 - i))) & 31);
  }
  return checksum;
}

function convertBits8To5(bytes: Uint8Array): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];

  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >>> bits) & 31);
    }
  }

  if (bits > 0) {
    out.push((acc << (5 - bits)) & 31);
  }

  return out;
}

function encodeBech32(hrp: string, bytes: Uint8Array): string {
  const words = convertBits8To5(bytes);
  const combined = [...words, ...createChecksum(hrp, words)];
  let encoded = `${hrp}1`;
  for (const word of combined) {
    encoded += BECH32_CHARSET[word];
  }
  return encoded;
}

function decodeHexBytes(hex: string): Uint8Array {
  const trimmed = hex.trim();
  if (trimmed.length === 0 || trimmed.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new WalletError(
      "INVALID_ADDRESS",
      "Wallet returned a malformed CIP-30 address (expected even-length hex bytes).",
    );
  }

  const bytes = new Uint8Array(trimmed.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encodes CIP-30 hex address bytes as a CIP-19 Bech32 testnet payment address (`addr_test1...`).
 *
 * Fails closed if:
 * - the hex string is malformed,
 * - the CIP-19 address type is not a Shelley payment address (upper nibble 0x0..0x7), or
 * - the CIP-19 network tag is not testnet (lower nibble 0x0).
 *
 * Does NOT reject script payment addresses (types 0x1, 0x3, 0x5, 0x7): key-hash validation
 * is performed by the server in T2.2 (Blueprint Section 6.5).
 */
export function encodeCardanoTestnetAddress(hexAddress: string): string {
  const bytes = decodeHexBytes(hexAddress);
  const header = bytes[0];
  const addressType = (header >>> 4) & 0x0f;
  const networkTag = header & 0x0f;

  // CIP-19: 0x0..0x7 are Shelley payment addresses (base, pointer, enterprise).
  // 0x8 is Byron (no network nibble); 0xe..0xf are stake/reward addresses.
  if (addressType > 0x07) {
    throw new WalletError(
      "INVALID_ADDRESS",
      "Wallet returned a non-Shelley-payment address. Select a Shelley testnet payment address.",
    );
  }

  if (networkTag !== 0) {
    throw new WalletError(
      "NETWORK_NOT_TESTNET",
      "Wallet returned a non-testnet address (network tag is not 0). Switch to Cardano Preprod testnet.",
    );
  }

  return encodeBech32(TESTNET_PAYMENT_HRP, bytes);
}
