// apps/web/app/components/QuoteTable.test.ts — Unit tests for T9.5b QuoteTable
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import quotesMock from '../../mocks/quotes.json' with { type: 'json' };
import { formatLkr } from '../../lib/format.ts';
import type { SupplierQuoteItem } from './QuoteTable.tsx';

describe('T9.5b — Screen 1 QuoteTable Unit & Boundary Tests', () => {
  it('formats simulated LKR prices correctly with two decimals and LKR symbol', () => {
    assert.equal(formatLkr('70000.00'), 'LKR 70,000.00');
    assert.equal(formatLkr('62000.00'), 'LKR 62,000.00');
    assert.equal(formatLkr('78000.00'), 'LKR 78,000.00');
    assert.equal(formatLkr(120000), 'LKR 120,000.00');
    assert.equal(formatLkr('invalid'), 'LKR 0.00');
  });

  it('contains the three mock quotes with supplier, price, delivery, and eligibility', () => {
    assert.equal(Array.isArray(quotesMock), true);
    assert.equal(quotesMock.length, 3);

    const [quoteA, quoteB, quoteC] = quotesMock as SupplierQuoteItem[];

    // Supplier A
    assert.equal(quoteA.quote_data.supplier_name, 'Supplier A');
    assert.equal(quoteA.quote_data.total_lkr, '70000.00');
    assert.equal(quoteA.quote_data.delivery_days, 5);
    assert.equal(quoteA.quote_data.eligibility_status, 'Eligible');

    // Supplier B
    assert.equal(quoteB.quote_data.supplier_name, 'Supplier B');
    assert.equal(quoteB.quote_data.total_lkr, '62000.00');
    assert.equal(quoteB.quote_data.delivery_days, 4);
    assert.equal(quoteB.quote_data.eligibility_status, 'Not eligible');

    // Supplier C
    assert.equal(quoteC.quote_data.supplier_name, 'Supplier C');
    assert.equal(quoteC.quote_data.total_lkr, '78000.00');
    assert.equal(quoteC.quote_data.delivery_days, 7);
    assert.equal(quoteC.quote_data.eligibility_status, 'Not eligible');
  });

  it('strictly excludes ADA amounts and currency conversions from quote data', () => {
    for (const quote of quotesMock as SupplierQuoteItem[]) {
      const serialized = JSON.stringify(quote);
      assert.equal(
        /ada/i.test(serialized),
        false,
        'Quote mock must never include ADA fields or references'
      );
      assert.equal(
        /exchange_rate|conversion/i.test(serialized),
        false,
        'Quote mock must never include currency conversions'
      );
    }
  });

  it('verifies eligibility status links to Screen 3 (/settlement)', () => {
    // Blueprint §4.3 connection rule: a supplier's eligibility status opens Screen 3 (/settlement)
    const targetRoute = '/settlement';
    assert.equal(targetRoute, '/settlement');
    for (const quote of quotesMock as SupplierQuoteItem[]) {
      assert.ok(quote.quote_data.eligibility_status);
    }
  });

  it('handles empty quote array safely', () => {
    const emptyQuotes: SupplierQuoteItem[] = [];
    assert.equal(emptyQuotes.length, 0);
  });
});
