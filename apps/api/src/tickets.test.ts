// T1.2c tests: the execution ticket (Blueprint 6.2; decisions D4, D16). Real Postgres, each test in a rolled-back
// transaction. Tickets come from the real POST /api/actions/evaluate route (PROPOSE_PURCHASE ALLOW).
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { createAgent } from "./agent-auth.ts";
import { buildApp, type AppOptions } from "./app.ts";
import { createGrant } from "./grants.ts";
import { POLICY_VERSION, type PolicyCaller } from "./policy.ts";
import { TICKET_TTL_MS, createTicket, ticketBindingTag, validateTicket } from "./tickets.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

const KEY = "test-grant-key-not-a-secret";
const NOW = new Date("2026-11-28T10:00:00.000Z");
const OWNER_LOGIN = { login: "demo-owner-test", password: "a-test-password-123" };
const SCOPES = ["supplier:search", "quote:read", "file:read", "proposal:prepare", "resource:suppliers/*", "resource:quotes/*"];
const ESCROW = { scriptAddress: "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg", amountTada: "5.000000" };
const PAYEE = "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";

let db: InstanceType<typeof pg.Client>;
let ownerId: string;
let agentId: string;
let token: string;
let procurementId: string;
let quoteId: string;
let supplierId: string;

const insertId = async (sql: string, values: unknown[]): Promise<string> => (await db.query(sql, values)).rows[0]!.id as string;

beforeEach(async () => {
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("BEGIN");
  ownerId = await insertId("INSERT INTO users (name, role) VALUES ('Owner', 'owner') RETURNING id", []);
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
    [procurementId, supplierId, JSON.stringify({ item: "Cotton bed linen sets", quantity: 10 })],
  );
});

afterEach(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

const app = (extra: Partial<AppOptions> = {}) =>
  buildApp({ db, ownerLogin: OWNER_LOGIN, ownerId, integrityKey: KEY, escrow: ESCROW, logger: false, now: () => NOW, ...extra });
const asAgent = () => ({ authorization: `Bearer ${token}` });
const propose = (server: ReturnType<typeof app>) =>
  server.inject({
    method: "POST",
    url: "/api/actions/evaluate",
    payload: {
      tool: "PROPOSE_PURCHASE",
      resource: `quotes/${supplierId}`,
      parameters: { procurement_id: procurementId, quote_id: quoteId, total_lkr: "70000.00" },
    },
    headers: asAgent(),
  });
const issue = async (server = app()) => {
  const response = await propose(server);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  return { ticket: body.ticket as string, actionId: body.action_id as string, body };
};
const agentCaller = (): PolicyCaller => ({ kind: "agent", agentId });

describe("ticket issued by evaluate", () => {
  test("ALLOW returns the ticket once; only a binding tag is stored, with the expiry", async () => {
    const { ticket, actionId, body } = await issue();
    assert.equal(body.decision, "ALLOW");
    assert.match(ticket, /^svt_[A-Za-z0-9_-]{43}$/);
    assert.equal(body.ticket_expires_at, new Date(NOW.getTime() + TICKET_TTL_MS).toISOString());
    const row = (await db.query("SELECT action_hash, ticket_nonce, ticket_expires_at, status FROM actions WHERE id = $1", [actionId])).rows[0]!;
    assert.equal(row.status, "APPROVED");
    assert.notEqual(row.ticket_nonce, ticket);
    assert.equal(row.ticket_nonce, ticketBindingTag(ticket, { actionHash: row.action_hash as string, caller: agentCaller(), policyVersion: POLICY_VERSION }));
    assert.equal((row.ticket_expires_at as Date).toISOString(), body.ticket_expires_at);
    assert.equal(body.action_hash, row.action_hash);
    assert.equal(JSON.stringify(row).includes(ticket), false, "the ticket itself is not stored");
  });

  test("the ticket is short-lived: five minutes (decision D49)", async () => {
    assert.equal(TICKET_TTL_MS, 5 * 60 * 1000);
    const { body } = await issue();
    assert.equal(Date.parse(body.ticket_expires_at) - NOW.getTime(), 300_000);
  });

  test("every evaluation gets a different ticket", async () => {
    const server = app();
    const a = await issue(server);
    const b = await issue(server);
    assert.notEqual(a.ticket, b.ticket);
    assert.notEqual(a.actionId, b.actionId);
  });

  test("APPROVAL_REQUIRED returns no ticket and stores none (the ticket comes with the owner's approval, T2.3)", async () => {
    const server = app();
    const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: OWNER_LOGIN });
    const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
    const response = await server.inject({
      method: "POST",
      url: "/api/actions/evaluate",
      payload: { tool: "ESCROW_LOCK", resource: `budget/${procurementId}`, parameters: { procurement_id: procurementId, quote_id: quoteId } },
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes("ticket"));
    const row = (await db.query("SELECT ticket_nonce, ticket_expires_at FROM actions")).rows[0]!;
    assert.equal(row.ticket_nonce, null);
    assert.equal(row.ticket_expires_at, null);
  });

  test("read tools still answer 501 and create no action (decided with the connectors card, T1.4)", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/api/actions/evaluate",
      payload: { tool: "QUOTE_READ", resource: "quotes/a", parameters: {} },
      headers: asAgent(),
    });
    assert.equal(response.statusCode, 501);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM actions")).rows[0]!.n, 0);
  });

  test("the ticket is not written to the logs", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const { ticket } = await issue(app({ logger: { stream, level: "trace" } }));
    assert.ok(lines.join("\n").includes("policy_decision"));
    assert.ok(!lines.join("\n").includes(ticket));
  });
});

