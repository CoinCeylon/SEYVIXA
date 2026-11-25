// T1.1b tests: grants, integrity tag, expiry, revocation. Same setup as agent-auth.test.ts: real Postgres,
// every test in a transaction that is rolled back. The key below is a test value, not a secret.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { computeGrantIntegrityTag } from "@seyvixa/shared";
import { createAgent } from "./agent-auth.ts";
import {
  checkScopesForNewGrant,
  createGrant,
  grantIntegrityKeyFromEnv,
  loadValidGrant,
  resourceScopeMatches,
  revokeGrant,
  type Grant,
} from "./grants.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

const KEY = "test-grant-key-not-a-secret";
const NOW = new Date("2026-11-27T10:00:00.000Z");
const FUTURE = new Date("2026-12-31T23:59:59.000Z");
const PAST = new Date("2026-11-01T00:00:00.000Z");

let db: InstanceType<typeof pg.Client>;
let ownerId: string;
let agentId: string;

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

const newGrant = (overrides: Partial<{ scopes: string[]; spendLimit: string; expiresAt: Date }> = {}) =>
  createGrant(
    db,
    {
      ownerId,
      agentId,
      scopes: overrides.scopes ?? ["supplier:search", "quote:read", "resource:quotes/*"],
      spendLimit: overrides.spendLimit ?? "120000.00",
      expiresAt: overrides.expiresAt ?? FUTURE,
      issuer: "test-issuer",
    },
    KEY,
  );

