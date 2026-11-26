// T7.2a & T7.2b — Unit tests for browser wallet helper (Blueprint Section 6.5; CIP-30; CIP-19).
// Uses mocked CIP-30 wallet objects (Lace and Eternl) and official CIP-19 testnet vectors.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { encodeCardanoTestnetAddress } from "./bech32.ts";
import {
  TESTNET_NETWORK_ID,
  WalletError,
  type CardanoWindowNamespace,
  type Cip30Api,
  type Cip30DataSignature,
  type Cip30WalletProvider,
  type SupportedWalletId,
} from "./types.ts";
import {
  _resetActiveWalletForTests,
  connectWallet,
  getAddress,
  signMessage,
  signTransaction,
} from "./wallet.ts";

// Official CIP-19 testnet test vectors (https://cips.cardano.org/cip/CIP-19)
const CIP19_TYPE00_TESTNET_HEX =
  "009493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251";
const CIP19_TYPE00_TESTNET_BECH32 =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";

const CIP19_TYPE01_SCRIPT_TESTNET_HEX =
  "10c37b1b5dc0669f1d3c61a6fddb2e8fde96be87b881c60bce8e8d542f337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251";
const CIP19_TYPE01_SCRIPT_TESTNET_BECH32 =
  "addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg";

const CIP19_TYPE06_ENTERPRISE_TESTNET_HEX =
  "609493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e";
const CIP19_TYPE06_ENTERPRISE_TESTNET_BECH32 =
  "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz";

const CIP19_TYPE00_MAINNET_HEX = `01${CIP19_TYPE00_TESTNET_HEX.slice(2)}`;
const CIP19_STAKE_TESTNET_HEX =
  "e0337b62cfff6403a06a3acbc34f8c46003c69fe79a3628cefa9c47251";

const MOCK_COSE_SIGNATURE: Cip30DataSignature = {
  signature: "845846a2012767616464726573735839009493315cd92eb5",
  key: "a4010103272006215820deadbeefcafebabe0123456789abcdef0123456789abcdef",
};
const MOCK_UNSIGNED_TX_CBOR_HEX = "84a40081825820deadbeef00018182581d60949331";
const MOCK_WITNESS_SET_CBOR_HEX = "a10081825820aabbccdd58401122334455667788";

interface MockApiOptions {
  networkId?: number;
  usedAddresses?: string[];
  unusedAddresses?: string[];
  changeAddress?: string;
  signData?: (addr: string, payload: string) => Promise<Cip30DataSignature>;
  signTx?: (tx: string, partialSign?: boolean) => Promise<string>;
}

function createMockApi(opts: MockApiOptions = {}): Cip30Api {
  return {
    getNetworkId: async () => opts.networkId ?? TESTNET_NETWORK_ID,
    getUsedAddresses: async () => opts.usedAddresses ?? [CIP19_TYPE00_TESTNET_HEX],
    getUnusedAddresses: async () => opts.unusedAddresses ?? [],
    getChangeAddress: async () => opts.changeAddress ?? CIP19_TYPE06_ENTERPRISE_TESTNET_HEX,
    signData: opts.signData ?? (async () => MOCK_COSE_SIGNATURE),
    signTx: opts.signTx ?? (async () => MOCK_WITNESS_SET_CBOR_HEX),
  };
}

function createMockProvider(
  name: string,
  api: Cip30Api,
  overrides: Partial<Cip30WalletProvider> = {},
): Cip30WalletProvider {
  return {
    name,
    icon: "data:image/svg+xml,<svg/>",
    apiVersion: "0.1.0",
    enable: async () => api,
    isEnabled: async () => true,
    ...overrides,
  };
}

