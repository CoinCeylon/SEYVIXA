// T8.3 — Standalone CLI verifier for SEYVIXA TrustOS receipts (Blueprint Section 6.8).
// Usage:
//   node tools/verifier/src/cli.ts --receipt <path.json> --trusted-fingerprint <64-hex>
//
// Rejects missing or malformed --trusted-fingerprint before reading any file.
// Outputs VERIFIED, REJECTED, or UNVERIFIABLE plus the list of checks. Never prints secrets.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidFingerprint, verifyReceipt } from "./verify.ts";

export interface CliArgs {
  readonly receiptPath: string;
  readonly trustedFingerprint: string;
  readonly publicKeyPath?: string;
}

export function parseCliArgs(argv: readonly string[]): { ok: true; args: CliArgs } | { ok: false; error: string } {
  let receiptPath = "";
  let trustedFingerprint = "";
  let publicKeyPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--receipt" && argv[i + 1]) {
      receiptPath = argv[i + 1];
      i += 1;
    } else if (flag === "--trusted-fingerprint" && argv[i + 1]) {
      trustedFingerprint = argv[i + 1];
      i += 1;
    } else if (flag === "--public-key" && argv[i + 1]) {
      publicKeyPath = argv[i + 1];
      i += 1;
    }
  }

  // Reject missing or malformed fingerprint BEFORE reading any file (T8.3 Step 2).
  if (!isValidFingerprint(trustedFingerprint)) {
    return {
      ok: false,
      error: "Missing or malformed --trusted-fingerprint (expected 64 lowercase hex characters).",
    };
  }

  if (receiptPath.trim().length === 0) {
    return {
      ok: false,
      error: "Missing --receipt <path.json> argument.",
    };
  }

  return {
    ok: true,
    args: {
      receiptPath,
      trustedFingerprint,
      publicKeyPath,
    },
  };
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok) {
    console.log("REJECTED");
    console.log(`- [FAIL] CLI arguments: ${parsed.error}`);
    return 1;
  }

  let receiptJson: unknown;
  try {
    receiptJson = JSON.parse(readFileSync(path.resolve(parsed.args.receiptPath), "utf8"));
  } catch {
    console.log("REJECTED");
    console.log("- [FAIL] Receipt file: Could not read or parse receipt JSON.");
    return 1;
  }

  const report = await verifyReceipt(receiptJson, parsed.args.trustedFingerprint, {
    publicKeyPath: parsed.args.publicKeyPath ? path.resolve(parsed.args.publicKeyPath) : undefined,
  });

  console.log(report.verdict);
  console.log(`View checked: ${report.view}`);
  for (const c of report.checks) {
    const tag = c.status === "pass" ? "PASS" : c.status === "fail" ? "FAIL" : "UNVERIFIABLE";
    console.log(`- [${tag}] Check ${String(c.check)} (${c.name}): ${c.message}`);
  }

  if (report.verdict === "VERIFIED") return 0;
  if (report.verdict === "UNVERIFIABLE") return 2;
  return 1;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
