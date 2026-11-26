// T1.1b, Blueprint 6.1 (grant integrity protection), decisions D10, D21, D30.
// The integrity tag of an agent grant: HMAC-SHA256 over the canonical JSON of every grant field except
// the tag, with a server key (GRANT_INTEGRITY_KEY). The seed and the gateway both call this one function,
// so they always produce the same tag for the same grant. Do not write a second HMAC anywhere.
import { createHmac } from "node:crypto";
import { z } from "zod";
import { canonicalize } from "./canonical.ts";
import { idSchema, lkrAmountSchema, textSchema, timestampSchema } from "./primitives.ts";

// A time may arrive as an ISO string (the seed) or a Date (what pg returns). Both give one form.
const timeInput = z.union([timestampSchema, z.date()]);

// Exactly these keys. A missing or extra key is an error, so a field can never be left out of the tag.
export const grantWithoutTagSchema = z.strictObject({
  id: idSchema,
  agent_id: idSchema,
  owner_id: idSchema,
  scopes: z.array(textSchema),
  spend_limit: lkrAmountSchema, // string such as "120000.00" (pg returns numeric as a string)
  expires_at: timeInput,
  revoked_at: timeInput.nullable(),
  issuer: textSchema,
});
export type GrantWithoutTag = z.input<typeof grantWithoutTagSchema>;

function isoTime(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Grant time is not a valid date");
  return date.toISOString();
}

// "120000" -> "120000.00", "5.5" -> "5.50". String work only, no floats.
function twoDecimals(amount: string): string {
  const [whole, fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/** Lowercase hex HMAC-SHA256 of the canonical JSON of the grant fields (without the tag). */
export function computeGrantIntegrityTag(grantWithoutTag: GrantWithoutTag, key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("GRANT_INTEGRITY_KEY is missing or empty");
  }
  const grant = grantWithoutTagSchema.parse(grantWithoutTag);
  const normalised = {
    id: grant.id.toLowerCase(),
    agent_id: grant.agent_id.toLowerCase(),
    owner_id: grant.owner_id.toLowerCase(),
    scopes: grant.scopes,
    spend_limit: twoDecimals(grant.spend_limit),
    expires_at: isoTime(grant.expires_at),
    revoked_at: grant.revoked_at === null ? null : isoTime(grant.revoked_at),
    issuer: grant.issuer,
  };
  return createHmac("sha256", key).update(canonicalize(normalised)).digest("hex");
}
