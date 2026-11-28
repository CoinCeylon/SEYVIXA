// T1.2b tests: the immutable action record built by POST /api/actions/evaluate (Blueprint 6.2, 6.5;
// decisions D2b, D15, D16, D29). Real Postgres, each test in a rolled-back transaction, Fastify inject.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { actionHash, actionPayloadSchema, canonicalize } from "@seyvixa/shared";
import { createAgent } from "./agent-auth.ts";
import { buildApp, type AppOptions } from "./app.ts";
import { APPROVAL_TTL_MS, REFUND_DEADLINE_OFFSET_MS } from "./actions.ts";
import { createGrant } from "./grants.ts";
import { POLICY_VERSION } from "./policy.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

const KEY = "test-grant-key-not-a-secret";
const NOW = new Date("2026-11-27T10:00:00.000Z");
const OWNER_LOGIN = { login: "demo-owner-test", password: "a-test-password-123" };
const SCOPES = ["supplier:search", "quote:read", "file:read", "proposal:prepare", "resource:suppliers/*", "resource:quotes/*"];
const ESCROW = { scriptAddress: "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg", amountTada: "5.000000" };
const PAYEE = "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";

let db: InstanceType<typeof pg.Client>;
let ownerId: string;
let otherOwnerId: string;
let agentId: string;
let token: string;
let supplierId: string;
let procurementId: string;
let quoteId: string;

const insertId = async (sql: string, values: unknown[]): Promise<string> => (await db.query(sql, values)).rows[0]!.id as string;

beforeEach(async () => {
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("BEGIN");
  ownerId = await insertId("INSERT INTO users (name, role) VALUES ('Owner', 'owner') RETURNING id", []);
  otherOwnerId = await insertId("INSERT INTO users (name, role) VALUES ('Other', 'owner') RETURNING id", []);
  const agent = await createAgent(db, { name: "Agent" });
  agentId = agent.id;
  token = agent.token;
  await createGrant(
    db,
    { ownerId, agentId, scopes: SCOPES, spendLimit: "120000.00", expiresAt: new Date("2026-12-31T23:59:59.000Z"), issuer: "seyvixa-seed" },
    KEY,
  );
  supplierId = await insertId("INSERT INTO suppliers (name, payee_address) VALUES ('Supplier A', $1) RETURNING id", [PAYEE]);
  procurementId = await insertId("INSERT INTO procurements (owner_id, description, budget, status) VALUES ($1, 'Linen', 150000.00, 'OPEN') RETURNING id", [ownerId]);
  quoteId = await insertId(
    "INSERT INTO supplier_quotes (procurement_id, supplier_id, amount, quote_data) VALUES ($1, $2, 70000.00, $3) RETURNING id",
    [procurementId, supplierId, JSON.stringify({ item: "Cotton bed linen sets", quantity: 10, total_lkr: "70000.00" })],
  );
});

