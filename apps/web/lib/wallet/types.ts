// T7.2a & T7.2b — Browser wallet helper types (Blueprint Section 6.5; Guide Section 4.3; CIP-30).
// Test networks only (CIP-30 networkId 0). The wallet signs but never submits transactions.

export const SUPPORTED_WALLETS = ["lace", "eternl"] as const;
export type SupportedWalletId = (typeof SUPPORTED_WALLETS)[number];

/**
 * CIP-30 network ID for Cardano testnets (0 = Testnet, 1 = Mainnet).
 * Important: CIP-30 networkId 0 does not distinguish Preprod from Preview.
 * The user must select Cardano Preprod in their wallet extension (decision T6.1).
 */
export const TESTNET_NETWORK_ID = 0 as const;

export interface Cip30Paginate {
  readonly page: number;
  readonly limit: number;
}

/**
 * Official CIP-30 `DataSignature` returned by `api.signData(addr, payload)` (CIP-8).
 * Returned verbatim to the caller; verification happens only on the server (T2.2, T2.3).
 */
export interface Cip30DataSignature {
  /** Hex-encoded CBOR `COSE_Sign1` signature. */
  readonly signature: string;
  /** Hex-encoded CBOR `COSE_Key` containing the public key. */
  readonly key: string;
}

/**
 * Minimal CIP-30 enabled API surface required for T7.2a and T7.2b.
 * Intentionally omits transaction submission: only the gateway submits (Blueprint Section 6.5).
 */
export interface Cip30Api {
  getNetworkId(): Promise<number>;
  getUsedAddresses(paginate?: Cip30Paginate): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  signData(addr: string, payload: string): Promise<Cip30DataSignature>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
}

/** Pre-enable wallet object injected at `window.cardano[walletId]` per CIP-30. */
export interface Cip30WalletProvider {
  readonly name: string;
  readonly icon: string;
  readonly apiVersion: string;
  enable(): Promise<Cip30Api>;
  isEnabled(): Promise<boolean>;
}

export type CardanoWindowNamespace = Partial<Record<SupportedWalletId, Cip30WalletProvider>> &
  Record<string, Cip30WalletProvider | undefined>;

export interface WalletHandle {
  readonly walletId: SupportedWalletId;
  readonly walletName: string;
  readonly apiVersion: string;
  /**
   * Always 0 (CIP-30 testnet).
   * Note: CIP-30 networkId 0 does not distinguish Preprod from Preview.
   */
  readonly networkId: typeof TESTNET_NETWORK_ID;
  readonly api: Cip30Api;
}

export interface ConnectWalletOptions {
  /** Optional CIP-30 `window.cardano` override (primarily for unit tests). */
  readonly cardano?: CardanoWindowNamespace;
}

export interface SignMessageOptions {
  /** Optional explicit handle; defaults to the last connected wallet handle. */
  readonly handle?: WalletHandle;
}

export interface SignTransactionOptions {
  /** Optional explicit handle; defaults to the last connected wallet handle. */
  readonly handle?: WalletHandle;
  /** CIP-30 `partialSign` flag (defaults to `false`). */
  readonly partialSign?: boolean;
}

export type WalletErrorCode =
  | "BROWSER_UNAVAILABLE"
  | "NO_CARDANO_NAMESPACE"
  | "UNSUPPORTED_WALLET"
  | "WALLET_NOT_INSTALLED"
  | "CONNECTION_REJECTED"
  | "NETWORK_NOT_TESTNET"
  | "NOT_CONNECTED"
  | "NO_ADDRESS_AVAILABLE"
  | "INVALID_ADDRESS"
  | "INVALID_PAYLOAD"
  | "INVALID_TX"
  | "UNSUPPORTED_OPERATION"
  | "SIGNING_REJECTED"
  | "INVALID_SIGNATURE_RESPONSE";

export class WalletError extends Error {
  readonly code: WalletErrorCode;

  constructor(code: WalletErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WalletError";
    this.code = code;
  }
}
