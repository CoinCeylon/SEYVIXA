// T7.2a & T7.2b — Browser wallet helper: connectWallet, getAddress, signMessage, signTransaction
// (Blueprint Section 6.5; Guide Section 4.3).
// Uses the official CIP-30 browser API (`window.cardano`) directly for Lace and Eternl.
// Test networks only (CIP-30 networkId 0). The wallet signs but NEVER submits transactions.

import { encodeCardanoTestnetAddress } from "./bech32.ts";
import {
  SUPPORTED_WALLETS,
  TESTNET_NETWORK_ID,
  WalletError,
  type CardanoWindowNamespace,
  type Cip30DataSignature,
  type Cip30WalletProvider,
  type ConnectWalletOptions,
  type SignMessageOptions,
  type SignTransactionOptions,
  type SupportedWalletId,
  type WalletHandle,
} from "./types.ts";

let activeHandle: WalletHandle | null = null;
const HEX_BYTES_RE = /^[0-9a-fA-F]+$/;

function isSupportedWalletId(value: string): value is SupportedWalletId {
  return (SUPPORTED_WALLETS as readonly string[]).includes(value);
}

function isEvenHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && HEX_BYTES_RE.test(value);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function encodePayloadToHex(payload: string | Uint8Array): string {
  const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  if (bytes.length === 0) {
    throw new WalletError("INVALID_PAYLOAD", "Payload to sign must not be empty.");
  }
  return bytesToHex(bytes);
}

function validateTestnetSigningAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    throw new WalletError("INVALID_ADDRESS", "Signing address must not be empty.");
  }

  // Reject Mainnet Bech32 addresses up front (fail closed).
  if (trimmed.startsWith("addr1") || trimmed.startsWith("stake1")) {
    throw new WalletError(
      "NETWORK_NOT_TESTNET",
      "Refusing Mainnet Bech32 address for signing. Use a Cardano Preprod testnet address (addr_test1...).",
    );
  }

  // Per CIP-30, signData accepts either Bech32 or hex-encoded address bytes.
  if (trimmed.startsWith("addr_test1")) {
    return trimmed;
  }

  if (isEvenHex(trimmed)) {
    // Validates CIP-19 header (Shelley payment address + testnet network tag 0).
    encodeCardanoTestnetAddress(trimmed);
    return trimmed;
  }

  throw new WalletError(
    "INVALID_ADDRESS",
    "Signing address must be a Cardano testnet Bech32 address (addr_test1...) or CIP-30 hex address bytes.",
  );
}

function getCardanoNamespace(options?: ConnectWalletOptions): CardanoWindowNamespace {
  if (options?.cardano !== undefined) {
    return options.cardano;
  }

  const maybeWindow = (globalThis as { window?: { cardano?: unknown } }).window;
  if (maybeWindow === undefined) {
    throw new WalletError(
      "BROWSER_UNAVAILABLE",
      "CIP-30 wallets are only available in a browser environment.",
    );
  }

  const cardano = maybeWindow.cardano;
  if (cardano === null || typeof cardano !== "object") {
    throw new WalletError(
      "NO_CARDANO_NAMESPACE",
      "No CIP-30 Cardano wallet extension was detected (window.cardano is missing). Install Lace or Eternl.",
    );
  }

  return cardano as CardanoWindowNamespace;
}

