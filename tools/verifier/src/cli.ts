// T8.3 & T8.3b — Standalone CLI verifier for SEYVIXA TrustOS receipts (Blueprint Section 6.8).
// Usage:
//   node tools/verifier/src/cli.ts --receipt <path.json> --trusted-fingerprint <64-hex>
//
// Security rules (T8.3b):
// - Allows ONLY `--receipt` and `--trusted-fingerprint` (no `--public-key` flag; key always
//   comes from `keys/receipt-signing-public.json` and is pinned by `--trusted-fingerprint`).
// - Rejects missing or malformed `--trusted-fingerprint` before reading any file.
// - Top-level catch prints `UNVERIFIABLE` and exits with code 2 (no stack trace, no config values).
// - Verdict output always displays any fallback label and the honest Check 6 Midnight note.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FALLBACK_CHECK2_STATUS,
  MIDNIGHT_HONEST_NOTE,
  isValidFingerprint,
  verifyReceipt,
} from "./verify.ts";

export interface CliArgs {
  readonly receiptPath: string;
  readonly trustedFingerprint: string;
}

export function parseCliArgs(
  argv: readonly string[],
): { ok: true; args: CliArgs } | { ok: false; error: string } {
  let receiptPath = "";
  let trustedFingerprint = "";

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--receipt" && argv[i + 1]) {
      receiptPath = argv[i + 1];
      i += 1;
    } else if (flag === "--trusted-fingerprint" && argv[i + 1]) {
      trustedFingerprint = argv[i + 1];
      i += 1;
    } else {
      return {
        ok: false,
        error: `Unknown or incomplete argument "${flag}". Only --receipt and --trusted-fingerprint are supported.`,
      };
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
    },
  };
}

export async function runCli(argv: readonly string[]): Promise<number> {
  try {
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

    const report = await verifyReceipt(receiptJson, parsed.args.trustedFingerprint);

    const verdictLine = report.fallbackLabel
      ? `${report.verdict} (${report.fallbackLabel})`
      : report.verdict;
    console.log(verdictLine);
    console.log(`Midnight: ${report.midnightNote}`);
    console.log(`View checked: ${report.view}`);
    for (const c of report.checks) {
      const tag =
        c.status === "pass"
          ? "PASS"
          : c.status === FALLBACK_CHECK2_STATUS
            ? "PASS (FALLBACK)"
            : c.status === "fail"
              ? "FAIL"
              : "UNVERIFIABLE";
      console.log(`- [${tag}] Check ${String(c.check)} (${c.name}): ${c.message}`);
    }

    if (report.verdict === "VERIFIED") return 0;
    if (report.verdict === "UNVERIFIABLE") return 2;
    return 1;
  } catch {
    // Top-level catch (T8.3b Step 5): never print stack trace or config/secret values.
    console.log("UNVERIFIABLE");
    console.log(`Midnight: ${MIDNIGHT_HONEST_NOTE}`);
    console.log("- [UNVERIFIABLE] Unexpected verifier runtime error.");
    return 2;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
