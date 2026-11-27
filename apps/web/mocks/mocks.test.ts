// apps/web/mocks/mocks.test.ts — Validates all mock files against shared Zod schemas (T9.4)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "../../../packages/shared/node_modules/zod/index.js";
import {
  actionPayloadSchema,
  agentGrantSchema,
  agentSchema,
  budgetReservationSchema,
  policyEventSchema,
  procurementSchema,
  supplierQuoteSchema,
  supplierSchema,
} from "../../../packages/shared/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMockJson(filename: string): unknown {
  const filepath = resolve(__dirname, filename);
  return JSON.parse(readFileSync(filepath, "utf-8"));
}

describe("T9.4 — Mock data files Zod schema compliance", () => {
  it("procurement.json matches procurementSchema", () => {
    const data = loadMockJson("procurement.json");
    const result = procurementSchema.safeParse(data);
    assert.equal(result.success, true, result.error ? JSON.stringify(result.error.issues) : "");
  });

  it("quotes.json matches z.array(supplierQuoteSchema)", () => {
    const data = loadMockJson("quotes.json");
    const result = z.array(supplierQuoteSchema).safeParse(data);
    assert.equal(result.success, true, result.error ? JSON.stringify(result.error.issues) : "");
    assert.equal(Array.isArray(data) && data.length, 3);
  });

  it("suppliers.json matches z.array(supplierSchema)", () => {
    const data = loadMockJson("suppliers.json");
    const result = z.array(supplierSchema).safeParse(data);
    assert.equal(result.success, true, result.error ? JSON.stringify(result.error.issues) : "");
    assert.equal(Array.isArray(data) && data.length, 3);
  });

  it("agents.json matches z.array(agentSchema)", () => {
    const data = loadMockJson("agents.json");
    const result = z.array(agentSchema).safeParse(data);
    assert.equal(result.success, true, result.error ? JSON.stringify(result.error.issues) : "");
    assert.equal(Array.isArray(data) && data.length, 2);
  });

  it("grants.json matches z.array(agentGrantSchema)", () => {
    const data = loadMockJson("grants.json");
    const result = z.array(agentGrantSchema).safeParse(data);
    assert.equal(result.success, true, result.error ? JSON.stringify(result.error.issues) : "");
    assert.equal(Array.isArray(data) && data.length, 2);
  });

  it("decisions.json matches z.array(policyEventSchema) with ALLOW, DENY, APPROVAL_REQUIRED", () => {
    const data = loadMockJson("decisions.json") as Array<{ decision: string; reason_code: string }>;
    const result = z.array(policyEventSchema).safeParse(data);
    assert.equal(result.success, true, result.error ? JSON.stringify(result.error.issues) : "");

    const decisions = data.map((d) => d.decision);
    assert.ok(decisions.includes("ALLOW"), "Must contain at least one ALLOW");
    assert.ok(decisions.includes("DENY"), "Must contain at least one DENY");
    assert.ok(decisions.includes("APPROVAL_REQUIRED"), "Must contain at least one APPROVAL_REQUIRED");

    const denyEvent = data.find((d) => d.decision === "DENY");
    assert.equal(denyEvent?.reason_code, "RESOURCE_OUT_OF_SCOPE");
  });

  it("action.json matches actionPayloadSchema", () => {
    const data = loadMockJson("action.json");
    const result = actionPayloadSchema.safeParse(data);
    assert.equal(result.success, true, result.error ? JSON.stringify(result.error.issues) : "");
  });

  it("budget.json contains valid reservations matching budgetReservationSchema", () => {
    const data = loadMockJson("budget.json") as { reservations: unknown };
    assert.ok(data && typeof data === "object");
    const result = z.array(budgetReservationSchema).safeParse(data.reservations);
    assert.equal(result.success, true, result.error ? JSON.stringify(result.error.issues) : "");
  });
});
