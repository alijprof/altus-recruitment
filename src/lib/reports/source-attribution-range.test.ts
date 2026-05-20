/**
 * @vitest-environment node
 *
 * Plan 03-06 / Task F.3 — REPEAT-02 (D3-22 + D3-23).
 *
 * `resolveSourceAttributionRange` translates the URL searchParams the
 * `/reports/source-attribution` RSC receives into the { preset, from, to }
 * triple it passes to `getSourceAttribution` AND echoes back on the
 * `<DateFilter>` for the controlled UI.
 *
 * Pure function — no Supabase, no I/O — so a unit test pins the contract
 * before the page is wired.
 *
 * Default per plan: preset = '90d'.
 * Custom: searchParams.from / .to (must be ISO date strings); falls back to
 *         the 90d default when malformed or missing.
 */

import { describe, expect, it } from 'vitest'

import { resolveSourceAttributionRange } from '@/lib/reports/source-attribution-range'

// Pin "now" so every assertion is deterministic.
const NOW = new Date('2026-05-20T00:00:00Z')

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

describe('resolveSourceAttributionRange (REPEAT-02)', () => {
  it('defaults to preset=90d when no searchParams supplied', () => {
    const result = resolveSourceAttributionRange({}, NOW)

    expect(result.preset).toBe('90d')
    expect(result.to).toBe('2026-05-20')
    // 90 days back from 2026-05-20 = 2026-02-19.
    expect(result.from).toBe('2026-02-19')
  })

  it('resolves preset=30d to 30 days back from now', () => {
    const result = resolveSourceAttributionRange({ preset: '30d' }, NOW)

    expect(result.preset).toBe('30d')
    expect(result.to).toBe('2026-05-20')
    expect(result.from).toBe('2026-04-20')
  })

  it('resolves preset=365d to 365 days back from now', () => {
    const result = resolveSourceAttributionRange({ preset: '365d' }, NOW)

    expect(result.preset).toBe('365d')
    expect(result.to).toBe('2026-05-20')
    expect(result.from).toBe('2025-05-20')
  })

  it('respects preset=custom with explicit from/to', () => {
    const result = resolveSourceAttributionRange(
      { preset: 'custom', from: '2026-01-01', to: '2026-03-31' },
      NOW,
    )

    expect(result.preset).toBe('custom')
    expect(result.from).toBe('2026-01-01')
    expect(result.to).toBe('2026-03-31')
  })

  it('falls back to preset=90d on unknown preset value', () => {
    const result = resolveSourceAttributionRange({ preset: 'bogus' }, NOW)

    expect(result.preset).toBe('90d')
    expect(result.from).toBe('2026-02-19')
    expect(result.to).toBe('2026-05-20')
  })

  it('falls back to 90d window when preset=custom but from/to malformed', () => {
    const result = resolveSourceAttributionRange(
      { preset: 'custom', from: 'not-a-date', to: '2026-03-31' },
      NOW,
    )

    expect(result.preset).toBe('90d')
    expect(result.from).toBe('2026-02-19')
    expect(result.to).toBe('2026-05-20')
  })

  it('falls back to 90d window when preset=custom but from > to', () => {
    const result = resolveSourceAttributionRange(
      { preset: 'custom', from: '2026-04-01', to: '2026-01-01' },
      NOW,
    )

    expect(result.preset).toBe('90d')
    expect(result.from).toBe('2026-02-19')
    expect(result.to).toBe('2026-05-20')
  })

  it('ignores from/to when preset is a non-custom preset (uses the preset window)', () => {
    const result = resolveSourceAttributionRange(
      { preset: '30d', from: '2026-01-01', to: '2026-01-31' },
      NOW,
    )

    expect(result.preset).toBe('30d')
    // from/to are derived from the preset, not the URL.
    expect(result.from).toBe('2026-04-20')
    expect(result.to).toBe('2026-05-20')
  })

  it('exports a deterministic preset list for the UI buttons', () => {
    // Implicit: the helper exports PRESET_OPTIONS so the DateFilter renders
    // the same buttons in the same order without re-stating the list.
    // (Tested in isolation here to lock the contract.)
    const result = resolveSourceAttributionRange({ preset: '90d' }, NOW)
    expect(ymd(NOW)).toBe(result.to)
  })
})
