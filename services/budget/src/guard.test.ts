// T4.1a tests: BudgetGuard reserve, commit, release (Blueprint 6.4, 9 item 8; decisions D2b, D4).
// Real Postgres. Parallel tests need data that other connections can see, so each test commits its own rows
// (unique ids) and deletes them afterwards. The public functions run on the default pool, one connection each.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { BudgetGuardError, closeBudgetPool, commit, createBudgetGuard, release, reserve, type ReserveResult } from "./index.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

let admin: InstanceType<typeof pg.Client>;
let ownerId: string;
let procurementId: string;
const agents: string[] = [];
const procurements: string[] = [];
const key = () => `t41a-${randomUUID()}`;

const insertId = async (sql: string, values: unknown[] = []): Promise<string> => (await admin.query(sql, values)).rows[0]!.id as string;
const newAgent = async () => {
  const id = await insertId("INSERT INTO agents (name, status) VALUES ('T4.1a agent', 'ACTIVE') RETURNING id");
  agents.push(id);
  return id;
};
const newProcurement = async (budget = "120000.00") => {
  const id = await insertId("INSERT INTO procurements (owner_id, description, budget, status) VALUES ($1, 'T4.1a', $2, 'OPEN') RETURNING id", [ownerId, budget]);
  procurements.push(id);
  return id;
};
const rows = async (pid = procurementId) =>
  (await admin.query("SELECT id, amount::text AS amount, status FROM budget_reservations WHERE procurement_id = $1 ORDER BY id", [pid])).rows;
const held = async (pid = procurementId) =>
  (await admin.query("SELECT COALESCE(SUM(amount), 0)::text AS n FROM budget_reservations WHERE procurement_id = $1 AND status IN ('RESERVED','COMMITTED')", [pid])).rows[0]!.n as string;
const okCount = (results: ReserveResult[]) => results.filter((r) => r.ok).length;

beforeEach(async () => {
  admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  ownerId = await insertId("INSERT INTO users (name, role) VALUES ('T4.1a owner', 'owner') RETURNING id");
  procurementId = await newProcurement();
});

afterEach(async () => {
  await admin.query("DELETE FROM budget_reservations WHERE procurement_id = ANY($1::uuid[])", [procurements]);
  await admin.query("DELETE FROM procurements WHERE id = ANY($1::uuid[])", [procurements]);
  await admin.query("DELETE FROM agents WHERE id = ANY($1::uuid[])", [agents]);
  await admin.query("DELETE FROM users WHERE id = $1", [ownerId]);
  procurements.length = 0;
  agents.length = 0;
  await admin.end();
});

after(async () => {
  await closeBudgetPool();
});