describe("encodeCardanoTestnetAddress (CIP-19 / BIP-173)", () => {
  it("encodes official CIP-19 Type 00 base testnet address", () => {
    assert.equal(
      encodeCardanoTestnetAddress(CIP19_TYPE00_TESTNET_HEX),
      CIP19_TYPE00_TESTNET_BECH32,
    );
  });

  it("encodes official CIP-19 Type 01 script payment testnet address without rejecting it (server validates in T2.2)", () => {
    assert.equal(
      encodeCardanoTestnetAddress(CIP19_TYPE01_SCRIPT_TESTNET_HEX),
      CIP19_TYPE01_SCRIPT_TESTNET_BECH32,
    );
  });

  it("encodes official CIP-19 Type 06 enterprise testnet address", () => {
    assert.equal(
      encodeCardanoTestnetAddress(CIP19_TYPE06_ENTERPRISE_TESTNET_HEX),
      CIP19_TYPE06_ENTERPRISE_TESTNET_BECH32,
    );
  });

  it("rejects mainnet address bytes (network tag 1)", () => {
    assert.throws(
      () => encodeCardanoTestnetAddress(CIP19_TYPE00_MAINNET_HEX),
      (err: unknown) => err instanceof WalletError && err.code === "NETWORK_NOT_TESTNET",
    );
  });

  it("rejects non-payment stake address bytes (type 14)", () => {
    assert.throws(
      () => encodeCardanoTestnetAddress(CIP19_STAKE_TESTNET_HEX),
      (err: unknown) => err instanceof WalletError && err.code === "INVALID_ADDRESS",
    );
  });

  it("rejects malformed hex strings", () => {
    for (const bad of ["", "abc", "zzzz", "addr_test1nothex"]) {
      assert.throws(
        () => encodeCardanoTestnetAddress(bad),
        (err: unknown) => err instanceof WalletError && err.code === "INVALID_ADDRESS",
      );
    }
  });
});

describe("T7.2a — connectWallet and getAddress (CIP-30)", () => {
  beforeEach(() => {
    _resetActiveWalletForTests();
  });

  it("connects to Lace on testnet and reads the first used address as Bech32", async () => {
    const api = createMockApi({ usedAddresses: [CIP19_TYPE00_TESTNET_HEX] });
    const cardano: CardanoWindowNamespace = {
      lace: createMockProvider("Lace", api),
    };

    const handle = await connectWallet("lace", { cardano });
    assert.equal(handle.walletId, "lace");
    assert.equal(handle.walletName, "Lace");
    assert.equal(handle.networkId, 0);

    assert.equal(await getAddress(handle), CIP19_TYPE00_TESTNET_BECH32);
    assert.equal(await getAddress(), CIP19_TYPE00_TESTNET_BECH32);
  });

  it("connects to Eternl when auto-detecting and Lace is absent", async () => {
    const api = createMockApi({ usedAddresses: [CIP19_TYPE06_ENTERPRISE_TESTNET_HEX] });
    const cardano: CardanoWindowNamespace = {
      eternl: createMockProvider("Eternl", api),
    };

    const handle = await connectWallet(undefined, { cardano });
    assert.equal(handle.walletId, "eternl");
    assert.equal(await getAddress(handle), CIP19_TYPE06_ENTERPRISE_TESTNET_BECH32);
  });

  it("falls back from usedAddresses -> unusedAddresses -> changeAddress", async () => {
    const unusedApi = createMockApi({
      usedAddresses: [],
      unusedAddresses: [CIP19_TYPE00_TESTNET_HEX],
      changeAddress: CIP19_TYPE06_ENTERPRISE_TESTNET_HEX,
    });
    const unusedHandle = await connectWallet("lace", {
      cardano: { lace: createMockProvider("Lace", unusedApi) },
    });
    assert.equal(await getAddress(unusedHandle), CIP19_TYPE00_TESTNET_BECH32);

    const changeApi = createMockApi({
      usedAddresses: [],
      unusedAddresses: [],
      changeAddress: CIP19_TYPE06_ENTERPRISE_TESTNET_HEX,
    });
    const changeHandle = await connectWallet("eternl", {
      cardano: { eternl: createMockProvider("Eternl", changeApi) },
    });
    assert.equal(await getAddress(changeHandle), CIP19_TYPE06_ENTERPRISE_TESTNET_BECH32);
  });

  it("rejects Mainnet (networkId 1) on connectWallet and on network switch", async () => {
    const mainnetApi = createMockApi({ networkId: 1 });
    await assert.rejects(
      () => connectWallet("lace", { cardano: { lace: createMockProvider("Lace", mainnetApi) } }),
      (err: unknown) => err instanceof WalletError && err.code === "NETWORK_NOT_TESTNET",
    );

    let currentNetworkId = 0;
    const switchApi = createMockApi();
    switchApi.getNetworkId = async () => currentNetworkId;

    const handle = await connectWallet("lace", {
      cardano: { lace: createMockProvider("Lace", switchApi) },
    });
    currentNetworkId = 1;

    await assert.rejects(
      () => getAddress(handle),
      (err: unknown) => err instanceof WalletError && err.code === "NETWORK_NOT_TESTNET",
    );
  });

  it("fails closed on user rejection, unsupported/missing wallet, non-browser env, not connected, or empty addresses", async () => {
    const api = createMockApi();
    await assert.rejects(
      () =>
        connectWallet("lace", {
          cardano: {
            lace: createMockProvider("Lace", api, {
              enable: async () => {
                throw new Error("User declined");
              },
            }),
          },
        }),
      (err: unknown) => err instanceof WalletError && err.code === "CONNECTION_REJECTED",
    );

    await assert.rejects(
      () => connectWallet("nami" as SupportedWalletId, { cardano: {} }),
      (err: unknown) => err instanceof WalletError && err.code === "UNSUPPORTED_WALLET",
    );

    await assert.rejects(
      () => connectWallet("lace", { cardano: {} }),
      (err: unknown) => err instanceof WalletError && err.code === "WALLET_NOT_INSTALLED",
    );

    await assert.rejects(
      () => connectWallet(),
      (err: unknown) => err instanceof WalletError && err.code === "BROWSER_UNAVAILABLE",
    );

    await assert.rejects(
      () => getAddress(),
      (err: unknown) => err instanceof WalletError && err.code === "NOT_CONNECTED",
    );

    const emptyHandle = await connectWallet("eternl", {
      cardano: {
        eternl: createMockProvider(
          "Eternl",
          createMockApi({ usedAddresses: [], unusedAddresses: [], changeAddress: "" }),
        ),
      },
    });
    await assert.rejects(
      () => getAddress(emptyHandle),
      (err: unknown) => err instanceof WalletError && err.code === "NO_ADDRESS_AVAILABLE",
    );
  });
});

