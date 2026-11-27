'use client';

import React, { useState } from 'react';
import procurementMock from '../../mocks/procurement.json' with { type: 'json' };

export interface ProcurementRequestData {
  items: string;
  quantity: number;
  deadline: string;
  budgetLkr: string;
}

export default function RequestForm() {
  // Pre-fill from procurement mock
  const [items, setItems] = useState<string>('Guest kits for hotel (soap, shampoo, towel, slippers)');
  const [quantity, setQuantity] = useState<number>(100);
  const [deadline, setDeadline] = useState<string>('2026-12-05');
  const [budgetLkr, setBudgetLkr] = useState<string>(procurementMock.budget || '120000.00');

  // Validation and submit state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedData, setSubmittedData] = useState<ProcurementRequestData | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Validate items
    if (!items.trim()) {
      setErrorMessage('Item description cannot be empty.');
      return;
    }

    // 2. Validate quantity (positive whole number)
    const q = Number(quantity);
    if (!Number.isInteger(q) || q <= 0) {
      setErrorMessage('Quantity must be a positive whole number greater than 0.');
      return;
    }

    // 3. Validate deadline
    if (!deadline.trim()) {
      setErrorMessage('Please select a valid delivery deadline.');
      return;
    }

    // 4. Validate budget (positive number)
    const b = Number.parseFloat(budgetLkr);
    if (Number.isNaN(b) || b <= 0) {
      setErrorMessage('Budget must be a positive simulated LKR amount.');
      return;
    }

    // Store submitted data for mock display
    setSubmittedData({
      items: items.trim(),
      quantity: q,
      deadline: deadline.trim(),
      budgetLkr: b.toFixed(2),
    });
  };

  const handleReset = () => {
    setItems('Guest kits for hotel (soap, shampoo, towel, slippers)');
    setQuantity(100);
    setDeadline('2026-12-05');
    setBudgetLkr('120000.00');
    setErrorMessage(null);
    setSubmittedData(null);
  };

  return (
    <div className="space-y-6">
      {/* Form Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">1. Create Procurement Request</h2>
          <p className="text-sm text-slate-500">
            Define requirements for autonomous agent quote sourcing and policy evaluation.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <div className="font-medium">Validation Error:</div>
            <div>{errorMessage}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Items Field */}
          <div>
            <label htmlFor="items" className="block text-sm font-medium text-slate-700">
              Required Items & Specifications
            </label>
            <input
              id="items"
              type="text"
              value={items}
              onChange={(e) => setItems(e.target.value)}
              placeholder="e.g. 100 Guest kits for hotel"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Quantity Field */}
            <div>
              <label htmlFor="quantity" className="block text-sm font-medium text-slate-700">
                Quantity
              </label>
              <input
                id="quantity"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(Number.parseInt(e.target.value, 10) || 0)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-slate-500">Positive whole integer.</p>
            </div>

            {/* Delivery Deadline */}
            <div>
              <label htmlFor="deadline" className="block text-sm font-medium text-slate-700">
                Required Delivery Deadline
              </label>
              <input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Budget Field with Persistent Distinction Label */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="budget" className="block text-sm font-medium text-slate-700">
                Procurement Budget (LKR)
              </label>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Simulated LKR budget — not real money
              </span>
            </div>
            <div className="relative mt-1 rounded-md shadow-sm">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <span className="text-slate-500 sm:text-sm">LKR</span>
              </div>
              <input
                id="budget"
                type="text"
                value={budgetLkr}
                onChange={(e) => setBudgetLkr(e.target.value)}
                placeholder="120000.00"
                className="block w-full rounded-md border border-slate-300 pl-12 pr-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Allocated business budget for this request (simulated off-chain).
            </p>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Reset to Mock
            </button>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Submit Procurement Request
            </button>
          </div>
        </form>
      </div>

      {/* Submitted Request Confirmation Panel (Mock State) */}
      {submittedData && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-emerald-200 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                ✓
              </span>
              <h3 className="text-base font-semibold text-emerald-900">Active Procurement Request</h3>
            </div>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
              Open (Mock State)
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-white p-3 border border-emerald-100">
              <dt className="text-xs font-medium text-slate-500">Items Specification</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{submittedData.items}</dd>
            </div>
            <div className="rounded-lg bg-white p-3 border border-emerald-100">
              <dt className="text-xs font-medium text-slate-500">Target Quantity</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{submittedData.quantity} units</dd>
            </div>
            <div className="rounded-lg bg-white p-3 border border-emerald-100">
              <dt className="text-xs font-medium text-slate-500">Delivery Deadline</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{submittedData.deadline}</dd>
            </div>
            <div className="rounded-lg bg-white p-3 border border-emerald-100">
              <dt className="text-xs font-medium text-slate-500">Simulated LKR Budget</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                LKR {Number(submittedData.budgetLkr).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-xs text-emerald-800">
            Procurement request is active in local mock memory. Ready for quote comparison (T9.5b) and agent activity feed (T9.5c).
          </p>
        </div>
      )}
    </div>
  );
}
