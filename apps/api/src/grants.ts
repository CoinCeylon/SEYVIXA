// T1.1b, Blueprint 6.1 (agent permissions) and 7, decisions D10, D21, D30, D32.
// Scope-list grants with expiry and revocation. Each grant carries an HMAC integrity tag over every
// other field (computeGrantIntegrityTag in packages/shared). loadValidGrant checks the tag, revocation
// and expiry on every call, and fails closed. Nothing here logs a key or a tag.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { computeGrantIntegrityTag, type ReasonCode } from "@seyvixa/shared";
import type { Queryable } from "./agent-auth.ts";

// The issuer of a grant created through the API. Set by the server, never by the request.
export const API_GRANT_ISSUER = "seyvixa-gateway";

// Tool scopes (decision D30). The budget scopes are used by the budget routes, not by action types.
// No approval or escrow scope exists, so a grant can never carry one (Blueprint 6.1).
export const TOOL_SCOPES = [
  "supplier:search",
  "quote:read",
  "file:read",
  "proposal:prepare",
  "budget:read",
  "budget:check",
  "budget:reserve",
] as const;

const RESOURCE_PREFIX = "resource:";
// Letters, digits and . _ / - ; a "*" is allowed only as the last character.
const RESOURCE_PATTERN = /^[A-Za-z0-9._/-]+\*?$/;
const PROTECTED_RESOURCE = "payroll.csv";

// True if the resource scope (for example "resource:quotes/*") covers the resource name.
// It equals the text after the prefix, or, if it ends with "*", starts with the text before the "*".
export function resourceScopeMatches(scope: string, resource: string): boolean {
  if (!scope.startsWith(RESOURCE_PREFIX)) return false;
  const pattern = scope.slice(RESOURCE_PREFIX.length);
  if (pattern.endsWith("*")) return resource.startsWith(pattern.slice(0, -1));
  return pattern === resource;
}

// Returns a list of problems, empty if the scope list is acceptable for a new grant.
export function checkScopesForNewGrant(scopes: readonly string[]): string[] {
  const problems: string[] = [];
  if (scopes.length === 0) problems.push("at least one scope is required");
  if (new Set(scopes).size !== scopes.length) problems.push("duplicate scopes");
  for (const scope of scopes) {
    if (scope.startsWith(RESOURCE_PREFIX)) {
      const pattern = scope.slice(RESOURCE_PREFIX.length);
      if (!RESOURCE_PATTERN.test(pattern) || pattern.includes("..") || pattern.startsWith("/")) {
        problems.push(`malformed resource scope: ${scope}`);
      } else if (resourceScopeMatches(scope, PROTECTED_RESOURCE)) {
        problems.push(`resource scope matches ${PROTECTED_RESOURCE}: ${scope}`);
      }
    } else if (!(TOOL_SCOPES as readonly string[]).includes(scope)) {
      problems.push(`unknown scope: ${scope}`);
    }
  }
  return problems;
}

export type Grant = {
  id: string;
  agent_id: string;
  owner_id: string;
  scopes: string[];
  spend_limit: string;
  expires_at: Date;
  revoked_at: Date | null;
  issuer: string;
  integrity_tag: string;
};

const COLUMNS = "id, agent_id, owner_id, scopes, spend_limit, expires_at, revoked_at, issuer, integrity_tag";

function toGrant(row: Record<string, unknown>): Grant {
  return row as unknown as Grant;
}

function tagInput(grant: Grant) {
  const { integrity_tag: _tag, ...rest } = grant;
  return rest;
}

const HEX64 = /^[0-9a-f]{64}$/;

// True only if the stored tag equals the tag recomputed from the stored fields. Any error means false.
function tagIsValid(grant: Grant, key: string): boolean {
  try {
    if (typeof grant.integrity_tag !== "string" || !HEX64.test(grant.integrity_tag)) return false;
    const expected = computeGrantIntegrityTag(tagInput(grant), key);
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(grant.integrity_tag, "hex"));
  } catch {
    return false;
  }
}

