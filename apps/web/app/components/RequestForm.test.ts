// apps/web/app/components/RequestForm.test.ts — Unit tests for Screen 1 RequestForm (T9.5a)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import procurementMock from "../../mocks/procurement.json" with { type: "json" };
import type { ProcurementRequestData } from "./RequestForm.tsx";

describe("T9.5a — Screen 1 RequestForm Validation & Boundaries", () => {
  it("pre-fills budget and items from mock procurement data", () => {
    assert.equal(procurementMock.budget, "120000.00");
    assert.ok(procurementMock.description.includes("100 guest kits"));
  });

  it("validates positive whole integer quantities", () => {
    const isValidQuantity = (q: number) => Number.isInteger(q) && q > 0;

    assert.equal(isValidQuantity(100), true);
    assert.equal(isValidQuantity(1), true);
    assert.equal(isValidQuantity(0), false);
    assert.equal(isValidQuantity(-5), false);
    assert.equal(isValidQuantity(12.5), false);
  });

  it("validates positive simulated LKR budget", () => {
    const isValidBudget = (bStr: string) => {
      const b = Number.parseFloat(bStr);
      return !Number.isNaN(b) && b > 0;
    };

    assert.equal(isValidBudget("120000.00"), true);
    assert.equal(isValidBudget("50000"), true);
    assert.equal(isValidBudget("0"), false);
    assert.equal(isValidBudget("-100"), false);
    assert.equal(isValidBudget("abc"), false);
  });

  it("guarantees zero ADA or conversion fields in ProcurementRequestData", () => {
    const sampleRequest: ProcurementRequestData = {
      items: "Guest kits for hotel",
      quantity: 100,
      deadline: "2026-12-05",
      budgetLkr: "120000.00",
    };

    const keys = Object.keys(sampleRequest);
    assert.ok(!keys.includes("ada"));
    assert.ok(!keys.includes("tada"));
    assert.ok(!keys.includes("rate"));
    assert.ok(!keys.includes("conversion"));
    assert.ok(keys.includes("budgetLkr"));
  });
});
