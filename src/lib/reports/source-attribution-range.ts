// Plan 03-06 / Task F.3 — REPEAT-02 (D3-22 + D3-23).
//
// Pure helper that resolves the `/reports/source-attribution` page's
// searchParams (`preset`, `from`, `to`) into the concrete date window the
// page passes to `getSourceAttribution` AND echoes back to the
// `<DateFilter>` Client Component.
//
// Design notes:
//   - Default preset = '90d' per the plan.
//   - 30 / 90 / 365 are convenience windows; the URL only carries `preset`
//     so the window is recomputed server-side on every render (no risk of
//     a stale `from`/`to` outliving the day boundary).
//   - 'custom' is the only preset that consults `from` + `to` in the URL.
//     Invalid input falls back to the 90d default — silently, because
//     showing a broken page for a typed URL is worse than showing the
//     default window with a small inline note (handled in the page UI).
//   - No `Date` arithmetic that drifts across DST: we operate in UTC for
//     the `from`/`to` strings and let Postgres handle the rest. The
//     `now` parameter is injectable for tests.

const PRESET_VALUES = ['30d', '90d', '365d', 'custom'] as const

export type SourceAttributionPreset = (typeof PRESET_VALUES)[number]

export type SourceAttributionRange = {
  preset: SourceAttributionPreset
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
}

export type SourceAttributionRangeInput = {
  preset?: string | string[]
  from?: string | string[]
  to?: string | string[]
}

export const PRESET_OPTIONS: ReadonlyArray<{
  value: SourceAttributionPreset
  label: string
}> = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '365d', label: 'Last 365 days' },
  { value: 'custom', label: 'Custom' },
]

const PRESET_DAYS: Record<Exclude<SourceAttributionPreset, 'custom'>, number> = {
  '30d': 30,
  '90d': 90,
  '365d': 365,
}

// Narrowed to non-'custom' so PRESET_DAYS[DEFAULT_PRESET] is well-typed.
const DEFAULT_PRESET: Exclude<SourceAttributionPreset, 'custom'> = '90d'

// --- helpers ----------------------------------------------------------------

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function isYmd(value: string): boolean {
  // Strict YYYY-MM-DD; rejects partial / locale dates.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  // Round-trip to catch invalid calendar days like 2026-02-30.
  return d.toISOString().slice(0, 10) === value
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function subtractDaysUtc(date: Date, days: number): string {
  const ms = date.getTime() - days * 24 * 60 * 60 * 1000
  return toYmd(new Date(ms))
}

function isPreset(value: string): value is SourceAttributionPreset {
  return (PRESET_VALUES as readonly string[]).includes(value)
}

function defaultWindow(now: Date): SourceAttributionRange {
  return {
    preset: DEFAULT_PRESET,
    from: subtractDaysUtc(now, PRESET_DAYS[DEFAULT_PRESET]),
    to: toYmd(now),
  }
}

// --- public ----------------------------------------------------------------

export function resolveSourceAttributionRange(
  searchParams: SourceAttributionRangeInput,
  now: Date = new Date(),
): SourceAttributionRange {
  const rawPreset = firstString(searchParams.preset)
  const preset: SourceAttributionPreset =
    rawPreset && isPreset(rawPreset) ? rawPreset : DEFAULT_PRESET

  if (preset === 'custom') {
    const from = firstString(searchParams.from)
    const to = firstString(searchParams.to)
    if (
      from && to &&
      isYmd(from) && isYmd(to) &&
      from <= to
    ) {
      return { preset: 'custom', from, to }
    }
    // Malformed custom range — silently fall back to the default window.
    return defaultWindow(now)
  }

  // The compiler narrowed `preset` to Exclude<…, 'custom'> via the early
  // return above, so PRESET_DAYS[preset] is well-typed.
  const days = PRESET_DAYS[preset]
  return {
    preset,
    from: subtractDaysUtc(now, days),
    to: toYmd(now),
  }
}
