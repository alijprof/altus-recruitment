/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

// VERIFICATION M-8: mock inngest.send to throw inside confirmApplyAction;
// confirm the candidate row + cv row still persist and the action returns
// ok (the user reaches the success page; recruiter can hit Phase 1's Retry
// button to re-fire cv/uploaded).

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (_k: string) => null,
  }),
}))

const SENTRY_CAPTURES: Array<{ message: string; tags?: Record<string, string> }> = []
vi.mock('@sentry/nextjs', () => ({
  captureException: (e: unknown, ctx?: { tags?: Record<string, string> }) => {
    SENTRY_CAPTURES.push({
      message: e instanceof Error ? e.message : String(e),
      tags: ctx?.tags,
    })
  },
  addBreadcrumb: () => {},
}))

vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'test' },
}))

// Stub the inngest client to throw on send.
vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    send: vi.fn(async () => {
      throw new Error('inngest network down')
    }),
  },
}))

// Entitlement gate (quick task 260618-sjo): the org is entitled, so the
// cv/uploaded enqueue path runs and we can exercise the inngest-failure
// fallback (M-8). The not-entitled skip path is covered in its own test.
vi.mock('@/lib/stripe/require-entitlement', () => ({
  isOrgEntitled: vi.fn(async () => true),
}))

// confirmApplyAction now derives the org from the slug (the org UUID is no
// longer passed by the client). Mock the slug → org lookup.
vi.mock('@/lib/db/organizations', () => ({
  getOrganizationBySlug: vi.fn(async () => ({ ok: true, data: { id: 'org-1' } })),
}))

// Stub the service client to return:
//   * candidate_cvs row by id → matching row
//   * storage.list → exact-name match
//   * update() → records the patch so we can assert the row is flipped to
//     'failed' when inngest.send throws (behaviour now changed — see below)
const UPDATE_CALLS: Array<Record<string, unknown>> = []
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: (_c1: string, _v1: string) => ({
          eq: (_c2: string, _v2: string) => ({
            eq: (_c3: string, _v3: string) => ({
              maybeSingle: async () => ({
                data: {
                  id: 'cv-1',
                  organization_id: 'org-1',
                  candidate_id: 'cand-1',
                  storage_path: 'org-1/applicants/cand-1-abc.pdf',
                  mime_type: 'application/pdf',
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        UPDATE_CALLS.push(patch)
        return {
          eq: (_c: string, _v: string) => ({
            select: () => ({
              single: async () => ({ data: { id: 'cv-1' }, error: null }),
            }),
          }),
        }
      },
    }),
    storage: {
      from: (_bucket: string) => ({
        list: async (_dir: string, _opts: unknown) => ({
          data: [{ name: 'cand-1-abc.pdf' }],
          error: null,
        }),
      }),
    },
  }),
}))

describe('confirmApplyAction — inngest fallback (M-8, SF-4 fix)', () => {
  it('returns ok even when inngest.send throws; logs PII-safe Sentry event; marks the row failed', async () => {
    SENTRY_CAPTURES.length = 0
    UPDATE_CALLS.length = 0
    const { confirmApplyAction } = await import('@/app/(public)/apply/[orgSlug]/actions')
    const result = await confirmApplyAction({
      candidateId: 'cand-1',
      candidateCvId: 'cv-1',
      orgSlug: 'acme-co',
    })

    // M-8: action MUST return ok=true so the user reaches the success page.
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.redirectTo).toBe('/apply/acme-co/success')
    }

    // Sentry MUST have captured the inngest.send failure with a PII-safe
    // message (no email, no name) and the canonical tag set.
    const sendFailure = SENTRY_CAPTURES.find((c) =>
      c.message.includes('apply-confirm: inngest.send'),
    )
    expect(sendFailure).toBeDefined()
    expect(sendFailure?.tags?.action).toBe('confirmApplyAction')
    expect(sendFailure?.tags?.subop).toBe('inngest.send')
    // No email / name in the message.
    expect(sendFailure?.message).not.toMatch(/@/)

    // SF-4 fix: the row must flip to 'failed' so the recruiter's Retry
    // button actually renders — previously this was an "M-8 fallback"
    // comment that left the row 'pending' forever with no retry affordance.
    const failedUpdate = UPDATE_CALLS.find((p) => p.parsing_status === 'failed')
    expect(failedUpdate).toBeDefined()
  })
})
