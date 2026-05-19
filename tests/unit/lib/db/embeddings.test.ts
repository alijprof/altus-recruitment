/**
 * @vitest-environment node
 *
 * Phase 2 review C1 regression test — ensures the hybrid-search helpers
 * forward `organizationId` to the RPC as `p_organization_id`. Without
 * this, service-role callers would scan candidates across all orgs (the
 * exact CRITICAL leak C1 closes).
 *
 * The test exercises the wrapper code paths only; the actual SQL filter
 * is verified by the migration's manual smoke tests (see
 * supabase/migrations/20260519130000_match_candidates_for_job_org_filter.sql
 * header).
 */
import { describe, expect, it, vi } from 'vitest'

// `server-only` is a pure marker — stub it so the module loads under
// vitest's node env.
vi.mock('server-only', () => ({}))

// Avoid pulling in the real Sentry SDK in the test runtime — the helpers
// only call captureException on error paths, which we don't exercise here.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
}))

import {
  getTopCandidatesByVector,
  getTopCandidatesForJob,
  hybridSearchCandidates,
} from '@/lib/db/embeddings'

// Minimal Supabase client mock that captures the rpc args so the test can
// assert on them. The wrapper only uses `.rpc(name, args)`.
type RpcArgs = Record<string, unknown>

type MockClient = {
  rpc: (fn: string, args: RpcArgs) => Promise<{ data: unknown; error: unknown }>
}

function mockClient(): {
  client: MockClient
  calls: Array<{ fn: string; args: RpcArgs }>
} {
  const calls: Array<{ fn: string; args: RpcArgs }> = []
  const client: MockClient = {
    rpc: (fn: string, args: RpcArgs) => {
      calls.push({ fn, args })
      return Promise.resolve({ data: [], error: null })
    },
  }
  return { client, calls }
}

describe('hybridSearchCandidates — Phase 2 C1 tenant guard', () => {
  it('forwards organizationId to the RPC as p_organization_id', async () => {
    const { client, calls } = mockClient()
    const result = await hybridSearchCandidates(client as never, {
      queryText: 'senior python dev',
      queryEmbedding: [0.1, 0.2, 0.3],
      organizationId: 'org-A',
      matchCount: 10,
      minCosineSimilarity: 0.5,
    })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.fn).toBe('match_candidates')
    expect(calls[0]?.args).toMatchObject({
      p_query_text: 'senior python dev',
      p_organization_id: 'org-A',
      p_match_count: 10,
      p_min_cosine_similarity: 0.5,
    })
  })

  it('passes a different org id for a different tenant — does not leak across calls', async () => {
    const { client, calls } = mockClient()
    await hybridSearchCandidates(client as never, {
      queryText: 'q1',
      queryEmbedding: [0.1],
      organizationId: 'org-A',
    })
    await hybridSearchCandidates(client as never, {
      queryText: 'q2',
      queryEmbedding: [0.2],
      organizationId: 'org-B',
    })

    expect(calls[0]?.args.p_organization_id).toBe('org-A')
    expect(calls[1]?.args.p_organization_id).toBe('org-B')
  })
})

describe('getTopCandidatesByVector — Phase 2 C1 tenant guard', () => {
  it('forwards organizationId through to the RPC', async () => {
    const { client, calls } = mockClient()
    await getTopCandidatesByVector(client as never, {
      jobEmbedding: [0.4, 0.5, 0.6],
      organizationId: 'org-X',
      limit: 5,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.fn).toBe('match_candidates')
    expect(calls[0]?.args.p_organization_id).toBe('org-X')
    expect(calls[0]?.args.p_match_count).toBe(5)
  })

  it('short-circuits to empty when jobEmbedding is empty (no RPC call)', async () => {
    const { client, calls } = mockClient()
    const result = await getTopCandidatesByVector(client as never, {
      jobEmbedding: [],
      organizationId: 'org-X',
    })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('getTopCandidatesForJob — Phase 2 C1 tenant guard', () => {
  it('forwards organizationId as p_organization_id to match_candidates_for_job', async () => {
    const { client, calls } = mockClient()
    await getTopCandidatesForJob(client as never, {
      jobId: 'job-1',
      organizationId: 'org-A',
      limit: 10,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.fn).toBe('match_candidates_for_job')
    expect(calls[0]?.args).toMatchObject({
      p_job_id: 'job-1',
      p_organization_id: 'org-A',
      p_match_count: 10,
    })
  })
})
