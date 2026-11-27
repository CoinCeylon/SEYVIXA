'use client';

import React from 'react';
import Link from 'next/link';
import defaultQuotes from '../../mocks/quotes.json';
import { formatLkr } from '../../lib/format';

export interface QuoteData {
  supplier_id?: string;
  supplier_name?: string;
  item?: string;
  quantity?: number;
  unit_price_lkr?: string;
  total_lkr?: string;
  delivery_days?: number;
  eligibility_status?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface SupplierQuoteItem {
  id: string;
  procurement_id: string;
  supplier_id: string;
  amount: string;
  quote_data: QuoteData;
}

interface QuoteTableProps {
  quotes?: SupplierQuoteItem[];
}

export { formatLkr };

export default function QuoteTable({ quotes = defaultQuotes as SupplierQuoteItem[] }: QuoteTableProps) {
  if (!quotes || quotes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h3 className="mt-3 text-base font-semibold text-slate-900">No supplier quotes received yet</h3>
        <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
          When autonomous procurement agents search suppliers and solicit quotes, comparison proposals will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-slate-50/60 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            Supplier Quote Comparison
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 border border-indigo-100">
              {quotes.length} Quotes
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Compare received prices, delivery timelines, and Midnight ZK eligibility proofs.
          </p>
        </div>

        {/* Currency boundary disclaimer badge */}
        <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs text-amber-800 border border-amber-200 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          <span>Simulated LKR quotes — not real money</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="px-6 py-3.5">
                Supplier
              </th>
              <th scope="col" className="px-6 py-3.5">
                Price (Simulated LKR)
              </th>
              <th scope="col" className="px-6 py-3.5">
                Delivery
              </th>
              <th scope="col" className="px-6 py-3.5">
                Eligibility Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {quotes.map((quote) => {
              const data = quote.quote_data || {};
              const supplierName = data.supplier_name || `Supplier ${quote.supplier_id.slice(-4)}`;
              const deliveryDays = data.delivery_days != null ? `${data.delivery_days} days` : 'Pending';
              const rawStatus = (data.eligibility_status || 'Pending').trim();
              const isEligible = rawStatus.toLowerCase() === 'eligible';

              return (
                <tr key={quote.id} className="hover:bg-slate-50/75 transition-colors">
                  {/* Supplier Column */}
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900">{supplierName}</div>
                    <div className="text-xs text-slate-400 font-mono">
                      ID: {quote.supplier_id.slice(0, 8)}...
                    </div>
                    {data.notes && (
                      <p className="mt-1 text-xs text-slate-500 max-w-sm truncate" title={String(data.notes)}>
                        {String(data.notes)}
                      </p>
                    )}
                  </td>

                  {/* Price (LKR) Column — Strictly NO ADA */}
                  <td className="px-6 py-4">
                    <div className="font-bold text-slate-900">
                      {formatLkr(data.total_lkr || quote.amount)}
                    </div>
                    {data.unit_price_lkr && (
                      <div className="text-xs text-slate-500">
                        {formatLkr(data.unit_price_lkr)} / unit
                      </div>
                    )}
                  </td>

                  {/* Delivery Column */}
                  <td className="px-6 py-4 text-slate-700">
                    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      ⏱ {deliveryDays}
                    </span>
                  </td>

                  {/* Eligibility Status Column — Links to Screen 3 (/settlement) */}
                  <td className="px-6 py-4">
                    <Link
                      href="/settlement"
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors border ${
                        isEligible
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                      }`}
                      title="Click to view Midnight proof details on Settlement & Proof Centre (Screen 3)"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isEligible ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                      />
                      <span>{rawStatus}</span>
                      <span className="text-[10px] opacity-75">→</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-3 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <span>
          Clicking an eligibility status opens Screen 3 (Settlement &amp; Proof Centre) to inspect the Midnight ZK proof.
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          Blueprint §4.3 Connection Rule
        </span>
      </div>
    </div>
  );
}
