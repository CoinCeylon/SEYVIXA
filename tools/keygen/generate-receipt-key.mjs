// T8.2 — One-time Ed25519 receipt-signing key generator (Blueprint Section 6.8; Section 9 item 12).
// Uses Node's built-in `node:crypto` only (no external libraries).
//
// Security rules:
// - Writes ONLY the public key document to `keys/receipt-signing-public.json`.
// - Never prints, logs, or commits the private key.
// - Refuses to overwrite an existing public key file unless `--force` is passed.

import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ED25519_SPKI_PREFIX_HEX = "302a300506032b6570032100";
const FORBIDDEN_PRIVATE_KEY_FIELDS = new Set([
  "d",
  "private",
  "private_key",
  "privateKey",
  "secret",
  "secret_key",
  "seed",
  "pkcs8",
  "pem",
]);

/**
 * Computes the trusted fingerprint: SHA-256 of the raw 32-byte Ed25519 public key in lowercase hex.
 */
export function computePublicKeyFingerprint(rawPublicKey) {
  if (!Buffer.isBuffer(rawPublicKey) || rawPublicKey.length !== 32) {
    throw new Error("Ed25519 raw public key must be a 32-byte Buffer.");
  }
  return createHash("sha256").update(rawPublicKey).digest("hex");
}

/**
 * Computes `kid` as the first 16 lowercase hex characters of the SHA-256 fingerprint.
 */
export function computeKid(fingerprint) {
  if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error("Fingerprint must be a 64-character lowercase hex SHA-256 digest.");
  }
  return fingerprint.slice(0, 16);
}

/**
 * Generates an Ed25519 key pair using Node's `node:crypto`.
 * Returns raw 32-byte public key, PKCS#8 DER base64url private key (for local .env only),
 * 64-hex SHA-256 fingerprint, and 16-hex `kid`.
 */
export function generateReceiptKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const jwk = publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") {
    throw new Error("Failed to export Ed25519 JWK public key coordinate.");
  }

  const rawPublicKey = Buffer.from(jwk.x, "base64url");
  if (
    rawPublicKey.length !== 32 ||
    spkiDer.length !== 44 ||
    spkiDer.subarray(0, 12).toString("hex") !== ED25519_SPKI_PREFIX_HEX ||
    !spkiDer.subarray(12).equals(rawPublicKey)
  ) {
    throw new Error("Exported Ed25519 raw public key failed 32-byte SPKI consistency check.");
  }

  const fingerprint = computePublicKeyFingerprint(rawPublicKey);
  const kid = computeKid(fingerprint);
  const privateKeyPkcs8Base64Url = privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64url");

  return {
    rawPublicKey,
    fingerprint,
    kid,
    privateKeyPkcs8Base64Url,
  };
}

/**
 * Builds the public-only JSON document committed at `keys/receipt-signing-public.json`.
 */
export function buildPublicKeyDocument(rawPublicKey, createdAt = new Date().toISOString()) {
  const fingerprint = computePublicKeyFingerprint(rawPublicKey);
  const kid = computeKid(fingerprint);
  return {
    algorithm: "Ed25519",
    kid,
    fingerprint,
    public_key_hex: rawPublicKey.toString("hex"),
    public_key_base64url: rawPublicKey.toString("base64url"),
    created_at: createdAt,
    note: "Public key only (T8.2, Blueprint Section 6.8). Do not regenerate after publication.",
  };
}

/**
 * Validates a loaded public key JSON object (rejects any private key fields and verifies fingerprint/kid).
 */
export function verifyPublicKeyDocument(doc) {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Public key document must be a JSON object.");
  }

  for (const key of Object.keys(doc)) {
    if (FORBIDDEN_PRIVATE_KEY_FIELDS.has(key) || /private|secret|seed/i.test(key)) {
      throw new Error(`Public key document contains forbidden private field "${key}".`);
    }
  }

  if (doc.algorithm !== "Ed25519") {
    throw new Error(`Expected algorithm "Ed25519", got ${JSON.stringify(doc.algorithm)}.`);
  }
  if (typeof doc.public_key_hex !== "string" || !/^[0-9a-f]{64}$/.test(doc.public_key_hex)) {
    throw new Error("public_key_hex must be a 64-character lowercase hex string (32 bytes).");
  }

  const rawPublicKey = Buffer.from(doc.public_key_hex, "hex");
  if (doc.public_key_base64url !== rawPublicKey.toString("base64url")) {
    throw new Error("public_key_base64url does not match public_key_hex.");
  }

  const recomputedFingerprint = computePublicKeyFingerprint(rawPublicKey);
  if (doc.fingerprint !== recomputedFingerprint) {
    throw new Error("Public key fingerprint does not match SHA-256(raw 32-byte public key).");
  }

  const expectedKid = computeKid(recomputedFingerprint);
  if (doc.kid !== expectedKid) {
    throw new Error("Public key kid does not match first 16 hex characters of fingerprint.");
  }

  return {
    rawPublicKey,
    fingerprint: recomputedFingerprint,
    kid: expectedKid,
  };
}

function upsertEnvVar(envPath, name, value) {
  const line = `${name}=${value}`;
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
    return;
  }

  const existing = readFileSync(envPath, "utf8");
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const updated = pattern.test(existing)
    ? existing.replace(pattern, line)
    : `${existing.replace(/\r?\n$/, "")}\n${line}\n`;
  writeFileSync(envPath, updated, { encoding: "utf8", mode: 0o600 });
}

function runCli(argv) {
  let publicPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../keys/receipt-signing-public.json",
  );
  let envPath = null;
  let force = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write-public" && argv[i + 1]) {
      publicPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--write-env" && argv[i + 1]) {
      envPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--force") {
      force = true;
    }
  }

  if (existsSync(publicPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing public key at ${publicPath}. Do not regenerate after publication (pass --force only if intentionally rotating).`,
    );
  }

  const generated = generateReceiptKeyPair();
  const doc = buildPublicKeyDocument(generated.rawPublicKey);
  verifyPublicKeyDocument(doc);

  mkdirSync(path.dirname(publicPath), { recursive: true });
  writeFileSync(publicPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  if (envPath !== null) {
    upsertEnvVar(envPath, "RECEIPT_SIGNING_PRIVATE_KEY", generated.privateKeyPkcs8Base64Url);
  }

  // Output public metadata ONLY — never print the private key.
  console.log(
    JSON.stringify(
      {
        public_key_path: publicPath,
        env_updated: envPath !== null,
        algorithm: doc.algorithm,
        kid: doc.kid,
        fingerprint: doc.fingerprint,
        created_at: doc.created_at,
      },
      null,
      2,
    ),
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCli(process.argv.slice(2));
}
