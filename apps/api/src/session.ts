// T2.1, Blueprint 6.1 and 9 (item 10), decision D19 and D35: the owner session.
// The demo owner logs in with the seeded login (DEMO_OWNER_LOGIN / DEMO_OWNER_PASSWORD from .env). The server
// then keeps a session and sends an HttpOnly cookie. Every owner request derives owner_id from that session
// and from nothing else. Nothing here logs. Never add a log line that prints a password, a session id or a header.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "@seyvixa/shared";

// Seeded owner id (docs/SEED_SPEC.md 3.1). A successful login maps to this user.
export const DEMO_OWNER_ID = "10000000-0000-4000-8000-000000000001";

export const SESSION_COOKIE = "sva_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 60 * 1000;

export const OWNER_PASSWORD_MIN_LENGTH = 12;
export const OWNER_PLACEHOLDER_PREFIX = "REPLACE_ME";

// 32 random bytes as base64url: 43 characters, no padding.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type OwnerLogin = { login: string; password: string };

// Reads the demo owner login from the environment. Fails if a value is missing, empty or still the
// .env.example placeholder, or the password is too short. The error names the variable, never the value.
export function ownerLoginFromEnv(env: Record<string, string | undefined>): OwnerLogin {
  const login = env.DEMO_OWNER_LOGIN;
  const password = env.DEMO_OWNER_PASSWORD;
  if (login === undefined || login === "") throw new Error("DEMO_OWNER_LOGIN is not set (see .env.example)");
  if (password === undefined || password === "") {
    throw new Error("DEMO_OWNER_PASSWORD is not set (see .env.example)");
  }
  if (login.startsWith(OWNER_PLACEHOLDER_PREFIX)) {
    throw new Error("DEMO_OWNER_LOGIN is still the .env.example placeholder; set your own value in .env");
  }
  if (password.startsWith(OWNER_PLACEHOLDER_PREFIX)) {
    throw new Error("DEMO_OWNER_PASSWORD is still the .env.example placeholder; set your own value in .env");
  }
  if (password.length < OWNER_PASSWORD_MIN_LENGTH) {
    throw new Error(`DEMO_OWNER_PASSWORD must be at least ${OWNER_PASSWORD_MIN_LENGTH} characters`);
  }
  return { login, password };
}

function digestMatches(expected: string, given: string): boolean {
  return timingSafeEqual(Buffer.from(sha256Hex(expected), "hex"), Buffer.from(sha256Hex(given), "hex"));
}

// Compares both values by their SHA-256 digests in constant time. Both are always compared.
export function loginMatches(expected: OwnerLogin, given: { login: unknown; password: unknown }): boolean {
  if (typeof given.login !== "string" || typeof given.password !== "string") return false;
  const loginOk = digestMatches(expected.login, given.login);
  const passwordOk = digestMatches(expected.password, given.password);
  return loginOk && passwordOk;
}

// Reads the session id from the Cookie header. Strict: exactly one cookie called sva_session, with a value
// that has the exact shape of a session id. Anything else (no header, duplicates, odd shape) is null.
// Only the Cookie header is read: never Authorization, the query string or the body.
export function readSessionCookie(headers: Record<string, string | string[] | undefined>): string | null {
  const header = headers.cookie;
  if (typeof header !== "string") return null;
  let found: string | null = null;
  for (const pair of header.split("; ")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator) !== SESSION_COOKIE) continue;
    if (found !== null) return null;
    found = pair.slice(separator + 1);
  }
  return found !== null && SESSION_ID_PATTERN.test(found) ? found : null;
}

// Server-side sessions, in memory (decision D35): a restart ends every session. Only the SHA-256 of the
// session id is kept, so a memory dump does not give a usable cookie. One session per owner: a new login
// replaces the old one.
export class SessionStore {
  private readonly sessions = new Map<string, { ownerId: string; expiresAt: number }>();
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(now: () => Date = () => new Date(), ttlMs: number = SESSION_TTL_MS) {
    this.now = now;
    this.ttlMs = ttlMs;
  }

  // Returns the new session id. This is the only time the id exists outside the cookie.
  create(ownerId: string): string {
    // Drop this owner's old session and any expired session, so the map does not grow.
    const nowMs = this.now().getTime();
    for (const [key, session] of this.sessions) {
      if (session.ownerId === ownerId || !(session.expiresAt > nowMs)) this.sessions.delete(key);
    }
    const id = randomBytes(32).toString("base64url");
    this.sessions.set(sha256Hex(id), { ownerId, expiresAt: this.now().getTime() + this.ttlMs });
    return id;
  }

  // The owner id of a live session, or null. An expired session is removed.
  ownerFor(id: string | null): string | null {
    if (id === null || !SESSION_ID_PATTERN.test(id)) return null;
    const key = sha256Hex(id);
    const session = this.sessions.get(key);
    if (session === undefined) return null;
    if (!(session.expiresAt > this.now().getTime())) {
      this.sessions.delete(key);
      return null;
    }
    return session.ownerId;
  }
}

// After LOGIN_MAX_FAILURES failed logins in a row, every login attempt gets "locked" for LOGIN_LOCK_MS,
// even with the right password. One counter for the whole server: request.ip is not reliable behind a proxy.
export class LoginLimiter {
  private failures = 0;
  private lockedUntil = 0;
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  // Seconds until a login attempt is allowed again, or 0 if it is allowed now.
  retryAfterSeconds(): number {
    const remaining = this.lockedUntil - this.now().getTime();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= LOGIN_MAX_FAILURES) {
      this.lockedUntil = this.now().getTime() + LOGIN_LOCK_MS;
      this.failures = 0;
    }
  }

  // The login route counts every attempt as a failure before it checks the password (so parallel requests
  // cannot slip past the lock), so a success must clear the count and any lock that attempt itself caused.
  recordSuccess(): void {
    this.failures = 0;
    this.lockedUntil = 0;
  }
}

// Set-Cookie value. HttpOnly always; Secure in production.
export function sessionCookieHeader(id: string, options: { secure: boolean; maxAgeSeconds: number }): string {
  const parts = [`${SESSION_COOKIE}=${id}`, "HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${options.maxAgeSeconds}`];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
