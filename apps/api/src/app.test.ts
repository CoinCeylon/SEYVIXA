// T1.1b and T2.1 route tests: owner login and POST /api/agents/:id/grants, with Fastify inject (no network).
// Real Postgres, each test in a rolled-back transaction. The owner session is the real one: every owner
// request here logs in through POST /api/auth/login and sends the cookie it gets back.
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { createAgent } from "./agent-auth.ts";
import { buildApp, type AppOptions } from "./app.ts";
import { loadValidGrant } from "./grants.ts";
import { SESSION_COOKIE, SESSION_TTL_MS } from "./session.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

const KEY = "test-grant-key-not-a-secret";
const NOW = new Date("2026-11-27T10:00:00.000Z");
const OWNER_LOGIN = { login: "demo-owner-test", password: "a-test-password-123" };

let db: InstanceType<typeof pg.Client>;
let ownerId: string;
let agentId: string;
let agentToken: string;
let clock: Date;

beforeEach(async () => {
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("BEGIN");
  ownerId = (await db.query("INSERT INTO users (name, role) VALUES ('Owner', 'owner') RETURNING id")).rows[0]!.id as string;
  const agent = await createAgent(db, { name: "Agent" });
  agentId = agent.id;
  agentToken = agent.token;
  clock = NOW;
});

afterEach(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

const app = (extra: Partial<AppOptions> = {}) =>
  buildApp({ db, ownerLogin: OWNER_LOGIN, ownerId, integrityKey: KEY, logger: false, now: () => clock, ...extra });
type Server = ReturnType<typeof app>;

const login = (server: Server, body: unknown = OWNER_LOGIN) =>
  server.inject({ method: "POST", url: "/api/auth/login", payload: body as object });

// "sva_session=<id>" from a login response.
const cookieOf = (response: { headers: Record<string, unknown> }): string => {
  const header = response.headers["set-cookie"];
  assert.equal(typeof header, "string", "expected one Set-Cookie header");
  return (header as string).split(";")[0]!;
};

const logIn = async (server: Server): Promise<string> => {
  const response = await login(server);
  assert.equal(response.statusCode, 200);
  return cookieOf(response);
};

const post = (server: Server, body: unknown, id = agentId, headers: Record<string, string> = {}) =>
  server.inject({ method: "POST", url: `/api/agents/${id}/grants`, payload: body as object, headers });

const validBody = () => ({
  scopes: ["supplier:search", "quote:read", "resource:quotes/*"],
  spend_limit: "120000.00",
  expires_at: "2026-12-31T23:59:59.000Z",
});

const grantCount = async () => (await db.query("SELECT count(*)::int AS n FROM agent_grants")).rows[0]!.n as number;
const otherUser = async () =>
  (await db.query("INSERT INTO users (name, role) VALUES ('Other', 'owner') RETURNING id")).rows[0]!.id as string;

describe("POST /api/auth/login", () => {
  test("the right login gives a session cookie with the safe flags and no secret in the body", async () => {
    const response = await login(app());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { authenticated: true });
    const setCookie = response.headers["set-cookie"] as string;
    assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
    for (const flag of ["HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${SESSION_TTL_MS / 1000}`]) {
      assert.ok(setCookie.includes(flag), `missing ${flag}`);
    }
    assert.ok(!setCookie.includes("Secure"), "Secure is off unless asked for");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.ok(!response.body.includes(cookieOf(response).split("=")[1]!));
    assert.ok(!response.body.includes(OWNER_LOGIN.password));
  });

  test("the Secure flag is set when secureCookie is on", async () => {
    const response = await login(app({ secureCookie: true }));
    assert.ok((response.headers["set-cookie"] as string).includes("; Secure"));
  });

  test("a wrong password, a wrong login or both give the same 401 and no cookie", async () => {
    const server = app();
    const bodies = [
      { login: OWNER_LOGIN.login, password: "wrong-password-123" },
      { login: "someone-else", password: OWNER_LOGIN.password },
      { login: "someone-else", password: "wrong-password-123" },
      { login: OWNER_LOGIN.login.toUpperCase(), password: OWNER_LOGIN.password },
      { login: OWNER_LOGIN.login, password: OWNER_LOGIN.password + " " },
    ];
    const results = [];
    for (const body of bodies) {
      const response = await login(server, body);
      assert.equal(response.statusCode, 401, JSON.stringify(body));
      assert.equal(response.headers["set-cookie"], undefined);
      results.push(response.body);
    }
    assert.equal(new Set(results).size, 1, "every failure looks the same");
  });

  test("missing fields, wrong types, empty values and extra keys give 400 and no cookie", async () => {
    const server = app();
    const bad = [
      undefined,
      {},
      { login: OWNER_LOGIN.login },
      { password: OWNER_LOGIN.password },
      { login: "", password: "" },
      { login: 1, password: 2 },
      { ...OWNER_LOGIN, owner_id: ownerId },
      { ...OWNER_LOGIN, extra: true },
    ];
    for (const body of bad) {
      const response = await server.inject({ method: "POST", url: "/api/auth/login", payload: body as object });
      assert.equal(response.statusCode, 400, JSON.stringify(body));
      assert.equal(response.headers["set-cookie"], undefined);
    }
  });

  test("the seeded owner must exist as a user, or login fails closed", async () => {
    const response = await login(app({ ownerId: "99999999-9999-4999-8999-999999999999" }));
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["set-cookie"], undefined);
  });

  test("5 failures in a row lock login for 60 seconds, even for the right password, then it opens again", async () => {
    const server = app();
    for (let i = 0; i < 5; i++) {
      assert.equal((await login(server, { ...OWNER_LOGIN, password: "wrong-password-123" })).statusCode, 401);
    }
    const locked = await login(server);
    assert.equal(locked.statusCode, 429);
    assert.equal(locked.headers["set-cookie"], undefined);
    assert.equal(locked.headers["retry-after"], "60");
    clock = new Date(NOW.getTime() + 61_000);
    assert.equal((await login(server)).statusCode, 200);
  });

  test("parallel wrong guesses cannot get past the lock: 5 are answered, the rest get 429", async () => {
    const server = app();
    const wrong = { ...OWNER_LOGIN, password: "wrong-password-123" };
    const responses = await Promise.all(Array.from({ length: 12 }, () => login(server, wrong)));
    const codes = responses.map((r) => r.statusCode);
    assert.equal(codes.filter((c) => c === 401).length, 5);
    assert.equal(codes.filter((c) => c === 429).length, 7);
    assert.equal((await login(server)).statusCode, 429, "the right password is refused while locked");
  });

  test("a success resets the failure count", async () => {
    const server = app();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) await login(server, { ...OWNER_LOGIN, password: "wrong-password-123" });
      assert.equal((await login(server)).statusCode, 200);
    }
  });

  test("a new login replaces the old session", async () => {
    const server = app();
    const first = await logIn(server);
    const second = await logIn(server);
    assert.notEqual(first, second);
    assert.equal((await post(server, validBody(), agentId, { cookie: first })).statusCode, 401);
    assert.equal((await post(server, validBody(), agentId, { cookie: second })).statusCode, 201);
  });
});