describe("T7.2b — signMessage (CIP-30 signData)", () => {
  beforeEach(() => {
    _resetActiveWalletForTests();
  });

  it("encodes UTF-8 payload to hex, calls signData, and returns COSE_Sign1 + COSE_Key verbatim", async () => {
    const calls: Array<{ addr: string; payload: string }> = [];
    let signTxCalled = false;

    const api = createMockApi({
      signData: async (addr, payload) => {
        calls.push({ addr, payload });
        return MOCK_COSE_SIGNATURE;
      },
      signTx: async () => {
        signTxCalled = true;
        return MOCK_WITNESS_SET_CBOR_HEX;
      },
    });

    await connectWallet("lace", { cardano: { lace: createMockProvider("Lace", api) } });

    const result = await signMessage(CIP19_TYPE00_TESTNET_BECH32, "seyvixa-register-v1");
    assert.deepEqual(result, MOCK_COSE_SIGNATURE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].addr, CIP19_TYPE00_TESTNET_BECH32);
    assert.equal(calls[0].payload, Buffer.from("seyvixa-register-v1", "utf8").toString("hex"));
    assert.equal(signTxCalled, false);
  });

  it("accepts Uint8Array payloads and CIP-30 hex testnet addresses", async () => {
    const calls: Array<{ addr: string; payload: string }> = [];
    const api = createMockApi({
      signData: async (addr, payload) => {
        calls.push({ addr, payload });
        return MOCK_COSE_SIGNATURE;
      },
    });

    const handle = await connectWallet("eternl", {
      cardano: { eternl: createMockProvider("Eternl", api) },
    });

    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const result = await signMessage(CIP19_TYPE00_TESTNET_HEX, bytes, { handle });
    assert.deepEqual(result, MOCK_COSE_SIGNATURE);
    assert.equal(calls[0].addr, CIP19_TYPE00_TESTNET_HEX);
    assert.equal(calls[0].payload, "deadbeef");
  });

  it("fails closed on Mainnet address, network switch to Mainnet, empty payload, or rejection", async () => {
    let currentNetworkId = 0;
    const api = createMockApi({
      signData: async () => {
        throw new Error("User rejected signData");
      },
    });
    api.getNetworkId = async () => currentNetworkId;

    const handle = await connectWallet("lace", {
      cardano: { lace: createMockProvider("Lace", api) },
    });

    await assert.rejects(
      () => signMessage("addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x", "hello", { handle }),
      (err: unknown) => err instanceof WalletError && err.code === "NETWORK_NOT_TESTNET",
    );

    await assert.rejects(
      () => signMessage(CIP19_TYPE00_MAINNET_HEX, "hello", { handle }),
      (err: unknown) => err instanceof WalletError && err.code === "NETWORK_NOT_TESTNET",
    );

    await assert.rejects(
      () => signMessage(CIP19_TYPE00_TESTNET_BECH32, "", { handle }),
      (err: unknown) => err instanceof WalletError && err.code === "INVALID_PAYLOAD",
    );

    await assert.rejects(
      () => signMessage(CIP19_TYPE00_TESTNET_BECH32, "hello", { handle }),
      (err: unknown) => err instanceof WalletError && err.code === "SIGNING_REJECTED",
    );

    currentNetworkId = 1;
    await assert.rejects(
      () => signMessage(CIP19_TYPE00_TESTNET_BECH32, "hello", { handle }),
      (err: unknown) => err instanceof WalletError && err.code === "NETWORK_NOT_TESTNET",
    );
  });

  it("fails closed if wallet returns a malformed DataSignature", async () => {
    const api = createMockApi({
      signData: async () => ({ signature: "", key: "" }),
    });
    const handle = await connectWallet("lace", {
      cardano: { lace: createMockProvider("Lace", api) },
    });

    await assert.rejects(
      () => signMessage(CIP19_TYPE00_TESTNET_BECH32, "test", { handle }),
      (err: unknown) => err instanceof WalletError && err.code === "INVALID_SIGNATURE_RESPONSE",
    );
  });
});

