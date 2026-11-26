import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { canonicalize } from "./canonical.ts";
import { computeGrantIntegrityTag, type GrantWithoutTag } from "./grant-integrity.ts";

const KEY = "test-key-not-a-real-secret";
const base = (): GrantWithoutTag => ({
  id: "30000000-0000-4000-8000-000000000001",
  agent_id: "20000000-0000-4000-8000-000000000001",
  owner_id: "10000000-0000-4000-8000-000000000001",
  scopes: ["supplier:search", "quote:read", "resource:quotes/*"],
  spend_limit: "120000.00",
  expires_at: "2026-12-31T23:59:59.000Z",
  revoked_at: null,
  issuer: "seyvixa-seed",
});

test("the tag is lowercase hex HMAC-SHA256 of the canonical JSON (fixed expected value)", () => {
  const expected = createHmac("sha256", KEY).update(canonicalize(base())).digest("hex");
  assert.equal(computeGrantIntegrityTag(base(), KEY), expected);
  assert.match(expected, /^[0-9a-f]{64}$/);
});

test("the same grant always gives the same tag", () => {
  assert.equal(computeGrantIntegrityTag(base(), KEY), computeGrantIntegrityTag(base(), KEY));
});

test("a different key gives a different tag", () => {
  assert.notEqual(computeGrantIntegrityTag(base(), KEY), computeGrantIntegrityTag(base(), KEY + "x"));
});

test("changing any one field changes the tag", () => {
  const original = computeGrantIntegrityTag(base(), KEY);
  const changes: Partial<GrantWithoutTag>[] = [
    { id: "30000000-0000-4000-8000-000000000009" },
    { agent_id: "20000000-0000-4000-8000-000000000009" },
    { owner_id: "10000000-0000-4000-8000-000000000009" },
    { scopes: ["supplier:search", "quote:read"] },
    { scopes: ["supplier:search", "quote:read", "resource:quotes/*", "file:read"] },
    { scopes: ["quote:read", "supplier:search", "resource:quotes/*"] }, // order is part of the grant
    { spend_limit: "120000.01" },
    { expires_at: "2027-01-01T00:00:00.000Z" },
    { revoked_at: "2026-11-26T10:00:00.000Z" },
    { issuer: "someone-else" },
  ];
  for (const change of changes) {
    assert.notEqual(computeGrantIntegrityTag({ ...base(), ...change }, KEY), original, JSON.stringify(change));
  }
});

test("equal values in different forms give one tag (Date vs string, offset, amount decimals, id case)", () => {
  const original = computeGrantIntegrityTag(base(), KEY);
  assert.equal(computeGrantIntegrityTag({ ...base(), expires_at: new Date("2026-12-31T23:59:59Z") }, KEY), original);
  assert.equal(computeGrantIntegrityTag({ ...base(), expires_at: "2027-01-01T05:29:59+05:30" }, KEY), original);
  assert.equal(computeGrantIntegrityTag({ ...base(), expires_at: "2026-12-31T23:59:59Z" }, KEY), original);
  assert.equal(computeGrantIntegrityTag({ ...base(), spend_limit: "120000" }, KEY), original);
  assert.equal(computeGrantIntegrityTag({ ...base(), spend_limit: "120000.0" }, KEY), original);
  assert.equal(computeGrantIntegrityTag({ ...base(), id: base().id.toUpperCase() }, KEY), original);
});

test("revoked_at as a Date and as a string give one tag", () => {
  const a = computeGrantIntegrityTag({ ...base(), revoked_at: new Date("2026-11-26T10:00:00Z") }, KEY);
  const b = computeGrantIntegrityTag({ ...base(), revoked_at: "2026-11-26T10:00:00.000Z" }, KEY);
  assert.equal(a, b);
});

test("a missing, extra or malformed field is an error", () => {
  const { issuer: _issuer, ...missing } = base();
  assert.throws(() => computeGrantIntegrityTag(missing as GrantWithoutTag, KEY));
  assert.throws(() => computeGrantIntegrityTag({ ...base(), integrity_tag: "x" } as GrantWithoutTag, KEY));
  assert.throws(() => computeGrantIntegrityTag({ ...base(), extra: 1 } as GrantWithoutTag, KEY));
  assert.throws(() => computeGrantIntegrityTag({ ...base(), spend_limit: "12e3" }, KEY));
  assert.throws(() => computeGrantIntegrityTag({ ...base(), spend_limit: "1.005" }, KEY));
  assert.throws(() => computeGrantIntegrityTag({ ...base(), expires_at: "not a date" }, KEY));
  assert.throws(() => computeGrantIntegrityTag({ ...base(), expires_at: new Date("x") }, KEY));
  assert.throws(() => computeGrantIntegrityTag({ ...base(), scopes: "supplier:search" as never }, KEY));
});

test("an empty or missing key is an error", () => {
  assert.throws(() => computeGrantIntegrityTag(base(), ""));
  assert.throws(() => computeGrantIntegrityTag(base(), undefined as never));
});

test("known answer: this exact tag must never change, the seed depends on it", () => {
  // If this fails, the canonical form or the field normalisation changed. Do not just update the value:
  // every stored tag would stop verifying (and the seed would need to be re-run).
  assert.equal(
    computeGrantIntegrityTag(base(), KEY),
    "feca1474a435375dad19efd98e2eed1f11cb069f396a205284641e8d5a8b0df9",
  );
});