describe("the owner session", () => {
  test("no cookie, no session: 401 and nothing created", async () => {
    const response = await post(app(), validBody());
    assert.equal(response.statusCode, 401);
    assert.equal(await grantCount(), 0);
  });

  test("a made-up, tampered, misnamed or duplicated cookie gives 401", async () => {
    const server = app();
    const good = await logIn(server);
    const id = good.split("=")[1]!;
    const flipped = id.slice(0, -1) + (id.endsWith("A") ? "B" : "A");
    const cookies = [
      `${SESSION_COOKIE}=${"A".repeat(43)}`,
      `${SESSION_COOKIE}=${flipped}`,
      `${SESSION_COOKIE}=${id}x`,
      `${SESSION_COOKIE}=${id.slice(0, -1)}`,
      `${SESSION_COOKIE}=`,
      `${SESSION_COOKIE}2=${id}`,
      `x${SESSION_COOKIE}=${id}`,
      `${SESSION_COOKIE}=${id}; ${SESSION_COOKIE}=${"A".repeat(43)}`,
      `${good}; ${good}`,
    ];
    for (const cookie of cookies) {
      assert.equal((await post(server, validBody(), agentId, { cookie })).statusCode, 401, cookie);
    }
    assert.equal(await grantCount(), 0);
    // Control: the real cookie, alone or with other cookies, works.
    assert.equal((await post(server, validBody(), agentId, { cookie: `a=b; ${good}; c=d` })).statusCode, 201);
  });

  test("a session ends at its expiry", async () => {
    const server = app();
    const cookie = await logIn(server);
    clock = new Date(NOW.getTime() + SESSION_TTL_MS - 1);
    assert.equal((await post(server, validBody(), agentId, { cookie })).statusCode, 201);
    clock = new Date(NOW.getTime() + SESSION_TTL_MS);
    assert.equal((await post(server, validBody(), agentId, { cookie })).statusCode, 401);
  });

  test("a session from one server is not valid on another", async () => {
    const cookie = await logIn(app());
    assert.equal((await post(app(), validBody(), agentId, { cookie })).statusCode, 401);
  });

  test("an agent credential is not an owner session", async () => {
    const server = app();
    const bearerOnly = await post(server, validBody(), agentId, { authorization: `Bearer ${agentToken}` });
    assert.equal(bearerOnly.statusCode, 401);
    // The agent token placed in the session cookie is no session either.
    const tokenAsCookie = await post(server, validBody(), agentId, { cookie: `${SESSION_COOKIE}=${agentToken}` });
    assert.equal(tokenAsCookie.statusCode, 401);
    // Same, with the token cut to the 43-character shape of a session id, so it reaches the session store.
    const shaped = await post(server, validBody(), agentId, { cookie: `${SESSION_COOKIE}=${agentToken.slice(4)}` });
    assert.equal(shaped.statusCode, 401);
    assert.equal(await grantCount(), 0);
    // Control: with the owner cookie it works, and a Bearer token next to it changes nothing.
    const cookie = await logIn(server);
    const both = await post(server, validBody(), agentId, { cookie, authorization: `Bearer ${agentToken}` });
    assert.equal(both.statusCode, 201);
    assert.equal(both.json().owner_id, ownerId);
  });

  test("a session whose owner no longer exists as a user gives 401", async () => {
    const server = app();
    const cookie = await logIn(server);
    await db.query("DELETE FROM users WHERE id = $1", [ownerId]);
    const response = await post(server, validBody(), agentId, { cookie });
    assert.equal(response.statusCode, 401);
    assert.equal(await grantCount(), 0);
  });
});