describe("reserve", () => {
  test("sequential reservations within the budget succeed, exactly at the limit too; one cent over is BUDGET_EXCEEDED", async () => {
    const agent = await newAgent();
    const first = await reserve(procurementId, agent, "70000.00", key());
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.repeated, false);
      assert.deepEqual({ ...first.reservation, id: "x" }, { id: "x", procurementId, agentId: agent, amountLkr: "70000.00", status: "RESERVED" });
    }
    assert.deepEqual(await reserve(procurementId, agent, "50000.01", key()), { ok: false, code: "BUDGET_EXCEEDED" });
    assert.equal((await reserve(procurementId, agent, "50000.00", key())).ok, true, "exactly at the limit is allowed");
    assert.deepEqual(await reserve(procurementId, agent, "0.01", key()), { ok: false, code: "BUDGET_EXCEEDED" });
    assert.equal(await held(), "120000.00");
    assert.equal((await rows()).length, 2, "a refused reservation stores nothing");
  });

  test("Blueprint example: LKR 70,000 and 65,000 at the same time against 120,000, 25 rounds: exactly one succeeds each time", async () => {
    for (let round = 0; round < 25; round++) {
      const pid = await newProcurement("120000.00");
      const [a, b] = [await newAgent(), await newAgent()];
      const results = await Promise.all([reserve(pid, a, "70000.00", key()), reserve(pid, b, "65000.00", key())]);
      assert.equal(okCount(results), 1, `round ${round}`);
      assert.ok(results.some((r) => !r.ok && r.code === "BUDGET_EXCEEDED"));
      assert.ok(Number(await held(pid)) <= 120000, `round ${round}`);
    }
  });

  test("twenty parallel reservations of 10,000 against 120,000: exactly twelve succeed and the total never exceeds the budget", async () => {
    const agent = await newAgent();
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(procurementId, agent, "10000.00", key())));
    assert.equal(okCount(results), 12);
    assert.equal(await held(), "120000.00");
    assert.equal((await rows()).length, 12);
  });

  test("a different procurement has its own budget and is not blocked by the first", async () => {
    const agent = await newAgent();
    const other = await newProcurement("5000.00");
    const results = await Promise.all([reserve(procurementId, agent, "120000.00", key()), reserve(other, agent, "5000.00", key())]);
    assert.equal(okCount(results), 2);
  });

  test("idempotent: the same key for the same request returns the same reservation and counts once", async () => {
    const agent = await newAgent();
    const k = key();
    const a = await reserve(procurementId, agent, "70000.00", k);
    const b = await reserve(procurementId, agent, "70000", k); // same amount written differently
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) {
      assert.equal(b.reservation.id, a.reservation.id);
      assert.equal(a.repeated, false);
      assert.equal(b.repeated, true);
    }
    assert.equal(await held(), "70000.00");
    assert.equal((await rows()).length, 1);
  });

  test("idempotent in parallel: ten identical calls make one reservation", async () => {
    const agent = await newAgent();
    const k = key();
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(procurementId, agent, "70000.00", k)));
    assert.equal(okCount(results), 10);
    assert.equal(new Set(results.map((r) => (r.ok ? r.reservation.id : ""))).size, 1);
    assert.equal((await rows()).length, 1);
  });

  test("a repeated key is answered even when the budget is now full, because it returns the first reservation", async () => {
    const agent = await newAgent();
    const k = key();
    await reserve(procurementId, agent, "100000.00", k);
    await reserve(procurementId, agent, "20000.00", key());
    const again = await reserve(procurementId, agent, "100000.00", k);
    assert.ok(again.ok && again.repeated);
  });

  test("the same key for a different amount, agent or procurement throws and changes nothing", async () => {
    const agent = await newAgent();
    const other = await newAgent();
    const otherProcurement = await newProcurement();
    const k = key();
    await reserve(procurementId, agent, "70000.00", k);
    await assert.rejects(reserve(procurementId, agent, "1.00", k), BudgetGuardError);
    await assert.rejects(reserve(procurementId, other, "70000.00", k), BudgetGuardError);
    await assert.rejects(reserve(otherProcurement, agent, "70000.00", k), BudgetGuardError);
    assert.equal((await rows()).length, 1);
    assert.equal((await rows(otherProcurement)).length, 0);
  });

  test("the same key racing on two procurements: one wins, the other throws, only one row exists", async () => {
    const agent = await newAgent();
    const otherProcurement = await newProcurement();
    const k = key();
    const settled = await Promise.allSettled([reserve(procurementId, agent, "100.00", k), reserve(otherProcurement, agent, "100.00", k)]);
    assert.equal(settled.filter((s) => s.status === "fulfilled").length, 1);
    assert.equal(settled.filter((s) => s.status === "rejected").length, 1);
    const loser = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    assert.ok(loser.reason instanceof BudgetGuardError, "the loser is told the key was used for a different request, not a raw database error");
    assert.equal((await rows()).length + (await rows(otherProcurement)).length, 1);
  });

  test("RELEASED amounts are free again; COMMITTED amounts stay held", async () => {
    const agent = await newAgent();
    const a = await reserve(procurementId, agent, "70000.00", key());
    const b = await reserve(procurementId, agent, "50000.00", key());
    assert.ok(a.ok && b.ok);
    if (!(a.ok && b.ok)) return;
    assert.deepEqual(await reserve(procurementId, agent, "1000.00", key()), { ok: false, code: "BUDGET_EXCEEDED" });
    assert.equal((await release(a.reservation.id)).ok, true);
    assert.equal((await reserve(procurementId, agent, "70000.00", key())).ok, true, "released money is available again");
    assert.equal((await commit(b.reservation.id)).ok, true);
    assert.deepEqual(await reserve(procurementId, agent, "1000.00", key()), { ok: false, code: "BUDGET_EXCEEDED" }, "committed money stays held");
  });

  test("malformed input throws instead of answering: bad ids, non-positive or too precise amounts, empty or huge key", async () => {
    const agent = await newAgent();
    const bad: [string, string, string, string][] = [
      ["nope", agent, "1.00", "k"],
      [procurementId, "nope", "1.00", "k"],
      [procurementId, agent, "0.00", "k"],
      [procurementId, agent, "-5.00", "k"],
      [procurementId, agent, "abc", "k"],
      [procurementId, agent, "1.234", "k"],
      [procurementId, agent, "", "k"],
      [procurementId, agent, "1.00", ""],
      [procurementId, agent, "1.00", "x".repeat(201)],
    ];
    for (const args of bad) await assert.rejects(reserve(...args), BudgetGuardError, JSON.stringify(args));
    assert.equal((await rows()).length, 0);
  });

  test("an unknown procurement throws and an unknown agent is refused by the database; nothing is stored", async () => {
    const agent = await newAgent();
    await assert.rejects(reserve(randomUUID(), agent, "1.00", key()), BudgetGuardError);
    await assert.rejects(reserve(procurementId, randomUUID(), "1.00", key()));
    assert.equal((await rows()).length, 0);
  });
});