describe("validateTicket", () => {
  test("accepts the issued ticket for its action and caller, and does not consume it", async () => {
    const { ticket, actionId, body } = await issue();
    for (let i = 0; i < 2; i++) {
      const check = await validateTicket(db, { ticket, actionId, caller: agentCaller() }, NOW);
      assert.deepEqual(check, { ok: true, actionId, actionHash: body.action_hash, policyVersion: POLICY_VERSION });
    }
    assert.equal((await db.query("SELECT status FROM actions WHERE id = $1", [actionId])).rows[0]!.status, "APPROVED");
  });

  test("a ticket for another action hash is invalid", async () => {
    const server = app();
    const a = await issue(server);
    const b = await issue(server);
    assert.equal((await validateTicket(db, { ticket: a.ticket, actionId: b.actionId, caller: agentCaller() }, NOW)).ok, false);
    assert.deepEqual(await validateTicket(db, { ticket: a.ticket, actionId: b.actionId, caller: agentCaller() }, NOW), { ok: false, code: "TICKET_INVALID" });
  });

  test("a ticket presented by another caller is invalid: another agent, the owner session, or an owner id equal to nothing", async () => {
    const { ticket, actionId } = await issue();
    const other = await createAgent(db, { name: "Other" });
    for (const caller of [{ kind: "agent", agentId: other.id }, { kind: "owner", ownerId }, { kind: "owner", ownerId: agentId }] as PolicyCaller[]) {
      assert.deepEqual(await validateTicket(db, { ticket, actionId, caller }, NOW), { ok: false, code: "TICKET_INVALID" }, JSON.stringify(caller));
    }
  });

  test("a ticket issued for a different action hash is invalid even when the ticket string and caller are right", async () => {
    const { actionId } = await issue();
    const hash = (await db.query("SELECT action_hash FROM actions WHERE id = $1", [actionId])).rows[0]!.action_hash as string;
    const forOther = createTicket({ actionHash: "f".repeat(64), caller: agentCaller(), policyVersion: POLICY_VERSION }, NOW);
    const other = await insertId(
      `INSERT INTO actions (procurement_id, owner_id, action_type, canonical_payload, action_hash, commitment_salt, status, policy_version, ticket_nonce, ticket_expires_at)
       VALUES ($1, $2, 'PROPOSE_PURCHASE', '{}', $3, $4, 'APPROVED', $5, $6, $7) RETURNING id`,
      [procurementId, ownerId, hash, "d".repeat(64), POLICY_VERSION, forOther.storedNonce, forOther.expiresAt],
    );
    assert.deepEqual(await validateTicket(db, { ticket: forOther.ticket, actionId: other, caller: agentCaller() }, NOW), { ok: false, code: "TICKET_INVALID" });
  });

  test("a ticket issued for another policy version is invalid", async () => {
    const { actionId } = await issue();
    const hash = (await db.query("SELECT action_hash FROM actions WHERE id = $1", [actionId])).rows[0]!.action_hash as string;
    const old = createTicket({ actionHash: hash, caller: agentCaller(), policyVersion: "policy-v0" }, NOW);
    // The immutable trigger forbids changing policy_version, so build a second action whose stored nonce was made for policy-v0.
    const other = await insertId(
      `INSERT INTO actions (procurement_id, owner_id, action_type, canonical_payload, action_hash, commitment_salt, status, policy_version, ticket_nonce, ticket_expires_at)
       VALUES ($1, $2, 'PROPOSE_PURCHASE', '{}', $3, $4, 'APPROVED', $5, $6, $7) RETURNING id`,
      [procurementId, ownerId, hash, "c".repeat(64), POLICY_VERSION, old.storedNonce, old.expiresAt],
    );
    assert.deepEqual(await validateTicket(db, { ticket: old.ticket, actionId: other, caller: agentCaller() }, NOW), { ok: false, code: "TICKET_INVALID" });
  });

  test("garbage, a missing ticket, a bad id, an unknown action and an action with no ticket are all TICKET_INVALID", async () => {
    const { ticket, actionId } = await issue();
    const noTicket = await insertId(
      `INSERT INTO actions (procurement_id, owner_id, action_type, canonical_payload, action_hash, commitment_salt, status, policy_version)
       VALUES ($1, $2, 'ESCROW_LOCK', '{}', $3, $4, 'PENDING_APPROVAL', $5) RETURNING id`,
      [procurementId, ownerId, "a".repeat(64), "b".repeat(64), POLICY_VERSION],
    );
    const cases: [string, string][] = [
      ["", actionId],
      ["svt_", actionId],
      ["nonsense", actionId],
      [ticket.slice(0, -1) + (ticket.endsWith("A") ? "B" : "A"), actionId],
      [ticket, "not-an-id"],
      [ticket, "00000000-0000-4000-8000-0000000000ff"],
      [ticket, noTicket],
    ];
    for (const [t, id] of cases) {
      assert.deepEqual(await validateTicket(db, { ticket: t, actionId: id, caller: agentCaller() }, NOW), { ok: false, code: "TICKET_INVALID" }, `${t} ${id}`);
    }
  });

  test("an expired ticket is TICKET_EXPIRED, exactly at the expiry too; one millisecond earlier is still valid", async () => {
    const { ticket, actionId } = await issue();
    const input = { ticket, actionId, caller: agentCaller() };
    assert.equal((await validateTicket(db, input, new Date(NOW.getTime() + TICKET_TTL_MS - 1))).ok, true);
    assert.deepEqual(await validateTicket(db, input, new Date(NOW.getTime() + TICKET_TTL_MS)), { ok: false, code: "TICKET_EXPIRED" });
    assert.deepEqual(await validateTicket(db, input, new Date(NOW.getTime() + TICKET_TTL_MS * 10)), { ok: false, code: "TICKET_EXPIRED" });
  });

  test("single use: once the execute transition has moved the action out of APPROVED, the ticket is TICKET_USED, even if it also expired", async () => {
    const { ticket, actionId } = await issue();
    await db.query("UPDATE actions SET status = 'EXECUTING' WHERE id = $1", [actionId]);
    const input = { ticket, actionId, caller: agentCaller() };
    assert.deepEqual(await validateTicket(db, input, NOW), { ok: false, code: "TICKET_USED" });
    assert.deepEqual(await validateTicket(db, input, new Date(NOW.getTime() + TICKET_TTL_MS * 2)), { ok: false, code: "TICKET_USED" });
    // A wrong ticket on a used action must not reveal that the action was used.
    assert.deepEqual(await validateTicket(db, { ...input, ticket: "svt_" + "A".repeat(43) }, NOW), { ok: false, code: "TICKET_INVALID" });
  });
});

describe("ticket binding tag", () => {
  test("changes with every input", () => {
    const base = { actionHash: "a".repeat(64), caller: { kind: "agent", agentId: "11111111-1111-4111-8111-111111111111" } as PolicyCaller, policyVersion: "policy-v1" };
    const tag = ticketBindingTag("svt_x", base);
    assert.notEqual(tag, ticketBindingTag("svt_y", base));
    assert.notEqual(tag, ticketBindingTag("svt_x", { ...base, actionHash: "b".repeat(64) }));
    assert.notEqual(tag, ticketBindingTag("svt_x", { ...base, caller: { kind: "agent", agentId: "22222222-2222-4222-8222-222222222222" } }));
    assert.notEqual(tag, ticketBindingTag("svt_x", { ...base, caller: { kind: "owner", ownerId: "11111111-1111-4111-8111-111111111111" } }));
    assert.notEqual(tag, ticketBindingTag("svt_x", { ...base, policyVersion: "policy-v2" }));
    assert.match(tag, /^[0-9a-f]{64}$/);
  });
});
