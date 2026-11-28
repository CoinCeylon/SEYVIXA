// T1.2b, Blueprint 6.2 and 6.5, decisions D2b, D15, D16, D29: the immutable action record.
// The server builds the canonical payload from stored rows and server configuration only, hashes it, and
// stores it. Nothing from the request becomes a payload value except which procurement and which stored
// quote (ids), and each id is checked against the owner. The agent never supplies a hash, an owner, a payee,
// an amount or a deadline. Nothing here logs.
import { randomBytes } from "node:crypto";
import { actionHash, actionPayloadSchema, canonicalize, idSchema, type ActionType } from "@seyvixa/shared";
import type { Queryable } from "./agent-auth.ts";
import { POLICY_VERSION, toCents, type PolicyCaller } from "./policy.ts";

// How long an approval request stays valid (the payload field `expiry`) and how far ahead the refund
// deadline is set. Fixed demo values (decisions in DECISIONS.md); change them by hand, not from a request.
export const APPROVAL_TTL_MS = 30 * 60 * 1000;
export const REFUND_DEADLINE_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;

// Tools that create an action record. Read tools (search, quote read, file read) create none: they get
// their ticket in T1.2c.
export const RECORD_ACTION_TYPES = ["PROPOSE_PURCHASE", "ESCROW_LOCK", "ESCROW_RELEASE", "ESCROW_REFUND"] as const;

export function createsActionRecord(tool: string): boolean {
  return (RECORD_ACTION_TYPES as readonly string[]).includes(tool);
}

// Fixed demo escrow values from server configuration (never from a request). The escrow amount is a fixed
// demo value, not converted from LKR (Blueprint 6.5).
export type EscrowConfig = { scriptAddress: string; amountTada: string };

// The request is valid JSON but cannot build an action (unknown procurement, wrong owner, missing quote...).
// The route answers 400 and never says which check failed.
export class InvalidActionRequest extends Error {}

export type PreparedAction = {
  actionType: ActionType;
  procurementId: string;
  ownerId: string;
  canonicalPayload: string;
  actionHash: string;
  commitmentSalt: string;
  status: "PENDING_APPROVAL" | "APPROVED";
  reservationId: string | null;
};

type PrepareInput = {
  caller: PolicyCaller;
  tool: ActionType;
  decision: "ALLOW" | "APPROVAL_REQUIRED";
  parameters: Record<string, unknown>;
};

// D15: APPROVAL_REQUIRED creates PENDING_APPROVAL; ALLOW without approval creates APPROVED.
const statusFor = (decision: PrepareInput["decision"]): PreparedAction["status"] =>
  decision === "APPROVAL_REQUIRED" ? "PENDING_APPROVAL" : "APPROVED";

const asId = (value: unknown): string => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new InvalidActionRequest();
  return parsed.data.toLowerCase();
};

export async function prepareAction(
  db: Queryable,
  input: PrepareInput,
  escrow: EscrowConfig | undefined,
  now: Date,
): Promise<PreparedAction> {
  if (input.tool === "ESCROW_RELEASE" || input.tool === "ESCROW_REFUND") {
    return prepareFromLock(db, input);
  }
  return prepareFromQuote(db, input, escrow, now);
}

// Release and refund act on a purchase that was locked. They copy the lock action's stored payload, hash and
// salt, so the hash the owner signed and the on-chain commitment stay the same. The lock must be the same
// owner's ESCROW_LOCK action.
async function prepareFromLock(db: Queryable, input: PrepareInput): Promise<PreparedAction> {
  if (input.caller.kind !== "owner") throw new InvalidActionRequest();
  const lockId = asId(input.parameters.action_id);
  const result = await db.query(
    "SELECT procurement_id, owner_id, canonical_payload, action_hash, commitment_salt FROM actions WHERE id = $1 AND action_type = 'ESCROW_LOCK'",
    [lockId],
  );
  const lock = result.rows[0];
  if (lock === undefined || lock.owner_id !== input.caller.ownerId) throw new InvalidActionRequest();
  return {
    actionType: input.tool,
    procurementId: lock.procurement_id as string,
    ownerId: lock.owner_id as string,
    canonicalPayload: lock.canonical_payload as string,
    actionHash: lock.action_hash as string,
    commitmentSalt: lock.commitment_salt as string,
    status: statusFor(input.decision),
    reservationId: null,
  };
}