afterEach(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

const app = (extra: Partial<AppOptions> = {}) =>
  buildApp({ db, ownerLogin: OWNER_LOGIN, ownerId, integrityKey: KEY, escrow: ESCROW, logger: false, now: () => NOW, ...extra });
type Server = ReturnType<typeof app>;

const ownerCookie = async (server: Server): Promise<string> => {
  const response = await server.inject({ method: "POST", url: "/api/auth/login", payload: OWNER_LOGIN });
  assert.equal(response.statusCode, 200);
  return (response.headers["set-cookie"] as string).split(";")[0]!;
};
const evaluate = (server: Server, body: unknown, headers: Record<string, string> = {}) =>
  server.inject({ method: "POST", url: "/api/actions/evaluate", payload: body as object, headers });
const asAgent = () => ({ authorization: `Bearer ${token}` });
const lockBody = (parameters: Record<string, unknown> = { procurement_id: procurementId, quote_id: quoteId }) => ({
  tool: "ESCROW_LOCK",
  resource: `budget/${procurementId}`,
  parameters,
});
const proposeBody = (parameters: Record<string, unknown> = { procurement_id: procurementId, quote_id: quoteId, total_lkr: "70000.00" }) => ({
  tool: "PROPOSE_PURCHASE",
  resource: `quotes/${supplierId}`,
  parameters,
});
const actions = async () => (await db.query("SELECT * FROM actions ORDER BY id")).rows;
const eventCount = async () => (await db.query("SELECT count(*)::int AS n FROM policy_events")).rows[0]!.n as number;

describe("ESCROW_LOCK by the owner session", () => {
  test("stores an immutable record: server-built payload, hash of the exact stored bytes, PENDING_APPROVAL, event linked", async () => {
    const server = app();
    const response = await evaluate(server, lockBody(), { cookie: await ownerCookie(server) });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.decision, "APPROVAL_REQUIRED");
    const [row] = await actions();
    assert.equal(await actions().then((r) => r.length), 1);
    assert.equal(body.action_id, row!.id);
    assert.equal(body.action_hash, row!.action_hash);
    assert.equal(row!.status, "PENDING_APPROVAL");
    assert.equal(row!.action_type, "ESCROW_LOCK");
    assert.equal(row!.owner_id, ownerId);
    assert.equal(row!.procurement_id, procurementId);
    assert.equal(row!.policy_version, POLICY_VERSION);
    assert.equal(row!.reservation_id, null);
    assert.match(row!.commitment_salt as string, /^[0-9a-f]{64}$/);

    const payload = actionPayloadSchema.parse(JSON.parse(row!.canonical_payload as string));
    assert.equal(row!.canonical_payload, canonicalize(payload), "stored bytes are the canonical form");
    assert.equal(row!.action_hash, actionHash(payload), "hash is SHA-256 of the stored canonical bytes");
    assert.equal(payload.owner_id, ownerId);
    assert.equal(payload.supplier_id, supplierId);
    assert.equal(payload.payee_address, PAYEE);
    assert.equal(payload.total_lkr, "70000.00");
    assert.equal(payload.settlement_asset, "tADA");
    assert.equal(payload.escrow_amount_tada, "5.000000");
    assert.equal(payload.escrow_script_address, ESCROW.scriptAddress);
    assert.deepEqual(payload.items, [{ description: "Cotton bed linen sets", quantity: 10 }]);
    assert.equal(payload.expiry, new Date(NOW.getTime() + APPROVAL_TTL_MS).toISOString());
    assert.equal(payload.refund_deadline, new Date(NOW.getTime() + REFUND_DEADLINE_OFFSET_MS).toISOString());
    assert.match(payload.nonce, /^[0-9a-f]{32}$/);

    const events = (await db.query("SELECT decision, reason_code, agent_id, action_id, procurement_id FROM policy_events")).rows;
    assert.deepEqual(events, [{ decision: "APPROVAL_REQUIRED", reason_code: "APPROVAL_REQUIRED", agent_id: null, action_id: row!.id, procurement_id: procurementId }]);
  });

  test("a changed material field gives a new hash: every evaluation gets a fresh nonce and salt, so two actions never share a hash", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    await evaluate(server, lockBody(), { cookie });
    await evaluate(server, lockBody(), { cookie });
    const rows = await actions();
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]!.action_hash, rows[1]!.action_hash);
    assert.notEqual(rows[0]!.commitment_salt, rows[1]!.commitment_salt);
    // Same stored data and same nonce would give the same hash (determinism is the shared canonical helper's job).
    const p = JSON.parse(rows[0]!.canonical_payload as string);
    assert.equal(actionHash(p), actionHash(JSON.parse(JSON.stringify(p))));
    assert.notEqual(actionHash({ ...p, total_lkr: "70000.01" }), actionHash(p));
  });

  test("the caller cannot supply the hash, the owner, the payee, the amount or the deadline", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    for (const key of ["action_hash", "owner_id", "nonce", "expiry", "ticket", "agent_id"]) {
      const response = await evaluate(server, lockBody({ procurement_id: procurementId, quote_id: quoteId, [key]: "x" }), { cookie });
      assert.equal(response.statusCode, 400, key);
    }
    assert.equal((await actions()).length, 0);
    // Values that are not forbidden keys are ignored: the payload comes from stored rows and server config.
    const response = await evaluate(
      server,
      lockBody({ procurement_id: procurementId, quote_id: quoteId, payee_address: "addr_test1evil", total_lkr: "1.00", escrow_amount_tada: "999.000000" }),
      { cookie },
    );
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse((await actions())[0]!.canonical_payload as string);
    assert.equal(payload.payee_address, PAYEE);
    assert.equal(payload.total_lkr, "70000.00");
    assert.equal(payload.escrow_amount_tada, "5.000000");
  });

  test("another owner's procurement, a quote from another procurement, a missing id or a supplier with no payee address is 400 and stores nothing", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    const otherProcurement = await insertId("INSERT INTO procurements (owner_id, description, budget, status) VALUES ($1, 'Other', 1.00, 'OPEN') RETURNING id", [otherOwnerId]);
    const otherQuote = await insertId(
      "INSERT INTO supplier_quotes (procurement_id, supplier_id, amount, quote_data) VALUES ($1, $2, 10.00, $3) RETURNING id",
      [otherProcurement, supplierId, JSON.stringify({ item: "x", quantity: 1 })],
    );
    const noPayee = await insertId("INSERT INTO suppliers (name) VALUES ('No payee') RETURNING id", []);
    const noPayeeQuote = await insertId(
      "INSERT INTO supplier_quotes (procurement_id, supplier_id, amount, quote_data) VALUES ($1, $2, 10.00, $3) RETURNING id",
      [procurementId, noPayee, JSON.stringify({ item: "x", quantity: 1 })],
    );
    const badQuote = await insertId(
      "INSERT INTO supplier_quotes (procurement_id, supplier_id, amount, quote_data) VALUES ($1, $2, 10.00, $3) RETURNING id",
      [procurementId, supplierId, JSON.stringify({ item: "x", quantity: 0 })],
    );
    for (const parameters of [
      { procurement_id: otherProcurement, quote_id: otherQuote },
      { procurement_id: procurementId, quote_id: otherQuote },
      { procurement_id: procurementId },
      { quote_id: quoteId },
      { procurement_id: "not-an-id", quote_id: quoteId },
      { procurement_id: procurementId, quote_id: noPayeeQuote },
      { procurement_id: procurementId, quote_id: badQuote },
    ]) {
      const response = await evaluate(server, lockBody(parameters), { cookie });
      assert.equal(response.statusCode, 400, JSON.stringify(parameters));
    }
    assert.equal((await actions()).length, 0);
    assert.equal(await eventCount(), 0);
  });

  test("without escrow configuration the answer is 500 and nothing is stored", async () => {
    const server = app({ escrow: undefined });
    const response = await evaluate(server, lockBody(), { cookie: await ownerCookie(server) });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: "INTERNAL_ERROR" });
    assert.equal((await actions()).length, 0);
    assert.equal(await eventCount(), 0);
  });
});

