// T8.2 & T8.2b — One-time Ed25519 receipt-signing key generator (Blueprint Section 6.8; Section 9 item 12).
// Uses Node's built-in `node:crypto` only (no external libraries).
//
// Behaviour & security rules:
// - Writes the Ed25519 private key (PKCS#8 DER base64url) to the single `.env` file you pass via
//   `--write-env <path>`, ONLY if its basename is exactly `.env`, neither the file nor its parent
//   is a symlink, `git check-ignore` reports it as ignored (and not tracked), and it does not
//   already contain a non-placeholder `RECEIPT_SIGNING_PRIVATE_KEY` value.
// - Writes the public key JSON to `--write-public <path>` second, only if it does not already exist.
//   If the `.env` write fails, the public key file is never written or modified.
// - `--force` is intentionally not supported; never regenerate a key after publication.
// - File mode `0o600` has no real effect on Windows and does not change permissions on an existing
//   file; protecting the `.env` file is the owner's responsibility.
// - Never prints or logs the private key in stdout, stderr, or thrown error messages.

import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ED25519_SPKI_PREFIX_HEX = "302a300506032b6570032100";
export const PKCS8_ED25519_BASE64URL_PREFIX = "MC4CAQAwBQYDK2VwBCIEI";
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
 * Returns raw 32-byte public key, PKCS#8 DER base64url private key (for ignored `.env` only),
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

function checkNoPrivateValues(value) {
  if (typeof value === "string") {
    if (
      value.includes(PKCS8_ED25519_BASE64URL_PREFIX) ||
      /BEGIN PRIVATE KEY/i.test(value)
    ) {
      throw new Error("Public key document contains a private-key-shaped string value.");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) checkNoPrivateValues(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_PRIVATE_KEY_FIELDS.has(key) || /private|secret|seed/i.test(key)) {
        throw new Error(`Public key document contains forbidden private field "${key}".`);
      }
      checkNoPrivateValues(val);
    }
  }
}

/**
 * Validates a loaded public key JSON object (rejects any private key fields or PKCS#8-shaped values
 * and verifies fingerprint and `kid`).
 */
export function verifyPublicKeyDocument(doc) {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Public key document must be a JSON object.");
  }

  checkNoPrivateValues(doc);

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

function pathExistsOrSymlink(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function isGitIgnoredAndUntracked(targetPath) {
  const dir = path.dirname(targetPath);
  const fileName = path.basename(targetPath);

  const ignored = spawnSync("git", ["check-ignore", "-q", fileName], {
    cwd: dir,
    encoding: "utf8",
  });
  if (ignored.status !== 0) {
    return false;
  }

  // Also refuse if git already tracks the file (e.g. force-added earlier).
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", fileName], {
    cwd: dir,
    encoding: "utf8",
  });
  return tracked.status !== 0;
}

function validateEnvTargetPath(envPath) {
  if (path.basename(envPath) !== ".env") {
    throw new Error("Refusing --write-env target: filename must be exactly \".env\".");
  }

  const parentDir = path.dirname(envPath);
  let parentStat;
  try {
    parentStat = lstatSync(parentDir);
  } catch {
    throw new Error("Refusing --write-env target: parent directory does not exist.");
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error("Refusing --write-env target: parent directory must be a real directory (not a symlink).");
  }

  if (pathExistsOrSymlink(envPath)) {
    const stat = lstatSync(envPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Refusing --write-env target: .env must be a regular file (symlinks are forbidden).");
    }
    if (path.basename(realpathSync(envPath)) !== ".env") {
      throw new Error("Refusing --write-env target: resolved path must be named \".env\".");
    }
  }

  if (!isGitIgnoredAndUntracked(envPath)) {
    throw new Error("Refusing --write-env target: .env must be ignored (and untracked) by git.");
  }
}