export async function createGrant(
  db: Queryable,
  input: {
    ownerId: string;
    agentId: string;
    scopes: string[];
    spendLimit: string;
    expiresAt: Date;
    issuer: string;
  },
  key: string,
): Promise<Grant> {
  const id = randomUUID();
  const fields = {
    id,
    agent_id: input.agentId,
    owner_id: input.ownerId,
    scopes: input.scopes,
    spend_limit: input.spendLimit,
    expires_at: input.expiresAt,
    revoked_at: null,
    issuer: input.issuer,
  };
  const tag = computeGrantIntegrityTag(fields, key);
  const result = await db.query(
    `INSERT INTO agent_grants (id, agent_id, owner_id, scopes, spend_limit, expires_at, revoked_at, issuer, integrity_tag)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8) RETURNING ${COLUMNS}`,
    [id, input.agentId, input.ownerId, input.scopes, input.spendLimit, input.expiresAt, input.issuer, tag],
  );
  return toGrant(result.rows[0]!);
}

export type GrantCheck =
  | { ok: true; grant: Grant }
  | {
      ok: false;
      reasonCode: Extract<
        ReasonCode,
        "GRANT_MISSING" | "GRANT_INTEGRITY_FAILED" | "GRANT_REVOKED" | "GRANT_EXPIRED"
      >;
    };

// The one place a grant is accepted. Every call verifies the integrity tag, revocation and expiry.
// An agent may hold several grants. All of them are checked: one tampered grant fails the whole check
// (GRANT_INTEGRITY_FAILED), then the usable grant with the latest expiry is returned. If none is
// usable the code is GRANT_REVOKED when every grant is revoked, otherwise GRANT_EXPIRED.
// Any database or other error fails closed with GRANT_INTEGRITY_FAILED.
export async function loadValidGrant(
  db: Queryable,
  agentId: string,
  key: string,
  now: Date = new Date(),
): Promise<GrantCheck> {
  try {
    const result = await db.query(`SELECT ${COLUMNS} FROM agent_grants WHERE agent_id = $1`, [agentId]);
    const grants = result.rows.map(toGrant);
    if (grants.length === 0) return { ok: false, reasonCode: "GRANT_MISSING" };

    if (grants.some((grant) => !tagIsValid(grant, key))) {
      return { ok: false, reasonCode: "GRANT_INTEGRITY_FAILED" };
    }
    const live = grants.filter((g) => g.revoked_at === null && g.expires_at.getTime() > now.getTime());
    if (live.length > 0) {
      live.sort((a, b) => b.expires_at.getTime() - a.expires_at.getTime());
      return { ok: true, grant: live[0]! };
    }
    const allRevoked = grants.every((g) => g.revoked_at !== null);
    return { ok: false, reasonCode: allRevoked ? "GRANT_REVOKED" : "GRANT_EXPIRED" };
  } catch {
    return { ok: false, reasonCode: "GRANT_INTEGRITY_FAILED" };
  }
}

// Revokes one grant of this owner. revoked_at is part of the tag, so the tag is recomputed. A grant whose
// tag does not verify is never re-signed. The UPDATE only applies if the stored tag is still the one that
// was verified, so a concurrent change makes it fail instead of signing a stale copy.
export async function revokeGrant(
  db: Queryable,
  input: { grantId: string; ownerId: string },
  key: string,
  now: Date = new Date(),
): Promise<Grant> {
  const found = await db.query(`SELECT ${COLUMNS} FROM agent_grants WHERE id = $1 AND owner_id = $2`, [
    input.grantId,
    input.ownerId,
  ]);
  if (found.rows.length !== 1) throw new Error("Grant not found for this owner");
  const grant = toGrant(found.rows[0]!);
  if (!tagIsValid(grant, key)) throw new Error("Grant failed its integrity check; not revoked or re-signed");
  if (grant.revoked_at !== null) return grant; // already revoked: keep the first revocation time

  const newTag = computeGrantIntegrityTag({ ...tagInput(grant), revoked_at: now }, key);
  const updated = await db.query(
    `UPDATE agent_grants SET revoked_at = $1, integrity_tag = $2
     WHERE id = $3 AND owner_id = $4 AND integrity_tag = $5 AND revoked_at IS NULL RETURNING ${COLUMNS}`,
    [now, newTag, grant.id, input.ownerId, grant.integrity_tag],
  );
  if (updated.rows.length !== 1) throw new Error("Grant changed while revoking; try again");
  return toGrant(updated.rows[0]!);
}

// The HMAC key comes from the environment only. Missing or empty is an error that names the variable.
export function grantIntegrityKeyFromEnv(env: Record<string, string | undefined>): string {
  const key = env.GRANT_INTEGRITY_KEY;
  if (key === undefined || key === "") throw new Error("GRANT_INTEGRITY_KEY is not set (see .env.example)");
  return key;
}