describe("POST /api/agents/:id/grants", () => {
  test("creates a grant for the session owner; it verifies and loads", async () => {
    const server = app();
    const response = await post(server, validBody(), agentId, { cookie: await logIn(server) });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.owner_id, ownerId);
    assert.equal(body.agent_id, agentId);
    assert.equal(body.issuer, "seyvixa-gateway");
    assert.equal(body.revoked_at, null);
    assert.equal(body.integrity_tag, undefined);
    const check = await loadValidGrant(db, agentId, KEY, NOW);
    assert.ok(check.ok);
    assert.equal(check.grant.id, body.id);
    assert.equal(check.grant.owner_id, ownerId);
  });

  test("owner_id in the body is rejected, even if it is the session owner", async () => {
    const server = app();
    const cookie = await logIn(server);
    const other = await otherUser();
    for (const claimed of [other, ownerId]) {
      const response = await post(server, { ...validBody(), owner_id: claimed }, agentId, { cookie });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(await grantCount(), 0);
  });

  test("owner_id in the query string or in a header is ignored: the grant belongs to the session owner", async () => {
    const server = app();
    const cookie = await logIn(server);
    const other = await otherUser();
    const viaQuery = await server.inject({
      method: "POST",
      url: `/api/agents/${agentId}/grants?owner_id=${other}`,
      payload: validBody(),
      headers: { cookie },
    });
    assert.equal(viaQuery.statusCode, 201);
    assert.equal(viaQuery.json().owner_id, ownerId);
    const viaHeader = await post(server, validBody(), agentId, { cookie, "x-owner-id": other, owner_id: other });
    assert.equal(viaHeader.statusCode, 201);
    assert.equal(viaHeader.json().owner_id, ownerId);
  });

  test("a forged owner_id without a session does not create anything", async () => {
    const server = app();
    const response = await server.inject({
      method: "POST",
      url: `/api/agents/${agentId}/grants?owner_id=${ownerId}`,
      payload: { ...validBody() },
      headers: { "x-owner-id": ownerId },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(await grantCount(), 0);
  });

  test("extra body keys (issuer, integrity_tag, agent_id, revoked_at, id) are rejected", async () => {
    const server = app();
    const cookie = await logIn(server);
    for (const extra of [{ issuer: "x" }, { integrity_tag: "0".repeat(64) }, { agent_id: agentId }, { revoked_at: null }, { id: agentId }]) {
      assert.equal((await post(server, { ...validBody(), ...extra }, agentId, { cookie })).statusCode, 400, JSON.stringify(extra));
    }
    assert.equal(await grantCount(), 0);
  });

  test("missing or empty body, missing fields and wrong types give 400", async () => {
    const server = app();
    const cookie = await logIn(server);
    assert.equal((await server.inject({ method: "POST", url: `/api/agents/${agentId}/grants`, headers: { cookie } })).statusCode, 400);
    for (const bad of [{}, { scopes: ["quote:read"] }, { ...validBody(), spend_limit: 120000 }, { ...validBody(), scopes: "quote:read" }, { ...validBody(), spend_limit: "0.00" }, { ...validBody(), spend_limit: "-5.00" }, { ...validBody(), expires_at: "tomorrow" }]) {
      assert.equal((await post(server, bad, agentId, { cookie })).statusCode, 400, JSON.stringify(bad));
    }
    assert.equal(await grantCount(), 0);
  });

  test("an expiry in the past or equal to now gives 400", async () => {
    const server = app();
    const cookie = await logIn(server);
    assert.equal((await post(server, { ...validBody(), expires_at: "2026-11-01T00:00:00.000Z" }, agentId, { cookie })).statusCode, 400);
    assert.equal((await post(server, { ...validBody(), expires_at: NOW.toISOString() }, agentId, { cookie })).statusCode, 400);
  });

  test("scopes that are unknown, approval or escrow scopes, or reach payroll.csv give 400", async () => {
    const server = app();
    const cookie = await logIn(server);
    for (const scopes of [["approve"], ["escrow:release"], ["quote:read", "resource:payroll.csv"], ["resource:*"], ["quote:read", "quote:read"], []]) {
      const response = await post(server, { ...validBody(), scopes }, agentId, { cookie });
      assert.equal(response.statusCode, 400, JSON.stringify(scopes));
    }
    assert.equal(await grantCount(), 0);
  });

  test("a malformed or unknown agent id gives 400 or 404", async () => {
    const server = app();
    const cookie = await logIn(server);
    assert.equal((await post(server, validBody(), "not-a-uuid", { cookie })).statusCode, 400);
    assert.equal((await post(server, validBody(), "99999999-9999-4999-8999-999999999999", { cookie })).statusCode, 404);
    assert.equal(await grantCount(), 0);
  });

  test("a server error returns a generic body, not the error text", async () => {
    let broken = false;
    const flaky = {
      query: async (text: string, values?: unknown[]) => {
        if (broken) throw new Error("secret database detail");
        return db.query(text, values);
      },
    };
    const server = app({ db: flaky });
    const cookie = await logIn(server);
    broken = true;
    const response = await post(server, validBody(), agentId, { cookie });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "INTERNAL_ERROR" });
    assert.ok(!response.body.includes("secret database detail"));
  });
});

