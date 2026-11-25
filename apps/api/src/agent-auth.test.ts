// T1.1a tests. They need the Postgres from docker-compose with `pnpm migrate` applied, and DATABASE_URL
// (read from .env). Every test runs in a transaction that is rolled back, so no rows are left behind.
// A missing DATABASE_URL fails the run on purpose: a skipped security test is a hidden security test.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import pg from "pg";
import { sha256Hex } from "@seyvixa/shared";
import {
  authenticateAgent,
  createAgent,
  credentialHashFromEnv,
  generateAgentToken,
  hashAgentToken,
  readBearerToken,
  type Queryable,
} from "./agent-auth.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is not set. Copy .env.example to .env and start the database.");

let db: InstanceType<typeof pg.Client>;

beforeEach(async () => {
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("BEGIN");
});

afterEach(async () => {
  await db.query("ROLLBACK");
  await db.end();
});

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("token and hash helpers", () => {
  test("generated tokens have the sva_ format and differ every time", () => {
    const a = generateAgentToken();
    const b = generateAgentToken();
    assert.match(a, /^sva_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, b);
  });

  test("an empty token is never hashed", () => {
    assert.throws(() => hashAgentToken(""));
  });

  test("createAgent stores the SHA-256 of the token and returns the token once", async () => {
    const { id, token } = await createAgent(db, { name: "Test Agent" });
    const row = (await db.query("SELECT status, credential_hash FROM agents WHERE id = $1", [id])).rows[0]!;
    assert.equal(row.credential_hash, sha256Hex(token));
    assert.equal(row.status, "ACTIVE");
  });
});

describe("authenticateAgent", () => {
  test("a valid token authenticates as its agent", async () => {
    const { id, token } = await createAgent(db, { name: "A" });
    assert.deepEqual(await authenticateAgent(bearer(token), db), { ok: true, agentId: id });
  });

  test("a wrong token fails with the generic kind", async () => {
    await createAgent(db, { name: "A" });
    assert.deepEqual(await authenticateAgent(bearer(generateAgentToken()), db), {
      ok: false,
      kind: "UNAUTHENTICATED",
    });
  });

  test("the owner session cookie alone does not authenticate", async () => {
    await createAgent(db, { name: "A" });
    const result = await authenticateAgent({ headers: { cookie: "session=owner-session-value" } }, db);
    assert.deepEqual(result, { ok: false, kind: "UNAUTHENTICATED" });
  });

  test("a cookie does not rescue a wrong token, and does not replace a right one", async () => {
    const { id, token } = await createAgent(db, { name: "A" });
    const wrong = await authenticateAgent(
      { headers: { authorization: `Bearer ${generateAgentToken()}`, cookie: "session=x" } },
      db,
    );
    assert.equal(wrong.ok, false);
    // A cookie next to a valid token changes nothing: the agent is still the token's agent.
    const right = await authenticateAgent({ headers: { authorization: `Bearer ${token}`, cookie: "session=x" } }, db);
    assert.deepEqual(right, { ok: true, agentId: id });
  });

  test("agent A's token cannot authenticate as agent B", async () => {
    const a = await createAgent(db, { name: "A" });
    const b = await createAgent(db, { name: "B" });
    const resultA = await authenticateAgent(bearer(a.token), db);
    const resultB = await authenticateAgent(bearer(b.token), db);
    assert.deepEqual(resultA, { ok: true, agentId: a.id });
    assert.deepEqual(resultB, { ok: true, agentId: b.id });
    assert.notEqual(a.id, b.id);
  });

  test("a SUSPENDED agent with a valid token gets AGENT_INACTIVE", async () => {
    const { id, token } = await createAgent(db, { name: "A", status: "SUSPENDED" });
    assert.deepEqual(await authenticateAgent(bearer(token), db), {
      ok: false,
      kind: "AGENT_INACTIVE",
      reasonCode: "AGENT_INACTIVE",
      agentId: id,
    });
  });

  test("any status other than ACTIVE counts as inactive (fail closed)", async () => {
    for (const status of ["active", "Suspended", "", "SOMETHING_ELSE"]) {
      const { token } = await createAgent(db, { name: `S-${status}`, status });
      const result = await authenticateAgent(bearer(token), db);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.kind, "AGENT_INACTIVE", `status ${JSON.stringify(status)}`);
    }
  });

  test("a SUSPENDED agent with a wrong token gets the generic kind, not AGENT_INACTIVE", async () => {
    await createAgent(db, { name: "A", status: "SUSPENDED" });
    assert.deepEqual(await authenticateAgent(bearer(generateAgentToken()), db), {
      ok: false,
      kind: "UNAUTHENTICATED",
    });
  });

  test("an agent with a NULL credential_hash never authenticates", async () => {
    await db.query("INSERT INTO agents (name, status, credential_hash) VALUES ('Null', 'ACTIVE', NULL)");
    const result = await authenticateAgent(bearer(generateAgentToken()), db);
    assert.deepEqual(result, { ok: false, kind: "UNAUTHENTICATED" });
  });

  test("two agents with the same hash fail closed", async () => {
    const token = generateAgentToken();
    const hash = hashAgentToken(token);
    await db.query("INSERT INTO agents (name, status, credential_hash) VALUES ('X', 'ACTIVE', $1), ('Y', 'ACTIVE', $1)", [hash]);
    assert.deepEqual(await authenticateAgent(bearer(token), db), { ok: false, kind: "UNAUTHENTICATED" });
  });

  test("a database error fails closed instead of throwing", async () => {
    const broken: Queryable = {
      query: async () => {
        throw new Error("database is down");
      },
    };
    assert.deepEqual(await authenticateAgent(bearer(generateAgentToken()), broken), {
      ok: false,
      kind: "UNAUTHENTICATED",
    });
  });
});