async function prepareFromQuote(
  db: Queryable,
  input: PrepareInput,
  escrow: EscrowConfig | undefined,
  now: Date,
): Promise<PreparedAction> {
  const procurementId = asId(input.parameters.procurement_id);
  const quoteId = asId(input.parameters.quote_id);
  if (escrow === undefined) throw new Error("escrow configuration is missing");

  const result = await db.query(
    `SELECT p.owner_id, q.supplier_id, q.amount::text AS amount, q.quote_data, s.payee_address
       FROM procurements p
       JOIN supplier_quotes q ON q.procurement_id = p.id
       JOIN suppliers s ON s.id = q.supplier_id
      WHERE p.id = $1 AND q.id = $2`,
    [procurementId, quoteId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new InvalidActionRequest();
  // The owner comes from the session (owner caller) or from the stored procurement (agent caller). Either way
  // the procurement must belong to the owner who is acting or who granted the agent.
  const ownerId = row.owner_id as string;
  if (input.caller.kind === "owner" && input.caller.ownerId !== ownerId) throw new InvalidActionRequest();
  if (input.caller.kind === "agent") {
    const grant = await db.query("SELECT 1 FROM agent_grants WHERE agent_id = $1 AND owner_id = $2", [
      input.caller.agentId,
      ownerId,
    ]);
    if (grant.rows.length === 0) throw new InvalidActionRequest();
  }
  const amount = row.amount as string;
  // The spend limit was checked against parameters.total_lkr. The stored quote total must be that same amount,
  // otherwise the limit check and the record would disagree.
  if (input.tool === "PROPOSE_PURCHASE") {
    const claimed = input.parameters.total_lkr;
    if (typeof claimed !== "string" || toCents(claimed) !== toCents(amount)) throw new InvalidActionRequest();
  }
  const payee = row.payee_address;
  const data = row.quote_data as { item?: unknown; quantity?: unknown } | null;
  if (typeof payee !== "string" || payee === "" || data === null || typeof data !== "object") {
    throw new InvalidActionRequest();
  }

  const payload = actionPayloadSchema.safeParse({
    procurement_id: procurementId,
    owner_id: ownerId,
    supplier_id: row.supplier_id,
    payee_address: payee,
    items: [{ description: data.item, quantity: data.quantity }],
    total_lkr: amount,
    settlement_asset: "tADA",
    escrow_amount_tada: escrow.amountTada,
    escrow_script_address: escrow.scriptAddress,
    refund_deadline: new Date(now.getTime() + REFUND_DEADLINE_OFFSET_MS).toISOString(),
    expiry: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    nonce: randomBytes(16).toString("hex"),
  });
  if (!payload.success) throw new InvalidActionRequest();

  // D2b: bind the budget reservation made for this procurement and amount, if one exists and no action has
  // claimed it yet. No reservation is not an error here: execute revalidates it (decision D2).
  const reservation = await db.query(
    `SELECT r.id FROM budget_reservations r
      WHERE r.procurement_id = $1 AND r.status = 'RESERVED' AND r.amount = $2::numeric
        AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.reservation_id = r.id)
      ORDER BY r.id LIMIT 1`,
    [procurementId, amount],
  );

  const canonicalPayload = canonicalize(payload.data);
  return {
    actionType: input.tool,
    procurementId,
    ownerId,
    canonicalPayload,
    actionHash: actionHash(payload.data),
    commitmentSalt: randomBytes(32).toString("hex"), // never goes on-chain
    status: statusFor(input.decision),
    reservationId: (reservation.rows[0]?.id as string | undefined) ?? null,
  };
}

// One statement writes the action and its policy event together, so there is never an action without its audit
// row (or the reverse). The event stores the decision name as its reason code (decision D36).
export async function insertActionWithEvent(
  db: Queryable,
  action: PreparedAction,
  event: { agentId: string | null; tool: string; resource: string; decision: string },
  now: Date,
  // T1.2c: for an ALLOW, the binding tag and expiry of the execution ticket, written with the action.
  ticket?: { storedNonce: string; expiresAt: Date },
): Promise<string> {
  const result = await db.query(
    `WITH a AS (
       INSERT INTO actions (procurement_id, owner_id, action_type, canonical_payload, action_hash,
                            commitment_salt, status, reservation_id, policy_version, updated_at,
                            ticket_nonce, ticket_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $14, $15, $16)
       RETURNING id
     )
     INSERT INTO policy_events (agent_id, action, decision, reason_code, resource, procurement_id, action_id)
     SELECT $10::uuid, $11::text, $12::text, $12::text, $13::text, $1, a.id FROM a
     RETURNING action_id`,
    [
      action.procurementId,
      action.ownerId,
      action.actionType,
      action.canonicalPayload,
      action.actionHash,
      action.commitmentSalt,
      action.status,
      action.reservationId,
      POLICY_VERSION,
      event.agentId,
      event.tool,
      event.decision,
      event.resource,
      now,
      ticket?.storedNonce ?? null,
      ticket?.expiresAt ?? null,
    ],
  );
  return result.rows[0]!.action_id as string;
}
