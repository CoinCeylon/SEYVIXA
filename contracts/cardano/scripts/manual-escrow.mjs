#!/usr/bin/env node
// T6.4 — Cardano Preprod Manual Lock & Release Script (Aiken Escrow Validator)
// Blueprint Section 6.5, Section 6.7, Section 13; Guide Section 6.2 (T6.4)
//
// Prototype boundary: buyer-controlled prototype escrow on Cardano Preprod testnet.
// Test ADA has no monetary value. Never commit seed phrases, private keys, or API keys.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BlockfrostProvider,
  MeshTxBuilder,
  MeshWallet,
  mConStr0,
  resolvePaymentKeyHash,
} from "../../../services/chain/node_modules/@meshsdk/core/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "../../..");
const PLUTUS_JSON_PATH = resolve(ROOT_DIR, "contracts/cardano/plutus.json");
const EVIDENCE_PATH = resolve(ROOT_DIR, "docs/evidence/T6.4-cardano-testnet.md");

// Constants
const SCRIPT_ADDRESS = "addr_test1wr0slpaxzct7xmln7m0fg3vklf33jkqw4x0fzxze5z473hgyk5pf0";
const LOCKED_LOVELACE = 5_000_000n; // 5 tADA
const COMMITMENT_DOMAIN_TAG = "seyvixa-commit-v1";
const DUMMY_SUPPLIER_PKH = "00000000000000000000000000000000000000000000000000000002";
// Testnet enterprise address for DUMMY_SUPPLIER_PKH (0x60 + 28 bytes PKH)
const SUPPLIER_ADDRESS = "addr_test1vqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqscyrspc";

function loadEnv() {
  const envPath = resolve(ROOT_DIR, ".env");
  try {
    const content = readFileSync(envPath, "utf-8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[key] = val;
      }
    }
    return env;
  } catch (err) {
    throw new Error(`Could not read .env file at ${envPath}: ${err.message}`);
  }
}

