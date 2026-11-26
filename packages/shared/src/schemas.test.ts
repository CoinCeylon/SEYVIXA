import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ZodType } from "zod";
import {
  ACTION_STATUSES,
  AGENT_STATUSES,
  agentStatusSchema,
  ACTION_TYPES,
  REASON_CODES,
  actionHash,
  actionPayloadSchema,
  actionSchema,
  agentGrantSchema,
  agentSchema,
  approvalSchema,
  budgetReservationSchema,
  chainTransactionSchema,
  challengeSchema,
  gatewayRequestSchema,
  gatewayResponseSchema,
  policyEventSchema,
  procurementSchema,
  receiptSchema,
  supplierQuoteSchema,
  supplierSchema,
  userSchema,
} from "./index.ts";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);
const TS = "2026-11-25T10:00:00Z";

// For each schema: one valid fixture, and one invalid fixture (a single field broken).
const cases: [string, ZodType, Record<string, unknown>, Record<string, unknown>][] = [
  [
    "users",
    userSchema,
    { id: ID1, name: "Demo owner", role: "owner", owner_address: null, payment_pubkey: null, payment_key_hash: null },
    { id: "nope", name: "Demo owner", role: "owner", owner_address: null, payment_pubkey: null, payment_key_hash: null },
  ],
  ["suppliers", supplierSchema, { id: ID1, name: "Supplier A" }, { id: ID1, name: "" }],
  [
    "agents",
    agentSchema,
    { id: ID1, name: "Procurement Agent", status: "ACTIVE", credential_hash: HASH },
    { id: ID1, name: "Procurement Agent", status: "ACTIVE", credential_hash: HASH, token: "secret" },
  ],
  [
    "agent_grants",
    agentGrantSchema,
    { id: ID1, agent_id: ID2, owner_id: ID3, scopes: ["QUOTE_READ"], spend_limit: "120000.00", expires_at: TS, revoked_at: null, issuer: "gateway", integrity_tag: HASH },
    { id: ID1, agent_id: ID2, owner_id: ID3, scopes: ["QUOTE_READ"], spend_limit: "-5", expires_at: TS, revoked_at: null, issuer: "gateway", integrity_tag: HASH },
  ],
  [
    "procurements",
    procurementSchema,
    { id: ID1, owner_id: ID2, description: "Office chairs", budget: "120000", status: "open" },
    { id: ID1, owner_id: ID2, description: "Office chairs", budget: 120000, status: "open" },
  ],
  [
    "supplier_quotes",
    supplierQuoteSchema,
    { id: ID1, procurement_id: ID2, supplier_id: ID3, amount: "70000.50", quote_data: { note: "text" } },
    { id: ID1, procurement_id: ID2, supplier_id: ID3, amount: "70000.505", quote_data: { note: "text" } },
  ],
  [
    "budget_reservations",
    budgetReservationSchema,
    { id: ID1, procurement_id: ID2, agent_id: ID3, amount: "70000", status: "RESERVED", idempotency_key: "k1" },
    { id: ID1, procurement_id: ID2, agent_id: ID3, amount: "70000", status: "HELD", idempotency_key: "k1" },
  ],
  [
    "approvals",
    approvalSchema,
    { id: ID1, action_hash: HASH, approver_id: ID2, expires_at: TS, used_at: null, nonce: "n1", signature: "sig" },
    { id: ID1, action_hash: "ABC", approver_id: ID2, expires_at: TS, used_at: null, nonce: "n1", signature: "sig" },
  ],
  [
    "policy_events",
    policyEventSchema,
    { id: ID1, agent_id: ID2, action: "FILE_READ", decision: "DENY", reason_code: "RESOURCE_OUT_OF_SCOPE", created_at: TS, procurement_id: null, action_id: null, resource: "payroll.csv" },
    { id: ID1, agent_id: ID2, action: "FILE_READ", decision: "DENY", reason_code: "MADE_UP_CODE", created_at: TS, procurement_id: null, action_id: null, resource: "payroll.csv" },
  ],
  [
    "actions",
    actionSchema,
    { id: ID1, procurement_id: ID2, owner_id: ID3, action_type: "ESCROW_LOCK", canonical_payload: "{}", action_hash: HASH, commitment_salt: null, status: "PENDING_APPROVAL", ticket_nonce: null, ticket_expires_at: null, idempotency_key: null, external_ref: null, last_error: null, updated_at: TS, reservation_id: null, policy_version: "1" },
    { id: ID1, procurement_id: ID2, owner_id: ID3, action_type: "BUDGET_RESERVE", canonical_payload: "{}", action_hash: HASH, commitment_salt: null, status: "PENDING_APPROVAL", ticket_nonce: null, ticket_expires_at: null, idempotency_key: null, external_ref: null, last_error: null, updated_at: TS, reservation_id: null, policy_version: "1" },
  ],
  [
    "challenges",
    challengeSchema,
    { id: ID1, purpose: "wallet_registration", owner_id: ID2, procurement_id: null, supplier_id: null, nonce: "n", expires_at: TS, used_at: null },
    { id: ID1, purpose: "login", owner_id: ID2, procurement_id: null, supplier_id: null, nonce: "n", expires_at: TS, used_at: null },
  ],
  [
    "chain_transactions",
    chainTransactionSchema,
    { id: ID1, chain: "cardano", network: "preview", kind: "escrow_lock", tx_hash: "ab12", escrow_utxo_ref: null, action_commitment: null, status: "submitted" },
    { id: ID1, chain: "cardano", network: "preview", kind: "escrow_lock", tx_hash: "", escrow_utxo_ref: null, action_commitment: null, status: "submitted" },
  ],
  [
    "receipts",
    receiptSchema,
    { id: ID1, view: "full", payload: "{}", signature: "sig", key_id: "k1", created_at: TS, procurement_id: ID2 },
    { id: ID1, view: "full", payload: "{}", signature: "sig", key_id: "k1", created_at: "yesterday", procurement_id: ID2 },
  ],
];

