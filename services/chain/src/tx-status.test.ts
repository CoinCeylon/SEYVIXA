import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockfrostProvider, createChainProvider, getTxStatus, loadChainConfig, type ChainConfig } from "./index.ts";

const SECRET = "secret-project-id-for-tests-only";
const TX = "a".repeat(64);
const config: ChainConfig = {
  network: "preprod",
  baseUrl: "https://chain.test/api/v0",
  projectId: SECRET,
  confirmationDepth: 3,
  timeoutMs: 1000,
};

type Route = { status?: number; body?: unknown; throws?: boolean; rawText?: string };
// Stubs only the HTTP layer (the network). getTxStatus itself is the real code under test.
function stub(routes: { tx: Route; tip?: Route }, calls: { url: string; headers: unknown }[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers });
    const r = url.endsWith("/blocks/latest") ? (routes.tip ?? { status: 200, body: { height: 0 } }) : routes.tx;
    if (r.throws) throw new Error(`boom ${SECRET}`);
    const text = r.rawText ?? JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status ?? 200 });
  }) as typeof fetch;
}
const txBody = (h: number, valid = true) => ({ block_height: h, valid_contract: valid });
const run = (routes: Parameters<typeof stub>[0], id = TX) => getTxStatus(id, { config, fetch: stub(routes) });

test("confirmed only at depth >= 3: tip-height+1 of 2 is found, 3 and 4 are confirmed", async () => {
  const at = (tip: number) => run({ tx: { body: txBody(100) }, tip: { body: { height: tip } } });
  assert.deepEqual(await at(100), { status: "found", confirmations: 1, blockHeight: 100 });
  assert.deepEqual(await at(101), { status: "found", confirmations: 2, blockHeight: 100 });
  assert.deepEqual(await at(102), { status: "confirmed", confirmations: 3, blockHeight: 100 });
  assert.deepEqual(await at(110), { status: "confirmed", confirmations: 11, blockHeight: 100 });
});

test("depth comes from config", async () => {
  const strict = { ...config, confirmationDepth: 5 };
  const r = await getTxStatus(TX, { config: strict, fetch: stub({ tx: { body: txBody(100) }, tip: { body: { height: 102 } } }) });
  assert.equal(r.status, "found");
});

test("tip behind the transaction block never gives fewer than 1 confirmation or confirmed (even at depth 1)", async () => {
  const r = await run({ tx: { body: txBody(100) }, tip: { body: { height: 98 } } });
  assert.deepEqual(r, { status: "found", confirmations: 1, blockHeight: 100 });
  const rDepth1 = await getTxStatus(TX, {
    config: { ...config, confirmationDepth: 1 },
    fetch: stub({ tx: { body: txBody(100) }, tip: { body: { height: 98 } } }),
  });
  assert.deepEqual(rDepth1, { status: "found", confirmations: 1, blockHeight: 100 });
});

test("HTTP 404 for the transaction is not_found", async () => {
  assert.deepEqual(await run({ tx: { status: 404, body: { status_code: 404 } } }), { status: "not_found" });
});

test("API failures are error, never confirmed or not_found", async () => {
  const cases: [Parameters<typeof stub>[0], string][] = [
    [{ tx: { throws: true } }, "api_unreachable"],
    [{ tx: { status: 500 } }, "api_error"],
    [{ tx: { status: 403 } }, "api_error"],
    [{ tx: { status: 429 } }, "api_error"],
    [{ tx: { rawText: "not json" } }, "invalid_response"],
    [{ tx: { body: { block_height: "100", valid_contract: true } } }, "invalid_response"],
    [{ tx: { body: { valid_contract: true } } }, "invalid_response"],
    [{ tx: { body: { block_height: 100 } } }, "invalid_response"],
    [{ tx: { body: { block_height: -1, valid_contract: true } } }, "invalid_response"],
    [{ tx: { body: txBody(100) }, tip: { throws: true } }, "api_unreachable"],
    [{ tx: { body: txBody(100) }, tip: { status: 500 } }, "api_error"],
    [{ tx: { body: txBody(100) }, tip: { status: 404 } }, "api_error"],
    [{ tx: { body: txBody(100) }, tip: { body: { height: null } } }, "invalid_response"],
    [{ tx: { body: txBody(100) }, tip: { rawText: "<html>" } }, "invalid_response"],
  ];
  for (const [routes, reason] of cases) {
    assert.deepEqual(await run(routes), { status: "error", reason }, JSON.stringify(routes));
  }
});

