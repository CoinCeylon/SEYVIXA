// T7.1 (Blueprint Section 5: "Cardano ... Mesh SDK for transactions, Blockfrost or Demeter for chain data";
// decision T6.1: Cardano Preprod + Blockfrost + @meshsdk/core 1.9.1).
// Network and API come from the environment, never from code or requests.
// The API key (BLOCKFROST_PROJECT_ID) is read from the environment only and is never logged or returned.
import { BlockfrostProvider } from "@meshsdk/core";

/** Default confirmation depth from team decision D18 (default 3, set in config). A prototype setting, not a security guarantee. */
export const DEFAULT_CONFIRMATION_DEPTH = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Base URL for the only supported network (Blockfrost OpenAPI `servers` entry for Preprod). */
export const PREPROD_BASE_URL = "https://cardano-preprod.blockfrost.io/api/v0";

export type ChainConfig = {
  readonly network: "preprod";
  readonly baseUrl: string;
  /** Secret. Do not log, serialise or put into error messages. */
  readonly projectId: string;
  /** Prototype setting (team decision D18). */
  readonly confirmationDepth: number;
  readonly timeoutMs: number;
};

export class ChainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainConfigError";
  }
}

type Env = Record<string, string | undefined>;

/** Fails closed: any missing or invalid value throws. Error messages never contain secret values. */
export function loadChainConfig(env: Env = process.env): ChainConfig {
  const network = env.CARDANO_NETWORK;
  if (network !== "preprod") {
    throw new ChainConfigError('CARDANO_NETWORK must be "preprod" (test network only)');
  }

  const projectId = env.BLOCKFROST_PROJECT_ID?.trim() ?? "";
  if (projectId === "" || projectId.startsWith("fake-")) {
    throw new ChainConfigError("BLOCKFROST_PROJECT_ID is not set or is still the fake placeholder");
  }

  const depthRaw = env.CONFIRMATION_DEPTH?.trim();
  let confirmationDepth = DEFAULT_CONFIRMATION_DEPTH;
  if (depthRaw !== undefined && depthRaw !== "") {
    if (!/^[1-9][0-9]*$/.test(depthRaw)) {
      throw new ChainConfigError("CONFIRMATION_DEPTH must be a positive integer");
    }
    confirmationDepth = Number(depthRaw);
  }

  return { network, baseUrl: PREPROD_BASE_URL, projectId, confirmationDepth, timeoutMs: DEFAULT_TIMEOUT_MS };
}

/**
 * Creates a Mesh SDK `BlockfrostProvider` connected to Cardano Preprod (`@meshsdk/core` 1.9.1, T7.1 / T6.1).
 * Ready for read queries and T7.3–T7.5 transaction building/submission.
 */
export function createChainProvider(config: ChainConfig = loadChainConfig()): BlockfrostProvider {
  return new BlockfrostProvider(config.projectId);
}
