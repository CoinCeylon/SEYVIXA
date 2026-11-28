// T4.1a, Blueprint 6.4 (Budget Guard) and 9 item 8, decisions D2b, D4, D26: atomic, idempotent budget
// reservations in PostgreSQL. The budget is shared across agents, so every reserve for one procurement is
// serialised by a row lock on that procurement (SELECT ... FOR UPDATE) inside one transaction. This is not a
// frontend check and not a plain read-then-insert: two concurrent reserves cannot both pass the balance check.
//
// This file takes the database as an argument and never imports pg, so any caller (the gateway route, tests)
// can run it on its own transaction. default.ts wires the default pool for the guide's plain functions.
//
// The guard does not decide who may reserve. The caller (POST /api/budget/reservations, T4.1b) authenticates
// the agent and runs the policy check first. The guard only protects the budget. Nothing here logs.
import { idSchema, positiveLkrAmountSchema } from "@seyvixa/shared";

export type TxClient = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
// Runs fn inside one database transaction: BEGIN, fn, COMMIT, or ROLLBACK if fn throws.
export type Transaction = <T>(fn: (client: TxClient) => Promise<T>) => Promise<T>;

export type ReservationStatus = "RESERVED" | "COMMITTED" | "RELEASED";
export type Reservation = {
  id: string;
  procurementId: string;
  agentId: string;
  amountLkr: string; // exact decimal text from numeric(14,2), for example "70000.00"
  status: ReservationStatus;
};

// Over budget is a result, not an exception. BUDGET_EXCEEDED and RESERVATION_MISSING are decision D4 reason codes.
export type ReserveResult =
  | { ok: true; reservation: Reservation; repeated: boolean }
  | { ok: false; code: "BUDGET_EXCEEDED" };
export type TransitionResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; code: "RESERVATION_MISSING" };

// Programming or data errors the caller must not see as a normal answer: malformed input, an unknown
// procurement, or an idempotency key reused for a different request. D4 has no code for these, so none is invented.
export class BudgetGuardError extends Error {}

const COLUMNS = "id, procurement_id, agent_id, amount::text AS amount, status";
const toReservation = (row: Record<string, unknown>): Reservation => ({
  id: row.id as string,
  procurementId: row.procurement_id as string,
  agentId: row.agent_id as string,
  amountLkr: row.amount as string,
  status: row.status as ReservationStatus,
});

const requireId = (value: unknown, name: string): string => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new BudgetGuardError(`${name} must be a valid id`);
  return parsed.data.toLowerCase();
};

export type BudgetGuard = {
  reserve(procurementId: string, agentId: string, amountLkr: string, idempotencyKey: string): Promise<ReserveResult>;
  commit(reservationId: string): Promise<TransitionResult>;
  release(reservationId: string): Promise<TransitionResult>;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";

export function createBudgetGuard(transaction: Transaction): BudgetGuard {
  async function reserveOnce(procurementId: string, agentId: string, amount: string, key: string): Promise<ReserveResult> {
    return transaction(async (db) => {
      // The lock. A second reserve for this procurement waits here until the first one commits or rolls back,
      // then sees its row in the sum below.
      const procurement = await db.query("SELECT budget::text AS budget FROM procurements WHERE id = $1 FOR UPDATE", [procurementId]);
      if (procurement.rows.length !== 1) throw new BudgetGuardError("unknown procurement");
      const budget = procurement.rows[0]!.budget as string;

      // Idempotency: the same key for the same request returns the same reservation and counts once.
      const existing = await db.query(
        `SELECT ${COLUMNS}, (amount = $2::numeric) AS same_amount FROM budget_reservations WHERE idempotency_key = $1`,
        [key, amount],
      );
      const found = existing.rows[0];
      if (found !== undefined) {
        const reservation = toReservation(found);
        if (reservation.procurementId !== procurementId || reservation.agentId !== agentId || found.same_amount !== true) {
          throw new BudgetGuardError("idempotency key was already used for a different request");
        }
        return { ok: true, reservation, repeated: true };
      }

      // RESERVED and COMMITTED amounts are held. RELEASED amounts are free again. Exact numeric arithmetic in SQL.
      const check = await db.query(
        `SELECT (COALESCE(SUM(amount), 0) + $2::numeric) > $3::numeric AS over
           FROM budget_reservations WHERE procurement_id = $1 AND status IN ('RESERVED', 'COMMITTED')`,
        [procurementId, amount, budget],
      );
      if (check.rows[0]!.over === true) return { ok: false, code: "BUDGET_EXCEEDED" };

      const inserted = await db.query(
        `INSERT INTO budget_reservations (procurement_id, agent_id, amount, status, idempotency_key)
         VALUES ($1, $2, $3::numeric, 'RESERVED', $4) RETURNING ${COLUMNS}`,
        [procurementId, agentId, amount, key],
      );
      return { ok: true, reservation: toReservation(inserted.rows[0]!), repeated: false };
    });
  }

  async function transition(reservationId: string, target: "COMMITTED" | "RELEASED"): Promise<TransitionResult> {
    const id = requireId(reservationId, "reservationId");
    return transaction(async (db) => {
      const result = await db.query(`SELECT ${COLUMNS} FROM budget_reservations WHERE id = $1 FOR UPDATE`, [id]);
      const row = result.rows[0];
      if (row === undefined) return { ok: false, code: "RESERVATION_MISSING" };
      // Repeating the same transition is a success, so an outcome retry (T1.3) can run twice. Any other state
      // means there is no active reservation to move.
      if (row.status === target) return { ok: true, reservation: toReservation(row) };
      if (row.status !== "RESERVED") return { ok: false, code: "RESERVATION_MISSING" };
      const updated = await db.query(`UPDATE budget_reservations SET status = $2 WHERE id = $1 RETURNING ${COLUMNS}`, [id, target]);
      return { ok: true, reservation: toReservation(updated.rows[0]!) };
    });
  }

  return {
    async reserve(procurementId, agentId, amountLkr, idempotencyKey) {
      const pid = requireId(procurementId, "procurementId");
      const aid = requireId(agentId, "agentId");
      if (!positiveLkrAmountSchema.safeParse(amountLkr).success) throw new BudgetGuardError("amountLkr must be a positive LKR amount with at most 2 decimals");
      if (typeof idempotencyKey !== "string" || idempotencyKey === "" || idempotencyKey.length > 200) {
        throw new BudgetGuardError("idempotencyKey must be a non-empty string of at most 200 characters");
      }
      try {
        return await reserveOnce(pid, aid, amountLkr, idempotencyKey);
      } catch (error) {
        // Two calls with the same key on different procurements take different locks and can race on the unique
        // key. The loser's transaction is rolled back; run it once more and it finds the winner's row.
        if (!isUniqueViolation(error)) throw error;
        return reserveOnce(pid, aid, amountLkr, idempotencyKey);
      }
    },
    commit: (reservationId) => transition(reservationId, "COMMITTED"),
    release: (reservationId) => transition(reservationId, "RELEASED"),
  };
}
