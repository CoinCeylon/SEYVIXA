// T1.2a tests for checkPolicy (Blueprint 6.2, decisions D4, D17, D30, D36). Real Postgres, each test in a
// rolled-back transaction. The last test fails if a reason code evaluate can produce has no test.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { REASON_CODES, type ActionType, type ReasonCode } from "@seyvixa/shared";
import { createAgent, type Queryable } from "./agent-auth.ts";
import { createGrant, revokeGrant } from "./grants.ts";
import {
  DENY_MESSAGES,
  checkPolicy,
  isProtectedResource,
  recordPolicyEvent,
  resourceNameIsSafe,
  type PolicyInput,
  type PolicyResult,
} from "./policy.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

const KEY = "test-grant-key-not-a-secret";
const NOW = new Date("2026-11-27T10:00:00.000Z");
const LATER = new Date("2026-12-31T23:59:59.000Z");
// The Procurement Agent's seeded scopes (docs/SEED_SPEC.md 3.3).
const PROCUREMENT_SCOPES = ["supplier:search", "quote:read", "file:read", "proposal:prepare", "resource:suppliers/*", "resource:quotes/*"];

let db: InstanceType<typeof pg.Client>;
let ownerId: string;
let agentId: string;
const seen = new Set<string>();

beforeEach(async () => {
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("BEGIN");
  ownerId = (await db.query("INSERT INTO users (name, role) VALUES ('Owner', 'owner') RETURNING id")).rows[0]!.id as string;
  agentId = (await createAgent(db, { name: "Agent" })).id;
});

