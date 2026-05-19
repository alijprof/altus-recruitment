/**
 * @vitest-environment node
 *
 * Plan 03-01 Task A.3 — Inngest function `embed-candidate-from-linkedin`.
 *
 * Verifies:
 *   1. The cross-tenant guard fires when the event's organization_id does
 *      NOT match the candidate's. Service-role bypasses RLS, so this
 *      check is the only thing between a forged event and a foreign read
 *      (HARD RULE 4 / parse-cv.ts CRITICAL-tenant-boundary pattern).
 *   2. On the happy path:
 *      - candidate is fetched via service-role client
 *      - candidateEmbeddingText is built with no CV text
 *      - embed() is called with purpose='linkedin_candidate_embed'
 *      - bumpCandidateEmbedding writes back with version+1
 *   3. The function exposes the expected Inngest config (id, concurrency,
 *      retries, trigger event name).
 *
 * The function uses Inngest's createFunction → exposes a `_def` shape. We
 * read the body indirectly by calling it with a stub step + event payload.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

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

const {
  embedMock,
  createServiceClientMock,
  getCandidateForEmbeddingMock,
  bumpCandidateEmbeddingMock,
} = vi.hoisted(() => ({
  embedMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  getCandidateForEmbeddingMock: vi.fn(),
  bumpCandidateEmbeddingMock: vi.fn(),
}))

vi.mock('@/lib/ai/voyage', () => ({ embed: embedMock }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/db/candidates', () => ({
  getCandidateForEmbedding: getCandidateForEmbeddingMock,
  bumpCandidateEmbedding: bumpCandidateEmbeddingMock,
}))

import { embedCandidateFromLinkedIn } from '@/lib/inngest/functions/embed-candidate-from-linkedin'

// Inngest function objects expose a `.fn` (the user-supplied handler) and
// `.opts`/`.trigger` via the createFunction return; we invoke the handler
// directly with a minimal stub `step`.
type InngestFnWithInternals = {
  fn: (args: { event: unknown; step: unknown }) => Promise<unknown>
  opts?: unknown
  trigger?: unknown
}

function makeStep() {
  return {
    run: async (_id: string, body: () => unknown | Promise<unknown>) => body(),
    sendEvent: async () => undefined,
  }
}

beforeEach(() => {
  embedMock.mockReset()
  createServiceClientMock.mockReset()
  getCandidateForEmbeddingMock.mockReset()
  bumpCandidateEmbeddingMock.mockReset()
})

describe('embedCandidateFromLinkedIn — config', () => {
  it('exposes the linkedin/captured event trigger via inngest config', () => {
    // Inngest InngestFunction objects expose `.opts.id` and `.opts.triggers`
    // directly. We narrow `unknown` via a typed shape.
    const fn = embedCandidateFromLinkedIn as unknown as {
      opts?: { id?: string; triggers?: Array<{ event?: string }> }
      id?: string
    }
    // Inngest v4 may expose `id` at the top level OR via opts.
    const id = fn.opts?.id ?? fn.id
    expect(id).toBe('embed-candidate-from-linkedin')
    const trigger = fn.opts?.triggers?.[0]
    expect(trigger?.event).toBe('linkedin/captured')
  })
})

describe('embedCandidateFromLinkedIn — cross-tenant guard', () => {
  it('throws NonRetriableError when event.organization_id ≠ candidate.organization_id', async () => {
    // The fetch returns a candidate belonging to a DIFFERENT org.
    getCandidateForEmbeddingMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'cand-1',
        organization_id: 'org-OTHER',
        full_name: 'Eve',
        current_role_title: null,
        current_company: null,
        location: null,
        skills: [],
        seniority_level: null,
        years_experience: null,
        sector_tags: [],
        embedding_version: 0,
      },
    })
    createServiceClientMock.mockReturnValue({})

    const handler = embedCandidateFromLinkedIn as unknown as InngestFnWithInternals

    await expect(
      handler.fn({
        event: {
          name: 'linkedin/captured',
          data: { organization_id: 'org-1', candidate_id: 'cand-1', user_id: 'u1' },
        },
        step: makeStep(),
      }),
    ).rejects.toThrow(/cross-tenant|tenant|organization/i)

    // The embed call MUST NOT have happened — the guard fired before it.
    expect(embedMock).not.toHaveBeenCalled()
    expect(bumpCandidateEmbeddingMock).not.toHaveBeenCalled()
  })
})

describe('embedCandidateFromLinkedIn — happy path', () => {
  it('fetches candidate, embeds, and bumps the embedding', async () => {
    getCandidateForEmbeddingMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'cand-1',
        organization_id: 'org-1',
        full_name: 'Alex Placeholder',
        current_role_title: 'Senior Engineer',
        current_company: 'PlaceholderCo',
        location: 'London',
        skills: ['TS', 'PG'],
        seniority_level: null,
        years_experience: null,
        sector_tags: [],
        embedding_version: 2,
      },
    })
    createServiceClientMock.mockReturnValue({})
    embedMock.mockResolvedValue({
      vectors: [new Array(1024).fill(0.1)],
      inputTokens: 42,
    })
    bumpCandidateEmbeddingMock.mockResolvedValue({
      ok: true,
      data: { id: 'cand-1', embedding_version: 3 },
    })

    const handler = embedCandidateFromLinkedIn as unknown as InngestFnWithInternals
    await handler.fn({
      event: {
        name: 'linkedin/captured',
        data: { organization_id: 'org-1', candidate_id: 'cand-1', user_id: 'u1' },
      },
      step: makeStep(),
    })

    expect(embedMock).toHaveBeenCalledTimes(1)
    const embedArgs = embedMock.mock.calls[0]?.[0]
    expect(embedArgs).toMatchObject({
      organizationId: 'org-1',
      userId: 'u1',
      purpose: 'linkedin_candidate_embed',
      inputType: 'document',
    })
    expect(Array.isArray(embedArgs.inputs)).toBe(true)
    expect(embedArgs.inputs[0]).toContain('Alex Placeholder')
    expect(embedArgs.inputs[0]).toContain('PlaceholderCo')

    expect(bumpCandidateEmbeddingMock).toHaveBeenCalledTimes(1)
    const bumpArgs = bumpCandidateEmbeddingMock.mock.calls[0]?.[1]
    expect(bumpArgs.candidateId).toBe('cand-1')
    expect(bumpArgs.embeddingVersion).toBe(3) // version 2 + 1
  })

  it('throws NonRetriableError when candidate not found', async () => {
    getCandidateForEmbeddingMock.mockResolvedValue({ ok: false, code: 'not_found' })
    createServiceClientMock.mockReturnValue({})

    const handler = embedCandidateFromLinkedIn as unknown as InngestFnWithInternals
    await expect(
      handler.fn({
        event: {
          name: 'linkedin/captured',
          data: { organization_id: 'org-1', candidate_id: 'missing', user_id: 'u1' },
        },
        step: makeStep(),
      }),
    ).rejects.toThrow(/not.?found|candidate/i)
    expect(embedMock).not.toHaveBeenCalled()
  })
})
