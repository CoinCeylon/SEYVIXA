// T7.1: read-only getTxStatus(txId). Blueprint Section 6.2 (blockchain call: "query the chain-data API"),
// Section 6.7 ("The backend must verify the actual network and transaction state."), Section 9 item 12.
// Team decision D18: found = the chain-data API returns the transaction in a block; confirmed = found
// with at least CONFIRMATION_DEPTH block confirmations (default 3, set in config, a prototype setting).
//
// Blockfrost fields used (checked against the official OpenAPI, github.com/blockfrost/openapi):
//   GET /txs/{hash}    -> tx_content: block_height (integer), valid_contract (boolean); 404 = not found
//   GET /blocks/latest -> block_content: height (integer, nullable)
// Authentication: HTTP header `project_id`.
//
// This function never builds or submits transactions and never trusts any caller-supplied flag.
import { z } from "zod";
import { loadChainConfig, type ChainConfig } from "./config.ts";

export type TxStatusErrorReason =
  | "invalid_tx_id"
  | "config_error"
  | "api_unreachable"
  | "api_error"
  | "invalid_response"
  | "contract_validation_failed";

export type TxStatus =
  | { status: "found"; confirmations: number; blockHeight: number }
  | { status: "confirmed"; confirmations: number; blockHeight: number }
  | { status: "not_found" }
  | { status: "error"; reason: TxStatusErrorReason };

// Blockfrost documents the hash as a 64-character hexadecimal string (case-sensitive); we accept lowercase only.
const TX_ID = /^[0-9a-f]{64}$/;

const txContent = z.object({
  block_height: z.number().int().nonnegative(),
  valid_contract: z.boolean(),
});
const blockContent = z.object({
  height: z.number().int().nonnegative(),
});

type Fetch = typeof fetch;
export type TxStatusDeps = { config?: ChainConfig; fetch?: Fetch };

type Fetched =
  | { kind: "ok"; body: unknown }
  | { kind: "not_found" }
  | { kind: "error"; reason: "api_unreachable" | "api_error" | "invalid_response" };

async function getJson(path: string, config: ChainConfig, doFetch: Fetch): Promise<Fetched> {
  let res: Response;
  try {
    res = await doFetch(`${config.baseUrl}${path}`, {
      method: "GET",
      headers: { project_id: config.projectId },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    // Network failure or timeout. The caught error is dropped on purpose so it cannot carry the key.
    return { kind: "error", reason: "api_unreachable" };
  }
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "error", reason: "api_error" };
  try {
    return { kind: "ok", body: await res.json() };
  } catch {
    return { kind: "error", reason: "invalid_response" };
  }
}

export async function getTxStatus(txId: string, deps: TxStatusDeps = {}): Promise<TxStatus> {
  if (typeof txId !== "string" || !TX_ID.test(txId)) return { status: "error", reason: "invalid_tx_id" };

  let config: ChainConfig;
  try {
    config = deps.config ?? loadChainConfig();
  } catch {
    return { status: "error", reason: "config_error" };
  }
  const doFetch = deps.fetch ?? fetch;

  const tx = await getJson(`/txs/${txId}`, config, doFetch);
  if (tx.kind === "not_found") return { status: "not_found" };
  if (tx.kind === "error") return { status: "error", reason: tx.reason };
  const txParsed = txContent.safeParse(tx.body);
  if (!txParsed.success) return { status: "error", reason: "invalid_response" };

  // A transaction that is in a block but failed Plutus script validation did not take effect.
  // It must never be reported as found or confirmed.
  if (!txParsed.data.valid_contract) return { status: "error", reason: "contract_validation_failed" };

  const tip = await getJson("/blocks/latest", config, doFetch);
  // Chain tip unknown: the depth cannot be checked, so never report confirmed.
  if (tip.kind === "not_found") return { status: "error", reason: "api_error" };
  if (tip.kind === "error") return { status: "error", reason: tip.reason };
  const tipParsed = blockContent.safeParse(tip.body);
  if (!tipParsed.success) return { status: "error", reason: "invalid_response" };

  const blockHeight = txParsed.data.block_height;
  // If the reported tip is behind the transaction's block (stale tip or reorg), keep status at "found" so
  // it can never be marked "confirmed" even when CONFIRMATION_DEPTH is configured to 1.
  if (tipParsed.data.height < blockHeight) {
    return { status: "found", confirmations: 1, blockHeight };
  }
  // The transaction's own block counts as the first confirmation.
  const confirmations = tipParsed.data.height - blockHeight + 1;
  const status = confirmations >= config.confirmationDepth ? "confirmed" : "found";
  return { status, confirmations, blockHeight };
}