describe("commit and release", () => {
  const reserved = async () => {
    const agent = await newAgent();
    const r = await reserve(procurementId, agent, "70000.00", key());
    assert.ok(r.ok);
    return (r as Extract<ReserveResult, { ok: true }>).reservation.id;
  };

  test("commit moves RESERVED to COMMITTED and repeating it is a success", async () => {
    const id = await reserved();
    const first = await commit(id);
    assert.ok(first.ok);
    assert.equal(first.ok && first.reservation.status, "COMMITTED");
    assert.equal((await commit(id)).ok, true);
    assert.equal((await rows())[0]!.status, "COMMITTED");
  });

  test("release moves RESERVED to RELEASED and repeating it is a success", async () => {
    const id = await reserved();
    const first = await release(id);
    assert.ok(first.ok);
    assert.equal(first.ok && first.reservation.status, "RELEASED");
    assert.equal((await release(id)).ok, true);
    assert.equal((await rows())[0]!.status, "RELEASED");
  });

  test("a released reservation cannot be committed: RESERVATION_MISSING", async () => {
    const a = await reserved();
    await release(a);
    assert.deepEqual(await commit(a), { ok: false, code: "RESERVATION_MISSING" });
  });

  test("committed cannot be released", async () => {
    const id = await reserved();
    await commit(id);
    assert.deepEqual(await release(id), { ok: false, code: "RESERVATION_MISSING" });
    assert.equal((await rows())[0]!.status, "COMMITTED");
  });

  test("an unknown reservation is RESERVATION_MISSING and a malformed id throws", async () => {
    assert.deepEqual(await commit(randomUUID()), { ok: false, code: "RESERVATION_MISSING" });
    assert.deepEqual(await release(randomUUID()), { ok: false, code: "RESERVATION_MISSING" });
    await assert.rejects(commit("nope"), BudgetGuardError);
    await assert.rejects(release(""), BudgetGuardError);
  });

  test("commit and release racing on one reservation: exactly one wins and the state is consistent", async () => {
    const id = await reserved();
    const [c, r] = await Promise.all([commit(id), release(id)]);
    assert.equal([c, r].filter((x) => x.ok).length, 1);
    const status = (await rows())[0]!.status;
    assert.ok(status === "COMMITTED" || status === "RELEASED");
    assert.equal(c.ok, status === "COMMITTED");
  });
});

describe("createBudgetGuard", () => {
  test("runs on a caller-supplied transaction: a rollback by the caller leaves nothing behind", async () => {
    const agent = await newAgent();
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      // The caller owns the transaction; the guard's own transaction is a savepoint on it.
      let n = 0;
      const guard = createBudgetGuard(async (fn) => {
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
      const r = await guard.reserve(procurementId, agent, "100.00", key());
      assert.equal(r.ok, true);
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
    assert.equal((await rows()).length, 0);
  });
});
