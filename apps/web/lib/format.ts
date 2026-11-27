// apps/web/lib/format.ts — Currency and presentation helpers

/**
 * Format an amount string or number as simulated Sri Lankan Rupees (LKR).
 * Strictly formats as LKR — never introduces ADA or cryptocurrency conversions.
 */
export function formatLkr(amountStr: string | number): string {
  const num = typeof amountStr === 'number' ? amountStr : parseFloat(amountStr);
  if (isNaN(num)) return 'LKR 0.00';
  return `LKR ${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