afterEach(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

const grant = (scopes: string[], extra: { spendLimit?: string; expiresAt?: Date; agent?: string } = {}) =>
  createGrant(
    db,
    {
      ownerId,
      agentId: extra.agent ?? agentId,
      scopes,
      spendLimit: extra.spendLimit ?? "120000.00",
      expiresAt: extra.expiresAt ?? LATER,
      issuer: "seyvixa-seed",
    },
    KEY,
  );

const agentCall = (tool: ActionType, resource: string, parameters: Record<string, unknown> = {}): PolicyInput => ({
  caller: { kind: "agent", agentId },
  tool,
  resource,
  parameters,
});

const decide = async (input: PolicyInput, database: Queryable = db, now = NOW): Promise<PolicyResult> => {
  const result = await checkPolicy(database, input, KEY, now);
  if (result.decision === "DENY") seen.add(result.reasonCode);
  return result;
};
const denied = (reasonCode: ReasonCode): PolicyResult => ({ decision: "DENY", reasonCode });

describe("agent: ALLOW", () => {
  test("each tool with its scope and a resource inside scope is allowed", async () => {
    await grant(PROCUREMENT_SCOPES);
    assert.deepEqual(await decide(agentCall("SUPPLIER_SEARCH", "suppliers/50000000-0000-4000-8000-00000000000a")), { decision: "ALLOW" });
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/supplier-a")), { decision: "ALLOW" });
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes/supplier-a.json")), { decision: "ALLOW" });
    assert.deepEqual(await decide(agentCall("PROPOSE_PURCHASE", "suppliers/a", { total_lkr: "70000.00" })), { decision: "ALLOW" });
  });

  test("an exact resource scope allows only that resource", async () => {
    await grant(["file:read", "resource:quotes/a.json"]);
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes/a.json")), { decision: "ALLOW" });
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes/a.json2")), denied("RESOURCE_OUT_OF_SCOPE"));
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes/b.json")), denied("RESOURCE_OUT_OF_SCOPE"));
  });
});

describe("agent: AGENT_INACTIVE (check 1)", () => {
  test("a SUSPENDED agent is denied even with a perfect grant", async () => {
    await grant(PROCUREMENT_SCOPES);
    await db.query("UPDATE agents SET status = 'SUSPENDED' WHERE id = $1", [agentId]);
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a")), denied("AGENT_INACTIVE"));
  });

  test("any status other than ACTIVE, and an unknown agent, are denied", async () => {
    await grant(PROCUREMENT_SCOPES);
    for (const status of ["active", "", "DELETED"]) {
      await db.query("UPDATE agents SET status = $1 WHERE id = $2", [status, agentId]);
      assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a")), denied("AGENT_INACTIVE"), status);
    }
    const unknown: PolicyInput = { ...agentCall("QUOTE_READ", "quotes/a"), caller: { kind: "agent", agentId: "99999999-9999-4999-8999-999999999999" } };
    assert.deepEqual(await decide(unknown), denied("AGENT_INACTIVE"));
  });
});

describe("agent: the grant (check 2 and 7)", () => {
  test("no grant: GRANT_MISSING", async () => {
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a")), denied("GRANT_MISSING"));
  });

  test("an expired grant: GRANT_EXPIRED (the expiry instant itself is expired)", async () => {
    await grant(PROCUREMENT_SCOPES, { expiresAt: new Date(NOW.getTime() + 1000) });
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a")), { decision: "ALLOW" });
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a"), db, new Date(NOW.getTime() + 1000)), denied("GRANT_EXPIRED"));
  });

  test("a revoked grant: GRANT_REVOKED", async () => {
    const g = await grant(PROCUREMENT_SCOPES);
    await revokeGrant(db, { grantId: g.id, ownerId }, KEY, NOW);
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a")), denied("GRANT_REVOKED"));
  });

  test("a tampered grant: GRANT_INTEGRITY_FAILED, even for an otherwise allowed call", async () => {
    const g = await grant(["quote:read", "resource:quotes/*"]);
    await db.query("UPDATE agent_grants SET scopes = $1 WHERE id = $2", [["quote:read", "file:read", "resource:*"], g.id]);
    assert.deepEqual(await decide(agentCall("FILE_READ", "payroll.csv")), denied("GRANT_INTEGRITY_FAILED"));
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a")), denied("GRANT_INTEGRITY_FAILED"));
  });
});

describe("agent: the tool (check 3)", () => {
  test("a grant without the tool scope: TOOL_OUT_OF_SCOPE, for every tool", async () => {
    await grant(["resource:*", "budget:reserve"]);
    for (const tool of ["SUPPLIER_SEARCH", "QUOTE_READ", "FILE_READ"] as const) {
      assert.deepEqual(await decide(agentCall(tool, "quotes/a")), denied("TOOL_OUT_OF_SCOPE"), tool);
    }
    assert.deepEqual(await decide(agentCall("PROPOSE_PURCHASE", "quotes/a", { total_lkr: "1.00" })), denied("TOOL_OUT_OF_SCOPE"));
  });

  test("the tool scope is the right one for the tool, not any tool scope", async () => {
    await grant(["quote:read", "supplier:search", "resource:quotes/*"]);
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes/a")), denied("TOOL_OUT_OF_SCOPE"));
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a")), { decision: "ALLOW" });
  });

  test("escrow actions are never allowed for an agent, whatever scopes it holds", async () => {
    await grant([...PROCUREMENT_SCOPES, "escrow:lock", "escrow:release", "approve", "resource:*"]);
    for (const tool of ["ESCROW_LOCK", "ESCROW_RELEASE", "ESCROW_REFUND"] as const) {
      assert.deepEqual(await decide(agentCall(tool, "quotes/a")), denied("TOOL_OUT_OF_SCOPE"), tool);
    }
  });
});

describe("agent: the resource (check 4), including payroll.csv", () => {
  test("P0-1: FILE_READ of payroll.csv by the Procurement Agent is RESOURCE_OUT_OF_SCOPE", async () => {
    await grant(PROCUREMENT_SCOPES);
    assert.deepEqual(await decide(agentCall("FILE_READ", "payroll.csv")), denied("RESOURCE_OUT_OF_SCOPE"));
  });

  test("payroll.csv is denied even if a grant carries resource:* (defence in depth), other resources still work", async () => {
    await grant(["file:read", "resource:*"]);
    assert.deepEqual(await decide(agentCall("FILE_READ", "payroll.csv")), denied("RESOURCE_OUT_OF_SCOPE"));
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes/payroll.csv")), denied("RESOURCE_OUT_OF_SCOPE"));
    assert.deepEqual(await decide(agentCall("FILE_READ", "PAYROLL.CSV")), denied("RESOURCE_OUT_OF_SCOPE"));
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes/a")), { decision: "ALLOW" });
  });

  test("path tricks and odd names are out of scope, even under a wildcard", async () => {
    await grant(["file:read", "resource:quotes/*"]);
    for (const resource of ["quotes/../payroll.csv", "quotes/../secret", "/payroll.csv", "quotes//x", "quotes/a b", " quotes/x", "quotes/x\n", "quotes\\x", "quotes/x\0", "quotes/é", "payroll.csv/"]) {
      assert.deepEqual(await decide(agentCall("FILE_READ", resource)), denied("RESOURCE_OUT_OF_SCOPE"), JSON.stringify(resource));
    }
  });

  test("a resource outside every resource scope, or a grant with no resource scope, is denied", async () => {
    await grant(["file:read", "resource:quotes/*"]);
    assert.deepEqual(await decide(agentCall("FILE_READ", "suppliers/a")), denied("RESOURCE_OUT_OF_SCOPE"));
    assert.deepEqual(await decide(agentCall("FILE_READ", "budget/40000000-0000-4000-8000-000000000001")), denied("RESOURCE_OUT_OF_SCOPE"));
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes")), denied("RESOURCE_OUT_OF_SCOPE"));
  });

  test("a grant with a tool scope but no resource scope allows no resource (fail closed)", async () => {
    await grant(["file:read"]);
    assert.deepEqual(await decide(agentCall("FILE_READ", "quotes/a")), denied("RESOURCE_OUT_OF_SCOPE"));
  });

  test("helper functions", () => {
    assert.equal(resourceNameIsSafe("quotes/supplier-a.json"), true);
    assert.equal(resourceNameIsSafe("quotes/../x"), false);
    assert.equal(isProtectedResource("payroll.csv"), true);
    assert.equal(isProtectedResource("a/b/Payroll.CSV"), true);
    assert.equal(isProtectedResource("payroll.csv.bak"), false);
  });
});

describe("agent: the spend limit (check 5)", () => {
  test("a total above the limit is SPEND_LIMIT_EXCEEDED; equal to the limit is allowed", async () => {
    await grant(PROCUREMENT_SCOPES, { spendLimit: "70000.00" });
    const propose = (total: string) => agentCall("PROPOSE_PURCHASE", "suppliers/a", { total_lkr: total });
    assert.deepEqual(await decide(propose("70000.00")), { decision: "ALLOW" });
    assert.deepEqual(await decide(propose("70000.01")), denied("SPEND_LIMIT_EXCEEDED"));
    assert.deepEqual(await decide(propose("70000.1")), denied("SPEND_LIMIT_EXCEEDED"));
    assert.deepEqual(await decide(propose("69999.99")), { decision: "ALLOW" });
    assert.deepEqual(await decide(propose("78000")), denied("SPEND_LIMIT_EXCEEDED"));
    assert.deepEqual(await decide(propose("999999999999.99")), denied("SPEND_LIMIT_EXCEEDED"));
  });

  test("a missing or malformed total on PROPOSE_PURCHASE fails closed with INTERNAL_ERROR", async () => {
    await grant(PROCUREMENT_SCOPES);
    for (const parameters of [{}, { total_lkr: "abc" }, { total_lkr: 70000 }, { total_lkr: "0.00" }, { total_lkr: "-1.00" }, { total_lkr: "70000.001" }, { total_lkr: null }]) {
      assert.deepEqual(await decide(agentCall("PROPOSE_PURCHASE", "suppliers/a", parameters)), denied("INTERNAL_ERROR"), JSON.stringify(parameters));
    }
  });

  test("the spend limit only applies to PROPOSE_PURCHASE; other tools ignore a total", async () => {
    await grant(PROCUREMENT_SCOPES, { spendLimit: "10.00" });
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a", { total_lkr: "999999.00" })), { decision: "ALLOW" });
  });
});

describe("order of checks", () => {
  test("agent status comes before the grant, the grant before the tool, the tool before the resource, the resource before spend", async () => {
    await db.query("UPDATE agents SET status = 'SUSPENDED' WHERE id = $1", [agentId]);
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a")), denied("AGENT_INACTIVE"), "no grant but suspended");
    await db.query("UPDATE agents SET status = 'ACTIVE' WHERE id = $1", [agentId]);

    await grant(["quote:read", "resource:quotes/*"], { expiresAt: new Date(NOW.getTime() + 1000) });
    const late = new Date(NOW.getTime() + 5000);
    assert.deepEqual(await decide(agentCall("FILE_READ", "payroll.csv"), db, late), denied("GRANT_EXPIRED"), "expired beats tool and resource");
    assert.deepEqual(await decide(agentCall("FILE_READ", "payroll.csv")), denied("TOOL_OUT_OF_SCOPE"), "tool beats resource");
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "payroll.csv")), denied("RESOURCE_OUT_OF_SCOPE"));
  });

  test("resource beats spend", async () => {
    await grant(PROCUREMENT_SCOPES, { spendLimit: "1.00" });
    assert.deepEqual(await decide(agentCall("PROPOSE_PURCHASE", "budget/x", { total_lkr: "50.00" })), denied("RESOURCE_OUT_OF_SCOPE"));
  });
});

