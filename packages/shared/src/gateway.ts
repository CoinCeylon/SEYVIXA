// T0.3b: gateway evaluate request and response (shape defined minimally, decision D29).
//
// Request: what the agent (or the owner session) asks for. It is strict at the top level, and the
// parameters object may not contain agent_id, owner_id, action_hash, ticket, nonce or expiry.
// The gateway takes the caller from the
// credential or session and computes every hash and ticket itself (Blueprint 6.1, 6.2, 6.5).
// Response: the Blueprint Section 6.2 example denial, plus the fields the evaluate description
// says are returned (action ID, action hash, single-use ticket).
import { z } from "zod";
import { actionTypeSchema, reasonCodeSchema } from "./enums.ts";
import { idSchema, sha256HexSchema, textSchema, timestampSchema } from "./primitives.ts";

// Keys an agent must never supply, even inside parameters. The gateway takes the caller from the
// credential or session and builds these itself.
export const RESERVED_PARAMETER_KEYS = [
  "agent_id",
  "owner_id",
  "action_hash",
  "ticket",
  "nonce",
  "expiry",
] as const;

export const gatewayRequestSchema = z.strictObject({
  tool: actionTypeSchema,
  resource: textSchema,
  parameters: z.record(z.string(), z.json()).superRefine((params, ctx) => {
    for (const key of RESERVED_PARAMETER_KEYS) {
      if (Object.hasOwn(params, key)) {
        ctx.addIssue({ code: "custom", message: `parameters must not contain "${key}"` });
      }
    }
  }),
});
export type GatewayRequest = z.infer<typeof gatewayRequestSchema>;

const allowResponseSchema = z.strictObject({
  decision: z.literal("ALLOW"),
  action_id: idSchema,
  action_hash: sha256HexSchema,
  ticket: textSchema, // short-lived, single-use
  ticket_expires_at: timestampSchema,
});

const approvalRequiredResponseSchema = z.strictObject({
  decision: z.literal("APPROVAL_REQUIRED"),
  action_id: idSchema,
  action_hash: sha256HexSchema,
  message: textSchema,
});

// Matches the example denial in Blueprint Section 6.2.
const denyResponseSchema = z.strictObject({
  decision: z.literal("DENY"),
  reason_code: reasonCodeSchema,
  agent_id: textSchema,
  requested_resource: textSchema,
  message: textSchema,
});

export const gatewayResponseSchema = z.discriminatedUnion("decision", [
  allowResponseSchema,
  approvalRequiredResponseSchema,
  denyResponseSchema,
]);
export type GatewayResponse = z.infer<typeof gatewayResponseSchema>;
