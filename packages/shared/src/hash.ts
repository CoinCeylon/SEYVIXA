// T0.3a, Blueprint Section 6.5: action_hash = SHA-256(canonical JSON).
// Node only (uses node:crypto). Strings are encoded as UTF-8.
import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.ts";

/** SHA-256 of the bytes (or of the UTF-8 encoding of the string), as lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** action_hash: SHA-256 over the RFC 8785 canonical form of the value, lowercase hex. */
export function actionHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
