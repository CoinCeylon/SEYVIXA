// T8.4 — Demo tamper script for test P0-7 ("altered receipt fails verification", Blueprint §6.8).
// Takes a simulated validly signed receipt, alters ONE field from:
//   locked_lovelace | total_lkr | outcome | release_tx_id
// writes the altered copy to a new file (never overwrites the original, never re-signs),
// runs the real verifier CLI (`tools/verifier/src/cli.ts`), and prints the observed verdict.
// Never reads `keys/**` or `.env` private keys. Never hardcodes verifier results.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const VERIFIER_ROOT = path.resolve(DIR, "..");

export const DEFAULT_FIXTURE_RECEIPT_PATH = path.join(
  VERIFIER_ROOT,
  "fixtures/simulated-receipt-full.json",
);
export const DEFAULT_FIXTURE_PUBLIC_KEY_PATH = path.join(
  VERIFIER_ROOT,
  "fixtures/simulated-demo-public-key.json",
);
export const VERIFIER_CLI_PATH = path.join(VERIFIER_ROOT, "src/cli.ts");

export const TAMPERABLE_FIELDS = [
  "locked_lovelace",
  "total_lkr",
  "outcome",
  "release_tx_id",
] as const;

export type TamperableField = (typeof TAMPERABLE_FIELDS)[number];

export function isTamperableField(value: string): value is TamperableField {
  return (TAMPERABLE_FIELDS as readonly string[]).includes(value);
}

/**
 * Returns a deep-cloned copy of `receipt` with exactly ONE field altered.
 * Never mutates the input object and never re-signs the receipt.
 */