for (const [name, schema, valid, invalid] of cases) {
  test(`${name}: valid fixture passes, invalid fixture fails`, () => {
    assert.equal(schema.safeParse(valid).success, true);
    assert.equal(schema.safeParse(invalid).success, false);
  });
}

// Pin every table schema to the migration: same table list, same column names.
test("each schema has exactly the columns of its table in 0001_init.sql", () => {
  const sql = readFileSync(new URL("../../../apps/api/migrations/0001_init.sql", import.meta.url), "utf8");
  const tables = new Map<string, string[]>();
  for (const m of sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
    const cols = [...m[2]!.matchAll(/^ {2}([a-z_]+)\s+(?:uuid|text|numeric|timestamptz|jsonb)/gm)].map((c) => c[1]!);
    tables.set(m[1]!, cols);
  }
  assert.equal(cases.length, 13);
  assert.equal(tables.size, 13);
  for (const [name, schema] of cases) {
    const shape = (schema as unknown as { shape: Record<string, unknown> }).shape;
    assert.deepEqual(Object.keys(shape).sort(), [...tables.get(name)!].sort(), name);
  }
});

test("LKR amounts: zero and leading zeros are not valid reservation amounts", () => {
  const base = { id: ID1, procurement_id: ID2, agent_id: ID3, status: "RESERVED", idempotency_key: "k" };
  assert.equal(budgetReservationSchema.safeParse({ ...base, amount: "0" }).success, false);
  assert.equal(budgetReservationSchema.safeParse({ ...base, amount: "0.00" }).success, false);
  assert.equal(budgetReservationSchema.safeParse({ ...base, amount: "00" }).success, false);
  assert.equal(budgetReservationSchema.safeParse({ ...base, amount: "0.01" }).success, true);
});

