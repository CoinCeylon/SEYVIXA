declare module "*validate-receipt-v0.mjs" {
  export const RECEIPT_V0_SCHEMA_PATH: string;
  export const RECEIPT_V0_SCHEMA: Record<string, unknown>;
  export function validateReceiptV0(receipt: unknown): {
    readonly valid: boolean;
    readonly errors: readonly string[];
  };
}
