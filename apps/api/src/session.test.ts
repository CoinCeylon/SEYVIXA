// T2.1 unit tests for session.ts. No database needed.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  LOGIN_LOCK_MS,
  LOGIN_MAX_FAILURES,
  LoginLimiter,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SessionStore,
  loginMatches,
  ownerLoginFromEnv,
  readSessionCookie,
  sessionCookieHeader,
} from "./session.ts";

const T0 = new Date("2026-11-27T10:00:00.000Z");
const OWNER = "10000000-0000-4000-8000-000000000001";

describe("ownerLoginFromEnv", () => {
  const good = { DEMO_OWNER_LOGIN: "owner-name", DEMO_OWNER_PASSWORD: "a-long-enough-password" };

  test("returns a good login", () => {
    assert.deepEqual(ownerLoginFromEnv(good), { login: "owner-name", password: "a-long-enough-password" });
  });

  test("fails when a value is missing or empty, naming the variable", () => {
    assert.throws(() => ownerLoginFromEnv({}), /DEMO_OWNER_LOGIN is not set/);
    assert.throws(() => ownerLoginFromEnv({ ...good, DEMO_OWNER_LOGIN: "" }), /DEMO_OWNER_LOGIN is not set/);
    assert.throws(() => ownerLoginFromEnv({ ...good, DEMO_OWNER_PASSWORD: undefined }), /DEMO_OWNER_PASSWORD is not set/);
    assert.throws(() => ownerLoginFromEnv({ ...good, DEMO_OWNER_PASSWORD: "" }), /DEMO_OWNER_PASSWORD is not set/);
  });

  test("fails for the placeholder and for a short password", () => {
    assert.throws(() => ownerLoginFromEnv({ ...good, DEMO_OWNER_LOGIN: "REPLACE_ME_login" }), /placeholder/);
    assert.throws(() => ownerLoginFromEnv({ ...good, DEMO_OWNER_PASSWORD: "REPLACE_ME_password_long_enough" }), /placeholder/);
    assert.throws(() => ownerLoginFromEnv({ ...good, DEMO_OWNER_PASSWORD: "a".repeat(11) }), /at least 12/);
    assert.doesNotThrow(() => ownerLoginFromEnv({ ...good, DEMO_OWNER_PASSWORD: "a".repeat(12) }));
  });

  test("the error never contains the value", () => {
    const secret = "REPLACE_ME_secret-looking-value-that-is-long";
    try {
      ownerLoginFromEnv({ ...good, DEMO_OWNER_PASSWORD: secret });
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(!(error as Error).message.includes(secret));
    }
  });
});

describe("loginMatches", () => {
  const expected = { login: "owner-name", password: "a-long-enough-password" };

  test("matches only the exact login and password", () => {
    assert.equal(loginMatches(expected, expected), true);
    assert.equal(loginMatches(expected, { login: "owner-name", password: "x" }), false);
    assert.equal(loginMatches(expected, { login: "x", password: expected.password }), false);
    assert.equal(loginMatches(expected, { login: "Owner-name", password: expected.password }), false);
    assert.equal(loginMatches(expected, { login: "", password: "" }), false);
  });

  test("non-string values never match", () => {
    for (const bad of [undefined, null, 1, {}, [], ["owner-name"]]) {
      assert.equal(loginMatches(expected, { login: bad, password: expected.password }), false);
      assert.equal(loginMatches(expected, { login: expected.login, password: bad }), false);
    }
  });
});

