// T7.2a & T7.2b — Browser wallet helper public exports (Blueprint Section 6.5; Guide Section 4.3).

export { connectWallet, getAddress, signMessage, signTransaction } from "./wallet.ts";
export { decodeCardanoTestnetAddress, encodeCardanoTestnetAddress } from "./bech32.ts";
export {
  SUPPORTED_WALLETS,
  TESTNET_NETWORK_ID,
  WalletError,
  type CardanoWindowNamespace,
  type Cip30Api,
  type Cip30DataSignature,
  type Cip30Paginate,
  type Cip30WalletProvider,
  type ConnectWalletOptions,
  type SignMessageOptions,
  type SignTransactionOptions,
  type SupportedWalletId,
  type WalletErrorCode,
  type WalletHandle,
} from "./types.ts";
