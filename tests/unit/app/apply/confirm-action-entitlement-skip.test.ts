/**
 * @vitest-environment node
 *
 * Quick task 260618-sjo / audit blocker 2 — public apply form AI-spend gate.
 *
 * The applicant's submission is NOT a paid feature: confirmApplyAction must
 * still resolve ok (candidate + CV already stored above), but for a
 * NON-ENTITLED org it must SKIP the cv/uploaded Inngest enqueue so the org
 * cannot drive Haiku parse + Voyage embed spend. This is the only place the
 * embed path can be stopped (it bypasses checkCap).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (_k: string) => null,
  }),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'test' },
}))

// inngest.send must NEVER be called on the not-entitled path.
const inngestSendMock = vi.fn(async () => undefined)
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendMock },
}))

// Service client: returns the cv row by id + a storage listing that confirms
// the object exists (so we reach the enqueue decision point).
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
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
    }),
    storage: {
      from: () => ({
        list: async () => ({ data: [{ name: 'cand-1-abc.pdf' }], error: null }),
      }),
    },
  }),
}))

// The org is NOT entitled — the enqueue must be skipped.
vi.mock('@/lib/stripe/require-entitlement', () => ({
  isOrgEntitled: vi.fn(async () => false),
}))

describe('confirmApplyAction — entitlement AI-spend skip', () => {
  it('keeps the candidate (ok=true) but does NOT enqueue cv/uploaded when not entitled', async () => {
    inngestSendMock.mockClear()
    const { confirmApplyAction } = await import('@/app/(public)/apply/[orgSlug]/actions')

    const result = await confirmApplyAction({
      candidateId: 'cand-1',
      candidateCvId: 'cv-1',
      organizationId: 'org-1',
      orgSlug: 'acme-co',
    })

    // The applicant still reaches the success page — application is not paid.
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.redirectTo).toBe('/apply/acme-co/success')
    }
    // No AI parse/embed spend for the non-entitled org.
    expect(inngestSendMock).not.toHaveBeenCalled()
  })
})
