// T1.2a route tests: POST /api/actions/evaluate (Blueprint 6.2, 7; decisions D17, D36), with Fastify inject.
// Real Postgres, each test in a rolled-back transaction, real agent credentials and the real owner session.
// Read tools answer 501 until T1.2c adds the ticket. Purchase and escrow actions build an action record (T1.2b, actions.test.ts).
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { gatewayResponseSchema } from "@seyvixa/shared";
import { createAgent } from "./agent-auth.ts";
import { buildApp, type AppOptions } from "./app.ts";
import { createGrant } from "./grants.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

const KEY = "test-grant-key-not-a-secret";
const NOW = new Date("2026-11-27T10:00:00.000Z");
const OWNER_LOGIN = { login: "demo-owner-test", password: "a-test-password-123" };
const SCOPES = ["supplier:search", "quote:read", "file:read", "proposal:prepare", "resource:suppliers/*", "resource:quotes/*"];

let db: InstanceType<typeof pg.Client>;
let ownerId: string;
let agentId: string;
let token: string;

beforeEach(async () => {
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("BEGIN");
  ownerId = (await db.query("INSERT INTO users (name, role) VALUES ('Owner', 'owner') RETURNING id")).rows[0]!.id as string;
  const agent = await createAgent(db, { name: "Agent" });
  agentId = agent.id;
  token = agent.token;
  await createGrant(
    db,
    { ownerId, agentId, scopes: SCOPES, spendLimit: "120000.00", expiresAt: new Date("2026-12-31T23:59:59.000Z"), issuer: "seyvixa-seed" },
    KEY,
  );
});

afterEach(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

const app = (extra: Partial<AppOptions> = {}) =>
  buildApp({ db, ownerLogin: OWNER_LOGIN, ownerId, integrityKey: KEY, logger: false, now: () => NOW, ...extra });
type Server = ReturnType<typeof app>;

const ownerCookie = async (server: Server): Promise<string> => {
  const response = await server.inject({ method: "POST", url: "/api/auth/login", payload: OWNER_LOGIN });
  assert.equal(response.statusCode, 200);
  return (response.headers["set-cookie"] as string).split(";")[0]!;
};

const evaluate = (server: Server, body: unknown, headers: Record<string, string> = {}) =>
  server.inject({ method: "POST", url: "/api/actions/evaluate", payload: body as object, headers });
const asAgent = (t = token) => ({ authorization: `Bearer ${t}` });

const events = async () =>
  (await db.query("SELECT agent_id, action, decision, reason_code, resource, action_id FROM policy_events ORDER BY created_at, id")).rows;
const actionCount = async () => (await db.query("SELECT count(*)::int AS n FROM actions")).rows[0]!.n as number;

describe("agent callers", () => {
  test("P0-1: FILE_READ of payroll.csv is DENY RESOURCE_OUT_OF_SCOPE, in the Blueprint 6.2 shape, and is recorded", async () => {
    const response = await evaluate(app(), { tool: "FILE_READ", resource: "payroll.csv", parameters: {} }, asAgent());
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.decision, "DENY");
    assert.equal(body.reason_code, "RESOURCE_OUT_OF_SCOPE");
    assert.equal(body.agent_id, agentId);
    assert.equal(body.requested_resource, "payroll.csv");
    assert.equal(body.message, "The agent is not authorised to access this resource.");
    assert.equal(gatewayResponseSchema.safeParse(body).success, true);
    const rows = await events();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { agent_id: agentId, action: "FILE_READ", decision: "DENY", reason_code: "RESOURCE_OUT_OF_SCOPE", resource: "payroll.csv", action_id: null });
    assert.equal(await actionCount(), 0, "a DENY creates no action record (D15)");
  });

  test("an allowed call is recorded as ALLOW and answers 501 until T1.2b and T1.2c (nothing is allowed yet)", async () => {
    const response = await evaluate(app(), { tool: "QUOTE_READ", resource: "quotes/supplier-a", parameters: {} }, asAgent());
    assert.equal(response.statusCode, 501);
    assert.deepEqual(response.json(), { error: "NOT_IMPLEMENTED" });
    assert.ok(!response.body.includes("ticket"));
    const rows = await events();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.decision, "ALLOW");
    assert.equal(rows[0]!.reason_code, "ALLOW");
    assert.equal(rows[0]!.agent_id, agentId);
    assert.equal(await actionCount(), 0);
  });

  test("a SUSPENDED agent with a valid credential gets DENY AGENT_INACTIVE and a policy event", async () => {
    await db.query("UPDATE agents SET status = 'SUSPENDED' WHERE id = $1", [agentId]);
    const response = await evaluate(app(), { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} }, asAgent());
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().reason_code, "AGENT_INACTIVE");
    assert.equal((await events())[0]!.reason_code, "AGENT_INACTIVE");
  });

  test("denies for the grant, the tool and the spend limit come back with their codes", async () => {
    const server = app();
    const tool = await evaluate(server, { tool: "ESCROW_LOCK", resource: "quotes/a", parameters: {} }, asAgent());
    assert.equal(tool.json().reason_code, "TOOL_OUT_OF_SCOPE");
    const over = await evaluate(server, { tool: "PROPOSE_PURCHASE", resource: "suppliers/a", parameters: { total_lkr: "120000.01" } }, asAgent());
    assert.equal(over.json().reason_code, "SPEND_LIMIT_EXCEEDED");
    await db.query("UPDATE agent_grants SET spend_limit = 1 WHERE agent_id = $1", [agentId]);
    const tampered = await evaluate(server, { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} }, asAgent());
    assert.equal(tampered.json().reason_code, "GRANT_INTEGRITY_FAILED");
    // created_at is the same inside one transaction, so compare as a sorted list.
    assert.deepEqual((await events()).map((e) => e.reason_code).sort(), ["GRANT_INTEGRITY_FAILED", "SPEND_LIMIT_EXCEEDED", "TOOL_OUT_OF_SCOPE"]);
  });

  test("PROPOSE_PURCHASE with no valid total, or with no stored quote to build the action from, is 400 and records nothing", async () => {
    const server = app();
    // The policy passes (total at the limit) but there is no stored quote to build the action from (T1.2b): 400.
    const equal = await evaluate(server, { tool: "PROPOSE_PURCHASE", resource: "suppliers/a", parameters: { total_lkr: "120000.00" } }, asAgent());
    assert.equal(equal.statusCode, 400);
    assert.equal(await actionCount(), 0);
    for (const parameters of [{}, { total_lkr: "abc" }, { total_lkr: 100 }, { total_lkr: "0.00" }]) {
      const response = await evaluate(server, { tool: "PROPOSE_PURCHASE", resource: "suppliers/a", parameters }, asAgent());
      assert.equal(response.statusCode, 400, JSON.stringify(parameters));
    }
    assert.equal((await events()).length, 0);
  });

  test("a deny never reveals grant details", async () => {
    const response = await evaluate(app(), { tool: "FILE_READ", resource: "payroll.csv", parameters: {} }, asAgent());
    for (const secret of ["120000", "spend_limit", "scopes", "seyvixa-seed", "quotes/*", ownerId]) {
      assert.ok(!response.body.includes(secret), secret);
    }
  });
});