function resolveWalletProvider(
  cardano: CardanoWindowNamespace,
  walletId?: SupportedWalletId,
): { readonly walletId: SupportedWalletId; readonly provider: Cip30WalletProvider } {
  if (walletId !== undefined) {
    if (!isSupportedWalletId(walletId)) {
      throw new WalletError(
        "UNSUPPORTED_WALLET",
        `Unsupported wallet "${String(walletId)}". Supported testnet wallets: ${SUPPORTED_WALLETS.join(", ")}.`,
      );
    }

    const provider = cardano[walletId];
    if (provider === undefined || typeof provider.enable !== "function") {
      throw new WalletError(
        "WALLET_NOT_INSTALLED",
        `Wallet "${walletId}" is not installed or did not expose a CIP-30 enable() method.`,
      );
    }

    return { walletId, provider };
  }

  for (const candidateId of SUPPORTED_WALLETS) {
    const provider = cardano[candidateId];
    if (provider !== undefined && typeof provider.enable === "function") {
      return { walletId: candidateId, provider };
    }
  }

  throw new WalletError(
    "WALLET_NOT_INSTALLED",
    "No supported CIP-30 wallet found. Install and enable Lace or Eternl on Cardano Preprod testnet.",
  );
}

function resolveConnectedHandle(handle?: WalletHandle): WalletHandle {
  const target = handle ?? activeHandle;
  if (target === null) {
    throw new WalletError(
      "NOT_CONNECTED",
      "No wallet is connected. Call connectWallet() first.",
    );
  }
  return target;
}

async function assertTestnetNetwork(networkId: number): Promise<void> {
  if (networkId !== TESTNET_NETWORK_ID) {
    throw new WalletError(
      "NETWORK_NOT_TESTNET",
      `Refusing non-testnet wallet (CIP-30 networkId=${String(networkId)}). Switch Lace or Eternl to Cardano Preprod testnet (networkId 0; note CIP-30 networkId 0 does not distinguish Preprod from Preview).`,
    );
  }
}

/**
 * Connects to a CIP-30 browser wallet (Lace or Eternl) on a Cardano testnet.
 *
 * Enforces CIP-30 `networkId === 0` (testnet only, fail-closed on Mainnet).
 * Note: CIP-30 networkId 0 does not distinguish Preprod from Preview; ensure the
 * wallet extension is set to Cardano Preprod (decision T6.1).
 */
export async function connectWallet(
  walletId?: SupportedWalletId,
  options?: ConnectWalletOptions,
): Promise<WalletHandle> {
  const cardano = getCardanoNamespace(options);
  const { walletId: resolvedId, provider } = resolveWalletProvider(cardano, walletId);

  let api;
  try {
    api = await provider.enable();
  } catch (err) {
    throw new WalletError(
      "CONNECTION_REJECTED",
      `Connection to "${resolvedId}" was rejected or failed.`,
      { cause: err },
    );
  }

  const networkId = await api.getNetworkId();
  await assertTestnetNetwork(networkId);

  const handle: WalletHandle = {
    walletId: resolvedId,
    walletName: provider.name,
    apiVersion: provider.apiVersion,
    networkId: TESTNET_NETWORK_ID,
    api,
  };

  activeHandle = handle;
  return handle;
}

/**
 * Reads the selected payment address from the connected CIP-30 testnet wallet
 * and returns it as a CIP-19 Bech32 string (`addr_test1...`).
 *
 * Address lookup order follows CIP-30:
 * 1. First used address (`getUsedAddresses()`)
 * 2. First unused address (`getUnusedAddresses()`)
 * 3. Change address (`getChangeAddress()`)
 *
 * Re-verifies `getNetworkId() === 0` before returning. Does not validate key-hash
 * vs script addresses (server responsibility in T2.2, Blueprint Section 6.5).
 */
export async function getAddress(handle?: WalletHandle): Promise<string> {
  const target = resolveConnectedHandle(handle);

  const networkId = await target.api.getNetworkId();
  await assertTestnetNetwork(networkId);

  const used = await target.api.getUsedAddresses();
  let rawHex = used.find((addr) => typeof addr === "string" && addr.trim().length > 0);

  if (rawHex === undefined) {
    const unused = await target.api.getUnusedAddresses();
    rawHex = unused.find((addr) => typeof addr === "string" && addr.trim().length > 0);
  }

  if (rawHex === undefined) {
    const change = await target.api.getChangeAddress();
    if (typeof change === "string" && change.trim().length > 0) {
      rawHex = change;
    }
  }

  if (rawHex === undefined) {
    throw new WalletError(
      "NO_ADDRESS_AVAILABLE",
      "Connected wallet returned no used, unused, or change payment address.",
    );
  }

  return encodeCardanoTestnetAddress(rawHex);
}