describe("PROPOSE_PURCHASE by an agent", () => {
  test("stores an APPROVED record (D15), binds the matching unclaimed RESERVED reservation (D2b) and returns the ticket (T1.2c)", async () => {
    const reservationId = await insertId(
      "INSERT INTO budget_reservations (procurement_id, agent_id, amount, status, idempotency_key) VALUES ($1, $2, 70000.00, 'RESERVED', 'k1') RETURNING id",
      [procurementId, agentId],
    );
    const response = await evaluate(app(), proposeBody(), asAgent());
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().decision, "ALLOW");
    assert.match(response.json().ticket, /^svt_[A-Za-z0-9_-]{43}$/);
    const [row] = await actions();
    assert.equal(row!.status, "APPROVED");
    assert.equal(row!.action_type, "PROPOSE_PURCHASE");
    assert.equal(row!.reservation_id, reservationId);
    const events = (await db.query("SELECT decision, agent_id, action_id FROM policy_events")).rows;
    assert.deepEqual(events, [{ decision: "ALLOW", agent_id: agentId, action_id: row!.id }]);
  });

  test("a second action cannot claim an already bound reservation, and a reservation for another amount is not bound", async () => {
    await db.query(
      "INSERT INTO budget_reservations (procurement_id, agent_id, amount, status, idempotency_key) VALUES ($1, $2, 70000.00, 'RESERVED', 'k1')",
      [procurementId, agentId],
    );
    await db.query(
      "INSERT INTO budget_reservations (procurement_id, agent_id, amount, status, idempotency_key) VALUES ($1, $2, 5.00, 'RESERVED', 'k2')",
      [procurementId, agentId],
    );
    const server = app();
    await evaluate(server, proposeBody(), asAgent());
    await evaluate(server, proposeBody(), asAgent());
    const rows = await actions();
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((r) => r.reservation_id !== null).length, 1);
  });

  test("no reservation is not an error: the record is stored with reservation_id null", async () => {
    await evaluate(app(), proposeBody(), asAgent());
    assert.equal((await actions())[0]!.reservation_id, null);
  });

  test("the spend limit is checked against the same amount the record stores: a total that differs from the quote is 400", async () => {
    const response = await evaluate(app(), proposeBody({ procurement_id: procurementId, quote_id: quoteId, total_lkr: "100.00" }), asAgent());
    assert.equal(response.statusCode, 400);
    assert.equal((await actions()).length, 0);
    assert.equal(await eventCount(), 0);
  });

  test("a procurement of an owner who did not grant this agent is 400", async () => {
    const otherProcurement = await insertId("INSERT INTO procurements (owner_id, description, budget, status) VALUES ($1, 'Other', 1000.00, 'OPEN') RETURNING id", [otherOwnerId]);
    const otherQuote = await insertId(
      "INSERT INTO supplier_quotes (procurement_id, supplier_id, amount, quote_data) VALUES ($1, $2, 70000.00, $3) RETURNING id",
      [otherProcurement, supplierId, JSON.stringify({ item: "x", quantity: 1 })],
    );
    const response = await evaluate(app(), proposeBody({ procurement_id: otherProcurement, quote_id: otherQuote, total_lkr: "70000.00" }), asAgent());
    assert.equal(response.statusCode, 400);
    assert.equal((await actions()).length, 0);
  });

  test("a DENY creates no action row (D15), including over the spend limit", async () => {
    await db.query("UPDATE agents SET status = 'SUSPENDED' WHERE id = $1", [agentId]);
    const suspended = await evaluate(app(), proposeBody(), asAgent());
    assert.equal(suspended.json().reason_code, "AGENT_INACTIVE");
    await db.query("UPDATE agents SET status = 'ACTIVE' WHERE id = $1", [agentId]);
    const over = await evaluate(app(), proposeBody({ procurement_id: procurementId, quote_id: quoteId, total_lkr: "120000.01" }), asAgent());
    assert.equal(over.json().reason_code, "SPEND_LIMIT_EXCEEDED");
    assert.equal((await actions()).length, 0);
  });

  test("an agent cannot ask for an escrow action, and read tools create no action row", async () => {
    const escrow = await evaluate(app(), lockBody(), asAgent());
    assert.equal(escrow.json().reason_code, "TOOL_OUT_OF_SCOPE");
    const read = await evaluate(app(), { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} }, asAgent());
    assert.equal(read.statusCode, 501);
    assert.equal((await actions()).length, 0);
  });
});

