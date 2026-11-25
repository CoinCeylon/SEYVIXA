# Midnight Environment Setup (T5.1)

> **Task ID:** T5.1 | **Blueprint:** Section 5, Section 6.6, Section 13
>
> **Test networks only.** Never use mainnet, real money, or real credentials. Never commit or paste seed phrases, private keys, or API keys.
>
> **Prototype boundary (Blueprint Section 6.6 & 13):** Midnight is used for one credential ("Registered Supplier (simulated)") and one eligibility claim issued by the simulated authority **"SEYVIXA Demo Supplier Registry"**. At demo time, label the UI and docs according to the Midnight fallback level actually reached (Blueprint Section 13).

---

## 1. Pinned Toolchain (Ledger 9 Compatibility Matrix)

All Midnight components below come from the single compatible **Ledger 9** release row in the official Midnight Compatibility Matrix (`docs.midnight.network`) and are pinned in [`docs/VERSIONS.md`](../../docs/VERSIONS.md). Do not mix versions across releases.

| Component | Pinned Version |
|---|---|
| Compact Devtools (`compact` CLI) | `0.5.3` |
| Compact Toolchain (`compact compile`, Language `0.28.0`) | `0.36.0` |
| `@midnight-ntwrk/compact-runtime` | `0.21.0` |
| `@midnight-ntwrk/compact-js` | `3.0.0` |
| `@midnight-ntwrk/midnight-js` | `5.0.0` |
| `@midnight-ntwrk/platform-js` | `3.0.0` |
| `@midnight-ntwrk/wallet-sdk` | `2.0.0` |
| Proof Server Docker image (`midnightntwrk/proof-server`) | `9.0.2` |

---

## 2. Prerequisites

- **OS:** Linux, macOS, or **Windows with WSL2 (Ubuntu)**.
  - *Note for Windows:* The Compact CLI (`compact`) does not have a native Windows `.exe` binary (Windows `C:\WINDOWS\system32\compact.exe` is an unrelated NTFS utility). Install and run `compact` inside WSL2 Ubuntu.
- **Docker:** Docker Engine / Docker Desktop running (for the Proof Server).
- **Node.js & pnpm:** Pinned in [`docs/VERSIONS.md`](../../docs/VERSIONS.md) (`Node.js 26.13.1`, `pnpm 12.23.0`).
- **Browser Wallet:** Latest **Lace** browser extension with Midnight network support.

### Windows only: Enable WSL2 Ubuntu (if not already installed)

Run in PowerShell:

```powershell
wsl --install -d Ubuntu
```

Restart if prompted, open **Ubuntu**, and create your Linux user.

---

## 3. Install Compact Devtools and Pin the Compiler

Inside **Linux / macOS / WSL2 Ubuntu**:

1. Install Compact Devtools:

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
```

2. Reload your shell `PATH`:

```bash
source "$HOME/.local/bin/env"
```

3. Install and pin the exact Compact toolchain version (`0.36.0`, **do not** run bare `compact update`):

```bash
compact update 0.36.0
```

4. Verify the installation:

```bash
compact --version
compact compile --version
```

---

## 4. Run the Local Proof Server

Ensure Docker Desktop / Docker Engine is running, then pull and start the pinned Proof Server image on port `6300`:

```bash
docker pull midnightntwrk/proof-server:9.0.2
docker run --rm -p 6300:6300 midnightntwrk/proof-server:9.0.2
```

Keep this running when generating or verifying ZK proofs locally.

---

## 5. Create a Testnet Wallet, Get `tNIGHT`, and Generate `tDUST`

1. Open the **Lace** browser extension and switch to the **Midnight** tab.
2. Select the **Preprod** (or **Preview**) test network — match the network used by your team's deployment.
3. Create or select your testnet wallet and back up the seed phrase **offline only** (never paste it into AI tools, `.env` files committed to git, or chat).
4. Copy your **Midnight Unshielded address** from **Receive** (it starts with `mn_addr_preprod1...` or `mn_addr_preview1...` — do **not** use a Cardano `addr_test1...` address).
5. Request `tNIGHT` from the official faucet:
   - **Preprod:** `https://faucet.preprod.midnight.network`
   - **Preview:** `https://faucet.preview.midnight.network`
6. Wait a few minutes for the faucet transaction to confirm, then in Lace Midnight **register your `tNIGHT` / click Generate `tDUST`** so `tDUST` accrues for transaction fees.

---

## 6. Clean-Run Verification Checklist (for Teammates)

- [ ] `compact --version` and `compact compile --version` report `0.5.3` / `0.36.0` (`b5d9e4dfc 2026-11-03`) inside Linux/macOS/WSL2.
- [ ] `docker run --rm -p 6300:6300 midnightntwrk/proof-server:9.0.2` starts cleanly.
- [ ] Lace wallet shows a Midnight testnet address (`mn_addr_preprod1...` or `mn_addr_preview1...`), non-zero `tNIGHT`, and accruing `tDUST`.
- [ ] No seed phrases, private keys, or API keys are stored in the repository.
