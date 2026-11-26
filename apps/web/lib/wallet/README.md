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

> **Status:** Pending manual browser interaction with a real Lace or Eternl extension switched to **Cardano Preprod** (unit tests and type checking pass; live wallet popup approval requires a human tester).

Start the zero-dependency local verification harness (binds to `127.0.0.1:4173` only, serves the exact helper TypeScript files, and never submits transactions):

```bash
node apps/web/lib/wallet/verify-harness.mjs
```

Then open `http://127.0.0.1:4173` in Chrome/Brave with **Lace** or **Eternl** set to **Cardano Preprod** (never Mainnet):

1. Click **Connect & Get Address** and confirm `networkId: 0` and an `addr_test1...` address.
2. Click **Sign Message (signData)** with the harmless test message (`seyvixa-t7.2b-preprod-test-message`) and copy the public `{ signature, key }` console output for PR evidence.
   - Note: `signMessage` decodes Bech32 `addr_test1...` addresses to CIP-30 hex address bytes (verifying the BIP-173 checksum and CIP-19 header) before calling `api.signData`.
   - If `signData` is unsupported or blocked by the wallet (`WalletError("UNSUPPORTED_OPERATION")`), notify Abdul at once for the demo-key fallback (Blueprint Section 6.5).
3. Paste a harmless unsigned Preprod transaction CBOR hex and click **Sign Transaction (signTx only)**. Confirm it returns a hex witness set without submitting anything on-chain.