/**
 * T7.2b — Signs an off-chain message (e.g. wallet registration challenge or purchase approval)
 * using CIP-30 `signData` (CIP-8) and returns `{ signature, key }` (COSE_Sign1 and COSE_Key)
 * verbatim as returned by the wallet.
 *
 * Blueprint Section 6.5:
 * - Message signing (`signData`) is distinct from transaction signing (`signTx`).
 *   Never pass a transaction hash to `signMessage`, and never treat an approval signature
 *   as a transaction authorisation.
 * - No signature verification is performed here; the server verifies in T2.2 / T2.3.
 */
export async function signMessage(
  address: string,
  payload: string | Uint8Array,
  options?: SignMessageOptions,
): Promise<Cip30DataSignature> {
  const target = resolveConnectedHandle(options?.handle);

  const networkId = await target.api.getNetworkId();
  await assertTestnetNetwork(networkId);

  const validatedAddress = validateTestnetSigningAddress(address);
  const hexPayload = encodePayloadToHex(payload);

  let result: Cip30DataSignature;
  try {
    result = await target.api.signData(validatedAddress, hexPayload);
  } catch (err) {
    throw new WalletError(
      "SIGNING_REJECTED",
      "Message signing (CIP-30 signData) was rejected or failed.",
      { cause: err },
    );
  }

  if (
    result === null ||
    typeof result !== "object" ||
    typeof result.signature !== "string" ||
    result.signature.trim().length === 0 ||
    typeof result.key !== "string" ||
    result.key.trim().length === 0
  ) {
    throw new WalletError(
      "INVALID_SIGNATURE_RESPONSE",
      "Wallet signData returned an invalid DataSignature (missing signature or key).",
    );
  }

  return {
    signature: result.signature,
    key: result.key,
  };
}

/**
 * T7.2b — Signs an unsigned Cardano transaction CBOR hex string using CIP-30 `signTx`
 * and returns the hex-encoded CBOR `transaction_witness_set` verbatim.
 *
 * Blueprint Section 6.5:
 * - The wallet ONLY signs; this helper NEVER submits transactions. Only the gateway submits.
 * - Transaction signing (`signTx`) is distinct from off-chain approval signing (`signData`).
 */
export async function signTransaction(
  unsignedTx: string,
  options?: SignTransactionOptions,
): Promise<string> {
  const target = resolveConnectedHandle(options?.handle);

  const networkId = await target.api.getNetworkId();
  await assertTestnetNetwork(networkId);

  const trimmedTx = unsignedTx.trim();
  if (!isEvenHex(trimmedTx)) {
    throw new WalletError(
      "INVALID_TX",
      "Unsigned transaction must be a non-empty, even-length hex-encoded CBOR string.",
    );
  }

  const partialSign = options?.partialSign ?? false;

  let witnessSetHex: string;
  try {
    witnessSetHex = await target.api.signTx(trimmedTx, partialSign);
  } catch (err) {
    throw new WalletError(
      "SIGNING_REJECTED",
      "Transaction signing (CIP-30 signTx) was rejected or failed.",
      { cause: err },
    );
  }

  if (typeof witnessSetHex !== "string" || !isEvenHex(witnessSetHex.trim())) {
    throw new WalletError(
      "INVALID_SIGNATURE_RESPONSE",
      "Wallet signTx returned an invalid witness set (expected non-empty even-length hex CBOR).",
    );
  }

  return witnessSetHex;
}

/** Internal test helper to clear module-level active handle between unit tests. */
export function _resetActiveWalletForTests(): void {
  activeHandle = null;
}
