// T4.1b tests: POST /api/budget/reservations (Blueprint 6.1, 6.4, 7; decisions D2, D2b, D4). Real Postgres, each
// test in a rolled-back transaction. The BudgetGuard (T4.1a) runs on the same connection through savepoints, so
// nothing is committed. Real agent credentials; the owner session is only used to show it is not accepted.
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { createBudgetGuard, type BudgetGuard } from "@seyvixa/budget";
import { createAgent } from "./agent-auth.ts";
import { buildApp, type AppOptions } from "./app.ts";
import { createGrant } from "./grants.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

const KEY = "test-grant-key-not-a-secret";
const NOW = new Date("2026-11-28T10:00:00.000Z");
const OWNER_LOGIN = { login: "demo-owner-test", password: "a-test-password-123" };
const FINANCE_SCOPES = ["budget:read", "budget:check", "budget:reserve", "resource:budget/*"];

let db: InstanceType<typeof pg.Client>;
let ownerId: string;
let procurementId: string;
let financeId: string;
let financeToken: string;
let guard: BudgetGuard;

const insertId = async (sql: string, values: unknown[] = []): Promise<string> => (await db.query(sql, values)).rows[0]!.id as string;
const grantTo = (agentId: string, scopes: string[], extra: Partial<Parameters<typeof createGrant>[1]> = {}) =>
  createGrant(db, { ownerId, agentId, scopes, spendLimit: "120000.00", expiresAt: new Date("2026-12-31T23:59:59.000Z"), issuer: "seyvixa-seed", ...extra }, KEY);

// The guard's transaction is a savepoint inside the test's own transaction.
function savepointGuard(client: InstanceType<typeof pg.Client>): BudgetGuard {
  let n = 0;
  return createBudgetGuard(async (fn) => {
    const name = `sp${n++}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn(client);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw error;
    }
  });
}

beforeEach(async () => {
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("BEGIN");
  ownerId = await insertId("INSERT INTO users (name, role) VALUES ('Owner', 'owner') RETURNING id");
  procurementId = await insertId("INSERT INTO procurements (owner_id, description, budget, status) VALUES ($1, 'Linen', 120000.00, 'OPEN') RETURNING id", [ownerId]);
  const finance = await createAgent(db, { name: "Finance Agent" });
  financeId = finance.id;
  financeToken = finance.token;
  await grantTo(financeId, FINANCE_SCOPES);
  guard = savepointGuard(db);
});

afterEach(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

const app = (extra: Partial<AppOptions> = {}) =>
  buildApp({ db, ownerLogin: OWNER_LOGIN, ownerId, integrityKey: KEY, budget: guard, logger: false, now: () => NOW, ...extra });
type Server = ReturnType<typeof app>;

const reserve = (server: Server, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${financeToken}` }) =>
  server.inject({ method: "POST", url: "/api/budget/reservations", payload: body as object, headers });
const body = (over: Record<string, unknown> = {}) => ({ procurement_id: procurementId, amount_lkr: "70000.00", idempotency_key: "k-1", ...over });
const reservations = async () => (await db.query("SELECT id, agent_id, procurement_id, amount::text AS amount, status, idempotency_key FROM budget_reservations ORDER BY id")).rows;
const events = async () =>
  (await db.query("SELECT agent_id, action, decision, reason_code, resource, procurement_id, action_id FROM policy_events ORDER BY created_at, id")).rows;
const sorted = <T>(list: T[]) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe("allowed reservation", () => {
  test("reserves, answers with the reservation, and writes an ALLOW event linked to the procurement", async () => {
    const response = await reserve(app(), body());
    assert.equal(response.statusCode, 200);
    const json = response.json();
    assert.deepEqual({ ...json, reservation_id: "x" }, { reservation_id: "x", procurement_id: procurementId, amount_lkr: "70000.00", status: "RESERVED", repeated: false });
    const rows = await reservations();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, json.reservation_id);
    assert.equal(rows[0]!.agent_id, financeId);
    assert.equal(rows[0]!.idempotency_key, `${financeId}:k-1`, "stored key is namespaced by the agent");
    assert.deepEqual(await events(), [
      { agent_id: financeId, action: "BUDGET_RESERVE", decision: "ALLOW", reason_code: "ALLOW", resource: `budget/${procurementId}`, procurement_id: procurementId, action_id: null },
    ]);
  });

  test("the agent comes from the credential: an agent_id in the body is rejected", async () => {
    const response = await reserve(app(), body({ agent_id: "00000000-0000-4000-8000-000000000001" }));
    assert.equal(response.statusCode, 400);
    assert.equal((await reservations()).length, 0);
    assert.equal((await events()).length, 0);
  });

  test("a repeated idempotency key returns the same reservation and holds the amount once; each call writes an event", async () => {
    const server = app();
    const a = await reserve(server, body());
    const b = await reserve(server, body());
    assert.equal(a.json().reservation_id, b.json().reservation_id);
    assert.equal(a.json().repeated, false);
    assert.equal(b.json().repeated, true);
    assert.equal((await reservations()).length, 1);
    assert.equal((await events()).length, 2);
  });

  test("the same key for a different amount is 400 and changes nothing", async () => {
    const server = app();
    await reserve(server, body());
    const again = await reserve(server, body({ amount_lkr: "1.00" }));
    assert.equal(again.statusCode, 400);
    assert.deepEqual(again.json(), { error: "INVALID_REQUEST" });
    assert.equal((await reservations()).length, 1);
  });

  test("another agent using the same client key gets its own reservation (keys are namespaced per agent)", async () => {
    const second = await createAgent(db, { name: "Second finance agent" });
    await grantTo(second.id, FINANCE_SCOPES);
    const server = app();
    const a = await reserve(server, body({ amount_lkr: "50000.00" }));
    const b = await reserve(server, body({ amount_lkr: "50000.00" }), { authorization: `Bearer ${second.token}` });
    assert.equal(b.statusCode, 200);
    assert.notEqual(a.json().reservation_id, b.json().reservation_id);
    assert.equal((await reservations()).length, 2);
  });
});