describe("ESCROW_RELEASE and ESCROW_REFUND", () => {
  const lockFirst = async (server: Server, cookie: string): Promise<string> => {
    const lock = await evaluate(server, lockBody(), { cookie });
    assert.equal(lock.statusCode, 200);
    return lock.json().action_id as string;
  };

  test("copy the lock action's payload, hash and salt into a new PENDING_APPROVAL record", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    const lockId = await lockFirst(server, cookie);
    for (const tool of ["ESCROW_RELEASE", "ESCROW_REFUND"]) {
      const response = await evaluate(server, { tool, resource: `budget/${procurementId}`, parameters: { action_id: lockId } }, { cookie });
      assert.equal(response.statusCode, 200, tool);
      assert.equal(response.json().decision, "APPROVAL_REQUIRED");
    }
    const rows = await actions();
    assert.equal(rows.length, 3);
    const lock = rows.find((r) => r.id === lockId)!;
    for (const row of rows.filter((r) => r.id !== lockId)) {
      assert.equal(row.status, "PENDING_APPROVAL");
      assert.equal(row.canonical_payload, lock.canonical_payload);
      assert.equal(row.action_hash, lock.action_hash);
      assert.equal(row.commitment_salt, lock.commitment_salt);
      assert.equal(row.procurement_id, procurementId);
    }
    assert.deepEqual(rows.map((r) => r.action_type).sort(), ["ESCROW_LOCK", "ESCROW_REFUND", "ESCROW_RELEASE"]);
  });

  test("a missing lock, a lock of another owner, or an action that is not a lock is 400 and stores nothing", async () => {
    const server = app();
    const cookie = await ownerCookie(server);
    const otherProcurement = await insertId("INSERT INTO procurements (owner_id, description, budget, status) VALUES ($1, 'Other', 1.00, 'OPEN') RETURNING id", [otherOwnerId]);
    const foreign = await insertId(
      `INSERT INTO actions (procurement_id, owner_id, action_type, canonical_payload, action_hash, commitment_salt, status, policy_version)
       VALUES ($1, $2, 'ESCROW_LOCK', '{}', $3, $4, 'PENDING_APPROVAL', 'policy-v1') RETURNING id`,
      [otherProcurement, otherOwnerId, "a".repeat(64), "b".repeat(64)],
    );
    const notLock = await insertId(
      `INSERT INTO actions (procurement_id, owner_id, action_type, canonical_payload, action_hash, commitment_salt, status, policy_version)
       VALUES ($1, $2, 'PROPOSE_PURCHASE', '{}', $3, $4, 'APPROVED', 'policy-v1') RETURNING id`,
      [procurementId, ownerId, "c".repeat(64), "d".repeat(64)],
    );
    const before = (await actions()).length;
    for (const parameters of [{}, { action_id: "not-an-id" }, { action_id: "00000000-0000-4000-8000-0000000000ff" }, { action_id: foreign }, { action_id: notLock }]) {
      const response = await evaluate(server, { tool: "ESCROW_RELEASE", resource: "budget/x", parameters }, { cookie });
      assert.equal(response.statusCode, 400, JSON.stringify(parameters));
    }
    assert.equal((await actions()).length, before);
  });
});