describe("loadValidGrant", () => {
  test("a valid grant passes and comes back with its fields", async () => {
    const created = await newGrant();
    const result = await loadValidGrant(db, agentId, KEY, NOW);
    assert.ok(result.ok);
    assert.equal(result.grant.id, created.id);
    assert.deepEqual(result.grant.scopes, ["supplier:search", "quote:read", "resource:quotes/*"]);
    assert.equal(result.grant.spend_limit, "120000.00");
    assert.equal(result.grant.owner_id, ownerId);
  });

  test("no grant gives GRANT_MISSING; another agent's grant does not count", async () => {
    assert.deepEqual(await loadValidGrant(db, agentId, KEY, NOW), { ok: false, reasonCode: "GRANT_MISSING" });
    const other = (await createAgent(db, { name: "Other" })).id;
    await createGrant(db, { ownerId, agentId: other, scopes: ["quote:read"], spendLimit: "1.00", expiresAt: FUTURE, issuer: "x" }, KEY);
    assert.deepEqual(await loadValidGrant(db, agentId, KEY, NOW), { ok: false, reasonCode: "GRANT_MISSING" });
  });

  test("an expired grant is denied with GRANT_EXPIRED", async () => {
    await newGrant({ expiresAt: PAST });
    assert.deepEqual(await loadValidGrant(db, agentId, KEY, NOW), { ok: false, reasonCode: "GRANT_EXPIRED" });
  });

  test("a grant is expired at the exact expiry time and valid one millisecond before", async () => {
    await newGrant({ expiresAt: NOW });
    assert.equal((await loadValidGrant(db, agentId, KEY, NOW)).ok, false);
    assert.equal((await loadValidGrant(db, agentId, KEY, new Date(NOW.getTime() - 1))).ok, true);
  });

  test("a revoked grant is denied with GRANT_REVOKED on every later check", async () => {
    const grant = await newGrant();
    assert.equal((await loadValidGrant(db, agentId, KEY, NOW)).ok, true);
    await revokeGrant(db, { grantId: grant.id, ownerId }, KEY, NOW);
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(await loadValidGrant(db, agentId, KEY, NOW), { ok: false, reasonCode: "GRANT_REVOKED" });
    }
  });

  test("a tampered grant is denied with GRANT_INTEGRITY_FAILED, for every field", async () => {
    const other = (await db.query("INSERT INTO users (name, role) VALUES ('Other owner', 'owner') RETURNING id")).rows[0]!.id as string;
    const otherAgent = (await createAgent(db, { name: "Other" })).id;
    const tampers: [string, string, unknown][] = [
      ["scopes", "scopes = $1", ["supplier:search", "quote:read", "resource:quotes/*", "file:read"]],
      ["spend_limit", "spend_limit = $1", "999999.00"],
      ["expires_at", "expires_at = $1", new Date("2030-01-01T00:00:00Z")],
      ["owner_id", "owner_id = $1", other],
      ["agent_id", "agent_id = $1", otherAgent],
      ["issuer", "issuer = $1", "someone-else"],
      ["integrity_tag", "integrity_tag = $1", "0".repeat(64)],
      ["integrity_tag (not hex)", "integrity_tag = $1", "not-a-tag"],
    ];
    for (const [label, assignment, value] of tampers) {
      await db.query("SAVEPOINT s");
      const grant = await newGrant();
      await db.query(`UPDATE agent_grants SET ${assignment} WHERE id = $2`, [value, grant.id]);
      const checkAgent = label === "agent_id" ? otherAgent : agentId;
      assert.deepEqual(
        await loadValidGrant(db, checkAgent, KEY, NOW),
        { ok: false, reasonCode: "GRANT_INTEGRITY_FAILED" },
        label,
      );
      await db.query("ROLLBACK TO SAVEPOINT s");
    }
  });

  test("un-revoking a revoked grant by editing the row is caught", async () => {
    const grant = await newGrant();
    await revokeGrant(db, { grantId: grant.id, ownerId }, KEY, NOW);
    await db.query("UPDATE agent_grants SET revoked_at = NULL WHERE id = $1", [grant.id]);
    assert.deepEqual(await loadValidGrant(db, agentId, KEY, NOW), { ok: false, reasonCode: "GRANT_INTEGRITY_FAILED" });
  });

  test("a grant checked with the wrong key is denied", async () => {
    await newGrant();
    assert.deepEqual(await loadValidGrant(db, agentId, KEY + "x", NOW), { ok: false, reasonCode: "GRANT_INTEGRITY_FAILED" });
  });

  test("a grant whose tag was computed with another key is denied", async () => {
    const grant = await newGrant();
    const { integrity_tag: _tag, ...fields } = grant;
    await db.query("UPDATE agent_grants SET integrity_tag = $1 WHERE id = $2", [
      computeGrantIntegrityTag(fields, "attacker-key"),
      grant.id,
    ]);
    assert.equal((await loadValidGrant(db, agentId, KEY, NOW)).ok, false);
  });

  test("one tampered grant fails the check even if the agent has a valid second grant", async () => {
    const bad = await newGrant();
    await newGrant();
    await db.query("UPDATE agent_grants SET spend_limit = 1 WHERE id = $1", [bad.id]);
    assert.deepEqual(await loadValidGrant(db, agentId, KEY, NOW), { ok: false, reasonCode: "GRANT_INTEGRITY_FAILED" });
  });

  test("with several valid grants the one that expires last is returned; revoked and expired ones are skipped", async () => {
    await newGrant({ expiresAt: PAST });
    const revoked = await newGrant({ expiresAt: new Date("2027-06-01T00:00:00Z") });
    await revokeGrant(db, { grantId: revoked.id, ownerId }, KEY, NOW);
    const early = await newGrant({ expiresAt: new Date("2026-12-01T00:00:00Z") });
    const late = await newGrant({ expiresAt: new Date("2026-12-31T00:00:00Z") });
    const result = await loadValidGrant(db, agentId, KEY, NOW);
    assert.ok(result.ok);
    assert.equal(result.grant.id, late.id);
    assert.notEqual(result.grant.id, early.id);
  });

  test("a database error fails closed", async () => {
    const broken = {
      query: async (): Promise<never> => {
        throw new Error("down");
      },
    };
    assert.deepEqual(await loadValidGrant(broken, agentId, KEY, NOW), { ok: false, reasonCode: "GRANT_INTEGRITY_FAILED" });
  });
});