describe("logging", () => {
  test("the authorization and cookie headers are redacted in request logs (D33); login logs no secret", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const server = app({ logger: { stream, level: "trace" } });
    const loginResponse = await login(server);
    assert.equal(loginResponse.statusCode, 200);
    const cookie = cookieOf(loginResponse);
    const sessionId = cookie.split("=")[1]!;
    const authorization = `Bearer ${agentToken}`;
    const response = await post(server, validBody(), agentId, { cookie, authorization });
    assert.equal(response.statusCode, 201);
    await login(server, { ...OWNER_LOGIN, password: "wrong-password-that-must-not-be-logged" });
    const output = lines.join("\n");
    assert.ok(output.includes("[Redacted]"), "expected the redaction marker (headers are logged, redacted)");
    assert.ok(!output.includes(sessionId), "the session id was logged");
    assert.ok(!output.includes(agentToken));
    assert.ok(!output.includes(KEY));
    assert.ok(!output.includes(OWNER_LOGIN.password), "the owner password was logged");
    assert.ok(!output.includes("wrong-password-that-must-not-be-logged"), "a failed password was logged");
    assert.ok(output.includes("owner_login"), "the login audit line is logged");
    assert.ok(output.includes("owner_login_failed"), "the failed login audit line is logged");
    assert.ok(output.includes("grant_created"), "the audit line is logged");
  });
});
