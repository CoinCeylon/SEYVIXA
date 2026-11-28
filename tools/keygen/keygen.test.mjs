// T8.2 & T8.2b — Isolated unit tests for the Ed25519 receipt-signing key generator
// (Blueprint Section 6.8; Section 9 item 12).
//
// Security rule: Every generator test runs in a fresh `mkdtemp` folder with a throwaway git repo.
// No test ever modifies the real `keys/` directory or any real `.env` file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PKCS8_ED25519_BASE64URL_PREFIX,
  buildPublicKeyDocument,
  computeKid,
  computePublicKeyFingerprint,
  generateReceiptKeyPair,
  runKeygen,
  verifyPublicKeyDocument,
} from "./generate-receipt-key.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_KEY_PATH = path.join(REPO_ROOT, "keys/receipt-signing-public.json");
const README_PATH = path.join(REPO_ROOT, "README.md");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function makeThrowawayGitRepo(gitignoreContent = ".env\n") {
  const dir = mkdtempSync(path.join(tmpdir(), "seyvixa-t82b-"));
  const init = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  assert.equal(init.status, 0, "git init must succeed in temp dir");
  if (gitignoreContent !== null) {
    writeFileSync(path.join(dir, ".gitignore"), gitignoreContent, "utf8");
  }
  return dir;
}