describe("fail closed", () => {
  test("a database error gives DENY with INTERNAL_ERROR", async () => {
    const broken: Queryable = { query: async () => { throw new Error("database is down"); } };
    assert.deepEqual(await decide(agentCall("QUOTE_READ", "quotes/a"), broken), denied("INTERNAL_ERROR"));
  });

  test("a result that cannot be read gives DENY, never ALLOW", async () => {
    await grant(PROCUREMENT_SCOPES);
    const odd: Queryable = { query: async () => ({ rows: [{ status: "ACTIVE" }, { status: "ACTIVE" }] }) };
    const result = await decide(agentCall("QUOTE_READ", "quotes/a"), odd);
    assert.equal(result.decision, "DENY");
  });
});

describe("owner caller", () => {
  test("an escrow action gives APPROVAL_REQUIRED (D17), and the owner has no tool access", async () => {
    for (const tool of ["ESCROW_LOCK", "ESCROW_RELEASE", "ESCROW_REFUND"] as const) {
      const result = await decide({ caller: { kind: "owner", ownerId }, tool, resource: "budget/x", parameters: {} });
      assert.deepEqual(result, { decision: "APPROVAL_REQUIRED" }, tool);
    }
    for (const tool of ["SUPPLIER_SEARCH", "QUOTE_READ", "FILE_READ", "PROPOSE_PURCHASE"] as const) {
      const result = await decide({ caller: { kind: "owner", ownerId }, tool, resource: "quotes/a", parameters: { total_lkr: "1.00" } });
      assert.deepEqual(result, denied("TOOL_OUT_OF_SCOPE"), tool);
    }
  });
});