function assertNoExistingRealPrivateKey(envPath) {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*RECEIPT_SIGNING_PRIVATE_KEY\s*=(.*)$/.exec(line);
    if (!match) continue;
    const rawVal = match[1].trim().replace(/^["']|["']$/g, "");
    if (!rawVal.startsWith("REPLACE_ME_")) {
      throw new Error(
        "Refusing to overwrite existing RECEIPT_SIGNING_PRIVATE_KEY in .env (only a REPLACE_ME_... placeholder may be replaced).",
      );
    }
  }
}

function upsertEnvPrivateKey(envPath, privateKeyValue) {
  const line = `RECEIPT_SIGNING_PRIVATE_KEY=${privateKeyValue}`;
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
    return;
  }

  const existing = readFileSync(envPath, "utf8");
  const pattern = /^\s*RECEIPT_SIGNING_PRIVATE_KEY\s*=.*$/m;
  const updated = pattern.test(existing)
    ? existing.replace(pattern, line)
    : `${existing.replace(/\r?\n$/, "")}\n${line}\n`;
  writeFileSync(envPath, updated, { encoding: "utf8", mode: 0o600 });
}

function parseKeygenArgs(argv, defaultPublicPath) {
  let publicPath = defaultPublicPath;
  let envPath = null;
  let seenPublic = false;
  let seenEnv = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write-public") {
      const next = argv[i + 1];
      if (seenPublic || next === undefined || next.trim().length === 0 || next.startsWith("--")) {
        throw new Error("--write-public requires a single non-empty file path.");
      }
      publicPath = path.resolve(next);
      seenPublic = true;
      i += 1;
    } else if (arg === "--write-env") {
      const next = argv[i + 1];
      if (seenEnv || next === undefined || next.trim().length === 0 || next.startsWith("--")) {
        throw new Error("--write-env requires a single non-empty .env file path.");
      }
      envPath = path.resolve(next);
      seenEnv = true;
      i += 1;
    } else {
      throw new Error(`Unknown or disallowed argument "${arg}". Only --write-env and --write-public are supported.`);
    }
  }

  if (envPath === null) {
    throw new Error("Missing required argument --write-env <path-to-ignored-.env>.");
  }

  return { publicPath, envPath };
}

/**
 * Testable keygen entry point. Returns `{ exitCode, stdout, stderr }` and never calls `process.exit`.
 * In tests, always pass `options.defaultPublicPath` or `--write-public` pointing inside a temp folder.
 */
export function runKeygen(argv, options = {}) {
  const defaultPublicPath =
    options.defaultPublicPath ??
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../keys/receipt-signing-public.json",
    );

  let generatedPrivateKey = null;

  try {
    const { publicPath, envPath } = parseKeygenArgs(argv, defaultPublicPath);

    // 1. Validate `.env` target path (exact name, no symlinks, git-ignored, untracked).
    validateEnvTargetPath(envPath);

    // 2. Refuse if `.env` already holds a non-placeholder RECEIPT_SIGNING_PRIVATE_KEY.
    assertNoExistingRealPrivateKey(envPath);

    // 3. Refuse if public key file already exists (or is a symlink). Never overwrite published key.
    if (pathExistsOrSymlink(publicPath)) {
      throw new Error(
        `Refusing to overwrite existing public key at ${publicPath}. Do not regenerate after publication.`,
      );
    }

    const generated = generateReceiptKeyPair();
    generatedPrivateKey = generated.privateKeyPkcs8Base64Url;

    const doc = buildPublicKeyDocument(generated.rawPublicKey);
    verifyPublicKeyDocument(doc);

    // 4. Write `.env` FIRST so any write failure never leaves a mismatched public key file.
    try {
      upsertEnvPrivateKey(envPath, generated.privateKeyPkcs8Base64Url);
    } catch {
      throw new Error("Failed to write RECEIPT_SIGNING_PRIVATE_KEY to .env; public key file was not written.");
    }

    // 5. Write public key JSON SECOND.
    mkdirSync(path.dirname(publicPath), { recursive: true });
    writeFileSync(publicPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

    // Output public metadata ONLY — never print the private key.
    const stdout = `${JSON.stringify(
      {
        public_key_path: publicPath,
        env_updated: true,
        algorithm: doc.algorithm,
        kid: doc.kid,
        fingerprint: doc.fingerprint,
        created_at: doc.created_at,
      },
      null,
      2,
    )}\n`;

    return { exitCode: 0, stdout, stderr: "" };
  } catch (err) {
    let msg = err instanceof Error ? err.message : "Key generation failed.";
    if (generatedPrivateKey && msg.includes(generatedPrivateKey)) {
      msg = "Key generation failed (details redacted).";
    }
    return { exitCode: 1, stdout: "", stderr: `${msg}\n` };
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const result = runKeygen(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
