// T1.1b route tests: POST /api/agents/:id/grants, with Fastify inject (no network). Real Postgres, each test
// in a rolled-back transaction. The session is a test function; T2.1 provides the real one.
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { createAgent } from "./agent-auth.ts";
import { buildApp, getSessionOwnerIdStub, type GetSessionOwnerId } from "./app.ts";
import { loadValidGrant } from "./grants.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

const KEY = "test-grant-key-not-a-secret";
const NOW = new Date("2026-11-27T10:00:00.000Z");

let db: InstanceType<typeof pg.Client>;
let ownerId: string;
let agentId: string;
let agentToken: string;

beforeEach(async () => {
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("BEGIN");
  ownerId = (await db.query("INSERT INTO users (name, role) VALUES ('Owner', 'owner') RETURNING id")).rows[0]!.id as string;
  const agent = await createAgent(db, { name: "Agent" });
  agentId = agent.id;
  agentToken = agent.token;
});

afterEach(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

const app = (session: GetSessionOwnerId = async () => ownerId) =>
  buildApp({ db, getSessionOwnerId: session, integrityKey: KEY, logger: false, now: () => NOW });

const validBody = () => ({
  scopes: ["supplier:search", "quote:read", "resource:quotes/*"],
  spend_limit: "120000.00",
  expires_at: "2026-12-31T23:59:59.000Z",
});

const post = (server: ReturnType<typeof app>, body: unknown, id = agentId, headers: Record<string, string> = {}) =>
  server.inject({ method: "POST", url: `/api/agents/${id}/grants`, payload: body as object, headers });

const grantCount = async () => (await db.query("SELECT count(*)::int AS n FROM agent_grants")).rows[0]!.n as number;

describe("POST /api/agents/:id/grants", () => {
  test("creates a grant for the session owner; it verifies and loads", async () => {
    const response = await post(app(), validBody());
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

  test("no session gives 401 and creates nothing", async () => {
    assert.equal((await post(app(async () => null), validBody())).statusCode, 401);
    assert.equal((await post(app(getSessionOwnerIdStub), validBody())).statusCode, 401);
    assert.equal(await grantCount(), 0);
  });

  test("a session function that throws gives 401", async () => {
    const response = await post(app(async () => { throw new Error("boom"); }), validBody());
    assert.equal(response.statusCode, 401);
    assert.equal(await grantCount(), 0);
  });

  test("a session owner that does not exist as a user gives 401", async () => {
    const response = await post(app(async () => "99999999-9999-4999-8999-999999999999"), validBody());
    assert.equal(response.statusCode, 401);
    assert.equal(await grantCount(), 0);
  });

  test("an agent credential is not an owner session", async () => {
    const server = app(async () => null);
    const response = await post(server, validBody(), agentId, { authorization: `Bearer ${agentToken}` });
    assert.equal(response.statusCode, 401);
    assert.equal(await grantCount(), 0);
  });

  test("owner_id in the body is rejected, even if it is the session owner", async () => {
    const other = (await db.query("INSERT INTO users (name, role) VALUES ('Other', 'owner') RETURNING id")).rows[0]!.id as string;
    for (const claimed of [other, ownerId]) {
      const response = await post(app(), { ...validBody(), owner_id: claimed });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(await grantCount(), 0);
  });

  test("owner_id in the query string is ignored: the grant belongs to the session owner", async () => {
    const other = (await db.query("INSERT INTO users (name, role) VALUES ('Other', 'owner') RETURNING id")).rows[0]!.id as string;
    const response = await app().inject({
      method: "POST",
      url: `/api/agents/${agentId}/grants?owner_id=${other}`,
      payload: validBody(),
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().owner_id, ownerId);
  });

  test("extra body keys (issuer, integrity_tag, agent_id, revoked_at, id) are rejected", async () => {
    for (const extra of [{ issuer: "x" }, { integrity_tag: "0".repeat(64) }, { agent_id: agentId }, { revoked_at: null }, { id: agentId }]) {
      assert.equal((await post(app(), { ...validBody(), ...extra })).statusCode, 400, JSON.stringify(extra));
    }
    assert.equal(await grantCount(), 0);
  });

  test("missing or empty body, missing fields and wrong types give 400", async () => {
    const server = app();
    assert.equal((await server.inject({ method: "POST", url: `/api/agents/${agentId}/grants` })).statusCode, 400);
    for (const bad of [{}, { scopes: ["quote:read"] }, { ...validBody(), spend_limit: 120000 }, { ...validBody(), scopes: "quote:read" }, { ...validBody(), spend_limit: "0.00" }, { ...validBody(), spend_limit: "-5.00" }, { ...validBody(), expires_at: "tomorrow" }]) {
      assert.equal((await post(server, bad)).statusCode, 400, JSON.stringify(bad));
    }
    assert.equal(await grantCount(), 0);
  });

  test("an expiry in the past or equal to now gives 400", async () => {
    assert.equal((await post(app(), { ...validBody(), expires_at: "2026-11-01T00:00:00.000Z" })).statusCode, 400);
    assert.equal((await post(app(), { ...validBody(), expires_at: NOW.toISOString() })).statusCode, 400);
  });

  test("scopes that are unknown, approval or escrow scopes, or reach payroll.csv give 400", async () => {
    for (const scopes of [["approve"], ["escrow:release"], ["quote:read", "resource:payroll.csv"], ["resource:*"], ["quote:read", "quote:read"], []]) {
      const response = await post(app(), { ...validBody(), scopes });
      assert.equal(response.statusCode, 400, JSON.stringify(scopes));
    }
    assert.equal(await grantCount(), 0);
  });

  test("a malformed or unknown agent id gives 400 or 404", async () => {
    assert.equal((await post(app(), validBody(), "not-a-uuid")).statusCode, 400);
    assert.equal((await post(app(), validBody(), "99999999-9999-4999-8999-999999999999")).statusCode, 404);
    assert.equal(await grantCount(), 0);
  });

  test("a server error returns a generic body, not the error text", async () => {
    const broken = buildApp({
      db: { query: async () => { throw new Error("secret database detail"); } },
      getSessionOwnerId: async () => ownerId,
      integrityKey: KEY,
      logger: false,
      now: () => NOW,
    });
    const response = await post(broken, validBody());
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "INTERNAL_ERROR" });
    assert.ok(!response.body.includes("secret database detail"));
  });
});

describe("logging", () => {
  test("the authorization and cookie headers are redacted in request logs (D33)", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const server = buildApp({
      db,
      getSessionOwnerId: async () => ownerId,
      integrityKey: KEY,
      logger: { stream, level: "trace" },
      now: () => NOW,
    });
    const cookie = "session=cookie-value-that-must-not-be-logged";
    const authorization = `Bearer ${agentToken}`;
    const response = await post(server, validBody(), agentId, { cookie, authorization });
    assert.equal(response.statusCode, 201);
    // Fastify's default request log does not include headers. If a later card logs them, the redaction
    // must hold, so check the configured paths directly with a request-shaped object.
    server.log.info({ req: { headers: { authorization, cookie } } }, "header redaction check");
    const output = lines.join("\n");
    assert.ok(output.length > 0, "expected some log output");
    // Fastify's request serializer already drops headers from a "req" log object; the redact paths are the
    // second guard. Either way the secrets must not reach the output.
    assert.ok(!output.includes("cookie-value-that-must-not-be-logged"));
    assert.ok(!output.includes(agentToken));
    assert.ok(!output.includes(KEY));
    assert.ok(output.includes("grant_created"), "the audit line is logged");
  });
});
