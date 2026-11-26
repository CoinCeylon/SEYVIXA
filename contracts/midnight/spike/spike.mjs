import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import {
  deployContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  DustWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  ShieldedWallet,
  UnshieldedWallet,
  WalletFacade,
  WalletSeeds,
  createKeystore,
  generateRandomSeed,
} from '@midnight-ntwrk/wallet-sdk';
import * as Counter from './managed/counter/contract/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.join(__dirname, '.spike-seed');
const WALLET_STATE_FILE = path.join(__dirname, '.wallet-state.json');
const CONTRACT_STATE_FILE = path.join(__dirname, '.spike-contract.json');
const ZK_CONFIG_PATH = path.join(__dirname, 'managed', 'counter');
const PRIVATE_STATE_DIR = path.join(__dirname, '.private-state');

const NETWORK_ID = 'preview';
const INDEXER_HTTP = 'https://indexer.preview.midnight.network/api/v4/graphql';
const INDEXER_WS = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
const NODE_RPC = 'wss://rpc.preview.midnight.network';
const PROOF_SERVER = 'http://127.0.0.1:6300';

const SYNC_TIMEOUT_MS = 10 * 60 * 1000;
const DUST_POLL_MAX = 24;

setNetworkId(NETWORK_ID);

function log(level, event, details = undefined) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(details ? { details } : {}),
  };
  console.log(JSON.stringify(entry));
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function verifyProofServerHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${PROOF_SERVER}/health`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Proof server health check returned HTTP ${res.status}`);
    }
    const body = await res.json();
    log('info', 'proof_server_healthy', { url: PROOF_SERVER, status: body.status });
  } catch (err) {
    throw new Error(
      `Proof server at ${PROOF_SERVER} is unreachable (${err.message}). Start Docker with: docker run --rm -p 6300:6300 midnightntwrk/proof-server:9.0.2`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function loadOrCreateSeed() {
  if (fs.existsSync(SEED_FILE)) {
    return Uint8Array.from(Buffer.from(fs.readFileSync(SEED_FILE, 'utf8').trim(), 'hex'));
  }
  const seed = generateRandomSeed();
  fs.writeFileSync(SEED_FILE, Buffer.from(seed).toString('hex'), { mode: 0o600 });
  return seed;
}

function loadSavedWalletState() {
  if (!fs.existsSync(WALLET_STATE_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(WALLET_STATE_FILE, 'utf8'));
    if (parsed?.shielded && parsed?.unshielded && parsed?.dust) {
      return parsed;
    }
    return null;
  } catch (err) {
    log('warn', 'wallet_state_load_failed', { error: err.message });
    return null;
  }
}

async function saveWalletState(wallet) {
  const [shielded, unshielded, dust] = await Promise.all([
    wallet.shielded.serializeState(),
    wallet.unshielded.serializeState(),
    wallet.dust.serializeState(),
  ]);
  fs.writeFileSync(
    WALLET_STATE_FILE,
    JSON.stringify({ networkId: NETWORK_ID, updatedAt: new Date().toISOString(), shielded, unshielded, dust }),
    { mode: 0o600 },
  );
  log('info', 'wallet_state_saved', { file: path.basename(WALLET_STATE_FILE) });
}

async function main() {
  await verifyProofServerHealth();

  const masterSeed = loadOrCreateSeed();
  const keys = WalletSeeds.fromMasterSeed(masterSeed);
  const keystore = createKeystore({ kind: 'schnorr', secret: keys.unshielded }, NETWORK_ID);
  const unshieldedBech32 = keystore.getBech32Address().asString();

  const savedWallet = loadSavedWalletState();
  log('info', 'wallet_init', {
    network: NETWORK_ID,
    address: unshieldedBech32,
    restoredFromSnapshot: Boolean(savedWallet),
  });

  const wallet = await WalletFacade.init({
    configuration: {
      networkId: NETWORK_ID,
      indexerClientConnection: {
        indexerHttpUrl: INDEXER_HTTP,
        indexerWsUrl: INDEXER_WS,
      },
      provingServerUrl: new URL(PROOF_SERVER),
      relayURL: new URL(NODE_RPC),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
      costParameters: {
        additionalFeeOverhead: 300_000_000_000_000n,
        feeBlocksMargin: 5,
      },
    },
    shielded: (cfg) =>
      savedWallet ? ShieldedWallet(cfg).restore(savedWallet.shielded) : ShieldedWallet(cfg).startWithSeed(keys.shielded),
    unshielded: (cfg) =>
      savedWallet
        ? UnshieldedWallet(cfg).restore(savedWallet.unshielded)
        : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (cfg) =>
      savedWallet ? DustWallet(cfg).restore(savedWallet.dust) : DustWallet(cfg).startWithSeed(keys.dust),
  });

  try {
    await wallet.start({ shielded: keys.shielded, dust: keys.dust });

    let lastLog = 0;
    const sub = wallet.state().subscribe((s) => {
      const now = Date.now();
      if (now - lastLog < 5000) return;
      lastLog = now;
      const sh = s.shielded?.state?.progress;
      const du = s.dust?.state?.progress;
      log('info', 'wallet_sync_progress', {
        synced: s.isSynced,
        shApplied: sh?.appliedIndex?.toString(),
        shTarget: sh?.highestRelevantWalletIndex?.toString(),
        unSynced: s.unshielded?.progress?.isStrictlyComplete?.(),
        duApplied: du?.appliedIndex?.toString(),
        duTarget: du?.highestRelevantWalletIndex?.toString(),
        nightCoins: s.unshielded?.availableCoins?.length ?? 0,
      });
    });

    const state = await withTimeout(wallet.waitForSyncedState(), SYNC_TIMEOUT_MS, 'wallet_sync');
    sub.unsubscribe();
    await saveWalletState(wallet);

    const nightUtxos = state.unshielded.availableCoins ?? [];
    const totalNight = nightUtxos.reduce((acc, c) => acc + c.utxo.value, 0n);
    let dustBalance = state.dust.balance(new Date());

    log('info', 'wallet_synced', {
      address: unshieldedBech32,
      nightUtxoCount: nightUtxos.length,
      tNightRaw: totalNight.toString(),
      tDust: dustBalance.toString(),
    });

    if (totalNight === 0n) {
      throw new Error(`No tNIGHT in ${unshieldedBech32}. Fund via https://faucet.preview.midnight.network`);
    }

    const unregistered = nightUtxos.filter((c) => !c.meta.registeredForDustGeneration);
    if (unregistered.length > 0 && dustBalance === 0n) {
      log('info', 'dust_register_start', { unregisteredCount: unregistered.length });
      const regRecipe = await wallet.registerNightUtxosForDustGeneration(
        unregistered,
        keystore.getPublicKey(),
        (payload) => keystore.signDataAsync(payload),
      );
      const finalizedReg = await wallet.finalizeRecipe(regRecipe);
      const regTxId = await wallet.submitTransaction(finalizedReg);
      log('info', 'dust_register_submitted', { txId: regTxId });
    } else {
      log('info', 'dust_registration_check', {
        alreadyRegisteredCount: nightUtxos.length - unregistered.length,
        unregisteredCount: unregistered.length,
        tDust: dustBalance.toString(),
      });
    }

    for (let i = 0; i < DUST_POLL_MAX && dustBalance === 0n; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const latest = await wallet.waitForSyncedState();
      dustBalance = latest.dust.balance(new Date());
      log('info', 'dust_accrual_poll', { attempt: i + 1, tDust: dustBalance.toString() });
    }

    if (dustBalance === 0n) {
      throw new Error('tDUST balance is still 0 after polling; wait for DUST accrual and re-run.');
    }

    const accountId = state.shielded.coinPublicKey.toHexString();
    const zkConfigProvider = new NodeZkConfigProvider(ZK_CONFIG_PATH);
    const proofProvider = httpClientProofProvider(PROOF_SERVER, zkConfigProvider);
    const publicDataProvider = indexerPublicDataProvider(INDEXER_HTTP, INDEXER_WS);
    const privateStateProvider = levelPrivateStateProvider({
      accountId,
      privateStateStoreName: 'midnight-spike-state',
      privateStoragePasswordProvider: () => 'Spike-Local-Dev-2026!',
      midnightDbName: PRIVATE_STATE_DIR,
    });

    const walletProvider = createLedger9WalletProvider({
      balanceTx: async (tx, ttl) => {
        const handle = wallet.adoptTransaction(tx.serialize(), 'Unbound');
        const recipe = await wallet.balanceUnboundTransaction(handle, {
          ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000),
        });
        const signed = await wallet.signRecipe(recipe, (payload) => keystore.signDataAsync(payload));
        return wallet.finalizeRecipe(signed);
      },
      getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
      getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    });

    const midnightProvider = createLedger9MidnightProvider(async (tx) => {
      const handle = wallet.adoptTransaction(tx.serialize(), 'Finalized');
      return wallet.submitTransaction(handle);
    });

    const providers = {
      config: {
        networkId: NETWORK_ID,
        ttlSeconds: 1800,
      },
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    };

    const compiledContract = CompiledContract.make('counter', Counter.Contract).pipe(
      CompiledContract.withVacantWitnesses,
      CompiledContract.withCompiledFileAssets(ZK_CONFIG_PATH),
    );

    let contractAddress;
    let deployTxId = null;
    let contract;

    if (fs.existsSync(CONTRACT_STATE_FILE)) {
      const savedContract = JSON.parse(fs.readFileSync(CONTRACT_STATE_FILE, 'utf8'));
      if (savedContract?.contractAddress) {
        contractAddress = savedContract.contractAddress;
        deployTxId = savedContract.deployTxId ?? null;
        log('info', 'contract_attaching', { contractAddress });
        contract = await findDeployedContract(providers, {
          compiledContract,
          contractAddress,
        });
      }
    }

    if (!contract) {
      log('info', 'contract_deploy_start');
      const deployed = await withTimeout(
        deployContract(providers, { compiledContract }),
        5 * 60 * 1000,
        'deployContract',
      );
      contract = deployed;
      contractAddress = deployed.deployTxData.public.contractAddress;
      deployTxId = deployed.deployTxData.public.txId;
      fs.writeFileSync(
        CONTRACT_STATE_FILE,
        JSON.stringify({ networkId: NETWORK_ID, contractAddress, deployTxId, updatedAt: new Date().toISOString() }, null, 2),
      );
      log('info', 'contract_deployed', { contractAddress, deployTxId });
    }

    const readRound = async () => {
      const read = await publicDataProvider.queryContractState(contractAddress);
      if (!read) throw new Error(`Contract state not found at ${contractAddress}`);
      return Counter.ledger(read.contractState.deserialize({ v9: ContractState }).data).round;
    };

    const beforeRound = await readRound();
    log('info', 'contract_state_before_increment', { contractAddress, round: beforeRound.toString() });

    log('info', 'contract_increment_start', { contractAddress });
    const incTx = await withTimeout(contract.callTx.increment(), 5 * 60 * 1000, 'callTx.increment');
    const incrementTxId = incTx.public.txId;
    log('info', 'contract_increment_submitted', { contractAddress, incrementTxId });

    const afterRound = await readRound();
    log('info', 'contract_state_verified', {
      contractAddress,
      deployTxId,
      incrementTxId,
      roundBefore: beforeRound.toString(),
      roundAfter: afterRound.toString(),
    });

    if (afterRound <= beforeRound) {
      throw new Error(`Expected counter round to increment (${beforeRound} -> ${afterRound})`);
    }

    fs.writeFileSync(
      CONTRACT_STATE_FILE,
      JSON.stringify(
        {
          networkId: NETWORK_ID,
          contractAddress,
          deployTxId,
          incrementTxId,
          roundBefore: beforeRound.toString(),
          roundAfter: afterRound.toString(),
          verifiedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await saveWalletState(wallet).catch((err) => log('warn', 'wallet_state_save_failed', { error: err.message }));
    await wallet.stop();
  }
}

main().catch((err) => {
  const causes = [];
  let cur = err;
  while (cur) {
    causes.push(String(cur?.message ?? cur));
    cur = cur?.cause;
  }
  log('error', 'spike_failed', {
    message: err.message,
    causes,
    stack: err.stack,
  });
  process.exit(1);
});