describe("malformed headers", () => {
  const token = generateAgentToken();
  const cases: [string, Record<string, string | string[] | undefined>][] = [
    ["no Authorization header", {}],
    ["lowercase bearer", { authorization: `bearer ${token}` }],
    ["uppercase BEARER", { authorization: `BEARER ${token}` }],
    ["two spaces after Bearer", { authorization: `Bearer  ${token}` }],
    ["leading space", { authorization: ` Bearer ${token}` }],
    ["trailing space", { authorization: `Bearer ${token} ` }],
    ["no token", { authorization: "Bearer" }],
    ["empty token", { authorization: "Bearer " }],
    ["no scheme", { authorization: token }],
    ["other scheme", { authorization: `Basic ${token}` }],
    ["two tokens", { authorization: `Bearer ${token} ${token}` }],
    ["duplicate Authorization header", { authorization: [`Bearer ${token}`, `Bearer ${token}`] }],
    ["same header under two spellings", { authorization: `Bearer ${token}`, Authorization: `Bearer ${token}` }],
    ["token without the sva_ prefix", { authorization: `Bearer ${token.slice(4)}` }],
    ["token too short", { authorization: `Bearer ${token.slice(0, -1)}` }],
    ["token too long", { authorization: `Bearer ${token}A` }],
  ];

  for (const [label, headers] of cases) {
    test(`${label} is rejected`, async () => {
      // The token is valid and stored, so only the header shape can make this fail.
      await db.query("INSERT INTO agents (name, status, credential_hash) VALUES ('A', 'ACTIVE', $1)", [
        hashAgentToken(token),
      ]);
      assert.equal(readBearerToken(headers), null);
      assert.deepEqual(await authenticateAgent({ headers }, db), { ok: false, kind: "UNAUTHENTICATED" });
    });
  }

  test("a valid token in the query string or body is ignored", async () => {
    const { token } = await createAgent(db, { name: "A" });
    const request = {
      headers: {},
      query: { token, access_token: token, authorization: `Bearer ${token}` },
      body: { token, authorization: `Bearer ${token}` },
    };
    assert.deepEqual(await authenticateAgent(request, db), { ok: false, kind: "UNAUTHENTICATED" });
  });
});

describe("the token is never stored or logged", () => {
  test("no column of any row in agents contains the token", async () => {
    const { token } = await createAgent(db, { name: "A" });
    const hits = await db.query("SELECT count(*)::int AS n FROM agents WHERE (agents.*)::text LIKE $1", [`%${token}%`]);
    assert.equal(hits.rows[0]!.n, 0);
    const own = await db.query("SELECT count(*)::int AS n FROM agents WHERE (agents.*)::text LIKE $1", [
      `%${hashAgentToken(token)}%`,
    ]);
    assert.equal(own.rows[0]!.n, 1); // only the hash is there
  });

  test("authentication success and failure write nothing that contains the token or its hash", async () => {
    const good = await createAgent(db, { name: "A" });
    const bad = generateAgentToken();
    const secrets = [good.token, hashAgentToken(good.token), bad, hashAgentToken(bad)];

    const written: string[] = [];
    const originals: Record<string, (...args: never[]) => unknown> = {};
    const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
    for (const m of consoleMethods) {
      originals[m] = console[m];
      console[m] = (...args: unknown[]) => void written.push(args.map(String).join(" "));
    }
    const stdoutWrite = process.stdout.write;
    const stderrWrite = process.stderr.write;
    // Pass through, so the test runner's own output is not swallowed.
    process.stdout.write = ((chunk: unknown, ...rest: never[]) => {
      written.push(String(chunk));
      return (stdoutWrite as (...a: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown, ...rest: never[]) => {
      written.push(String(chunk));
      return (stderrWrite as (...a: unknown[]) => boolean).call(process.stderr, chunk, ...rest);
    }) as typeof process.stderr.write;

    try {
      assert.equal((await authenticateAgent(bearer(good.token), db)).ok, true);
      assert.equal((await authenticateAgent(bearer(bad), db)).ok, false);
      assert.equal((await authenticateAgent({ headers: { authorization: `bearer ${good.token}` } }, db)).ok, false);
      const broken: Queryable = {
        query: async () => {
          throw new Error("database is down");
        },
      };
      assert.equal((await authenticateAgent(bearer(good.token), broken)).ok, false);
    } finally {
      for (const m of consoleMethods) console[m] = originals[m] as never;
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    }

    const output = written.join("\n");
    for (const secret of secrets) assert.ok(!output.includes(secret), "a secret appeared in the output");
  });
});

describe("credentialHashFromEnv (seed rule)", () => {
  const good = "sva_" + "A".repeat(43);

  test("returns the SHA-256 of a good value", () => {
    assert.equal(credentialHashFromEnv("X", { X: good }), sha256Hex(good));
  });

  test("fails when missing or empty", () => {
    assert.throws(() => credentialHashFromEnv("X", {}), /X is not set/);
    assert.throws(() => credentialHashFromEnv("X", { X: "" }), /X is not set/);
  });

  test("fails when shorter than 32 characters", () => {
    assert.throws(() => credentialHashFromEnv("X", { X: "a".repeat(31) }), /at least 32/);
    assert.doesNotThrow(() => credentialHashFromEnv("X", { X: "a".repeat(32) }));
  });

  test("fails for the .env.example placeholder", () => {
    assert.throws(() => credentialHashFromEnv("X", { X: "REPLACE_ME_with_a_generated_token" }), /placeholder/);
  });

  test("the error never contains the value", () => {
    const secret = "REPLACE_ME_secret-looking-value-that-is-long-enough";
    try {
      credentialHashFromEnv("X", { X: secret });
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(!(error as Error).message.includes(secret));
    }
  });
});
