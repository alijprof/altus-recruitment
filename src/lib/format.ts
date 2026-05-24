// Shared formatters used across (app) pages and shared components.
//
// Lifted out of `src/app/(app)/settings/usage/page.tsx` for Plan 03-06's
// `/reports/source-attribution` page (REPEAT-02), which needs the same
// pence-to-pound display logic.

/**
 * Render an integer pence amount as a UK currency string.
 *   - Sub-£1 amounts render as `42p`.
 *   - £1+ amounts render as `£12.34` with two decimal places.
 *
 * Negative values are pass-through; the callers don't expect negatives, but
 * we don't silently absolute them — that would hide bookkeeping bugs.
 */
export function formatPence(p: number): string {
  if (p < 100) return `${p}p`
  return `£${(p / 100).toFixed(2)}`
}

// Module-level formatter instance — `Intl.NumberFormat` construction is
// relatively expensive, so we reuse a single configured instance across calls.
const gbpRound = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/**
 * Render an integer pence amount as a whole-pound GBP string with UK locale
 * thousand separators, e.g. `formatGbpRound(200000000)` → `£2,000,000`.
 *
 * Use this for marquee acquirer-facing headlines (pipeline value, large
 * totals) where thousand separators matter and sub-pound precision does not.
 * For per-row or sub-£1 amounts, keep using `formatPence`.
 *
 * Negative values pass through — `Intl.NumberFormat` handles them naturally
 * (e.g. `-£1,234`). We do not absolute them; matches `formatPence` philosophy.
 */
export function formatGbpRound(p: number): string {
  return gbpRound.format(p / 100)
}
