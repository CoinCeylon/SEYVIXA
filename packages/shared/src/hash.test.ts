import { test } from "node:test";
import assert from "node:assert/strict";
import { actionHash, canonicalize, sha256Hex } from "./index.ts";

// Expected values below were produced with the sha256sum tool, not with this code.
test("sha256Hex matches known SHA-256 vectors, lowercase hex", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.match(sha256Hex("abc"), /^[0-9a-f]{64}$/);
});

test("sha256Hex gives the same result for a string and its UTF-8 bytes", () => {
  const text = "é€😀";
  assert.equal(sha256Hex(text), sha256Hex(new TextEncoder().encode(text)));
  assert.equal(sha256Hex(new TextEncoder().encode("abc")), sha256Hex("abc"));
});

test("actionHash is SHA-256 of the canonical JSON", () => {
  const value = { b: 1, a: 2 };
  assert.equal(canonicalize(value), '{"a":2,"b":1}');
  assert.equal(actionHash(value), "d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772");
  assert.equal(actionHash(value), sha256Hex(canonicalize(value)));
});

test("identical payloads with different key order give the same action hash", () => {
  const one = { procurementId: "p1", total: 120000, asset: "tADA", nested: { x: 1, y: [1, 2] } };
  const two = { nested: { y: [1, 2], x: 1 }, asset: "tADA", total: 120000, procurementId: "p1" };
  assert.equal(actionHash(one), actionHash(two));
});

test("a changed value changes the action hash", () => {
  assert.notEqual(actionHash({ total: 120000 }), actionHash({ total: 120001 }));
  assert.notEqual(actionHash([1, 2]), actionHash([2, 1]));
});
