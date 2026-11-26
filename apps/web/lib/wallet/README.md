# Browser Wallet Helper (`apps/web/lib/wallet`)

**Tasks:** T7.2a (`connectWallet`, `getAddress`) and T7.2b (`signMessage`, `signTransaction`)  
**Blueprint:** Section 6.5 | **Guide:** Section 4.3 | **Decision:** T6.1  
**Owner:** Divejikan | **Consumers:** Prabhath, Shahnas

Native CIP-30 browser wallet helper for connecting a Cardano testnet wallet (**Lace** or **Eternl**), reading the selected payment address as CIP-19 Bech32 (`addr_test1...`), signing off-chain messages (`signData`), and signing escrow transactions (`signTx`).

## Scope and Security Boundaries

- **Wallet signs, never submits:** No function in this helper submits a transaction. Only the server gateway submits transactions (Blueprint Section 6.5).
- **Message signing vs transaction signing are separate:**
  - `signMessage(address, payload)` calls CIP-30 `signData` (CIP-8) for off-chain wallet registration and purchase approval messages, returning `{ signature, key }` (`COSE_Sign1` + `COSE_Key`) verbatim. Never pass a transaction hash to `signMessage`.
  - `signTransaction(unsignedTx)` calls CIP-30 `signTx` for server-built escrow transactions, returning the hex CBOR witness set verbatim. Never treat a transaction signature as an off-chain approval.
- **No client-side verification:** Key-hash/script-address validation and COSE signature verification happen only on the server (T2.2, T2.3).

## Usage

```ts
// Adjust import path if Next.js path aliases (e.g. "@/lib/wallet") are configured in apps/web
import {
  connectWallet,
  getAddress,
  signMessage,
  signTransaction,
  WalletError,
} from "./apps/web/lib/wallet";

try {
  // 1. Connect Lace or Eternl on Cardano Preprod testnet (networkId 0)
  const handle = await connectWallet();

  // 2. Read the selected payment address as Bech32 (addr_test1...)
  const address = await getAddress(handle);

  // 3. Sign an off-chain challenge or approval message (CIP-30 signData -> { signature, key })
  const approvalSig = await signMessage(address, "seyvixa-register-v1:nonce-123");

  // 4. Sign a server-built unsigned escrow transaction CBOR hex (CIP-30 signTx -> witnessSetHex)
  //    Send the witness set back to the gateway; this helper never submits.
  const witnessSetHex = await signTransaction(unsignedTxCborHex);
} catch (err) {
  if (err instanceof WalletError) {
    console.error(err.code, err.message);
  }
}
```

## Testnet-only Enforcement

- `connectWallet()`, `getAddress()`, `signMessage()`, and `signTransaction()` all verify `api.getNetworkId() === 0` and fail closed with `WalletError("NETWORK_NOT_TESTNET")` on Mainnet.
- **Important CIP-30 limitation:** CIP-30 `networkId === 0` covers all Cardano testnets and **cannot distinguish Preprod from Preview**. Users must select **Cardano Preprod** in Lace or Eternl (Decision T6.1). Cardano testnet test ADA has no monetary value.

## Running the Unit Tests

```bash
node --test "apps/web/lib/wallet/*.test.ts"
```

## Manual Browser Verification (Lace / Eternl on Preprod)

1. Switch Lace or Eternl to **Cardano Preprod** (never Mainnet).
2. Connect and read your testnet address:
   ```ts
   const handle = await connectWallet("lace"); // or "eternl"
   const address = await getAddress(handle);
   console.log({ wallet: handle.walletName, networkId: handle.networkId, address });
   ```
3. Test `signMessage` with a harmless test message and log the public `{ signature, key }` result:
   ```ts
   const signed = await signMessage(address, "seyvixa-t7.2b-test-message");
   console.log("signData result:", signed);
   ```
4. Test `signTransaction` with a harmless unsigned Preprod transaction CBOR hex and confirm it returns a witness set hex string without submitting anything on-chain.
