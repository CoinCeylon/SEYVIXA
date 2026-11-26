// T8.2 — Unit tests for the Ed25519 receipt-signing public key and published fingerprint
// (Blueprint Section 6.8; Section 9 item 12).

import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPublicKeyDocument,
  computeKid,
  computePublicKeyFingerprint,
  generateReceiptKeyPair,
  verifyPublicKeyDocument,
} from "./generate-receipt-key.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_KEY_PATH = path.join(REPO_ROOT, "keys/receipt-signing-public.json");
const README_PATH = path.join(REPO_ROOT, "README.md");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

describe("T8.2 — Receipt signing key generation and verification", () => {
  it("generates a valid Ed25519 key pair whose raw 32-byte public key verifies signatures", () => {
    const pair = generateReceiptKeyPair();
    assert.equal(pair.rawPublicKey.length, 32);
    assert.match(pair.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(pair.kid, pair.fingerprint.slice(0, 16));

    const privKeyObj = createPrivateKey({
      key: Buffer.from(pair.privateKeyPkcs8Base64Url, "base64url"),
      format: "der",
      type: "pkcs8",
    });
    const pubKeyObj = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, pair.rawPublicKey]),
      format: "der",
      type: "spki",
    });

    const payload = Buffer.from("seyvixa-t8.2-test-payload", "utf8");
    const signature = sign(null, payload, privKeyObj);
    assert.equal(verify(null, payload, pubKeyObj, signature), true);
  });

  it("rejects any public key document containing private key material", () => {
    const pair = generateReceiptKeyPair();
    const doc = buildPublicKeyDocument(pair.rawPublicKey);
    assert.doesNotThrow(() => verifyPublicKeyDocument(doc));

    for (const forbiddenField of ["d", "private_key", "privateKey", "secret", "seed"]) {
      assert.throws(
        () => verifyPublicKeyDocument({ ...doc, [forbiddenField]: "should-never-exist" }),
        /forbidden private field/i,
      );
    }
  });

  it("committed keys/receipt-signing-public.json matches README.md fingerprint and kid and contains no private fields", () => {
    const rawJson = readFileSync(PUBLIC_KEY_PATH, "utf8");
    assert.doesNotMatch(rawJson, /BEGIN PRIVATE KEY|private_key|privateKey|"d"\s*:/i);

    const doc = JSON.parse(rawJson);
    const verified = verifyPublicKeyDocument(doc);

    const recomputedFingerprint = computePublicKeyFingerprint(verified.rawPublicKey);
    const recomputedKid = computeKid(recomputedFingerprint);
    assert.equal(doc.fingerprint, recomputedFingerprint);
    assert.equal(doc.kid, recomputedKid);

    const readme = readFileSync(README_PATH, "utf8");
    assert.ok(
      readme.includes(recomputedFingerprint),
      "README.md must publish the exact 64-hex SHA-256 fingerprint from keys/receipt-signing-public.json",
    );
    assert.ok(
      readme.includes(recomputedKid),
      "README.md must publish the 16-hex kid prefix",
    );
    assert.match(readme, /Do not regenerate after publication/i);
  });

  it(".env.example defines only a fake placeholder for RECEIPT_SIGNING_PRIVATE_KEY", () => {
    const envExample = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    assert.match(envExample, /^RECEIPT_SIGNING_PRIVATE_KEY=REPLACE_ME_/m);
  });
});