describe("T7.2b — signTransaction (CIP-30 signTx, never submits)", () => {
  beforeEach(() => {
    _resetActiveWalletForTests();
  });

  it("calls signTx with partialSign=false by default, returns witness set hex, and never submits", async () => {
    const calls: Array<{ tx: string; partialSign: boolean | undefined }> = [];
    let signDataCalled = false;
    let submitCalled = false;

    const apiWithSubmitSpy = Object.assign(
      createMockApi({
        signData: async () => {
          signDataCalled = true;
          return MOCK_COSE_SIGNATURE;
        },
        signTx: async (tx, partialSign) => {
          calls.push({ tx, partialSign });
          return MOCK_WITNESS_SET_CBOR_HEX;
        },
      }),
      {
        // Present only as a spy to prove the helper never invokes any submit method.
        submitTx: async () => {
          submitCalled = true;
          return "should-never-be-called";
        },
      },
    );

    await connectWallet("lace", {
      cardano: { lace: createMockProvider("Lace", apiWithSubmitSpy) },
    });

    const witness = await signTransaction(MOCK_UNSIGNED_TX_CBOR_HEX);
    assert.equal(witness, MOCK_WITNESS_SET_CBOR_HEX);
    assert.deepEqual(calls, [{ tx: MOCK_UNSIGNED_TX_CBOR_HEX, partialSign: false }]);
    assert.equal(signDataCalled, false);
    assert.equal(submitCalled, false);

    const partialWitness = await signTransaction(MOCK_UNSIGNED_TX_CBOR_HEX, { partialSign: true });
    assert.equal(partialWitness, MOCK_WITNESS_SET_CBOR_HEX);
    assert.deepEqual(calls[1], { tx: MOCK_UNSIGNED_TX_CBOR_HEX, partialSign: true });
    assert.equal(submitCalled, false);
  });

  it("fails closed on invalid hex tx, not connected, network switch to Mainnet, rejection, or invalid witness", async () => {
    await assert.rejects(
      () => signTransaction(MOCK_UNSIGNED_TX_CBOR_HEX),
      (err: unknown) => err instanceof WalletError && err.code === "NOT_CONNECTED",
    );

    let currentNetworkId = 0;
    const api = createMockApi({
      signTx: async () => {
        throw new Error("User declined tx");
      },
    });
    api.getNetworkId = async () => currentNetworkId;

    const handle = await connectWallet("eternl", {
      cardano: { eternl: createMockProvider("Eternl", api) },
    });

    for (const badTx of ["", "abc", "not-hex-cbor"]) {
      await assert.rejects(
        () => signTransaction(badTx, { handle }),
        (err: unknown) => err instanceof WalletError && err.code === "INVALID_TX",
      );
    }

    await assert.rejects(
      () => signTransaction(MOCK_UNSIGNED_TX_CBOR_HEX, { handle }),
      (err: unknown) => err instanceof WalletError && err.code === "SIGNING_REJECTED",
    );

    currentNetworkId = 1;
    await assert.rejects(
      () => signTransaction(MOCK_UNSIGNED_TX_CBOR_HEX, { handle }),
      (err: unknown) => err instanceof WalletError && err.code === "NETWORK_NOT_TESTNET",
    );

    const badWitnessHandle = await connectWallet("lace", {
      cardano: {
        lace: createMockProvider(
          "Lace",
          createMockApi({ signTx: async () => "not-valid-hex" }),
        ),
      },
    });
    await assert.rejects(
      () => signTransaction(MOCK_UNSIGNED_TX_CBOR_HEX, { handle: badWitnessHandle }),
      (err: unknown) => err instanceof WalletError && err.code === "INVALID_SIGNATURE_RESPONSE",
    );
  });
});
