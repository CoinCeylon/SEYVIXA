// T0.3b: one schema and type per Blueprint Section 8 table (plus suppliers, from the additive
// note), matching apps/api/migrations/0001_init.sql. Column names are snake_case as in the database.
// Nullable columns are .nullable(): the database returns null, not a missing key.
// These schemas describe the JSON form of a row: timestamps are ISO strings and amounts are
// decimal strings. node-postgres returns timestamptz as a JS Date, so convert before parsing.
import { z } from "zod";
import {
  actionStatusSchema,
  actionTypeSchema,
  challengePurposeSchema,
  decisionSchema,
  reasonCodeSchema,
  reservationStatusSchema,
} from "./enums.ts";
import {
  idSchema,
  lkrAmountSchema,
  positiveLkrAmountSchema,
  sha256HexSchema,
  textSchema,
  timestampSchema,
} from "./primitives.ts";

export const userSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  role: textSchema,
  owner_address: textSchema.nullable(),
  payment_pubkey: textSchema.nullable(),
  payment_key_hash: textSchema.nullable(),
});
export type User = z.infer<typeof userSchema>;

export const supplierSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
});
export type Supplier = z.infer<typeof supplierSchema>;

export const agentSchema = z.strictObject({
  id: idSchema,
  name: textSchema,
  status: textSchema,
  credential_hash: textSchema.nullable(), // hash only, never the token
});
export type Agent = z.infer<typeof agentSchema>;

export const agentGrantSchema = z.strictObject({
  id: idSchema,
  agent_id: idSchema,
  owner_id: idSchema,
  scopes: z.array(textSchema),
  spend_limit: lkrAmountSchema,
  expires_at: timestampSchema,
  revoked_at: timestampSchema.nullable(),
  issuer: textSchema,
  integrity_tag: textSchema, // HMAC with a server key over the grant fields
});
export type AgentGrant = z.infer<typeof agentGrantSchema>;

export const procurementSchema = z.strictObject({
  id: idSchema,
  owner_id: idSchema,
  description: textSchema,
  budget: lkrAmountSchema,
  status: textSchema,
});
export type Procurement = z.infer<typeof procurementSchema>;

export const supplierQuoteSchema = z.strictObject({
  id: idSchema,
  procurement_id: idSchema,
  supplier_id: idSchema,
  amount: lkrAmountSchema,
  quote_data: z.json(), // untrusted supplier data
});
export type SupplierQuote = z.infer<typeof supplierQuoteSchema>;

export const budgetReservationSchema = z.strictObject({
  id: idSchema,
  procurement_id: idSchema,
  agent_id: idSchema,
  amount: positiveLkrAmountSchema,
  status: reservationStatusSchema,
  idempotency_key: textSchema,
});
export type BudgetReservation = z.infer<typeof budgetReservationSchema>;

export const approvalSchema = z.strictObject({
  id: idSchema,
  action_hash: sha256HexSchema,
  approver_id: idSchema,
  expires_at: timestampSchema,
  used_at: timestampSchema.nullable(),
  nonce: textSchema,
  signature: textSchema,
});
export type Approval = z.infer<typeof approvalSchema>;

// reason_code uses the D4 list. D4 has no code for an ALLOW or APPROVAL_REQUIRED event; see D29.
export const policyEventSchema = z.strictObject({
  id: idSchema,
  agent_id: idSchema.nullable(),
  action: textSchema,
  decision: decisionSchema,
  reason_code: reasonCodeSchema,
  created_at: timestampSchema,
  procurement_id: idSchema.nullable(), // D27
  action_id: idSchema.nullable(), // D27
  resource: textSchema.nullable(), // D27
});
export type PolicyEvent = z.infer<typeof policyEventSchema>;

export const actionSchema = z.strictObject({
  id: idSchema,
  procurement_id: idSchema,
  owner_id: idSchema,
  action_type: actionTypeSchema,
  canonical_payload: textSchema, // exact canonical bytes that are hashed
  action_hash: sha256HexSchema,
  commitment_salt: textSchema.nullable(),
  status: actionStatusSchema,
  ticket_nonce: textSchema.nullable(),
  ticket_expires_at: timestampSchema.nullable(),
  idempotency_key: textSchema.nullable(),
  external_ref: textSchema.nullable(), // transaction ID or connector reference
  last_error: textSchema.nullable(),
  updated_at: timestampSchema,
  reservation_id: idSchema.nullable(),
  policy_version: textSchema,
});
export type Action = z.infer<typeof actionSchema>;

export const challengeSchema = z.strictObject({
  id: idSchema,
  purpose: challengePurposeSchema,
  owner_id: idSchema,
  procurement_id: idSchema.nullable(),
  supplier_id: idSchema.nullable(),
  nonce: textSchema,
  expires_at: timestampSchema,
  used_at: timestampSchema.nullable(),
});
export type Challenge = z.infer<typeof challengeSchema>;

export const chainTransactionSchema = z.strictObject({
  id: idSchema,
  chain: textSchema,
  network: textSchema,
  kind: textSchema,
  tx_hash: textSchema,
  escrow_utxo_ref: textSchema.nullable(),
  action_commitment: textSchema.nullable(),
  status: textSchema,
});
export type ChainTransaction = z.infer<typeof chainTransactionSchema>;

// The receipts table row only. The receipt payload type belongs to T8.5.
export const receiptSchema = z.strictObject({
  id: idSchema,
  view: textSchema,
  payload: textSchema, // exact canonical bytes that were signed
  signature: textSchema,
  key_id: textSchema,
  created_at: timestampSchema,
  procurement_id: idSchema, // D27
});
export type Receipt = z.infer<typeof receiptSchema>;
