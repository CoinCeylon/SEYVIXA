// T0.3b: fixed value lists. Do not add or rename a value here without an entry in docs/DECISIONS.md.
import { z } from "zod";

// Blueprint Section 6.2: the gateway returns one of these.
export const DECISIONS = ["ALLOW", "DENY", "APPROVAL_REQUIRED"] as const;
export const decisionSchema = z.enum(DECISIONS);
export type Decision = z.infer<typeof decisionSchema>;

// Decision D4 (with GRANT_INTEGRITY_FAILED from D21). Exactly these, no extras.
export const REASON_CODES = [
  "AGENT_INACTIVE",
  "GRANT_MISSING",
  "GRANT_EXPIRED",
  "GRANT_REVOKED",
  "GRANT_INTEGRITY_FAILED",
  "TOOL_OUT_OF_SCOPE",
  "RESOURCE_OUT_OF_SCOPE",
  "SPEND_LIMIT_EXCEEDED",
  "BUDGET_EXCEEDED",
  "RESERVATION_MISSING",
  "APPROVAL_INVALID",
  "APPROVAL_EXPIRED",
  "APPROVAL_USED",
  "PAYLOAD_HASH_MISMATCH",
  "TICKET_INVALID",
  "TICKET_EXPIRED",
  "TICKET_USED",
  "POLICY_VERSION_STALE",
  "OWNER_MISMATCH",
  "ACTION_NOT_EXECUTABLE",
  "TX_MISMATCH",
  "INTERNAL_ERROR", // fail closed
] as const;
export const reasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

// Decision D31 (T1.1a). "Suspending an agent" is the Blueprint 6.2 term. Code treats anything that is
// not "ACTIVE" as inactive (fail closed). The database has no CHECK on agents.status.
export const AGENT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export const agentStatusSchema = z.enum(AGENT_STATUSES);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

// Decision D17. BUDGET_RESERVE is not an action type (it uses the direct route from D2).
export const ACTION_TYPES = [
  "SUPPLIER_SEARCH",
  "QUOTE_READ",
  "FILE_READ",
  "PROPOSE_PURCHASE",
  "ESCROW_LOCK",
  "ESCROW_RELEASE",
  "ESCROW_REFUND",
] as const;
export const actionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof actionTypeSchema>;

// Blueprint Section 8 state values, with PENDING_APPROVAL from decision D15.
export const ACTION_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
] as const;
export const actionStatusSchema = z.enum(ACTION_STATUSES);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const RESERVATION_STATUSES = ["RESERVED", "COMMITTED", "RELEASED"] as const;
export const reservationStatusSchema = z.enum(RESERVATION_STATUSES);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

export const CHALLENGE_PURPOSES = ["wallet_registration", "midnight_proof"] as const;
export const challengePurposeSchema = z.enum(CHALLENGE_PURPOSES);
export type ChallengePurpose = z.infer<typeof challengePurposeSchema>;
