// T1.2a, Blueprint 6.2 and 9 (item 3), decisions D2, D4, D15, D17, D30, D36: the one policy check.
// POST /api/actions/evaluate uses it now, and POST /api/budget/reservations will use it (D2).
// It decides from database state and the request only, fails closed, and never reads identity from the
// request: the caller is passed in from the credential or the session. Nothing here logs.
import { positiveLkrAmountSchema, type ActionType, type Decision, type ReasonCode } from "@seyvixa/shared";
import type { Queryable } from "./agent-auth.ts";
import { PROTECTED_RESOURCE, loadValidGrant, resourceScopeMatches } from "./grants.ts";

// Tool scope each agent action type needs (D30). Escrow actions have no scope on purpose: no grant can
// carry one, so an agent can never ask for them (Blueprint 6.1).
export const TOOL_ACTION_SCOPE = {
  SUPPLIER_SEARCH: "supplier:search",
  QUOTE_READ: "quote:read",
  FILE_READ: "file:read",
  PROPOSE_PURCHASE: "proposal:prepare",
} as const satisfies Partial<Record<ActionType, string>>;

// Owner-initiated actions. They need approval (D17) and are never allowed for an agent.
export const ESCROW_ACTION_TYPES = ["ESCROW_LOCK", "ESCROW_RELEASE", "ESCROW_REFUND"] as const;

export function isEscrowAction(tool: string): boolean {
  return (ESCROW_ACTION_TYPES as readonly string[]).includes(tool);
}

export type PolicyCaller = { kind: "agent"; agentId: string } | { kind: "owner"; ownerId: string };

export type PolicyInput = {
  caller: PolicyCaller;
  tool: ActionType;
  resource: string;
  parameters: Record<string, unknown>;
};

export type PolicyResult =
  | { decision: Extract<Decision, "ALLOW" | "APPROVAL_REQUIRED"> }
  | { decision: "DENY"; reasonCode: ReasonCode };

const deny = (reasonCode: ReasonCode): PolicyResult => ({ decision: "DENY", reasonCode });

// A resource name is letters, digits and . _ / - only. Every segment must be a real name: not empty (no "//",
// no leading or trailing "/"), and not "." or "..". Anything else is out of scope, so a pattern like quotes/*
// cannot be walked out of with quotes/../x, quotes/./x or quotes/x/ .
const RESOURCE_NAME = /^[A-Za-z0-9._/-]+$/;

