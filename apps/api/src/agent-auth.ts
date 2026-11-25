// T1.1a, Blueprint Sections 6.1 and 6.2 (decisions D7, D31, D32, D33): agent credentials.
// An agent authenticates with its own bearer token. Only the SHA-256 of the token is stored
// (agents.credential_hash). The owner session cookie is never read here, so it can never act as an agent.
// Nothing in this file logs. Never add a log line that prints a token, a hash or a request header.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "@seyvixa/shared";

// The only thing this file needs from the database. A pg Client or Pool fits.
export type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

export const AGENT_TOKEN_PREFIX = "sva_";
// "sva_" + base64url of 32 random bytes (43 characters, no padding).
const TOKEN_PATTERN = /^sva_[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export const SEED_CREDENTIAL_MIN_LENGTH = 32;
export const SEED_PLACEHOLDER_PREFIX = "REPLACE_ME";

export function generateAgentToken(): string {
  return AGENT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashAgentToken(token: string): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Refusing to hash an empty agent token");
  }
  return sha256Hex(token);
}

// Creates an agent and returns the token once. The token is not stored anywhere.
export async function createAgent(
  db: Queryable,
  input: { name: string; status?: string },
): Promise<{ id: string; token: string }> {
  const token = generateAgentToken();
  const result = await db.query(
    "INSERT INTO agents (name, status, credential_hash) VALUES ($1, $2, $3) RETURNING id",
    [input.name, input.status ?? "ACTIVE", hashAgentToken(token)],
  );
  const id = result.rows[0]?.id;
  if (typeof id !== "string") throw new Error("Agent insert returned no id");
  return { id, token };
}

// For the seed script (decision D31): reads one agent credential from the environment and returns the
// hash to store. Fails if the value is missing, too short or still the .env.example placeholder.
// The error text names the variable only, never the value.
export function credentialHashFromEnv(
  name: string,
  env: Record<string, string | undefined>,
): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Generate one and put it in .env (see .env.example).`);
  }
  if (value.startsWith(SEED_PLACEHOLDER_PREFIX)) {
    throw new Error(`${name} is still the .env.example placeholder. Put a generated token in .env.`);
  }
  if (value.length < SEED_CREDENTIAL_MIN_LENGTH) {
    throw new Error(`${name} must be at least ${SEED_CREDENTIAL_MIN_LENGTH} characters.`);
  }
  return hashAgentToken(value);
}

export type AuthRequest = {
  headers: Record<string, string | string[] | undefined>;
  // query, body and cookies are deliberately not part of this type: they are never read.
};

// One generic failure kind for every authentication problem, so a caller learns nothing about why.
// AGENT_INACTIVE is returned only after a valid token (reason code D4).
export type AuthResult =
  | { ok: true; agentId: string }
  | { ok: false; kind: "UNAUTHENTICATED" }
  | { ok: false; kind: "AGENT_INACTIVE"; reasonCode: "AGENT_INACTIVE"; agentId: string };

const UNAUTHENTICATED: AuthResult = { ok: false, kind: "UNAUTHENTICATED" };

// Accepts exactly one header: "Authorization: Bearer <token>". Capital B, one space, no extra whitespace,
// token in the exact format generateAgentToken produces. Anything else returns null.
export function readBearerToken(headers: AuthRequest["headers"]): string | null {
  const values = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === "authorization")
    .map(([, value]) => value);
  if (values.length !== 1) return null; // missing, or the same header under two spellings
  const value = values[0];
  if (typeof value !== "string") return null; // an array means a duplicate header
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

function hashesEqual(a: string, b: string): boolean {
  if (!HASH_PATTERN.test(a) || !HASH_PATTERN.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

// Fails closed: a missing or malformed header, an unknown token, a database error and a duplicate
// credential all return UNAUTHENTICATED. It never throws and never reads the owner session cookie.
export async function authenticateAgent(request: AuthRequest, db: Queryable): Promise<AuthResult> {
  try {
    const token = readBearerToken(request.headers);
    if (token === null) return UNAUTHENTICATED;
    const presentedHash = hashAgentToken(token);

    // A NULL credential_hash never equals a parameter, so such an agent is never returned.
    const result = await db.query(
      "SELECT id, status, credential_hash FROM agents WHERE credential_hash = $1",
      [presentedHash],
    );
    if (result.rows.length !== 1) return UNAUTHENTICATED; // none, or a duplicated hash
    const row = result.rows[0]!;
    const { id, status, credential_hash: storedHash } = row;
    if (typeof id !== "string" || typeof storedHash !== "string") return UNAUTHENTICATED;
    if (!hashesEqual(presentedHash, storedHash)) return UNAUTHENTICATED;

    // Only a valid token reaches this line. Anything other than "ACTIVE" counts as inactive.
    if (status !== "ACTIVE") {
      return { ok: false, kind: "AGENT_INACTIVE", reasonCode: "AGENT_INACTIVE", agentId: id };
    }
    return { ok: true, agentId: id };
  } catch {
    return UNAUTHENTICATED;
  }
}
