// T8.5 — Zero-dependency validator for schemas/receipt.v0.schema.json (Blueprint Section 6.8).
// Evaluates the published JSON Schema (Draft 2020-12 subset used by receipt.v0.schema.json)
// so both receipt generation (T8.1) and the verifier CLI (T8.3) can validate receipts without
// adding unpinned external libraries.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const RECEIPT_V0_SCHEMA_PATH = path.join(DIR, "receipt.v0.schema.json");
export const RECEIPT_V0_SCHEMA = JSON.parse(readFileSync(RECEIPT_V0_SCHEMA_PATH, "utf8"));

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  const parts = ref.slice(2).split("/");
  let current = root;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      throw new Error(`Unresolvable $ref: ${ref}`);
    }
    current = current[part];
  }
  return current;
}

function matchesType(value, typeName) {
  if (typeName === "null") return value === null;
  if (typeName === "array") return Array.isArray(value);
  if (typeName === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (typeName === "integer") return typeof value === "number" && Number.isInteger(value);
  if (typeName === "number") return typeof value === "number" && Number.isFinite(value);
  if (typeName === "string") return typeof value === "string";
  if (typeName === "boolean") return typeof value === "boolean";
  return false;
}

function validateNode(value, schema, root, pointer, errors) {
  if (schema.$ref) {
    validateNode(value, resolveRef(root, schema.$ref), root, pointer, errors);
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${pointer}: expected constant ${JSON.stringify(schema.const)}`);
    return;
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${pointer}: value must be one of ${JSON.stringify(schema.enum)}`);
    return;
  }

  if (schema.type !== undefined) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((t) => matchesType(value, t))) {
      errors.push(`${pointer}: expected type ${allowedTypes.join("|")}`);
      return;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${pointer}: length must be >= ${String(schema.minLength)}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${pointer}: does not match pattern ${schema.pattern}`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${pointer}: invalid ISO date-time`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${pointer}: must be >= ${String(schema.minimum)}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${pointer}: must contain at least ${String(schema.minItems)} item(s)`);
    }
    if (schema.items !== undefined) {
      for (let i = 0; i < value.length; i += 1) {
        validateNode(value[i], schema.items, root, `${pointer}/${String(i)}`, errors);
      }
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(`${pointer}: missing required property "${key}"`);
        }
      }
    }

    const props = schema.properties ?? {};
    for (const [key, propVal] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        validateNode(propVal, props[key], root, `${pointer}/${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${pointer}: unexpected property "${key}"`);
      }
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      validateNode(value, sub, root, pointer, errors);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const branchErrors = schema.oneOf.map((sub) => {
      const errs = [];
      validateNode(value, sub, root, pointer, errs);
      return errs;
    });
    const matches = branchErrors.filter((errs) => errs.length === 0).length;
    if (matches !== 1) {
      const bestBranch = branchErrors.sort((a, b) => a.length - b.length)[0] ?? [];
      errors.push(
        matches === 0
          ? `${pointer}: failed oneOf (${bestBranch.join("; ")})`
          : `${pointer}: matched more than one oneOf branch`,
      );
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((sub) => {
      const errs = [];
      validateNode(value, sub, root, pointer, errs);
      return errs.length === 0;
    });
    if (!matched) {
      errors.push(`${pointer}: failed anyOf`);
    }
  }

  if (schema.not !== undefined) {
    const notErrors = [];
    validateNode(value, schema.not, root, pointer, notErrors);
    if (notErrors.length === 0) {
      errors.push(`${pointer}: matched disallowed "not" schema`);
    }
  }

  if (schema.if !== undefined) {
    const ifErrors = [];
    validateNode(value, schema.if, root, pointer, ifErrors);
    if (ifErrors.length === 0 && schema.then !== undefined) {
      validateNode(value, schema.then, root, pointer, errors);
    } else if (ifErrors.length > 0 && schema.else !== undefined) {
      validateNode(value, schema.else, root, pointer, errors);
    }
  }
}

/**
 * Validates a receipt object against `schemas/receipt.v0.schema.json`.
 * Returns `{ valid: true, errors: [] }` or `{ valid: false, errors: string[] }`.
 */
export function validateReceiptV0(receipt) {
  const errors = [];
  validateNode(receipt, RECEIPT_V0_SCHEMA, RECEIPT_V0_SCHEMA, "#", errors);
  return { valid: errors.length === 0, errors };
}
