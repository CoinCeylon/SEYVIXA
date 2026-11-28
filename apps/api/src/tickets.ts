// T1.2c, Blueprint 6.2 (evaluate returns a short-lived, single-use ticket bound to the action hash, the caller
// and the policy version; revalidation item 7), decisions D4, D16: the execution ticket.
// The ticket is a random, unguessable token shown once. The database keeps only a binding tag, the SHA-256 of
// the ticket together with the action hash, the caller and the policy version, in the existing `ticket_nonce`
// column (like agent credentials, D32). A ticket therefore only matches the action, caller and policy version
// it was issued for, with no new column. Consuming the ticket is the execute transition (T1.3): moving the
// action from APPROVED to EXECUTING under a row lock. Nothing here logs and the ticket is never stored.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { idSchema, sha256Hex, type ReasonCode } from "@seyvixa/shared";
import type { Queryable } from "./agent-auth.ts";
import type { PolicyCaller } from "./policy.ts";

export const TICKET_PREFIX = "svt_";
// Short-lived: how long an execution ticket stays valid after it is issued.
export const TICKET_TTL_MS = 5 * 60 * 1000;

export type TicketBinding = { actionHash: string; caller: PolicyCaller; policyVersion: string };
export type IssuedTicket = {
  ticket: string; // shown to the caller once, never stored
  storedNonce: string; // goes in actions.ticket_nonce
  expiresAt: Date; // goes in actions.ticket_expires_at
};

const callerKey = (caller: PolicyCaller): string =>
  caller.kind === "agent" ? `agent:${caller.agentId}` : `owner:${caller.ownerId}`;

// SHA-256 over the ticket and everything it is bound to. The parts are separated by newlines; none of them can
// contain one (base64url, hex, uuid, a fixed policy version string).
export function ticketBindingTag(ticket: string, binding: TicketBinding): string {
  return sha256Hex(
    ["seyvixa-ticket-v1", ticket, binding.actionHash, callerKey(binding.caller), binding.policyVersion].join("\n"),
  );
}

export function createTicket(binding: TicketBinding, now: Date): IssuedTicket {
  const ticket = TICKET_PREFIX + randomBytes(32).toString("base64url");
  return {
    ticket,
    storedNonce: ticketBindingTag(ticket, binding),
    expiresAt: new Date(now.getTime() + TICKET_TTL_MS),
  };
}

export type TicketCheck =
  | { ok: true; actionId: string; actionHash: string; policyVersion: string }
  | { ok: false; code: Extract<ReasonCode, "TICKET_INVALID" | "TICKET_EXPIRED" | "TICKET_USED"> };

const invalid: TicketCheck = { ok: false, code: "TICKET_INVALID" };

// Read-only. It never consumes the ticket. Order matters:
// 1. An unknown action, an action with no ticket, or a ticket that does not match the action hash, caller or
//    policy version stored with the action are all TICKET_INVALID (no hint which).
// 2. A matching ticket on an action that is no longer APPROVED was already used by the execute transition.
// 3. A matching ticket past its expiry is TICKET_EXPIRED.
// Execute (T1.3) also compares the returned policy version with the current POLICY_VERSION (D16).
export async function validateTicket(
  db: Queryable,
  input: { ticket: string; actionId: string; caller: PolicyCaller },
  now: Date,
): Promise<TicketCheck> {
  if (typeof input.ticket !== "string" || !input.ticket.startsWith(TICKET_PREFIX)) return invalid;
  const id = idSchema.safeParse(input.actionId);
  if (!id.success) return invalid;
  const result = await db.query(
    "SELECT action_hash, policy_version, status, ticket_nonce, ticket_expires_at FROM actions WHERE id = $1",
    [id.data],
  );
  const row = result.rows[0];
  if (row === undefined || typeof row.ticket_nonce !== "string" || !(row.ticket_expires_at instanceof Date)) return invalid;

  const actionHash = row.action_hash as string;
  const policyVersion = row.policy_version as string;
  const expected = Buffer.from(ticketBindingTag(input.ticket, { actionHash, caller: input.caller, policyVersion }), "hex");
  const stored = Buffer.from(row.ticket_nonce, "hex");
  if (expected.length !== stored.length || !timingSafeEqual(expected, stored)) return invalid;

  if (row.status !== "APPROVED") return { ok: false, code: "TICKET_USED" };
  if (now.getTime() >= row.ticket_expires_at.getTime()) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, actionId: id.data.toLowerCase(), actionHash, policyVersion };
}