describe("revokeGrant", () => {
  test("sets revoked_at, re-signs the tag, and keeps the first revocation time", async () => {
    const grant = await newGrant();
    const revoked = await revokeGrant(db, { grantId: grant.id, ownerId }, KEY, NOW);
    assert.equal(revoked.revoked_at?.toISOString(), NOW.toISOString());
    assert.notEqual(revoked.integrity_tag, grant.integrity_tag);
    const again = await revokeGrant(db, { grantId: grant.id, ownerId }, KEY, new Date(NOW.getTime() + 60_000));
    assert.equal(again.revoked_at?.toISOString(), NOW.toISOString());
  });

  test("another owner cannot revoke the grant", async () => {
    const grant = await newGrant();
    const other = (await db.query("INSERT INTO users (name, role) VALUES ('Other', 'owner') RETURNING id")).rows[0]!.id as string;
    await assert.rejects(revokeGrant(db, { grantId: grant.id, ownerId: other }, KEY, NOW));
    assert.equal((await loadValidGrant(db, agentId, KEY, NOW)).ok, true);
  });

  test("a tampered grant is not re-signed by revoke", async () => {
    const grant = await newGrant();
    await db.query("UPDATE agent_grants SET spend_limit = 5 WHERE id = $1", [grant.id]);
    await assert.rejects(revokeGrant(db, { grantId: grant.id, ownerId }, KEY, NOW), /integrity/);
    const row = (await db.query("SELECT revoked_at, integrity_tag FROM agent_grants WHERE id = $1", [grant.id])).rows[0]!;
    assert.equal(row.revoked_at, null);
    assert.equal(row.integrity_tag, grant.integrity_tag);
  });
});

describe("scope rules for new grants", () => {
  test("accepts the demo scopes", () => {
    assert.deepEqual(checkScopesForNewGrant(["supplier:search", "quote:read", "file:read", "proposal:prepare", "resource:suppliers/*", "resource:quotes/*"]), []);
    assert.deepEqual(checkScopesForNewGrant(["budget:read", "budget:check", "budget:reserve", "resource:budget/*"]), []);
  });

  test("rejects empty, duplicate, unknown, approval, escrow and malformed scopes", () => {
    const bad: string[][] = [
      [],
      ["quote:read", "quote:read"],
      ["quote:write"],
      ["approve"],
      ["escrow:release"],
      ["escrow:lock"],
      ["budget:change"],
      ["resource:"],
      ["resource:*x"],
      ["resource:a*b"],
      ["resource:../secret"],
      ["Resource:quotes/*"],
      ["supplier:search "],
    ];
    for (const scopes of bad) {
      assert.notDeepEqual(checkScopesForNewGrant(scopes), [], JSON.stringify(scopes));
    }
  });

  test("rejects any resource scope that matches payroll.csv", () => {
    for (const scope of ["resource:payroll.csv", "resource:*", "resource:p*", "resource:payroll*", "resource:payroll.csv*"]) {
      assert.notDeepEqual(checkScopesForNewGrant([scope]), [], scope);
    }
    assert.deepEqual(checkScopesForNewGrant(["resource:payrolls/*"]), []);
  });

  test("resourceScopeMatches follows the D30 grammar", () => {
    assert.equal(resourceScopeMatches("resource:quotes/*", "quotes/abc"), true);
    assert.equal(resourceScopeMatches("resource:quotes/*", "suppliers/abc"), false);
    assert.equal(resourceScopeMatches("resource:payroll.csv", "payroll.csv"), true);
    assert.equal(resourceScopeMatches("resource:quotes", "quotes/abc"), false);
    assert.equal(resourceScopeMatches("quote:read", "quotes/abc"), false);
  });
});

describe("grantIntegrityKeyFromEnv", () => {
  test("returns the key, or fails naming the variable only", () => {
    assert.equal(grantIntegrityKeyFromEnv({ GRANT_INTEGRITY_KEY: "k" }), "k");
    assert.throws(() => grantIntegrityKeyFromEnv({}), /GRANT_INTEGRITY_KEY/);
    assert.throws(() => grantIntegrityKeyFromEnv({ GRANT_INTEGRITY_KEY: "" }), /GRANT_INTEGRITY_KEY/);
  });
});

// Type check only: the Grant type matches what pg returns.
export type _GrantShape = Grant;