describe("T8.2 — Published public key, README, and .env.example integrity (read-only)", () => {
  it("generates a valid Ed25519 key pair whose raw 32-byte public key verifies signatures", () => {
    const pair = generateReceiptKeyPair();
    assert.equal(pair.rawPublicKey.length, 32);
    assert.match(pair.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(pair.kid, pair.fingerprint.slice(0, 16));
    assert.ok(pair.privateKeyPkcs8Base64Url.startsWith(PKCS8_ED25519_BASE64URL_PREFIX));

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

  it("rejects any public key document containing private key fields or PKCS#8-shaped values", () => {
    const pair = generateReceiptKeyPair();
    const doc = buildPublicKeyDocument(pair.rawPublicKey);
    assert.doesNotThrow(() => verifyPublicKeyDocument(doc));

    for (const forbiddenField of ["d", "private_key", "privateKey", "secret", "seed"]) {
      assert.throws(
        () => verifyPublicKeyDocument({ ...doc, [forbiddenField]: "should-never-exist" }),
        /forbidden private field/i,
      );
    }

    assert.throws(
      () => verifyPublicKeyDocument({ ...doc, note: pair.privateKeyPkcs8Base64Url }),
      /private-key-shaped/i,
    );
  });

  it("committed keys/receipt-signing-public.json matches README.md fingerprint and kid and contains no private material", () => {
    const rawJson = readFileSync(PUBLIC_KEY_PATH, "utf8");
    assert.doesNotMatch(rawJson, /BEGIN PRIVATE KEY|private_key|privateKey|"d"\s*:/i);
    assert.equal(rawJson.includes(PKCS8_ED25519_BASE64URL_PREFIX), false);

    const doc = JSON.parse(rawJson);
    const verified = verifyPublicKeyDocument(doc);

    const recomputedFingerprint = computePublicKeyFingerprint(verified.rawPublicKey);
    const recomputedKid = computeKid(recomputedFingerprint);
    assert.equal(doc.fingerprint, recomputedFingerprint);
    assert.equal(doc.kid, recomputedKid);

    const readme = readFileSync(README_PATH, "utf8");
    assert.ok(readme.includes(recomputedFingerprint), "README.md must publish the exact fingerprint");
    assert.ok(readme.includes(recomputedKid), "README.md must publish the 16-hex kid");
    assert.match(readme, /Do not regenerate after publication/i);
    assert.doesNotMatch(readme, /submission slide\/documentation/i);
    assert.doesNotMatch(readme, /stays in server `\.env` only/i);
  });

  it(".env.example defines only a fake placeholder for RECEIPT_SIGNING_PRIVATE_KEY", () => {
    const envExample = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    assert.match(envExample, /^RECEIPT_SIGNING_PRIVATE_KEY=REPLACE_ME_/m);
  });
});

describe("T8.2b — Key generator safety rules (isolated tmpdir + throwaway git repo)", () => {
  it("refuses --write-env .env.example and leaves .env.example unchanged", () => {
    const dir = makeThrowawayGitRepo(".env\n");
    try {
      const envExample = path.join(dir, ".env.example");
      const pubFile = path.join(dir, "keys/pub.json");
      const original = "RECEIPT_SIGNING_PRIVATE_KEY=REPLACE_ME_example\n";
      writeFileSync(envExample, original, "utf8");

      const res = runKeygen(["--write-env", envExample, "--write-public", pubFile]);
      assert.equal(res.exitCode, 1);
      assert.equal(readFileSync(envExample, "utf8"), original);
      assert.equal(existsSync(pubFile), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses any --write-env path whose basename is not exactly .env", () => {
    const dir = makeThrowawayGitRepo("*.env\n.env.*\n");
    try {
      const otherFile = path.join(dir, "local.env");
      const pubFile = path.join(dir, "keys/pub.json");
      const res = runKeygen(["--write-env", otherFile, "--write-public", pubFile]);
      assert.equal(res.exitCode, 1);
      assert.equal(existsSync(otherFile), false);
      assert.equal(existsSync(pubFile), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an .env file that git does not ignore", () => {
    const dir = makeThrowawayGitRepo("*.log\n"); // .env NOT ignored
    try {
      const envFile = path.join(dir, ".env");
      const pubFile = path.join(dir, "keys/pub.json");
      const res = runKeygen(["--write-env", envFile, "--write-public", pubFile]);
      assert.equal(res.exitCode, 1);
      assert.equal(existsSync(envFile), false);
      assert.equal(existsSync(pubFile), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses symlink bypass for .env target", () => {
    const dir = makeThrowawayGitRepo(".env\n");
    try {
      const trackedTarget = path.join(dir, ".env.example");
      const symlinkEnv = path.join(dir, ".env");
      const pubFile = path.join(dir, "keys/pub.json");
      const original = "RECEIPT_SIGNING_PRIVATE_KEY=REPLACE_ME_example\n";
      writeFileSync(trackedTarget, original, "utf8");

      let createdSymlink = false;
      try {
        symlinkSync(trackedTarget, symlinkEnv);
        createdSymlink = true;
      } catch {
        // Windows without Developer Mode may disallow file symlinks; skip only symlink creation.
      }
      if (createdSymlink) {
        const res = runKeygen(["--write-env", symlinkEnv, "--write-public", pubFile]);
        assert.equal(res.exitCode, 1);
        assert.equal(readFileSync(trackedTarget, "utf8"), original);
        assert.equal(existsSync(pubFile), false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing real RECEIPT_SIGNING_PRIVATE_KEY (with or without fresh public path)", () => {
    const dir = makeThrowawayGitRepo(".env\n");
    try {
      const envFile = path.join(dir, ".env");
      const pubFile = path.join(dir, "keys/fresh-pub.json");
      const existingContent = "OTHER=1\nRECEIPT_SIGNING_PRIVATE_KEY=real-existing-key-value\n";
      writeFileSync(envFile, existingContent, "utf8");

      const res = runKeygen(["--write-env", envFile, "--write-public", pubFile]);
      assert.equal(res.exitCode, 1);
      assert.equal(readFileSync(envFile, "utf8"), existingContent);
      assert.equal(existsSync(pubFile), false);
      assert.equal(res.stderr.includes("real-existing-key-value"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces a REPLACE_ME_... placeholder and never leaks the private key in stdout, stderr, or public file", () => {
    const dir = makeThrowawayGitRepo(".env\n");
    try {
      const envFile = path.join(dir, ".env");
      const pubFile = path.join(dir, "keys/receipt-signing-public.json");
      writeFileSync(envFile, "FOO=bar\nRECEIPT_SIGNING_PRIVATE_KEY=REPLACE_ME_placeholder\n", "utf8");

      const res = runKeygen(["--write-env", envFile, "--write-public", pubFile]);
      assert.equal(res.exitCode, 0, res.stderr);

      const envAfter = readFileSync(envFile, "utf8");
      const match = /^RECEIPT_SIGNING_PRIVATE_KEY=(.+)$/m.exec(envAfter);
      assert.ok(match, "RECEIPT_SIGNING_PRIVATE_KEY must be written to .env");
      const writtenKey = match[1].trim();
      assert.ok(writtenKey.startsWith(PKCS8_ED25519_BASE64URL_PREFIX));
      assert.equal(envAfter.includes("FOO=bar"), true);

      const pubRaw = readFileSync(pubFile, "utf8");
      assert.equal(res.stdout.includes(writtenKey), false);
      assert.equal(res.stderr.includes(writtenKey), false);
      assert.equal(pubRaw.includes(writtenKey), false);
      assert.equal(pubRaw.includes(PKCS8_ED25519_BASE64URL_PREFIX), false);

      const pubDoc = JSON.parse(pubRaw);
      assert.doesNotThrow(() => verifyPublicKeyDocument(pubDoc));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing --write-env, empty flag value, unknown flags, and --force without writing any file", () => {
    const dir = makeThrowawayGitRepo(".env\n");
    try {
      const envFile = path.join(dir, ".env");
      const pubFile = path.join(dir, "keys/pub.json");

      const missingEnvRes = runKeygen(["--write-public", pubFile]);
      assert.equal(missingEnvRes.exitCode, 1);
      assert.match(missingEnvRes.stderr, /Missing required argument --write-env/i);
      assert.equal(existsSync(envFile), false);
      assert.equal(existsSync(pubFile), false);

      for (const badArgs of [
        ["--write-env", "", "--write-public", pubFile],
        ["--write-env", envFile, "--write-public", ""],
        ["--write-env", envFile, "--write-public", pubFile, "--unknown"],
        ["--write-env", envFile, "--write-public", pubFile, "--force"],
      ]) {
        const res = runKeygen(badArgs);
        assert.equal(res.exitCode, 1, `Expected failure for args: ${JSON.stringify(badArgs)}`);
        assert.equal(existsSync(envFile), false);
        assert.equal(existsSync(pubFile), false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never overwrites an existing public key file", () => {
    const dir = makeThrowawayGitRepo(".env\n");
    try {
      const envFile = path.join(dir, ".env");
      const pubFile = path.join(dir, "pub.json");
      const sentinel = '{"sentinel":true}\n';
      writeFileSync(pubFile, sentinel, "utf8");

      const res = runKeygen(["--write-env", envFile, "--write-public", pubFile]);
      assert.equal(res.exitCode, 1);
      assert.equal(readFileSync(pubFile, "utf8"), sentinel);
      assert.equal(existsSync(envFile), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not write the public key file if the .env write fails (missing folder or read-only .env)", () => {
    const dir = makeThrowawayGitRepo(".env\n");
    try {
      // Case 1: missing parent folder for .env
      const missingEnv = path.join(dir, "does-not-exist", ".env");
      const pubFile1 = path.join(dir, "pub1.json");
      const res1 = runKeygen(["--write-env", missingEnv, "--write-public", pubFile1]);
      assert.equal(res1.exitCode, 1);
      assert.equal(existsSync(pubFile1), false);

      // Case 2: read-only .env
      const roEnv = path.join(dir, ".env");
      const pubFile2 = path.join(dir, "pub2.json");
      writeFileSync(roEnv, "RECEIPT_SIGNING_PRIVATE_KEY=REPLACE_ME_ro\n", "utf8");
      chmodSync(roEnv, 0o444);
      try {
        const res2 = runKeygen(["--write-env", roEnv, "--write-public", pubFile2]);
        assert.equal(res2.exitCode, 1);
        assert.equal(existsSync(pubFile2), false);
      } finally {
        chmodSync(roEnv, 0o666);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