export function resourceNameIsSafe(resource: string): boolean {
  if (!RESOURCE_NAME.test(resource)) return false;
  return resource.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

// payroll.csv is never reachable by an agent, whatever a grant says (defence in depth: a grant that
// matches it cannot be created either, T1.1b). Checks every segment, in any letter case.
export function isProtectedResource(resource: string): boolean {
  return resource.split("/").some((segment) => segment.toLowerCase() === PROTECTED_RESOURCE);
}

// Decimal LKR string to whole cents, so amounts are compared exactly and never as floats.
export function toCents(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

// Evaluate's rule for an agent. Checks run in this order (Blueprint 6.2 items 1 to 5):
// agent active, grant valid (integrity, expiry, revocation), tool in scope, resource in scope, spend limit.
async function checkAgent(
  db: Queryable,
  agentId: string,
  input: PolicyInput,
  integrityKey: string,
  now: Date,
): Promise<PolicyResult> {
  const agent = await db.query("SELECT status FROM agents WHERE id = $1", [agentId]);
  if (agent.rows.length !== 1 || agent.rows[0]!.status !== "ACTIVE") return deny("AGENT_INACTIVE");

  const check = await loadValidGrant(db, agentId, integrityKey, now);
  if (!check.ok) return deny(check.reasonCode);
  const { scopes, spend_limit: spendLimit } = check.grant;

  if (!Object.hasOwn(TOOL_ACTION_SCOPE, input.tool)) return deny("TOOL_OUT_OF_SCOPE");
  const needed = TOOL_ACTION_SCOPE[input.tool as keyof typeof TOOL_ACTION_SCOPE];
  if (!scopes.includes(needed)) return deny("TOOL_OUT_OF_SCOPE");

  if (!resourceNameIsSafe(input.resource) || isProtectedResource(input.resource)) {
    return deny("RESOURCE_OUT_OF_SCOPE");
  }
  if (!scopes.some((scope) => resourceScopeMatches(scope, input.resource))) return deny("RESOURCE_OUT_OF_SCOPE");

  if (input.tool === "PROPOSE_PURCHASE") {
    // A missing or malformed total throws here, which becomes INTERNAL_ERROR. The route validates it first (400).
    const total = positiveLkrAmountSchema.parse(input.parameters.total_lkr);
    if (toCents(total) > toCents(spendLimit)) return deny("SPEND_LIMIT_EXCEEDED");
  }
  return { decision: "ALLOW" };
}

// The policy check. Any thrown error gives DENY with INTERNAL_ERROR (fail closed, Blueprint 9 item 3).
// An agent gets ALLOW or DENY by its grant. The owner session may only ask for escrow actions, and gets
// APPROVAL_REQUIRED (D17); an owner asking for anything else is denied.
export async function checkPolicy(
  db: Queryable,
  input: PolicyInput,
  integrityKey: string,
  now: Date = new Date(),
): Promise<PolicyResult> {
  try {
    if (input.caller.kind === "owner") {
      return isEscrowAction(input.tool) ? { decision: "APPROVAL_REQUIRED" } : deny("TOOL_OUT_OF_SCOPE");
    }
    return await checkAgent(db, input.caller.agentId, input, integrityKey, now);
  } catch {
    return deny("INTERNAL_ERROR");
  }
}

// One row per decision. A DENY stores its D4 code; ALLOW and APPROVAL_REQUIRED store the decision name (D36).
// action_id is NULL here: the action record arrives in T1.2b. procurement_id is NULL until T1.5.
export async function recordPolicyEvent(
  db: Queryable,
  event: { agentId: string | null; tool: string; resource: string; result: PolicyResult },
): Promise<void> {
  const reason = event.result.decision === "DENY" ? event.result.reasonCode : event.result.decision;
  await db.query(
    "INSERT INTO policy_events (agent_id, action, decision, reason_code, resource) VALUES ($1, $2, $3, $4, $5)",
    [event.agentId, event.tool, event.result.decision, reason, event.resource],
  );
}

// Fixed text per code: never grant details, never anything from the request.
export const DENY_MESSAGES: Record<ReasonCode, string> = {
  AGENT_INACTIVE: "The agent is not active.",
  GRANT_MISSING: "The agent has no permission grant.",
  GRANT_EXPIRED: "The agent's permission grant has expired.",
  GRANT_REVOKED: "The agent's permission grant has been revoked.",
  GRANT_INTEGRITY_FAILED: "The agent's permission grant failed its integrity check.",
  TOOL_OUT_OF_SCOPE: "The agent is not authorised to use this tool.",
  RESOURCE_OUT_OF_SCOPE: "The agent is not authorised to access this resource.",
  SPEND_LIMIT_EXCEEDED: "The action exceeds the agent's spending limit.",
  BUDGET_EXCEEDED: "The action exceeds the available budget.",
  RESERVATION_MISSING: "No active budget reservation exists for this action.",
  APPROVAL_INVALID: "The approval is not valid.",
  APPROVAL_EXPIRED: "The approval has expired.",
  APPROVAL_USED: "The approval has already been used.",
  PAYLOAD_HASH_MISMATCH: "The payload does not match the evaluated action.",
  TICKET_INVALID: "The execution ticket is not valid.",
  TICKET_EXPIRED: "The execution ticket has expired.",
  TICKET_USED: "The execution ticket has already been used.",
  POLICY_VERSION_STALE: "The policy changed since this action was evaluated.",
  OWNER_MISMATCH: "The action does not belong to this owner.",
  ACTION_NOT_EXECUTABLE: "The action cannot be executed in its current state.",
  TX_MISMATCH: "The transaction does not match the evaluated action.",
  INTERNAL_ERROR: "The request could not be evaluated, so it was denied.",
};

// D16: one configuration constant, bumped by hand when policy logic changes. Stored on every action.
export const POLICY_VERSION = "policy-v1";