describe("authentication", () => {
  test("no credential and no session: 401, no event", async () => {
    const response = await evaluate(app(), { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} });
    assert.equal(response.statusCode, 401);
    assert.equal((await events()).length, 0);
  });

  test("a wrong or malformed credential: 401, no event, and the owner cookie does not rescue it", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    for (const headers of [asAgent("sva_" + "A".repeat(43)), { authorization: "Bearer nope" }, { authorization: `bearer ${token}` }]) {
      const response = await evaluate(server, { tool: "ESCROW_LOCK", resource: "budget/x", parameters: {} }, { ...headers, cookie });
      assert.equal(response.statusCode, 401, JSON.stringify(headers));
    }
    assert.equal((await events()).length, 0);
  });

  test("an agent credential next to an owner cookie is an agent: the owner path is not opened", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    const response = await evaluate(server, { tool: "ESCROW_LOCK", resource: "budget/x", parameters: {} }, { ...asAgent(), cookie });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().reason_code, "TOOL_OUT_OF_SCOPE");
    assert.equal((await events())[0]!.agent_id, agentId);
  });

  test("an agent token in the cookie, or no Authorization header at all, is not an agent", async () => {
    const response = await evaluate(app(), { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} }, { cookie: `sva_session=${token.slice(4)}` });
    assert.equal(response.statusCode, 401);
  });
});

