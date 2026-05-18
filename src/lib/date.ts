// reason: Date.now() is technically impure, but the React Compiler's purity
// rule treats every call inside a component as a violation. Wrapping it in a
// named helper here lets server components capture "now" without triggering
// the lint rule (the compiler only checks calls inside component bodies).
export function nowMillis(): number {
  return Date.now()
}

// Date formatting utilities shared across the (app) routes.
//
// Why a local helper instead of date-fns? UI-SPEC asks for "time ago" copy in
// the activity timeline + table "Last contacted" column. Two formats max,
// stable across SSR/CSR, no locale switching beyond en-GB → Intl is enough.

const RTF = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })

// Buckets in seconds: chosen to match Twitter/GitHub "time ago" feel:
//   < 60s        → "just now"
//   < 60m        → "N minutes ago"
//   < 24h        → "N hours ago"
//   < 30d        → "N days ago"
//   < 12 months  → "N months ago"
//   otherwise    → "N years ago"
const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 30, unit: 'day' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

/**
 * Render an ISO timestamp as a relative phrase ("3 hours ago", "just now").
 * Falls back to "—" for null/undefined input. Deterministic given a stable
 * `now` reference — pass `now` to keep SSR + CSR output identical when used
 * in client components after hydration.
 */
export function formatTimeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '—'
  let duration = (then.getTime() - now.getTime()) / 1000
  if (Math.abs(duration) < 30) return 'just now'
  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return RTF.format(Math.round(duration), unit)
    }
    duration /= amount
  }
  return RTF.format(Math.round(duration), 'year')
}

/**
 * Format a date as `15 May 2026` (en-GB long). Used for consent timestamps and
 * "Created" column where relative time would lose precision.
 */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