test("valid_contract false is an error, not found or confirmed", async () => {
  const r = await run({ tx: { body: txBody(100, false) }, tip: { body: { height: 500 } } });
  assert.deepEqual(r, { status: "error", reason: "contract_validation_failed" });
});

test("invalid tx ids are rejected before any API call", async () => {
  const calls: { url: string; headers: unknown }[] = [];
  const f = stub({ tx: { body: txBody(1) } }, calls);
  for (const bad of ["", "abc", "A".repeat(64), "g".repeat(64), `${TX}/../x`, `${TX}?x=1`, "a".repeat(65)]) {
    assert.deepEqual(await getTxStatus(bad, { config, fetch: f }), { status: "error", reason: "invalid_tx_id" });
  }
  assert.equal(calls.length, 0);
});

test("sends the key only as a project_id header and never leaks it in results", async () => {
  const calls: { url: string; headers: unknown }[] = [];
  const f = stub({ tx: { body: txBody(100) }, tip: { body: { height: 102 } } }, calls);
  const ok = await getTxStatus(TX, { config, fetch: f });
  assert.equal(calls[0]?.url, `https://chain.test/api/v0/txs/${TX}`);
  assert.equal(calls[1]?.url, "https://chain.test/api/v0/blocks/latest");
  assert.deepEqual(calls[0]?.headers, { project_id: SECRET });
  assert.equal(JSON.stringify(ok).includes(SECRET), false);
  const failed = await getTxStatus(TX, { config, fetch: stub({ tx: { throws: true } }) });
  assert.equal(JSON.stringify(failed).includes(SECRET), false);
});

test("missing config gives error config_error (fail closed), not confirmed", async () => {
  const saved = { ...process.env };
  delete process.env.BLOCKFROST_PROJECT_ID;
  try {
    assert.deepEqual(await getTxStatus(TX, { fetch: stub({ tx: { body: txBody(1) } }) }), {
      status: "error",
      reason: "config_error",
    });
  } finally {
    process.env = saved;
  }
});

test("loadChainConfig: defaults, validation and no secret in errors", () => {
  const base = { CARDANO_NETWORK: "preprod", BLOCKFROST_PROJECT_ID: SECRET };
  const c = loadChainConfig(base);
  assert.equal(c.confirmationDepth, 3);
  assert.equal(c.baseUrl, "https://cardano-preprod.blockfrost.io/api/v0");
  assert.equal(loadChainConfig({ ...base, CONFIRMATION_DEPTH: "5" }).confirmationDepth, 5);
  const provider = createChainProvider(c);
  assert.ok(provider instanceof BlockfrostProvider);
  for (const bad of [
    { ...base, CARDANO_NETWORK: "mainnet" },
    { ...base, CARDANO_NETWORK: undefined },
    { ...base, BLOCKFROST_PROJECT_ID: "  " },
    { ...base, BLOCKFROST_PROJECT_ID: "fake-blockfrost-preprod-project-id-change-me" },
    { ...base, CONFIRMATION_DEPTH: "0" },
    { ...base, CONFIRMATION_DEPTH: "abc" },
  ]) {
    assert.throws(
      () => loadChainConfig(bad),
      (e: Error) => !e.message.includes(SECRET),
    );
  }
});

// Live test against Cardano Preprod. Skipped (and reported as skipped) unless a real project id and a
// known Preprod transaction id are in the local environment. Never uses fake values.
const liveId = process.env.BLOCKFROST_PROJECT_ID;
const knownTx = process.env.CHAIN_TEST_KNOWN_TX_ID;
const liveReady = Boolean(liveId && !liveId.startsWith("fake-") && knownTx && /^[0-9a-f]{64}$/.test(knownTx));
test("LIVE Preprod: known tx is found/confirmed, random hash is not_found", { skip: !liveReady && "no real BLOCKFROST_PROJECT_ID / CHAIN_TEST_KNOWN_TX_ID in env" }, async (t) => {
  const known = await getTxStatus(knownTx as string);
  // Evidence for the PR: tx ids are public; the result objects never contain the key.
  t.diagnostic(`known ${knownTx} -> ${JSON.stringify(known)}`);
  assert.ok(known.status === "found" || known.status === "confirmed", JSON.stringify(known));
  const randomTx = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const random = await getTxStatus(randomTx);
  t.diagnostic(`random ${randomTx} -> ${JSON.stringify(random)}`);
  assert.deepEqual(random, { status: "not_found" });
});
