/**
 * @vitest-environment node
 *
 * Layer 2 of the CV-intake battle-test harness (06-05-PLAN.md) — the layer
 * that would have caught the 12 production CV parse failures
 * (06-CONTEXT.md). Every test below calls the REAL updateCandidateCVParse /
 * markCandidateFieldsFromCV helpers (src/lib/db/candidate-cvs.ts) against a
 * REAL local Postgres 17.6 + PostgREST v14.5, then RE-READS the row and
 * asserts on the STORED value — never just the helper's return value
 * (06-RESEARCH.md Pitfall 5: a test that only checks `result.ok` can pass
 * while silently corrupting data, exactly like the skills-as-objects class
 * below).
 *
 * ============================================================================
 * RED CONTRACT — read this before "fixing" anything in this file
 * ============================================================================
 * This suite asserts POST-FIX behaviour: the outcome each payload SHOULD
 * produce once plan 06-06 (zod coercion boundary + tightened tool schema)
 * and plan 06-07 (Postgres-legality sanitiser + DbResult.detail) land. Until
 * then, most of the tests below are DESIGNED TO FAIL. That failure is the
 * proof this suite tests something real: the existing mocked write-path
 * test (tests/unit/mark-candidate-fields-from-cv.test.ts) passes on every
 * one of these payloads today — its query-builder mock has no type system,
 * no constraints, no PostgREST — which is exactly why the 12 shipped
 * (06-RESEARCH.md Pitfall 1). Keep that mock; it guards the D-08 policy.
 * This suite guards something that mock structurally cannot: the real
 * write.
 *
 * DO NOT "fix" a red test here by weakening its assertion to match today's
 * broken behaviour (06-RESEARCH.md threat T-06-18). If a test is wrong,
 * fix the test's expectation against the PLAN's documented behaviour
 * (06-05-PLAN.md <behavior>), not against what the unfixed code happens to
 * do today.
 *
 * Expected-red count, VERIFIED by a live `pnpm test:integration` run against
 * this exact file on 2026-08-09: **15 failed, 7 passed** (22 total). Re-run
 * the suite before trusting these numbers if this file changes; do not
 * hand-edit this count.
 *
 * Expected-red set (15 — all designed to fail until 06-06/06-07 land):
 *   C1a, C1b, C1c                         (NUL in extracted_data jsonb)
 *   C2a, C2b                              (lone surrogate in extracted_data)
 *   C3a, C3b                              (years_experience_total overflow)
 *   C4a, C4b, C4c, C4d                    (salary_* integer-column violations)
 *   C5a, C5b                              (name / work_history TypeErrors)
 *   SKILLS-OBJ                            (silent-corruption contract)
 *   BAD-ENUM                              (DbResult.detail / SQLSTATE contract)
 * Expected-green set (7 — must NEVER go red, today or after the fix lands):
 *   C3c, C3d, C4e, plus the four tests under "Negative controls" below
 *   (1.1 MB string, ~2 MB extracted_data, exotic-Unicode zoo, non-NUL
 *   control chars).
 *
 * NOTE on `pnpm test:integration`'s own exit summary: vitest's default
 * reporter prints "Test Files  1 failed (1)" BEFORE "Tests  15 failed | 7
 * passed (22)" — a naive `/(\d+) failed/` regex over the combined output
 * matches the FIRST line and misreports "1 failed". Match `/Tests\s+(\d+)
 * failed/` specifically (or just read the "Tests" summary line) when
 * scripting against this suite's output.
 *
 * 06-FORENSICS.md (the zero-cost half of the read-only forensic replay of
 * the 12 real failed rows) found ZERO NULs, ZERO lone surrogates and ZERO
 * extraction errors across all 12 — the illegal content lives in Claude's
 * PARSED OUTPUT hitting DB type bounds or unguarded casts, not in the
 * extracted text. No C7 class was found; all six 06-RESEARCH.md classes
 * (C1-C5 here, C6/truncation in tests/unit/lib/ai/cv-parse-truncation.test.ts)
 * are covered below with no seventh class to add.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

const { markCandidateFieldsFromCV, updateCandidateCVParse } = await import('@/lib/db/candidate-cvs')
const { getHarness, isStackUp } = await import('./supabase-harness')

import { HOSTILE_PAYLOADS } from '../fixtures/cv-corpus/hostile-payloads'

import type { Harness } from './supabase-harness'
import type { ParsedCVSubset, ParsingStatus } from '@/lib/db/candidate-cvs'
import type { DbResult } from '@/lib/db/types'

const up = await isStackUp()

if (!up) {
  // A silent skip is worse than no test at all (06-05-PLAN.md Task 2).
  console.warn(
    '\n[tests/integration/cv-write-path.test.ts] SKIPPED — local Supabase stack unreachable.\n' +
      'Start it with:\n' +
      '  pnpm exec supabase start -x vector,logflare,edge-runtime,studio,imgproxy,realtime\n' +
      'Then re-run: pnpm test:integration\n',
  )
}

function findPayload(id: string): unknown {
  const entry = HOSTILE_PAYLOADS.find((p) => p.id === id)
  if (!entry) throw new Error(`hostile-payloads.ts fixture is missing entry: ${id}`)
  return entry.payload
}

// DbResult today (src/lib/db/types.ts) has no `detail` field — plan 06-06/
// 06-07 widens the failure variant to carry one (06-05-PLAN.md <interfaces>).
// This helper reads it via a boundary cast, same idiom candidate-cvs.ts uses
// for the generated-type gaps, so this file typechecks cleanly against
// TODAY's DbResult while still proving the field is (or isn't) there.
function detailOf(result: DbResult<unknown>): string | undefined {
  if (result.ok) return undefined
  return (result as unknown as { detail?: string }).detail
}

describe.skipIf(!up)('CV write path — layer 2 RED suite (real local Postgres)', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await getHarness()
  })

  beforeEach(async () => {
    await harness.resetCandidate()
  })

  afterAll(async () => {
    if (harness) await harness.teardown()
  })

  // -------------------------------------------------------------------
  // C1 — NUL in extracted_data jsonb (updateCandidateCVParse)
  // -------------------------------------------------------------------
  describe('C1 — NUL in extracted_data jsonb (updateCandidateCVParse)', () => {
    it('C1a: NUL in a STRING VALUE is removed, rest of string intact', async () => {
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: findPayload('C1a'),
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidate_cvs')
        .select('extracted_data')
        .eq('id', harness.candidateCvId)
        .single()
      const stored = data?.extracted_data as { name?: string } | null
      expect(stored?.name).toBe('JaneDoe')
    })

    it('C1b: NUL in an object KEY is removed, key + value preserved', async () => {
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: findPayload('C1b'),
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidate_cvs')
        .select('extracted_data')
        .eq('id', harness.candidateCvId)
        .single()
      const stored = data?.extracted_data as Record<string, unknown> | null
      expect(stored?.badkey).toBe('value')
    })

    it('C1c: NUL nested at work_history[0].summary is removed', async () => {
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: findPayload('C1c'),
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidate_cvs')
        .select('extracted_data')
        .eq('id', harness.candidateCvId)
        .single()
      const stored = data?.extracted_data as {
        work_history?: Array<{ summary?: string }>
      } | null
      expect(stored?.work_history?.[0]?.summary).toBe('Texthere')
    })
  })

  // -------------------------------------------------------------------
  // C2 — lone UTF-16 surrogate in extracted_data jsonb (updateCandidateCVParse)
  // -------------------------------------------------------------------
  describe('C2 — lone surrogate in extracted_data jsonb (updateCandidateCVParse)', () => {
    it('C2a: lone HIGH surrogate replaced by U+FFFD, write succeeds', async () => {
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: findPayload('C2a'),
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidate_cvs')
        .select('extracted_data')
        .eq('id', harness.candidateCvId)
        .single()
      const stored = data?.extracted_data as { name?: string } | null
      expect(stored?.name).toBe('�')
    })

    it('C2b: lone LOW surrogate replaced by U+FFFD, write succeeds', async () => {
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: findPayload('C2b'),
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidate_cvs')
        .select('extracted_data')
        .eq('id', harness.candidateCvId)
        .single()
      const stored = data?.extracted_data as { name?: string } | null
      expect(stored?.name).toBe('�')
    })
  })

  // -------------------------------------------------------------------
  // C3 — years_experience_total numeric(4,1) overflow (markCandidateFieldsFromCV)
  // -------------------------------------------------------------------
  describe('C3 — years_experience_total (numeric(4,1) overflow, 22003) (markCandidateFieldsFromCV)', () => {
    it('C3a: years_experience_total 2015 (calendar year) — write succeeds, years_experience stays NULL', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C3a') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('years_experience')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.years_experience).toBeNull()
    })

    it('C3b: years_experience_total 1000 (exact overflow cliff) — years_experience stays NULL', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C3b') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('years_experience')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.years_experience).toBeNull()
    })

    it('C3c negative control: 999.9 is stored unchanged (must stay GREEN)', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C3c') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('years_experience')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.years_experience).toBe(999.9)
    })

    it('C3d negative control: 12.5 is stored unchanged (must stay GREEN)', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C3d') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('years_experience')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.years_experience).toBe(12.5)
    })
  })

  // -------------------------------------------------------------------
  // C4 — salary_current_estimate / salary_expectation integer bounds
  // (markCandidateFieldsFromCV)
  // -------------------------------------------------------------------
  describe('C4 — salary_current_estimate / salary_expectation integer bounds (markCandidateFieldsFromCV)', () => {
    it('C4a: currency-formatted string "£45,000" stored as 45000', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C4a') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('salary_current_estimate')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.salary_current_estimate).toBe(45000)
    })

    it('C4b: float 45000.5 stored as 45001 (rounded)', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C4b') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('salary_current_estimate')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.salary_current_estimate).toBe(45001)
    })

    it('C4c: value exceeding int4 range not stored, write still succeeds', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C4c') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('salary_current_estimate')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.salary_current_estimate).toBeNull()
    })

    it('C4d: object shape ({min,max}) not stored, write still succeeds', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C4d') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('salary_expectation')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.salary_expectation).toBeNull()
    })

    it('C4e negative control: clean numeric string "45000" stored as 45000 (must stay GREEN)', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('C4e') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('salary_current_estimate')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.salary_current_estimate).toBe(45000)
    })
  })

  // -------------------------------------------------------------------
  // C5 — JavaScript-level shape violations (markCandidateFieldsFromCV)
  // -------------------------------------------------------------------
  describe('C5 — JavaScript-level shape violations, no SQLSTATE (markCandidateFieldsFromCV)', () => {
    it('C5a: name as an array — no TypeError escapes the helper, row still written', async () => {
      await expect(
        markCandidateFieldsFromCV(harness.sb, {
          candidateId: harness.candidateId,
          parsed: findPayload('C5a') as ParsedCVSubset,
        }),
      ).resolves.toMatchObject({ ok: true })

      const { data } = await harness.sb
        .from('candidates')
        .select('full_name')
        .eq('id', harness.candidateId)
        .single()
      // The malformed shape must never be silently stringified onto the row
      // (Array.prototype.toString() would produce "Jane,Doe").
      expect(data?.full_name).not.toBe('Jane,Doe')
    })

    it('C5b: work_history with a null element — no TypeError, null dropped, Dev stored', async () => {
      await expect(
        markCandidateFieldsFromCV(harness.sb, {
          candidateId: harness.candidateId,
          parsed: findPayload('C5b') as ParsedCVSubset,
        }),
      ).resolves.toMatchObject({ ok: true })

      const { data } = await harness.sb
        .from('candidates')
        .select('work_experience')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.work_experience).toEqual([{ title: 'Dev', company: null, dates: null }])
    })
  })

  // -------------------------------------------------------------------
  // Silent-corruption contract (markCandidateFieldsFromCV)
  // -------------------------------------------------------------------
  describe('Silent-corruption contract — skills as an array of objects (markCandidateFieldsFromCV)', () => {
    it('SKILLS-OBJ: non-string skills elements are dropped, never stringified onto the row', async () => {
      const result = await markCandidateFieldsFromCV(harness.sb, {
        candidateId: harness.candidateId,
        parsed: findPayload('SKILLS-OBJ') as ParsedCVSubset,
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidates')
        .select('skills')
        .eq('id', harness.candidateId)
        .single()
      expect(data?.skills ?? []).not.toContain('{"name":"Python"}')
    })
  })

  // -------------------------------------------------------------------
  // Error-detail contract (updateCandidateCVParse)
  // -------------------------------------------------------------------
  describe('Error-detail contract — DbResult.detail carries the SQLSTATE (updateCandidateCVParse)', () => {
    it('BAD-ENUM: an invalid parsing_status value fails permanently; detail carries 22P02 + column', async () => {
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: findPayload('BAD-ENUM') as unknown as ParsingStatus,
      })
      // This one can NEVER succeed — the contract is what's IN the failure,
      // not that the write eventually passes (unlike every test above it).
      expect(result.ok).toBe(false)
      // `?? ''` keeps this a plain string-mismatch failure today (DbResult
      // has no `detail` field yet) rather than a matcher-usage error on
      // `undefined` — a clearer RED message, same underlying assertion.
      const detail = detailOf(result) ?? ''
      expect(detail).toContain('22P02')
      expect(detail).toContain('parsing_status')
    })
  })

  // -------------------------------------------------------------------
  // Negative controls — must NEVER go red, today or after the fix lands.
  // -------------------------------------------------------------------
  describe('Negative controls — must NEVER go red', () => {
    it('a 1.1 MB string value in extracted_data writes cleanly and is not mangled', async () => {
      const huge = 'a'.repeat(1_100_000)
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: { name: huge, confidence_per_field: {} },
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidate_cvs')
        .select('extracted_data')
        .eq('id', harness.candidateCvId)
        .single()
      const stored = data?.extracted_data as { name?: string } | null
      expect(stored?.name?.length).toBe(1_100_000)
    })

    it('a ~2 MB extracted_data object writes cleanly', async () => {
      const big = 'b'.repeat(2_000_000)
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: { name: 'Jane Doe', current_company: big, confidence_per_field: {} },
      })
      expect(result.ok).toBe(true)
    })

    it('emoji, ZWJ, astral plane, RTL, CJK, diacritics, smart quotes, soft hyphen, BOM all write cleanly', async () => {
      const exotic =
        '\u{1F44D}\u{1F469}‍\u{1F4BB}\u{1F600}مرحبا' +
        '张伟' +
        'Zoë O’Brien-Şahin' +
        'soft­hyphen' +
        '﻿BOM-prefixed'
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: { name: exotic, confidence_per_field: {} },
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidate_cvs')
        .select('extracted_data')
        .eq('id', harness.candidateCvId)
        .single()
      const stored = data?.extracted_data as { name?: string } | null
      expect(stored?.name).toBe(exotic)
    })

    it('control chars U+0001-U+001F other than NUL (e.g. \\v, \\x01) write cleanly and are preserved', async () => {
      const withControls = 'a\vb\x01c'
      const result = await updateCandidateCVParse(harness.sb, {
        id: harness.candidateCvId,
        status: 'complete',
        extractedData: { name: withControls, confidence_per_field: {} },
      })
      expect(result.ok).toBe(true)

      const { data } = await harness.sb
        .from('candidate_cvs')
        .select('extracted_data')
        .eq('id', harness.candidateCvId)
        .single()
      const stored = data?.extracted_data as { name?: string } | null
      expect(stored?.name).toBe(withControls)
    })
  })
})