describe("readSessionCookie", () => {
  const id = "A".repeat(43);

  test("reads exactly one well-formed session cookie", () => {
    assert.equal(readSessionCookie({ cookie: `${SESSION_COOKIE}=${id}` }), id);
    assert.equal(readSessionCookie({ cookie: `a=b; ${SESSION_COOKIE}=${id}; c=d` }), id);
  });

  test("everything else is null", () => {
    const cases: [string, Record<string, string | string[] | undefined>][] = [
      ["no header", {}],
      ["array header", { cookie: [`${SESSION_COOKIE}=${id}`] }],
      ["empty value", { cookie: `${SESSION_COOKIE}=` }],
      ["too short", { cookie: `${SESSION_COOKIE}=${id.slice(1)}` }],
      ["too long", { cookie: `${SESSION_COOKIE}=${id}A` }],
      ["bad characters", { cookie: `${SESSION_COOKIE}=${"A".repeat(42)}!` }],
      ["quoted value", { cookie: `${SESSION_COOKIE}="${id}"` }],
      ["other name", { cookie: `other=${id}` }],
      ["name prefix", { cookie: `${SESSION_COOKIE}2=${id}` }],
      ["duplicate", { cookie: `${SESSION_COOKIE}=${id}; ${SESSION_COOKIE}=${id}` }],
      ["authorization only", { authorization: `Bearer ${id}` }],
    ];
    for (const [label, headers] of cases) assert.equal(readSessionCookie(headers), null, label);
  });
});

describe("SessionStore", () => {
  test("a created session resolves to its owner until it expires", () => {
    let now = T0;
    const store = new SessionStore(() => now);
    const id = store.create(OWNER);
    assert.match(id, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(store.ownerFor(id), OWNER);
    now = new Date(T0.getTime() + SESSION_TTL_MS - 1);
    assert.equal(store.ownerFor(id), OWNER);
    now = new Date(T0.getTime() + SESSION_TTL_MS);
    assert.equal(store.ownerFor(id), null);
  });

  test("unknown, null and malformed ids give null", () => {
    const store = new SessionStore(() => T0);
    store.create(OWNER);
    for (const id of [null, "", "x", "A".repeat(43), "A".repeat(44)]) assert.equal(store.ownerFor(id), null);
  });

  test("ids are random and a new session replaces the owner's old one", () => {
    const store = new SessionStore(() => T0);
    const first = store.create(OWNER);
    const second = store.create(OWNER);
    assert.notEqual(first, second);
    assert.equal(store.ownerFor(first), null);
    assert.equal(store.ownerFor(second), OWNER);
  });

  test("the session id is not kept in memory in clear", () => {
    const store = new SessionStore(() => T0);
    const id = store.create(OWNER);
    const keys = [...(store as unknown as { sessions: Map<string, unknown> }).sessions.keys()];
    assert.equal(keys.length, 1);
    assert.notEqual(keys[0], id);
    assert.ok(!JSON.stringify(keys).includes(id));
  });
});

describe("LoginLimiter", () => {
  test("locks after the maximum failures and opens after the lock time", () => {
    let now = T0;
    const limiter = new LoginLimiter(() => now);
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) limiter.recordFailure();
    assert.equal(limiter.retryAfterSeconds(), 0);
    limiter.recordFailure();
    assert.equal(limiter.retryAfterSeconds(), LOGIN_LOCK_MS / 1000);
    now = new Date(T0.getTime() + LOGIN_LOCK_MS - 1);
    assert.ok(limiter.retryAfterSeconds() > 0);
    now = new Date(T0.getTime() + LOGIN_LOCK_MS);
    assert.equal(limiter.retryAfterSeconds(), 0);
  });

  test("a success clears the count", () => {
    const limiter = new LoginLimiter(() => T0);
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) limiter.recordFailure();
    limiter.recordSuccess();
    limiter.recordFailure();
    assert.equal(limiter.retryAfterSeconds(), 0);
  });
});

describe("sessionCookieHeader", () => {
  test("has HttpOnly, SameSite=Strict and Path=/, and Secure only when asked", () => {
    const plain = sessionCookieHeader("id", { secure: false, maxAgeSeconds: 10 });
    assert.equal(plain, `${SESSION_COOKIE}=id; HttpOnly; SameSite=Strict; Path=/; Max-Age=10`);
    assert.equal(sessionCookieHeader("id", { secure: true, maxAgeSeconds: 10 }), `${plain}; Secure`);
  });
});
