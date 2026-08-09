/**
 * @vitest-environment node
 *
 * Review 2026-08-09 ME-03 — the sibling write paths.
 *
 * The Phase-6 guards (coerceParsedCV + sanitiseForPostgres) existed at
 * exactly three call sites, all on the CV pipeline. But the LinkedIn ingest
 * and the public apply form write the SAME candidates columns
 * (full_name / headline / about / skills / work_experience / education /
 * location / current_role_title) from an extension-supplied JSON body and an
 * untrusted browser form respectively — and zod's `z.string()` accepts a NUL
 * and a lone surrogate without complaint.
 *
 * Either one turns the write into a deterministic 22P05 (Postgres) or
 * PGRST102 (PostgREST, before Postgres is even reached), reported to the
 * user as a generic failure with no root cause captured. That is the exact
 * shape of the 12 production rows this phase exists to explain.
 *
 * These tests capture the payload actually handed to supabase-js and assert
 * the illegal sequences are gone before it leaves our code.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))
vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_SERVICE_ROLE_KEY: 'test',
    ANTHROPIC_API_KEY: 'test',
    VOYAGE_API_KEY: 'test',
    INNGEST_EVENT_KEY: 'test',
    INNGEST_SIGNING_KEY: 'test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test',
    MAX_MONTHLY_MATCH_SPEND_PENCE: 10_000,
  },
}))
vi.mock('@/lib/ai/voyage', () => ({ embed: vi.fn() }))

import { createCandidate } from '@/lib/db/candidates'
import { upsertCandidateFromLinkedIn } from '@/lib/db/candidates-linkedin'

// Built from code points — a committed source file must contain no raw NUL
// and no raw lone surrogate (see src/lib/text/postgres-safe-text.ts).
const NUL = String.fromCharCode(0x00)
const LONE_HIGH = String.fromCharCode(0xd83d)
const FFFD = String.fromCharCode(0xfffd)
const LONE_SURROGATE_PROBE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** Recursively assert no NUL and no lone surrogate survive anywhere. */
function assertLegal(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    expect(value.includes(NUL), `${path} contains a NUL`).toBe(false)
    expect(LONE_SURROGATE_PROBE.test(value), `${path} contains a lone surrogate`).toBe(false)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertLegal(v, `${path}[${i}]`))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertLegal(k, `${path}.<key ${JSON.stringify(k)}>`)
      assertLegal(v, `${path}.${k}`)
    }
  }
}

const dirtyProfile = {
  name: `Jane${NUL}Doe`,
  headline: `Engineer ${LONE_HIGH}`,
  current_role: `Lead${NUL}Dev`,
  current_company: 'Northwind Offshore Ltd',
  location: `Aberdeen${LONE_HIGH}`,
  about: `About${NUL}me`,
  skills: [`Auto${NUL}CAD`, `P6 ${LONE_HIGH}`],
  work_experience: [{ role: `Dev${NUL}`, summary: `Text${LONE_HIGH}` }],
  education: [{ institution: `Uni${NUL}` }],
  linkedin_url: 'https://www.linkedin.com/in/jane/',
  email: 'jane@example.com',
}

describe('upsertCandidateFromLinkedIn — INSERT path sanitises at the boundary', () => {
  it('strips NUL and replaces lone surrogates in every field, keys included', async () => {
    let captured: unknown
    const client = {
      from() {
        return {
          select() {
            const chain = {
              eq: () => chain,
              ilike: () => chain,
              limit: () => chain,
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }
            return chain
          },
          insert(payload: unknown) {
            captured = payload
            const chain = {
              select: () => chain,
              single: () => Promise.resolve({ data: { id: 'cand-1' }, error: null }),
            }
            return chain
          },
        }
      },
    }

    const result = await upsertCandidateFromLinkedIn(client as never, {
      organizationId: 'org-1',
      profile: dirtyProfile,
    })

    expect(result.ok).toBe(true)
    assertLegal(captured)
    // Content is preserved apart from the two illegal sequences.
    const row = captured as Record<string, unknown>
    expect(row.full_name).toBe('JaneDoe')
    expect(row.headline).toBe(`Engineer ${FFFD}`)
    expect(row.current_company).toBe('Northwind Offshore Ltd')
  })
})

describe('upsertCandidateFromLinkedIn — UPDATE path sanitises at the boundary', () => {
  it('strips NUL and replaces lone surrogates in the patch', async () => {
    let captured: unknown
    const client = {
      from() {
        return {
          select() {
            const chain = {
              eq: () => chain,
              ilike: () => chain,
              limit: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: 'cand-1', organization_id: 'org-1', email: null },
                  error: null,
                }),
            }
            return chain
          },
          update(payload: unknown) {
            captured = payload
            const chain = {
              eq: () => chain,
              select: () => chain,
              single: () => Promise.resolve({ data: { id: 'cand-1' }, error: null }),
            }
            return chain
          },
        }
      },
    }

    const result = await upsertCandidateFromLinkedIn(client as never, {
      organizationId: 'org-1',
      profile: dirtyProfile,
    })

    expect(result.ok).toBe(true)
    assertLegal(captured)
    const patch = captured as Record<string, unknown>
    expect(patch.about).toBe('Aboutme')
  })
})

describe('createCandidate — the public apply form insert sanitises at the boundary', () => {
  it('strips NUL and replaces lone surrogates in untrusted form fields', async () => {
    let captured: unknown
    const client = {
      from() {
        return {
          insert(payload: unknown) {
            captured = payload
            const chain = {
              select: () => chain,
              single: () => Promise.resolve({ data: { id: 'cand-2' }, error: null }),
            }
            return chain
          },
        }
      },
    }

    const result = await createCandidate(client as never, {
      full_name: `Jane${NUL}Doe`,
      email: 'jane@example.com',
      phone: null,
      location: `Aberdeen${LONE_HIGH}`,
      current_role_title: `Lead${NUL}Dev`,
      current_company: null,
      market_status: 'actively_looking',
      source: 'apply_form',
      organization_id: 'org-1',
      source_detail: null,
      consent_basis: 'consent',
      consent_at: new Date('2026-08-09T00:00:00.000Z').toISOString(),
      consent_text_version: 'v1',
    })

    expect(result.ok).toBe(true)
    assertLegal(captured)
    const row = captured as Record<string, unknown>
    expect(row.full_name).toBe('JaneDoe')
    expect(row.location).toBe(`Aberdeen${FFFD}`)
  })
})