describe("policy events and messages", () => {
  test("a DENY stores its D4 code; ALLOW and APPROVAL_REQUIRED store the decision name (D36)", async () => {
    await recordPolicyEvent(db, { agentId, tool: "FILE_READ", resource: "payroll.csv", result: denied("RESOURCE_OUT_OF_SCOPE") });
    await recordPolicyEvent(db, { agentId, tool: "QUOTE_READ", resource: "quotes/a", result: { decision: "ALLOW" } });
    await recordPolicyEvent(db, { agentId: null, tool: "ESCROW_LOCK", resource: "budget/x", result: { decision: "APPROVAL_REQUIRED" } });
    const rows = (await db.query("SELECT agent_id, action, decision, reason_code, resource, action_id, procurement_id FROM policy_events ORDER BY created_at, reason_code")).rows;
    assert.equal(rows.length, 3);
    const byDecision = Object.fromEntries(rows.map((r) => [r.decision, r]));
    assert.equal(byDecision.DENY.reason_code, "RESOURCE_OUT_OF_SCOPE");
    assert.equal(byDecision.DENY.resource, "payroll.csv");
    assert.equal(byDecision.ALLOW.reason_code, "ALLOW");
    assert.equal(byDecision.APPROVAL_REQUIRED.reason_code, "APPROVAL_REQUIRED");
    assert.equal(byDecision.APPROVAL_REQUIRED.agent_id, null);
    for (const r of rows) assert.equal(r.action_id, null);
  });

  test("there is a fixed message for every reason code, and none contains request data", () => {
    assert.deepEqual(Object.keys(DENY_MESSAGES).sort(), [...REASON_CODES].sort());
    for (const message of Object.values(DENY_MESSAGES)) assert.ok(message.length > 0);
  });
});

describe("coverage", () => {
  test("every reason code that evaluate can produce was reached by a test above", () => {
    const producible: ReasonCode[] = [
      "AGENT_INACTIVE",
      "GRANT_MISSING",
      "GRANT_EXPIRED",
      "GRANT_REVOKED",
      "GRANT_INTEGRITY_FAILED",
      "TOOL_OUT_OF_SCOPE",
      "RESOURCE_OUT_OF_SCOPE",
      "SPEND_LIMIT_EXCEEDED",
      "INTERNAL_ERROR",
    ];
    for (const code of producible) assert.ok(seen.has(code), `${code} was never produced by a test`);
  });
});