async function waitForTxConfirmation(provider, txHash, maxAttempts = 30, intervalMs = 10_000) {
  console.log(`[INFO] Waiting for transaction ${txHash} confirmation on Preprod...`);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await provider.get(`/txs/${txHash}`);
      if (res && res.hash === txHash && res.block) {
        console.log(`[SUCCESS] Confirmed in block ${res.block_height} (slot ${res.slot})!`);
        return res;
      }
    } catch {
      // 404 or pending while in mempool
    }
    console.log(`  Attempt ${attempt}/${maxAttempts}: Transaction still pending, waiting ${intervalMs / 1000}s...`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction ${txHash} did not confirm after ${maxAttempts} attempts.`);
}

async function main() {
  console.log("=== SEYVIXA TrustOS: Cardano Preprod Manual Escrow Test (T6.4) ===");
  const env = loadEnv();

  const network = env.CARDANO_NETWORK;
  if (network !== "preprod") {
    throw new Error('CARDANO_NETWORK in .env must be "preprod"');
  }

  const projectId = env.BLOCKFROST_PROJECT_ID?.trim();
  if (!projectId || projectId.startsWith("fake-")) {
    throw new Error("BLOCKFROST_PROJECT_ID in .env is missing or still has placeholder value.");
  }

  const mnemonic = env.PREPROD_WALLET_MNEMONIC?.trim();
  if (!mnemonic) {
    console.error("\n[ACTION REQUIRED] PREPROD_WALLET_MNEMONIC is not set in your .env file!");
    console.error("Please add your 24-word Preprod wallet seed phrase to .env:");
    console.error('PREPROD_WALLET_MNEMONIC="word1 word2 word3 ... word24"\n');
    console.error("Test ADA only. Never commit or share your seed phrase.\n");
    process.exit(1);
  }

  const words = mnemonic.split(/\s+/);
  if (words.length !== 24 && words.length !== 12 && words.length !== 15) {
    throw new Error(`Invalid mnemonic length (${words.length} words). Expected 24 (or 12/15) words.`);
  }

  // 1. Read Aiken compiled blueprint
  console.log("[1/5] Loading compiled Aiken validator from plutus.json...");
  const plutusJson = JSON.parse(readFileSync(PLUTUS_JSON_PATH, "utf-8"));
  const validatorDef = plutusJson.validators.find((v) => v.title === "escrow.escrow.spend");
  if (!validatorDef) {
    throw new Error("Could not find validator 'escrow.escrow.spend' in plutus.json");
  }
  // Aiken compiledCode is single-CBOR; Mesh PlutusV3Script expects double-CBOR
  const rawCode = validatorDef.compiledCode;
  const byteLength = rawCode.length / 2;
  const cborHeader = "59" + byteLength.toString(16).padStart(4, "0");
  const scriptCbor = cborHeader + rawCode;

  console.log(`  Compiled code loaded (${scriptCbor.length / 2} bytes double-CBOR).`);
  console.log(`  Target Script Address: ${SCRIPT_ADDRESS}`);

  // 2. Initialize provider & wallet
  console.log("[2/5] Initializing Blockfrost provider & Mesh wallet...");
  const provider = new BlockfrostProvider(projectId);
  const wallet = new MeshWallet({
    networkId: 0,
    fetcher: provider,
    submitter: provider,
    key: {
      type: "mnemonic",
      words,
    },
  });

  const buyerAddress = await wallet.getChangeAddress();
  const buyerPkh = resolvePaymentKeyHash(buyerAddress);
  console.log(`  Buyer Address: ${buyerAddress}`);
  console.log(`  Buyer PKH:     ${buyerPkh}`);

  const utxos = await wallet.getUtxos();
  const totalLovelace = utxos.reduce((acc, u) => {
    const lovelace = u.output.amount.find((a) => a.unit === "lovelace");
    return acc + (lovelace ? BigInt(lovelace.quantity) : 0n);
  }, 0n);

  console.log(`  Available UTxOs: ${utxos.length}`);
  console.log(`  Total Balance:   ${Number(totalLovelace) / 1_000_000} tADA`);

  if (totalLovelace < 10_000_000n) {
    throw new Error("Insufficient balance in test wallet. Need at least 10 tADA (for lock + collateral + fees).");
  }

  // 3. Check for existing locked script UTxO or build and submit Lock Transaction
  let lockTxHash;
  let targetScriptUtxo;

  console.log("\n[3/5] Checking for existing unspent escrow UTxO at script address...");
  const existingScriptUtxos = await provider.fetchAddressUTxOs(SCRIPT_ADDRESS);
  if (existingScriptUtxos.length > 0) {
    targetScriptUtxo = existingScriptUtxos[0];
    lockTxHash = targetScriptUtxo.input.txHash;
    console.log(`  Found existing locked UTxO: ${lockTxHash}#${targetScriptUtxo.input.outputIndex}`);
    console.log(`  >> Lock Tx Explorer: https://preprod.cardanoscan.io/transaction/${lockTxHash}`);
  } else {
    // Prepare Escrow Datum
    const refundDeadline = Date.now() + 2 * 3600 * 1000; // 2 hours in future
    const actionHash = createHash("sha256").update("test-purchase-kit-100").digest("hex");
    const salt = randomBytes(32).toString("hex");
    const actionCommitment = createHash("sha256")
      .update(Buffer.concat([
        Buffer.from(COMMITMENT_DOMAIN_TAG, "utf-8"),
        Buffer.from(actionHash, "hex"),
        Buffer.from(salt, "hex"),
      ]))
      .digest("hex");

    const inlineDatum = mConStr0([
      buyerPkh,
      DUMMY_SUPPLIER_PKH,
      LOCKED_LOVELACE,
      BigInt(refundDeadline),
      actionCommitment,
    ]);

    console.log("  Building and submitting LOCK transaction...");
    console.log(`  Locking ${Number(LOCKED_LOVELACE) / 1_000_000} tADA at ${SCRIPT_ADDRESS}`);
    const lockTxBuilder = new MeshTxBuilder({
      fetcher: provider,
      evaluator: provider,
    });

    const unsignedLockTx = await lockTxBuilder
      .txOut(SCRIPT_ADDRESS, [{ unit: "lovelace", quantity: LOCKED_LOVELACE.toString() }])
      .txOutInlineDatumValue(inlineDatum, "Mesh")
      .changeAddress(buyerAddress)
      .selectUtxosFrom(utxos)
      .complete();

    console.log("  Signing lock transaction...");
    const signedLockTx = await wallet.signTx(unsignedLockTx);
    console.log("  Submitting lock transaction to Cardano Preprod...");
    lockTxHash = await wallet.submitTx(signedLockTx);
    console.log(`  >> Lock Tx Submitted: ${lockTxHash}`);
    console.log(`  >> Preprod Explorer: https://preprod.cardanoscan.io/transaction/${lockTxHash}`);

    // Wait for lock confirmation
    await waitForTxConfirmation(provider, lockTxHash);

    // Give Blockfrost indexer 3 seconds
    await new Promise((r) => setTimeout(r, 3000));
    const scriptUtxos = await provider.fetchAddressUTxOs(SCRIPT_ADDRESS);
    targetScriptUtxo = scriptUtxos.find((u) => u.input.txHash === lockTxHash);
    if (!targetScriptUtxo) {
      throw new Error(`Could not find script UTxO for lock tx ${lockTxHash} at ${SCRIPT_ADDRESS}`);
    }
  }

  // 4. Build and Submit Release Transaction
  console.log("\n[4/5] Building and submitting RELEASE transaction...");
  console.log(`  Target Script UTxO: ${targetScriptUtxo.input.txHash}#${targetScriptUtxo.input.outputIndex}`);

  // Fresh wallet UTxOs for fees & collateral
  const freshWalletUtxos = await wallet.getUtxos();
  const collateral = freshWalletUtxos.find((u) => {
    const lovelace = u.output.amount.find((a) => a.unit === "lovelace");
    return lovelace && BigInt(lovelace.quantity) >= 5_000_000n && u.output.amount.length === 1;
  }) || freshWalletUtxos[0];

  if (!collateral) {
    throw new Error("Could not find a suitable UTxO for collateral.");
  }
  console.log(`  Selected collateral: ${collateral.input.txHash}#${collateral.input.outputIndex}`);

  const releaseTxBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: provider,
  });

  const releaseRedeemer = mConStr0([]); // Release variant

  const unsignedReleaseTx = await releaseTxBuilder
    .spendingPlutusScriptV3()
    .txIn(
      targetScriptUtxo.input.txHash,
      targetScriptUtxo.input.outputIndex,
      targetScriptUtxo.output.amount,
      targetScriptUtxo.output.address,
    )
    .txInScript(scriptCbor)
    .txInInlineDatumPresent()
    .txInRedeemerValue(releaseRedeemer, "Mesh")
    .requiredSignerHash(buyerPkh)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    )
    .txOut(SUPPLIER_ADDRESS, [{ unit: "lovelace", quantity: LOCKED_LOVELACE.toString() }])
    .changeAddress(buyerAddress)
    .selectUtxosFrom(freshWalletUtxos)
    .complete();

  console.log("  Signing release transaction...");
  const signedReleaseTx = await wallet.signTx(unsignedReleaseTx);
  console.log("  Submitting release transaction to Cardano Preprod...");
  const releaseTxHash = await wallet.submitTx(signedReleaseTx);
  console.log(`  >> Release Tx Submitted: ${releaseTxHash}`);
  console.log(`  >> Preprod Explorer: https://preprod.cardanoscan.io/transaction/${releaseTxHash}`);

  // Wait for release confirmation
  await waitForTxConfirmation(provider, releaseTxHash);

  // 6. Record Evidence
  console.log("\n[5/5] Recording evidence in docs/evidence/T6.4-cardano-testnet.md...");
  const evidenceContent = `# T6.4 — Cardano Preprod Escrow Testnet Evidence

> **Task ID:** T6.4 | **Blueprint:** Section 6.5, Section 6.7, Section 13 | **Date:** ${new Date().toISOString().split("T")[0]}
>
> **Cardano Fallback Level Demonstrated:** **Level 1** — *"Cardano testnet escrow (buyer-controlled prototype)"*
> (Per Blueprint Section 13 & DATUM_SPEC.md, the Aiken Plutus V3 validator enforced buyer signature and payment to supplier on-chain on Cardano Preprod testnet. Test ADA has no monetary value.)

---

## 1. Environment & Network Details

- **Cardano Network:** Preprod
- **Chain-Data API:** Blockfrost (\`cardano-preprod.blockfrost.io\`)
- **Aiken Validator:** \`contracts/cardano/validators/escrow.ak\`
- **Plutus Version:** Plutus V3 (\`plutus.json\`)
- **Script Address:** \`${SCRIPT_ADDRESS}\`
- **Buyer Address:** \`${buyerAddress}\`
- **Buyer Payment Key Hash:** \`${buyerPkh}\`
- **Supplier Address:** \`${SUPPLIER_ADDRESS}\`
- **Supplier Payment Key Hash:** \`${DUMMY_SUPPLIER_PKH}\`
- **Locked Amount:** \`5.0 tADA\` (\`5,000,000\` lovelace)

---

## 2. On-Chain Transaction Evidence (Cardano Preprod)

| Step | Transaction ID | Cardanoscan Explorer Link | Status |
|---|---|---|---|
| **Lock Transaction** | \`${lockTxHash}\` | [View on Cardanoscan](https://preprod.cardanoscan.io/transaction/${lockTxHash}) | **Confirmed** |
| **Release Transaction** | \`${releaseTxHash}\` | [View on Cardanoscan](https://preprod.cardanoscan.io/transaction/${releaseTxHash}) | **Confirmed** |

---

## 3. Escrow Datum & Redeemer Specification Compliance

- **Inline Datum:** \`Constr 0 [buyer, supplier, 5000000, refund_deadline, action_commitment]\`
- **Action Commitment:** \`SHA-256("seyvixa-commit-v1" || action_hash || salt)\`
- **Redeemer:** \`Release\` (\`Constr 0 []\`)
- **Witnesses:**
  - Plutus V3 validator script witness attached and executed by Cardano node.
  - Buyer payment key witness attached via \`requiredSignerHash\`.
  - Payment of 5.0 tADA transferred from script address to supplier payment key hash.
`;

  writeFileSync(EVIDENCE_PATH, evidenceContent, "utf-8");
  console.log(`[DONE] Evidence successfully recorded at ${EVIDENCE_PATH}`);
  console.log("\n=== T6.4 Escrow Lifecycle Completed Successfully on Cardano Preprod! ===");
}

main().catch((err) => {
  console.error(`\n[ERROR] ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