test("reason codes are exactly the D4 list, 22 codes, no extras", () => {
  assert.deepEqual([...REASON_CODES].sort(), [
    "ACTION_NOT_EXECUTABLE", "AGENT_INACTIVE", "APPROVAL_EXPIRED", "APPROVAL_INVALID", "APPROVAL_USED",
    "BUDGET_EXCEEDED", "GRANT_EXPIRED", "GRANT_INTEGRITY_FAILED", "GRANT_MISSING", "GRANT_REVOKED",
    "INTERNAL_ERROR", "OWNER_MISMATCH", "PAYLOAD_HASH_MISMATCH", "POLICY_VERSION_STALE",
    "RESERVATION_MISSING", "RESOURCE_OUT_OF_SCOPE", "SPEND_LIMIT_EXCEEDED", "TICKET_EXPIRED",
    "TICKET_INVALID", "TICKET_USED", "TOOL_OUT_OF_SCOPE", "TX_MISMATCH",
  ]);
  assert.equal(REASON_CODES.length, 22);
});

test("action types are exactly the D17 list; BUDGET_RESERVE is not one", () => {
  assert.deepEqual([...ACTION_TYPES], [
    "SUPPLIER_SEARCH", "QUOTE_READ", "FILE_READ", "PROPOSE_PURCHASE", "ESCROW_LOCK", "ESCROW_RELEASE", "ESCROW_REFUND",
  ]);
  assert.ok(!(ACTION_TYPES as readonly string[]).includes("BUDGET_RESERVE"));
});

test("action statuses include PENDING_APPROVAL (D15)", () => {
  assert.deepEqual([...ACTION_STATUSES], ["PENDING_APPROVAL", "APPROVED", "EXECUTING", "SUCCEEDED", "FAILED", "UNKNOWN"]);
});

test("agent statuses are exactly ACTIVE and SUSPENDED (D31)", () => {
  assert.deepEqual([...AGENT_STATUSES], ["ACTIVE", "SUSPENDED"]);
  assert.equal(agentStatusSchema.safeParse("active").success, false);
  assert.equal(agentStatusSchema.safeParse("SUSPENDED").success, true);
});


const payload = {
  procurement_id: ID1,
  owner_id: ID2,
  supplier_id: ID3,
  payee_address: "addr_test1example",
  items: [{ description: "Office chair", quantity: 10 }],
  total_lkr: "70000.00",
  settlement_asset: "tADA",
  escrow_amount_tada: "10.000000",
  escrow_script_address: "addr_test1script",
  refund_deadline: "2026-12-10T00:00:00Z",
  expiry: "2026-11-30T00:00:00Z",
  nonce: "abc123",
};

test("action payload: valid passes; conversion, hash and unknown fields are rejected", () => {
  assert.equal(actionPayloadSchema.safeParse(payload).success, true);
  assert.equal(actionPayloadSchema.safeParse({ ...payload, lkr_to_ada_rate: "0.01" }).success, false);
  assert.equal(actionPayloadSchema.safeParse({ ...payload, action_hash: HASH }).success, false);
  assert.equal(actionPayloadSchema.safeParse({ ...payload, settlement_asset: "ADA" }).success, false);
  assert.equal(actionPayloadSchema.safeParse({ ...payload, total_lkr: 70000 }).success, false);
  assert.equal(actionPayloadSchema.safeParse({ ...payload, items: [] }).success, false);
  // One string form per hashed value: zero, leading zeros, wrong decimals and offsets are refused.
  for (const bad of [
    { total_lkr: "70000" },
    { total_lkr: "0.00" },
    { escrow_amount_tada: "10" },
    { escrow_amount_tada: "0.000000" },
    { escrow_amount_tada: "010.000000" },
    { expiry: "2026-11-30T05:30:00+05:30" },
  ]) {
    assert.equal(actionPayloadSchema.safeParse({ ...payload, ...bad }).success, false, JSON.stringify(bad));
  }
});