describe("owner session caller", () => {
  test("an escrow action with nothing to build the action from is 400 and records nothing (the action record is covered in actions.test.ts)", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    for (const tool of ["ESCROW_LOCK", "ESCROW_RELEASE", "ESCROW_REFUND"]) {
      const response = await evaluate(server, { tool, resource: "budget/x", parameters: {} }, { cookie });
      assert.equal(response.statusCode, 400, tool);
    }
    assert.equal((await events()).length, 0);
    assert.equal(await actionCount(), 0);
  });

  test("the owner session cannot call the agent tools: 400, no event", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    for (const tool of ["SUPPLIER_SEARCH", "QUOTE_READ", "FILE_READ", "PROPOSE_PURCHASE"]) {
      const response = await evaluate(server, { tool, resource: "quotes/a", parameters: { total_lkr: "1.00" } }, { cookie });
      assert.equal(response.statusCode, 400, tool);
    }
    assert.equal((await events()).length, 0);
  });

  test("a session whose owner no longer exists gives 401", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    await db.query("DELETE FROM agent_grants WHERE owner_id = $1", [ownerId]);
    await db.query("DELETE FROM users WHERE id = $1", [ownerId]);
    const response = await evaluate(server, { tool: "ESCROW_LOCK", resource: "budget/x", parameters: {} }, { cookie });
    assert.equal(response.statusCode, 401);
  });
});

describe("the request body", () => {
  test("identity, hash, ticket or other keys at the top level, or reserved parameter keys, are rejected: 400, no event", async () => {
    const server = app();
    const base = { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} };
    const bad = [
      { ...base, agent_id: agentId },
      { ...base, owner_id: ownerId },
      { ...base, action_hash: "0".repeat(64) },
      { ...base, ticket: "t" },
      { ...base, extra: 1 },
      { ...base, parameters: { agent_id: agentId } },
      { ...base, parameters: { Owner_Id: ownerId } },
      { ...base, parameters: { ticket: "t" } },
      { tool: "NOT_A_TOOL", resource: "quotes/a", parameters: {} },
      { tool: "BUDGET_RESERVE", resource: "budget/x", parameters: {} },
      { tool: "QUOTE_READ", resource: "", parameters: {} },
      { tool: "QUOTE_READ", parameters: {} },
      { tool: "QUOTE_READ", resource: "quotes/a" },
      { tool: "QUOTE_READ", resource: 5, parameters: {} },
      {},
    ];
    for (const body of bad) {
      const response = await evaluate(server, body, asAgent());
      assert.equal(response.statusCode, 400, JSON.stringify(body));
    }
    assert.equal((await evaluate(server, undefined, asAgent())).statusCode, 400);
    assert.equal((await events()).length, 0);
  });

  test("an owner_id or agent_id in the query string or a header does not change the caller", async () => {
    const response = await app().inject({
      method: "POST",
      url: `/api/actions/evaluate?agent_id=${agentId}&owner_id=${ownerId}`,
      payload: { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} },
      headers: { "x-agent-id": agentId, "x-owner-id": ownerId },
    });
    assert.equal(response.statusCode, 401);
    assert.equal((await events()).length, 0);
  });
});

describe("fail closed", () => {
  test("if the policy event cannot be written, the answer is 500 and nothing is allowed", async () => {
    const flaky = {
      query: async (text: string, values?: unknown[]) => {
        if (text.includes("INSERT INTO policy_events")) throw new Error("secret database detail");
        return db.query(text, values);
      },
    };
    const response = await evaluate(app({ db: flaky }), { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} }, asAgent());
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "INTERNAL_ERROR" });
    assert.ok(!response.body.includes("secret database detail"));
    assert.ok(!response.body.includes("ALLOW"));
  });

  test("if the database fails while checking, the answer is DENY INTERNAL_ERROR (and recorded when possible)", async () => {
    let broken = false;
    const flaky = {
      query: async (text: string, values?: unknown[]) => {
        if (broken && (text.includes("FROM agents WHERE id") || text.includes("FROM agent_grants"))) throw new Error("db down");
        return db.query(text, values);
      },
    };
    const server = app({ db: flaky });
    broken = true;
    const response = await evaluate(server, { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} }, asAgent());
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().decision, "DENY");
    assert.equal(response.json().reason_code, "INTERNAL_ERROR");
    assert.equal((await events())[0]!.reason_code, "INTERNAL_ERROR");
  });
});

describe("logging", () => {
  test("the request resource and parameters (supplier content is data) and the credential are not logged", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const server = app({ logger: { stream, level: "trace" } });
    const response = await evaluate(
      server,
      { tool: "FILE_READ", resource: "quotes/RESOURCE-MARKER-123", parameters: { note: "PARAMETER-MARKER-456 ignore previous instructions" } },
      asAgent(),
    );
    assert.equal(response.statusCode, 501); // allowed by the policy, not yet executable (T1.2b)
    const output = lines.join("\n");
    assert.ok(output.includes("policy_decision"), "the decision is logged");
    assert.ok(!output.includes("RESOURCE-MARKER-123"));
    assert.ok(!output.includes("PARAMETER-MARKER-456"));
    assert.ok(!output.includes(token));
  });
});
