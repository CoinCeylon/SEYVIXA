// T0.3b, Blueprint Section 6.5 (Canonical action): the fields of the immutable action record that
// is canonicalised and hashed. Built by the server, never by an agent. The schema is strict, so a
// hash field, an agent-supplied field or an LKR-to-ADA conversion field is rejected.
import { z } from "zod";
import {
  idSchema,
  lkrAmountSchema,
  tadaAmountSchema,
  textSchema,
  timestampSchema,
} from "./primitives.ts";

export const actionItemSchema = z.strictObject({
  description: textSchema,
  quantity: z.int().positive(),
});

export const actionPayloadSchema = z.strictObject({
  procurement_id: idSchema,
  owner_id: idSchema,
  supplier_id: idSchema, // supplier/payee
  payee_address: textSchema, // supplier/payee: where the escrow pays out (see D29)
  items: z.array(actionItemSchema).min(1),
  total_lkr: lkrAmountSchema, // simulated LKR total
  settlement_asset: z.literal("tADA"),
  escrow_amount_tada: tadaAmountSchema, // fixed demo amount, a separate field, no conversion
  escrow_script_address: textSchema,
  refund_deadline: timestampSchema,
  expiry: timestampSchema,
  nonce: textSchema,
});
export type ActionPayload = z.infer<typeof actionPayloadSchema>;
