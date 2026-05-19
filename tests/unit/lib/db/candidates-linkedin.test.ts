/**
 * @vitest-environment node
 *
 * Plan 03-01 Task A.2 — DB helpers for LinkedIn dedup + upsert.
 *
 * Asserted invariants:
 *   - getCandidateByLinkedInUrl matches on `source_detail` exactly (NOT
 *     .ilike — `_` and `%` would silently widen, per Phase 2 review M1).
 *   - getCandidateByEmailLowercase lowercases at the boundary (M2).
 *   - upsertCandidateFromLinkedIn dedups on linkedin_url first, falls back
 *     to email, and otherwise creates a new row with source='linkedin'
 *     and source_detail=<linkedin_url> per D3-03 + D3-04.
 *   - Defence-in-depth: when an existing row is returned by the dedup
 *     lookup, the upsert asserts its organization_id matches the caller
 *     and throws on mismatch. RLS makes this all but impossible, but the
 *     belt-and-braces matches the Phase 2 cross-tenant FK guard ethos.
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
vi.mock('@/lib/ai/voyage', () => ({ embed: vi.fn() }))

import {
  getCandidateByLinkedInUrl,
  getCandidateByEmailLowercase,
  upsertCandidateFromLinkedIn,
} from '@/lib/db/candidates-linkedin'

type FilterCall = { method: string; col: string; val: unknown }

function buildSelectStub(returnRow: unknown): {
  client: unknown
  filters: FilterCall[]
} {
  const filters: FilterCall[] = []
  type Chain = {
    eq: (col: string, val: unknown) => Chain
    ilike: (col: string, val: unknown) => Chain
    limit: (n: number) => Chain
    maybeSingle: () => Promise<{ data: unknown; error: null }>
  }
  function chain(): Chain {
    const c: Chain = {
      eq: (col, val) => {
        filters.push({ method: 'eq', col, val })
        return c
      },
      ilike: (col, val) => {
        filters.push({ method: 'ilike', col, val })
        return c
      },
      limit: () => c,
      maybeSingle: () => Promise.resolve({ data: returnRow, error: null }),
    }
    return c
  }
  const client = {
    from: () => ({ select: () => chain() }),
  }
  return { client, filters }
}

describe('getCandidateByLinkedInUrl', () => {
  it('uses .eq on source_detail (NOT .ilike — M1 invariant)', async () => {
    const { client, filters } = buildSelectStub(null)
    await getCandidateByLinkedInUrl(client as never, 'https://www.linkedin.com/in/alice/')
    const f = filters.find((x) => x.col === 'source_detail')
    expect(f?.method).toBe('eq')
    expect(f?.val).toBe('https://www.linkedin.com/in/alice/')
  })

  it('returns { ok: true, data: null } when the row is missing', async () => {
    const { client } = buildSelectStub(null)
    const r = await getCandidateByLinkedInUrl(client as never, 'https://www.linkedin.com/in/x/')
    expect(r).toEqual({ ok: true, data: null })
  })

  it('returns the candidate row when a match exists', async () => {
    const row = { id: 'cand-1', organization_id: 'org-1', email: 'a@b.com' }
    const { client } = buildSelectStub(row)
    const r = await getCandidateByLinkedInUrl(client as never, 'https://www.linkedin.com/in/alice/')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data?.id).toBe('cand-1')
  })
})

describe('getCandidateByEmailLowercase', () => {
  it('lowercases the email before querying (M2)', async () => {
    const { client, filters } = buildSelectStub(null)
    await getCandidateByEmailLowercase(client as never, 'Alice@Example.COM')
    const f = filters.find((x) => x.col === 'email')
    expect(f?.method).toBe('eq')
    expect(f?.val).toBe('alice@example.com')
  })

  it('returns { ok: true, data: null } when email is empty', async () => {
    const { client, filters } = buildSelectStub(null)
    const r = await getCandidateByEmailLowercase(client as never, '')
    expect(r).toEqual({ ok: true, data: null })
    expect(filters).toHaveLength(0)
  })
})

describe('upsertCandidateFromLinkedIn', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('updates an existing row when source_detail dedups', async () => {
    const updates: Array<{ table: string; patch: unknown; where: unknown }> = []
    const inserts: Array<{ table: string; row: unknown }> = []

    type SelectChain = {
      eq: (col: string, val: unknown) => SelectChain
      ilike: (col: string, val: unknown) => SelectChain
      limit: (n: number) => SelectChain
      maybeSingle: () => Promise<{ data: unknown; error: null }>
    }
    type UpdateChain = {
      eq: (col: string, val: unknown) => UpdateChain
      select: (cols: string) => UpdateChain
      single: () => Promise<{ data: { id: string }; error: null }>
    }
    type InsertChain = {
      select: (cols: string) => InsertChain
      single: () => Promise<{ data: { id: string }; error: null }>
    }

    let dedupCalls = 0
    const client = {
      from(table: string) {
        return {
          select(): SelectChain {
            const where: Record<string, unknown> = {}
            const chain: SelectChain = {
              eq: (col, val) => {
                where[col] = val
                return chain
              },
              ilike: (col, val) => {
                where[col] = val
                return chain
              },
              limit: () => chain,
              maybeSingle: () => {
                dedupCalls += 1
                if (dedupCalls === 1) {
                  // First call: getCandidateByLinkedInUrl — hit
                  return Promise.resolve({
                    data: { id: 'existing-1', organization_id: 'org-1' },
                    error: null,
                  })
                }
                return Promise.resolve({ data: null, error: null })
              },
            }
            return chain
          },
          update(patch: unknown) {
            const where: Record<string, unknown> = {}
            const chain: UpdateChain = {
              eq: (col, val) => {
                where[col] = val
                return chain
              },
              select: () => chain,
              single: () => {
                updates.push({ table, patch, where })
                return Promise.resolve({ data: { id: 'existing-1' }, error: null })
              },
            }
            return chain
          },
          insert(row: unknown): InsertChain {
            const chain: InsertChain = {
              select: () => chain,
              single: () => {
                inserts.push({ table, row })
                return Promise.resolve({ data: { id: 'new-1' }, error: null })
              },
            }
            return chain
          },
        }
      },
    }

    const result = await upsertCandidateFromLinkedIn(client as never, {
      organizationId: 'org-1',
      profile: {
        name: 'Alice Placeholder',
        headline: 'Engineer',
        current_role: 'Senior',
        current_company: 'PlaceholderCo',
        location: null,
        about: null,
        skills: ['TS'],
        work_experience: [],
        education: [],
        linkedin_url: 'https://www.linkedin.com/in/alice/',
        email: 'alice@example.com',
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.id).toBe('existing-1')
      expect(result.data.created).toBe(false)
    }
    // Should NOT have inserted.
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(1)
  })

  it('inserts a new row when both linkedin_url + email miss', async () => {
    const inserts: Array<{ row: unknown }> = []
    let dedupCalls = 0

    const client = {
      from() {
        return {
          select() {
            const chain = {
              eq: () => chain,
              ilike: () => chain,
              limit: () => chain,
              maybeSingle: () => {
                dedupCalls += 1
                return Promise.resolve({ data: null, error: null })
              },
            }
            return chain
          },
          insert(row: unknown) {
            inserts.push({ row })
            const chain = {
              select: () => chain,
              single: () => Promise.resolve({ data: { id: 'new-1' }, error: null }),
            }
            return chain
          },
        }
      },
    }

    const result = await upsertCandidateFromLinkedIn(client as never, {
      organizationId: 'org-1',
      profile: {
        name: 'Bob Placeholder',
        headline: null,
        current_role: null,
        current_company: null,
        location: null,
        about: null,
        skills: [],
        work_experience: [],
        education: [],
        linkedin_url: 'https://www.linkedin.com/in/bob/',
        email: null,
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.id).toBe('new-1')
      expect(result.data.created).toBe(true)
    }
    expect(inserts).toHaveLength(1)
    const row = inserts[0]?.row as Record<string, unknown>
    expect(row.source).toBe('linkedin')
    expect(row.source_detail).toBe('https://www.linkedin.com/in/bob/')
    expect(dedupCalls).toBeGreaterThanOrEqual(1)
  })

  it('refuses to update across tenants (defence-in-depth)', async () => {
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
                  data: { id: 'foreign-1', organization_id: 'org-OTHER' },
                  error: null,
                }),
            }
            return chain
          },
          update() {
            const chain = {
              eq: () => chain,
              select: () => chain,
              single: () => Promise.resolve({ data: null, error: null }),
            }
            return chain
          },
        }
      },
    }
    const result = await upsertCandidateFromLinkedIn(client as never, {
      organizationId: 'org-1',
      profile: {
        name: 'Eve',
        headline: null,
        current_role: null,
        current_company: null,
        location: null,
        about: null,
        skills: [],
        work_experience: [],
        education: [],
        linkedin_url: 'https://www.linkedin.com/in/eve/',
        email: null,
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('internal')
  })
})