test("a valid action payload hashes the same whatever the key order", () => {
  const reversed = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(actionHash(payload), actionHash(reversed));
});

test("gateway request: valid passes; hash, ticket, ids and nonce are rejected at top level and as top-level parameters keys", () => {
  const req = { tool: "FILE_READ", resource: "payroll.csv", parameters: { path: "payroll.csv" } };
  assert.equal(gatewayRequestSchema.safeParse(req).success, true);
  assert.equal(gatewayRequestSchema.safeParse({ ...req, action_hash: HASH }).success, false);
  assert.equal(gatewayRequestSchema.safeParse({ ...req, ticket: "t" }).success, false);
  assert.equal(gatewayRequestSchema.safeParse({ ...req, owner_id: ID1 }).success, false);
  assert.equal(gatewayRequestSchema.safeParse({ ...req, agent_id: ID1 }).success, false);
  assert.equal(gatewayRequestSchema.safeParse({ ...req, tool: "BUDGET_RESERVE" }).success, false);
  // The same keys are refused as top-level keys of parameters, in any letter case.
  assert.equal(gatewayRequestSchema.safeParse({ ...req, parameters: { Agent_Id: "x" } }).success, false);
  for (const key of ["agent_id", "owner_id", "action_hash", "ticket", "nonce", "expiry"]) {
    const nested = { ...req, parameters: { [key]: "x" } };
    assert.equal(gatewayRequestSchema.safeParse(nested).success, false, key);
  }
});

test("policy event reason_code (D36): DENY needs a D4 code; ALLOW and APPROVAL_REQUIRED store the decision name", () => {
  const base = { id: ID1, agent_id: ID2, action: "FILE_READ", created_at: TS, procurement_id: null, action_id: null, resource: "quotes/a" };
  const ok = (e: object) => policyEventSchema.safeParse({ ...base, ...e }).success;
  assert.equal(ok({ decision: "DENY", reason_code: "RESOURCE_OUT_OF_SCOPE" }), true);
  assert.equal(ok({ decision: "ALLOW", reason_code: "ALLOW" }), true);
  assert.equal(ok({ decision: "APPROVAL_REQUIRED", reason_code: "APPROVAL_REQUIRED" }), true);
  assert.equal(ok({ decision: "DENY", reason_code: "ALLOW" }), false, "a DENY cannot carry a success value");
  assert.equal(ok({ decision: "DENY", reason_code: "APPROVAL_REQUIRED" }), false);
  assert.equal(ok({ decision: "ALLOW", reason_code: "RESOURCE_OUT_OF_SCOPE" }), false);
  assert.equal(ok({ decision: "ALLOW", reason_code: "APPROVAL_REQUIRED" }), false);
  assert.equal(ok({ decision: "APPROVAL_REQUIRED", reason_code: "ALLOW" }), false);
  assert.equal(ok({ decision: "ALLOW", reason_code: "MADE_UP" }), false);
});

test("gateway response: the three decisions parse; a DENY needs a D4 reason code", () => {
  const deny = {
    decision: "DENY",
    reason_code: "RESOURCE_OUT_OF_SCOPE",
    agent_id: "procurement-agent",
    requested_resource: "payroll.csv",
    message: "The agent is not authorised to access this resource.",
  };
  assert.equal(gatewayResponseSchema.safeParse(deny).success, true);
  assert.equal(gatewayResponseSchema.safeParse({ ...deny, reason_code: "NOPE" }).success, false);
  assert.equal(
    gatewayResponseSchema.safeParse({ decision: "ALLOW", action_id: ID1, action_hash: HASH, ticket: "t", ticket_expires_at: TS }).success,
    true,
  );
  assert.equal(
    gatewayResponseSchema.safeParse({ decision: "APPROVAL_REQUIRED", action_id: ID1, action_hash: HASH, message: "Owner approval needed" }).success,
    true,
  );
  assert.equal(gatewayResponseSchema.safeParse({ decision: "ALLOW", action_id: ID1 }).success, false);
});