describe("refusals", () => {
  test("over budget: DENY BUDGET_EXCEEDED in the Blueprint 6.2 shape, no reservation, and an ALLOW then a DENY event", async () => {
    const server = app();
    assert.equal((await reserve(server, body({ amount_lkr: "100000.00", idempotency_key: "a" }))).statusCode, 200);
    const response = await reserve(server, body({ amount_lkr: "30000.00", idempotency_key: "b" }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      decision: "DENY",
      reason_code: "BUDGET_EXCEEDED",
      agent_id: financeId,
      requested_resource: `budget/${procurementId}`,
      message: "The action exceeds the available budget.",
    });
    assert.equal((await reservations()).length, 1);
    assert.deepEqual(
      sorted((await events()).map((e) => `${e.decision}:${e.reason_code}`)),
      sorted(["ALLOW:ALLOW", "ALLOW:ALLOW", "DENY:BUDGET_EXCEEDED"]),
    );
  });

  test("a denied agent gets no reservation and the denial reason code, with an event for every call", async () => {
    const server = app();
    const procurementAgent = await createAgent(db, { name: "Procurement Agent" });
    await grantTo(procurementAgent.id, ["supplier:search", "quote:read", "file:read", "proposal:prepare", "resource:quotes/*"]);
    const noGrant = await createAgent(db, { name: "No grant" });
    const expired = await createAgent(db, { name: "Expired" });
    await grantTo(expired.id, FINANCE_SCOPES, { expiresAt: new Date("2026-11-01T00:00:00.000Z") });
    const narrow = await createAgent(db, { name: "Narrow resource" });
    await grantTo(narrow.id, ["budget:reserve", "resource:quotes/*"]);
    const lowLimit = await createAgent(db, { name: "Low limit" });
    await grantTo(lowLimit.id, FINANCE_SCOPES, { spendLimit: "1000.00" });
    const readOnly = await createAgent(db, { name: "Read-only finance" });
    await grantTo(readOnly.id, ["budget:read", "budget:check", "resource:budget/*"]);
    const suspended = await createAgent(db, { name: "Suspended" });
    await grantTo(suspended.id, FINANCE_SCOPES);
    await db.query("UPDATE agents SET status = 'SUSPENDED' WHERE id = $1", [suspended.id]);

    const cases: [string, { id: string; token: string }, string][] = [
      ["wrong scope (no budget:reserve)", procurementAgent, "TOOL_OUT_OF_SCOPE"],
      ["read and check scopes but not reserve", readOnly, "TOOL_OUT_OF_SCOPE"],
      ["no grant", noGrant, "GRANT_MISSING"],
      ["expired grant", expired, "GRANT_EXPIRED"],
      ["resource not in scope", narrow, "RESOURCE_OUT_OF_SCOPE"],
      ["over the spend limit", lowLimit, "SPEND_LIMIT_EXCEEDED"],
      ["suspended agent", suspended, "AGENT_INACTIVE"],
    ];
    for (const [label, agent, code] of cases) {
      const response = await reserve(server, body({ idempotency_key: `d-${code}` }), { authorization: `Bearer ${agent.token}` });
      assert.equal(response.statusCode, 200, label);
      assert.equal(response.json().decision, "DENY", label);
      assert.equal(response.json().reason_code, code, label);
      assert.equal(response.json().agent_id, agent.id, label);
    }
    assert.equal((await reservations()).length, 0, "no denied call reserved anything");
    const rows = await events();
    assert.equal(rows.length, cases.length);
    assert.ok(rows.every((e) => e.action === "BUDGET_RESERVE" && e.decision === "DENY" && e.procurement_id === procurementId));
  });

  test("a denied call about an unknown procurement is recorded with no procurement id (the event may not point at a missing row)", async () => {
    const other = await createAgent(db, { name: "No scope" });
    await grantTo(other.id, ["supplier:search", "resource:quotes/*"]);
    const response = await reserve(app(), body({ procurement_id: "00000000-0000-4000-8000-0000000000ff" }), { authorization: `Bearer ${other.token}` });
    assert.equal(response.json().reason_code, "TOOL_OUT_OF_SCOPE");
    assert.equal((await events())[0]!.procurement_id, null);
  });

  test("no credential, a bad credential or an owner session only is 401 and writes nothing", async () => {
    const server = app();
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: OWNER_LOGIN });
    const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
    const attempts: Record<string, string>[] = [{}, { authorization: "Bearer sva_nope" }, { cookie }];
    for (const headers of attempts) {
      const response = await reserve(server, body(), headers);
      assert.equal(response.statusCode, 401, JSON.stringify(headers));
    }
    assert.equal((await reservations()).length, 0);
    assert.equal((await events()).length, 0);
  });

  test("another owner's procurement, an unknown procurement and a malformed body are 400 and write nothing", async () => {
    const otherOwner = await insertId("INSERT INTO users (name, role) VALUES ('Other', 'owner') RETURNING id");
    const foreign = await insertId("INSERT INTO procurements (owner_id, description, budget, status) VALUES ($1, 'x', 1000.00, 'OPEN') RETURNING id", [otherOwner]);
    const server = app();
    const bad: Record<string, unknown>[] = [
      body({ procurement_id: foreign }),
      body({ procurement_id: "00000000-0000-4000-8000-0000000000ff" }),
      body({ procurement_id: "nope" }),
      body({ amount_lkr: "0.00" }),
      body({ amount_lkr: "-1.00" }),
      body({ amount_lkr: "abc" }),
      body({ amount_lkr: "1.234" }),
      body({ amount_lkr: 100 }),
      body({ idempotency_key: "" }),
      body({ idempotency_key: "x".repeat(129) }),
      { amount_lkr: "1.00", idempotency_key: "k" },
      { ...body(), extra: true },
    ];
    for (const payload of bad) {
      const response = await reserve(server, payload);
      assert.equal(response.statusCode, 400, JSON.stringify(payload));
    }
    assert.equal((await reservations()).length, 0);
    assert.equal((await events()).length, 0);
  });

  test("without a budget guard configured the answer is 500 and nothing is written", async () => {
    const response = await reserve(app({ budget: undefined }), body());
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "INTERNAL_ERROR" });
    assert.equal((await reservations()).length, 0);
    assert.equal((await events()).length, 0);
  });

  test("evaluate cannot be used for budget reservations: the tool BUDGET_RESERVE is not an action type", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/api/actions/evaluate",
      payload: { tool: "BUDGET_RESERVE", resource: `budget/${procurementId}`, parameters: { amount_lkr: "1.00" } },
      headers: { authorization: `Bearer ${financeToken}` },
    });
    assert.equal(response.statusCode, 400);
    assert.equal((await reservations()).length, 0);
  });
});

describe("logging", () => {
  test("the idempotency key, the amount and the credential are not logged", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const response = await reserve(app({ logger: { stream, level: "trace" } }), body({ idempotency_key: "KEY-MARKER-789", amount_lkr: "12345.67" }));
    assert.equal(response.statusCode, 200);
    const output = lines.join("\n");
    assert.ok(output.includes("policy_decision"));
    assert.ok(!output.includes("KEY-MARKER-789"));
    assert.ok(!output.includes("12345.67"));
    assert.ok(!output.includes(financeToken));
  });
});
