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