describe("immutability of the stored record (Blueprint 6.2)", () => {
  test("the payload, hash, salt, owner, procurement, type and policy version cannot be changed; status and ticket columns can", async () => {
    const server = app();
    await evaluate(server, lockBody(), { cookie: await ownerCookie(server) });
    const id = (await actions())[0]!.id as string;
    const attempts: [string, unknown][] = [
      ["canonical_payload", "{}"],
      ["action_hash", "e".repeat(64)],
      ["commitment_salt", "f".repeat(64)],
      ["owner_id", otherOwnerId],
      ["procurement_id", await insertId("INSERT INTO procurements (owner_id, description, budget, status) VALUES ($1, 'P2', 1.00, 'OPEN') RETURNING id", [ownerId])],
      ["action_type", "ESCROW_RELEASE"],
      ["policy_version", "policy-v0"],
    ];
    for (const [column, value] of attempts) {
      await db.query("SAVEPOINT attempt");
      await assert.rejects(db.query(`UPDATE actions SET ${column} = $1 WHERE id = $2`, [value, id]), /immutable/, column);
      await db.query("ROLLBACK TO SAVEPOINT attempt");
    }
    await db.query("UPDATE actions SET status = 'APPROVED', ticket_nonce = 'n1', last_error = 'x' WHERE id = $1", [id]);
    assert.equal((await actions())[0]!.status, "APPROVED");
  });
});
