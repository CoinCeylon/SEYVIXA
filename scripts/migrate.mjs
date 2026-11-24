// T0.2b (decision D25): apply the plain SQL files in apps/api/migrations in filename order.
// Each file runs in its own transaction, so a file must not contain its own COMMIT or
// statements that cannot run in a transaction (such as CREATE INDEX CONCURRENTLY).
// Use a direct connection (the advisory lock is per session, not safe behind a transaction pooler).
// schema_migrations is bookkeeping, not a product table.
// A second run applies nothing. Reads DATABASE_URL (see .env.example).
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "api",
  "migrations",
);
const MIN_SERVER_VERSION_NUM = 130000; // Postgres 13 (decision D25)
const LOCK_KEY = 7260001; // advisory lock so two runs cannot interleave

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const { rows: ver } = await client.query("SHOW server_version_num");
  if (Number(ver[0].server_version_num) < MIN_SERVER_VERSION_NUM) {
    throw new Error(`Postgres 13 or newer is required, found ${ver[0].server_version_num}`);
  }
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const { rows: done } = await client.query("SELECT filename FROM schema_migrations");
  const applied = new Set(done.map((r) => r.filename));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file}`);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      // A failed ROLLBACK (for example a dropped connection) must not hide the original error.
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`${file}: ${err.message}`);
    }
    console.log(`apply  ${file}`);
    count += 1;
  }
  console.log(`done: ${count} applied, ${files.length - count} already applied`);
} catch (err) {
  console.error(`migration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
