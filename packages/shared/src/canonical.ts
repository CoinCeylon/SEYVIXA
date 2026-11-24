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
// Only JSON values are accepted: null, boolean, finite number, string, array, plain object.
// Anything else throws, so a hash is never computed over something that silently changed
// shape (undefined, functions, NaN, Infinity, bigint, Date, Map, lone surrogates).

export function canonicalize(value: unknown): string {
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
      return Array.isArray(value) ? canonicalizeArray(value) : canonicalizeObject(value);
    default:
      throw new TypeError(`canonicalize: ${typeof value} is not a JSON value`);
  }
}

function canonicalizeArray(items: unknown[]): string {
  // Index loop, not map(): a sparse array hole must throw, not become null.
  const parts: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (!(i in items)) throw new TypeError("canonicalize: sparse array");
    parts.push(canonicalize(items[i]));
  }
  return `[${parts.join(",")}]`;
}

function canonicalizeObject(obj: object): string {
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("canonicalize: only plain objects are accepted");
  }
  const record = obj as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => {
      if (!key.isWellFormed()) {
        throw new TypeError("canonicalize: property name contains a lone surrogate");
      }
      // An undefined property value throws inside canonicalize (JSON.stringify would drop it).
      return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
    });
  return `{${parts.join(",")}}`;
}
