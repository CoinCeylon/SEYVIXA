// T0.3a, Blueprint Section 6.5: deterministic canonical JSON (RFC 8785, JSON Canonicalization Scheme).
//
// Own implementation, no library. RFC 8785 relies on three things JavaScript already does:
//  - numbers print as the shortest round-trip form (ECMAScript Number::toString), which
//    JSON.stringify uses, and -0 prints as "0";
//  - strings are escaped exactly as RFC 8785 Section 3.2.2.2 requires (JSON.stringify escapes
//    only the control characters, quote and backslash, with lowercase \u00xx);
//  - Array.prototype.sort() on strings compares UTF-16 code units, the order RFC 8785
//    Section 3.2.3 requires for property names.
// Output is a string; hash it with sha256Hex, which encodes it as UTF-8.
//
// Input contract: action records must be plain JSON data, such as the result of JSON.parse or a
// literal built by the server. Accepted: null, boolean, finite number, string, array, plain object.
// Anything that would be dropped, changed or computed is refused with a TypeError, so two
// different records can never share one canonical form: undefined, functions, symbols, bigint,
// NaN, Infinity, Date, Map, Proxy, lone surrogates, symbol keys, non-enumerable properties,
// getters and setters, extra properties on arrays, sparse arrays, cycles, and nesting deeper
// than MAX_DEPTH.
import { types } from "node:util";

const MAX_DEPTH = 256;

export function canonicalize(value: unknown): string {
  return write(value, new Set<object>(), 0);
}

function write(value: unknown, ancestors: Set<object>, depth: number): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("canonicalize: NaN and Infinity are not JSON numbers");
      }
      return JSON.stringify(value);
    case "string":
      if (!value.isWellFormed()) {
        throw new TypeError("canonicalize: string contains a lone surrogate");
      }
      return JSON.stringify(value);
    case "object":
      return writeContainer(value, ancestors, depth);
    default:
      throw new TypeError(`canonicalize: ${typeof value} is not a JSON value`);
  }
}

function writeContainer(obj: object, ancestors: Set<object>, depth: number): string {
  if (depth >= MAX_DEPTH) throw new TypeError("canonicalize: nesting is too deep");
  if (ancestors.has(obj)) throw new TypeError("canonicalize: cyclic structure");
  if (types.isProxy(obj)) throw new TypeError("canonicalize: Proxy is not accepted");

  ancestors.add(obj);
  try {
    return Array.isArray(obj)
      ? writeArray(obj, ancestors, depth)
      : writeObject(obj, ancestors, depth);
  } finally {
    ancestors.delete(obj);
  }
}

// Own property values are read from descriptors, so a getter is never run.
function dataValue(target: object, key: string, what: string): unknown {
  const desc = Object.getOwnPropertyDescriptor(target, key);
  if (desc === undefined || !("value" in desc) || desc.enumerable !== true) {
    throw new TypeError(`canonicalize: ${what} must be a plain enumerable data property`);
  }
  return desc.value;
}

function writeArray(items: unknown[], ancestors: Set<object>, depth: number): string {
  if (Object.getPrototypeOf(items) !== Array.prototype) {
    throw new TypeError("canonicalize: only plain arrays are accepted");
  }
  // A plain, dense array has exactly its indexes plus "length" as own keys.
  const keys = Reflect.ownKeys(items);
  if (keys.length !== items.length + 1) {
    throw new TypeError("canonicalize: sparse array or extra array property");
  }
  const parts: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    parts.push(write(dataValue(items, String(i), "array element"), ancestors, depth + 1));
  }
  return `[${parts.join(",")}]`;
}

function writeObject(obj: object, ancestors: Set<object>, depth: number): string {
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("canonicalize: only plain objects are accepted");
  }
  const keys = Reflect.ownKeys(obj);
  const names: string[] = [];
  for (const key of keys) {
    if (typeof key === "symbol") throw new TypeError("canonicalize: symbol keys are not accepted");
    if (!key.isWellFormed()) {
      throw new TypeError("canonicalize: property name contains a lone surrogate");
    }
    names.push(key);
  }
  // sort() on strings compares UTF-16 code units, as RFC 8785 Section 3.2.3 requires.
  const parts = names.sort().map((name) => {
    // An undefined property value throws inside write (JSON.stringify would drop it).
    const v = write(dataValue(obj, name, `property "${name}"`), ancestors, depth + 1);
    return `${JSON.stringify(name)}:${v}`;
  });
  return `{${parts.join(",")}}`;
}