export function tamperReceiptObject(
  receipt: Record<string, unknown>,
  field: TamperableField,
): Record<string, unknown> {
  const copy = structuredClone(receipt);
  const chain = copy.chain as Record<string, unknown> | undefined;
  const approvedAction = copy.approved_action as Record<string, unknown> | undefined;

  if (field === "locked_lovelace") {
    if (!chain || typeof chain.locked_lovelace !== "number") {
      throw new Error('Receipt is missing numeric "chain.locked_lovelace".');
    }
    chain.locked_lovelace = chain.locked_lovelace + 1_000_000;
  } else if (field === "total_lkr") {
    if (!approvedAction || typeof approvedAction.total_lkr !== "string") {
      throw new Error('Receipt is missing string "approved_action.total_lkr" (requires full view).');
    }
    approvedAction.total_lkr =
      approvedAction.total_lkr === "99999.00" ? "88888.00" : "99999.00";
  } else if (field === "outcome") {
    if (!chain || typeof chain.outcome !== "string") {
      throw new Error('Receipt is missing string "chain.outcome".');
    }
    chain.outcome = chain.outcome === "released" ? "locked" : "released";
  } else if (field === "release_tx_id") {
    if (!chain || typeof chain.release_tx_id !== "string") {
      throw new Error('Receipt is missing string "chain.release_tx_id".');
    }
    chain.release_tx_id =
      chain.release_tx_id === "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        ? "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        : "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  }

  return copy;
}

export interface TamperRunOptions {
  readonly field: TamperableField;
  readonly receiptPath?: string;
  readonly outPath?: string;
  readonly publicKeyPath?: string;
  readonly trustedFingerprint?: string;
}

export interface TamperRunResult {
  readonly field: TamperableField;
  readonly originalPath: string;
  readonly alteredPath: string;
  readonly verifierExitCode: number;
  readonly verifierVerdict: string;
  readonly verifierOutput: string;
  readonly summaryLine: string;
}

function defaultAlteredPath(originalPath: string, field: TamperableField): string {
  const parsed = path.parse(originalPath);
  return path.join(parsed.dir, `${parsed.name}.tampered.${field}${parsed.ext || ".json"}`);
}

function loadFingerprintFromPublicKeyFile(publicKeyPath: string): string {
  const doc = JSON.parse(readFileSync(publicKeyPath, "utf8")) as { fingerprint?: unknown };
  if (typeof doc.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(doc.fingerprint)) {
    throw new Error(`Public key file ${publicKeyPath} does not contain a valid 64-hex fingerprint.`);
  }
  return doc.fingerprint;
}

/**
 * Alters one field in a copy of the receipt, writes the copy to `outPath` (never overwriting the original),
 * and runs the real verifier CLI (`tools/verifier/src/cli.ts`) on the altered copy.
 */
export function runTamperDemo(options: TamperRunOptions): TamperRunResult {
  const originalPath = path.resolve(options.receiptPath ?? DEFAULT_FIXTURE_RECEIPT_PATH);
  const alteredPath = path.resolve(options.outPath ?? defaultAlteredPath(originalPath, options.field));
  const publicKeyPath = path.resolve(options.publicKeyPath ?? DEFAULT_FIXTURE_PUBLIC_KEY_PATH);

  if (path.resolve(originalPath).toLowerCase() === path.resolve(alteredPath).toLowerCase()) {
    throw new Error("Refusing to overwrite the original receipt file; choose a distinct --out path.");
  }

  const trustedFingerprint =
    options.trustedFingerprint ?? loadFingerprintFromPublicKeyFile(publicKeyPath);

  const originalReceipt = JSON.parse(readFileSync(originalPath, "utf8")) as Record<string, unknown>;
  const tamperedReceipt = tamperReceiptObject(originalReceipt, options.field);
  writeFileSync(alteredPath, `${JSON.stringify(tamperedReceipt, null, 2)}\n`, "utf8");

  let verifierOutput = "";
  let verifierExitCode = 0;
  try {
    verifierOutput = execFileSync(
      process.execPath,
      [
        VERIFIER_CLI_PATH,
        "--receipt",
        alteredPath,
        "--trusted-fingerprint",
        trustedFingerprint,
        "--public-key",
        publicKeyPath,
      ],
      { encoding: "utf8" },
    );
  } catch (err) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string };
    verifierExitCode = typeof execErr.status === "number" ? execErr.status : 1;
    verifierOutput = `${execErr.stdout ?? ""}${execErr.stderr ?? ""}`;
  }

  const firstLine = verifierOutput.trim().split(/\r?\n/)[0]?.trim() || "UNKNOWN";
  const summaryLine = `Altered field ${options.field}; verifier result ${firstLine}.`;

  return {
    field: options.field,
    originalPath,
    alteredPath,
    verifierExitCode,
    verifierVerdict: firstLine,
    verifierOutput: verifierOutput.trim(),
    summaryLine,
  };
}

function parseArgs(argv: readonly string[]): TamperRunOptions {
  let field: string = "locked_lovelace";
  let receiptPath: string | undefined;
  let outPath: string | undefined;
  let publicKeyPath: string | undefined;
  let trustedFingerprint: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--field" && argv[i + 1]) {
      field = argv[i + 1];
      i += 1;
    } else if (arg === "--receipt" && argv[i + 1]) {
      receiptPath = argv[i + 1];
      i += 1;
    } else if (arg === "--out" && argv[i + 1]) {
      outPath = argv[i + 1];
      i += 1;
    } else if (arg === "--public-key" && argv[i + 1]) {
      publicKeyPath = argv[i + 1];
      i += 1;
    } else if (arg === "--trusted-fingerprint" && argv[i + 1]) {
      trustedFingerprint = argv[i + 1];
      i += 1;
    }
  }

  if (!isTamperableField(field)) {
    throw new Error(
      `Unsupported --field "${field}". Choose one of: ${TAMPERABLE_FIELDS.join(", ")}.`,
    );
  }

  return { field, receiptPath, outPath, publicKeyPath, trustedFingerprint };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const result = runTamperDemo(parseArgs(process.argv.slice(2)));
  console.log(result.verifierOutput);
  console.log(result.summaryLine);
}
