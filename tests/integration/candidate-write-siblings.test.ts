/**
 * Layer-2 proof for the SIBLING candidate write paths (review 2026-08-09
 * ME-03) — real local Postgres, real PostgREST, real SQLSTATEs.
 *
 * tests/integration/cv-write-path.test.ts covers the CV pipeline's two
 * guarded boundaries. It is FROZEN byte-identical to its original RED
 * commit, so this coverage lives in its own file rather than being bolted
 * onto it.
 *
 * What this pins: `createCandidate` (fed by the PUBLIC apply form) and
 * `upsertCandidateFromLinkedIn` (fed by the browser extension's JSON body)
 * write the SAME candidates columns the CV pipeline writes — full_name,
 * headline, about, skills, work_experience, education, location,
 * current_role_title — and zod's `z.string()` accepts both illegal
 * sequences without complaint. Before the fix these calls failed
 * deterministically:
 *
 *   U+0000                -> 22P05 (Postgres)
 *   lone UTF-16 surrogate -> PGRST102 (PostgREST, before Postgres is reached)
 *
 * ...and surfaced to the user as a generic error with no root cause — the
 * same shape as the 12 production rows this phase exists to explain.
 *
 * The value of asserting HERE rather than only at the unit level: a unit
 * test can only prove we sanitised the payload we handed to supabase-js.
 * This proves the write actually lands, and re-reads the STORED value back
 * out of Postgres to prove nothing else was mangled on the way.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))
vi.mock('@/lib/ai/voyage', () => ({ embed: vi.fn() }))

const { createCandidate } = await import('@/lib/db/candidates')
const { getHarness, isStackUp } = await import('./supabase-harness')

import type { Harness } from './supabase-harness'

// Built from code points — a committed source file must contain no raw NUL
// and no raw lone surrogate (see src/lib/text/postgres-safe-text.ts).
const NUL = String.fromCharCode(0x00)
const LONE_HIGH = String.fromCharCode(0xd83d)
const FFFD = String.fromCharCode(0xfffd)

const up = await isStackUp()

describe.skipIf(!up)('candidate sibling write paths — layer 2 (real local Postgres)', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await getHarness()
  })

  afterAll(async () => {
    if (harness) await harness.teardown()
  })

  describe('createCandidate — the public apply-form insert', () => {
    it('writes successfully with a NUL in full_name, and stores the sanitised value', async () => {
      const result = await createCandidate(harness.sb, {
        full_name: `Jane${NUL}Doe`,
        email: `nul-${Date.now()}@example.com`,
        phone: null,
        location: null,
        current_role_title: null,
        current_company: null,
        market_status: 'actively_looking',
        source: 'apply_form',
        organization_id: harness.orgId,
        source_detail: null,
        consent_basis: 'consent',
        consent_at: new Date().toISOString(),
        consent_text_version: 'integration-v1',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const { data } = await harness.sb
        .from('candidates')
        .select('full_name')
        .eq('id', result.data.id)
        .single()
      expect(data?.full_name).toBe('JaneDoe')
    })

    it('writes successfully with a lone surrogate in location, replaced by U+FFFD', async () => {
      const result = await createCandidate(harness.sb, {
        full_name: 'Zoe Legal',
        email: `surrogate-${Date.now()}@example.com`,
        phone: null,
        location: `Aberdeen${LONE_HIGH}`,
        current_role_title: null,
        current_company: null,
        market_status: 'actively_looking',
        source: 'apply_form',
        organization_id: harness.orgId,
        source_detail: null,
        consent_basis: 'consent',
        consent_at: new Date().toISOString(),
        consent_text_version: 'integration-v1',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const { data } = await harness.sb
        .from('candidates')
        .select('location')
        .eq('id', result.data.id)
        .single()
      expect(data?.location).toBe(`Aberdeen${FFFD}`)
    })

    it('leaves legitimate unicode completely untouched', async () => {
      const result = await createCandidate(harness.sb, {
        full_name: "Zoë O'Brien-Şahin",
        email: `unicode-${Date.now()}@example.com`,
        phone: null,
        location: '张伟 / مرحبا',
        current_role_title: null,
        current_company: null,
        market_status: 'actively_looking',
        source: 'apply_form',
        organization_id: harness.orgId,
        source_detail: null,
        consent_basis: 'consent',
        consent_at: new Date().toISOString(),
        consent_text_version: 'integration-v1',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const { data } = await harness.sb
        .from('candidates')
        .select('full_name, location')
        .eq('id', result.data.id)
        .single()
      expect(data?.full_name).toBe("Zoë O'Brien-Şahin")
      expect(data?.location).toBe('张伟 / مرحبا')
    })
  })

  // -------------------------------------------------------------------
  // WHY upsertCandidateFromLinkedIn IS NOT EXERCISED HERE
  //
  // It cannot be, with this harness. Its INSERT deliberately omits
  // organization_id and relies on the BEFORE INSERT trigger
  // `candidates_set_org` resolving it from `current_organization_id()`,
  // i.e. from auth.uid(). This harness holds a SERVICE-ROLE client, which
  // has no auth.uid(), so the trigger raises P0001 for any caller —
  // sanitised payload or not. Confirmed empirically against this stack:
  //
  //   P0001 (candidates.insert: full_name, headline, about, email,
  //          location, current_role_title, current_company, skills,
  //          work_experience, education, source, source_detail,
  //          consent_basis, consent_at, consent_text_version)
  //
  // (That one-line diagnosis is itself the ME-03 `detail` widening paying
  // for itself — before it, this returned a bare `code: 'internal'`.)
  //
  // Covering it at layer 2 would mean teaching the harness to mint a real
  // authenticated session for a seeded user, which is a much larger change
  // than the fix it would verify. The LinkedIn path's sanitisation is
  // instead pinned at the unit level in
  // tests/unit/lib/db/write-boundary-sanitisation.test.ts, which captures
  // the exact payload handed to supabase-js and asserts recursively —
  // values AND keys — that neither illegal sequence survives.
  //
  // The layer-2 half of the guarantee still holds transitively: this file
  // proves a NUL and a lone surrogate in those same `candidates` columns
  // are accepted by the real database once sanitised, via createCandidate.
  // -------------------------------------------------------------------
})
