// T4.1a: the guide's plain functions (Section 4.3), reserve(procurementId, agentId, amountLkr, idempotencyKey),
// commit(reservationId) and release(reservationId), on a pool made lazily from DATABASE_URL. A pool, not one
// connection, so that parallel calls really run on separate connections and are serialised by the database lock,
// not by the client.
import pg from "pg";
import { createBudgetGuard, type Transaction } from "./guard.ts";

let pool: InstanceType<typeof pg.Pool> | undefined;

function getPool(): InstanceType<typeof pg.Pool> {
  if (pool === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString });
  }
  return pool;
}

const poolTransaction: Transaction = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original error matters more than a failed rollback on a broken connection.
    }
    throw error;
  } finally {
    client.release();
  }
};

const guard = createBudgetGuard(poolTransaction);
export const reserve = guard.reserve;
export const commit = guard.commit;
export const release = guard.release;

// For tests and shutdown: closes the default pool. A later call creates a new one.
export async function closeBudgetPool(): Promise<void> {
  const current = pool;
  pool = undefined;
  if (current !== undefined) await current.end();
}
