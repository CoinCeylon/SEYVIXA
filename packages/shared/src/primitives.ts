// T0.3b: small building blocks for the schemas. Choices recorded in docs/DECISIONS.md (D29).
import { z } from "zod";

/** Id. The database column is uuid; guid accepts any 8-4-4-4-12 hex form (seed ids may be readable). */
export const idSchema = z.guid();

/** Timestamp as an ISO 8601 string (what JSON carries). The database stores timestamptz. */
export const timestampSchema = z.iso.datetime({ offset: true });

/** Simulated LKR amount as a decimal string with at most 2 decimals (database numeric(14,2)). Never a float. */
export const lkrAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, "LKR amount: no leading zeros, up to 2 decimals");

/** LKR amount that must be greater than zero (budget_reservations.amount has CHECK (amount > 0)). */
export const positiveLkrAmountSchema = lkrAmountSchema.refine((v) => Number(v) > 0, "must be greater than 0");

/** Test-ADA amount as a decimal string with at most 6 decimals. A separate field from LKR; never converted. */
export const tadaAmountSchema = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "tADA amount: up to 6 decimals");

/** SHA-256 as lowercase hex (64 characters). */
export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected lowercase SHA-256 hex");

/** Non-empty text (names, nonces, signatures, addresses: formats are not fixed by the Blueprint). */
export const textSchema = z.string().min(1);
