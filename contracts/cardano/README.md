# Cardano Environment Setup (T6.1)

> **Task ID:** T6.1 | **Blueprint:** Section 5, Section 13
>
> **Test networks only.** Use **Cardano Preprod** only. Test ADA has no monetary value. Never commit or paste seed phrases, private keys, or Blockfrost API keys.
>
> **Prototype boundary (Blueprint Section 13):** The escrow is a buyer-controlled prototype, not neutral or trustless. Label the UI and docs according to the Cardano fallback level actually reached (Blueprint Section 13).

---

## 1. Team Decision & Pinned Toolchain

Per [`docs/DECISIONS.md`](../../docs/DECISIONS.md) (T6.1) and [`docs/VERSIONS.md`](../../docs/VERSIONS.md):

| Component | Decision / Pinned Version |
|---|---|
| Cardano Testnet | **Preprod** |
| Chain-data API | **Blockfrost** (`BLOCKFROST_PROJECT_ID`) |
| Aiken Version Manager (`aikup`) | `0.0.11` |
| Aiken Compiler (`aiken`) | `1.1.24` (`v1.1.24+bacbeb3`) |
| `@meshsdk/core` | `1.9.1` |
| `@meshsdk/common` | `1.9.1` |

---

## 2. Install Aiken (`v1.1.24`)

### Windows (PowerShell)

```powershell
powershell -c "irm https://windows.aiken-lang.org | iex"
aikup install 1.1.24
aiken --version
```

### Linux / macOS

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://install.aiken-lang.org | sh
aikup install 1.1.24
aiken --version
```

Expected output: `aiken v1.1.24+...`

---

## 3. Get a Blockfrost Preprod API Key

1. Sign in at `https://blockfrost.io/` and create a new project.
2. Select network: **Cardano Preprod**.
3. Copy the **Project ID** into your local `.env` file (never commit `.env` or paste the key anywhere):

```env
CARDANO_NETWORK=preprod
BLOCKFROST_PROJECT_ID=your-preprod-project-id-here
```

---

## 4. Create a Preprod Wallet & Get Test ADA

1. Open **Lace** (or **Eternl**) in your browser and switch the Cardano network to **Preprod** (address starts with `addr_test1...`).
2. Copy your Preprod receive address (`addr_test1...`).
3. Request test ADA from the official Cardano Testnet Faucet:
   - `https://docs.cardano.org/cardano-testnets/tools/faucet/`
   - Select **Preprod Testnet**, paste your `addr_test1...` address, complete verification, and submit.
4. Wait 1–2 minutes for test ADA to arrive in your wallet.

---

## 5. Build & Test Escrow Validator (T6.3)

From `contracts/cardano/`:

```bash
aiken check
aiken build
aiken address --validator escrow
```

- **Compiled blueprint:** [`contracts/cardano/plutus.json`](plutus.json) (Plutus V3)
- **Preprod script address (`escrow`):** `addr_test1wr0slpaxzct7xmln7m0fg3vklf33jkqw4x0fzxze5z473hgyk5pf0`

---

## 6. Manual Testnet Lock & Release (T6.4)

Run the automated Preprod testnet escrow script:

1. Add your Preprod wallet mnemonic to your local `.env`:
   ```env
   PREPROD_WALLET_MNEMONIC="word1 word2 word3 ... word24"
   ```
2. Run the script:
   ```bash
   node contracts/cardano/scripts/manual-escrow.mjs
   ```
3. The script will:
   - Connect to Cardano Preprod via Blockfrost.
   - Build, sign, and submit the **Lock Transaction** (locks 5 tADA at script address with `EscrowDatum`).
   - Wait for block confirmation.
   - Build, sign, and submit the **Release Transaction** (Plutus V3 spending input, `Release` redeemer, buyer signature, pays 5 tADA to supplier).
   - Wait for block confirmation.
   - Automatically record transaction hashes and CardanoScan explorer links in `docs/evidence/T6.4-cardano-testnet.md`.
