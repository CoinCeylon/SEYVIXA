import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize } from "./canonical.ts";

test("RFC 8785 Section 3.2.2 example", () => {
  // Input is the JSON text from the RFC; the string value holds the escapes written out.
  const input = JSON.parse(
    '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
      '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
      '"literals":[null,true,false]}',
  );
  const expected =
    '{"literals":[null,true,false],' +
    '"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
    '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';
  assert.equal(canonicalize(input), expected);
});

test("RFC 8785 Section 3.2.3: keys sort by UTF-16 code units", () => {
  const input = {
    "€": "Euro Sign",
    "\r": "Carriage Return",
    "דּ": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "😀": "Emoji: Grinning Face",
    "\u0080": "Control",
    "ö": "Latin Small Letter O With Diaeresis",
  };
  // Compare the output text, not a parsed object: JS orders integer-like keys first on its own.
  const expected =
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
    '"ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign",' +
    '"😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';
  assert.equal(canonicalize(input), expected);
});

test("key order does not change the output, at any depth", () => {
  const a = { b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } };
  const b = { a: { c: null, d: [1, { x: 2, y: 1 }] }, b: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(canonicalize(a), '{"a":{"c":null,"d":[1,{"x":2,"y":1}]},"b":1}');
});

test("no whitespace, array order is kept", () => {
  assert.equal(canonicalize({ list: [3, 1, 2], s: "a b" }), '{"list":[3,1,2],"s":"a b"}');
  assert.equal(canonicalize([]), "[]");
  assert.equal(canonicalize({}), "{}");
});

test("numbers use the shortest ECMAScript form", () => {
  const cases: [number, string][] = [
    [0, "0"],
    [-0, "0"],
    [5e-324, "5e-324"],
    [1.7976931348623157e308, "1.7976931348623157e+308"],
    [9007199254740991, "9007199254740991"],
    [295147905179352830000, "295147905179352830000"],
    [1e21, "1e+21"],
    [1e-7, "1e-7"],
    [0.000001, "0.000001"],
    [4.5, "4.5"],
    [-12, "-12"],
  ];
  for (const [n, expected] of cases) assert.equal(canonicalize(n), expected);
});

test("unicode is kept as UTF-8 characters, controls are escaped", () => {
  assert.equal(canonicalize("é€😀"), '"é€😀"');
  assert.equal(canonicalize("\u0000\u001f\u007f"), '"\\u0000\\u001f\u007f"');
  assert.equal(canonicalize('a"b\\c\n'), '"a\\"b\\\\c\\n"');
});

test("values that are not JSON are rejected", () => {
  assert.throws(() => canonicalize(undefined), TypeError);
  assert.throws(() => canonicalize({ a: undefined }), TypeError);
  assert.throws(() => canonicalize(() => 1), TypeError);
  assert.throws(() => canonicalize(NaN), TypeError);
  assert.throws(() => canonicalize(Infinity), TypeError);
  assert.throws(() => canonicalize(10n), TypeError);
  assert.throws(() => canonicalize(new Date(0)), TypeError);
  assert.throws(() => canonicalize(new Map()), TypeError);
  assert.throws(() => canonicalize("\ud800"), TypeError);
  assert.throws(() => canonicalize({ "\ud800": 1 }), TypeError);
  assert.throws(() => canonicalize([1, , 3]), TypeError);
});
