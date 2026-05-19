/**
 * @vitest-environment node
 *
 * Phase 2 review M1 + M2 regression tests — verify that
 * findCandidateByEmail and findContactByEmail:
 *   1. lowercase the input email (case-insensitive matching, M2)
 *   2. use `.eq` rather than `.ilike` so `_` and `%` are NOT wildcards
 *      (M1: prevents false-positive matches across rows)
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
}))

// Stub the env module so candidates.ts → voyage.ts → env.ts doesn't trip
// on missing test-runtime env vars. Only the keys voyage.ts/match.ts read
// matter at import time; everything else can stay undefined.
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

// voyage and match modules are not needed by these helpers — stub them
// to avoid pulling in the real SDK at import time.
vi.mock('@/lib/ai/voyage', () => ({
  embed: vi.fn(),
}))

import { findCandidateByEmail } from '@/lib/db/candidates'
import { findContactByEmail } from '@/lib/db/contacts'

type FilterCall = { method: string; col: string; val: unknown }

/**
 * Build a stub Supabase-like client that records every filter call
 * (.eq / .ilike etc) and returns `null` for maybeSingle (no match). The
 * recorded calls let the test assert which method (and which value) the
 * helper used.
 */
function buildStub(): {
  client: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => unknown
      }
    }
  }
  filters: FilterCall[]
} {
  const filters: FilterCall[] = []

  type Chain = {
    eq: (col: string, val: unknown) => Chain
    ilike: (col: string, val: unknown) => Chain
    limit: (n: number) => Chain
    maybeSingle: () => Promise<{ data: null; error: null }>
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
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    }
    return c
  }

  const client = {
    from: () => ({
      select: () => chain(),
    }),
  }

  return { client, filters }
}

describe('findCandidateByEmail — Phase 2 M1/M2', () => {
  it('lowercases the email before querying (M2 — case-insensitive)', async () => {
    const { client, filters } = buildStub()
    await findCandidateByEmail(
      client as never,
      'Alice@Example.COM',
      'org-1',
    )
    // The email filter should be lowercased.
    const emailFilter = filters.find((f) => f.col === 'email')
    expect(emailFilter?.val).toBe('alice@example.com')
  })

  it('uses .eq (NOT .ilike) so `_` is treated literally (M1 — no wildcard)', async () => {
    const { client, filters } = buildStub()
    await findCandidateByEmail(
      client as never,
      'john_doe@example.com',
      'org-1',
    )
    const emailFilter = filters.find((f) => f.col === 'email')
    // The fix is to use .eq, not .ilike. If .ilike were used, the `_`
    // would silently match `johnAdoe@example.com` etc.
    expect(emailFilter?.method).toBe('eq')
    expect(emailFilter?.val).toBe('john_doe@example.com')
  })

  it('returns { ok: true, data: null } for empty/whitespace email', async () => {
    const { client, filters } = buildStub()
    const result = await findCandidateByEmail(client as never, '   ', 'org-1')
    expect(result.ok).toBe(true)
    expect(filters).toHaveLength(0) // no DB hit
  })
})

describe('findContactByEmail — Phase 2 M1/M2', () => {
  it('lowercases the email before querying (M2)', async () => {
    const { client, filters } = buildStub()
    await findContactByEmail(
      client as never,
      'Bob@Example.COM',
      'org-1',
    )
    const emailFilter = filters.find((f) => f.col === 'email')
    expect(emailFilter?.val).toBe('bob@example.com')
  })

  it('uses .eq (NOT .ilike) for safe exact matching (M1)', async () => {
    const { client, filters } = buildStub()
    await findContactByEmail(
      client as never,
      'a_b@example.com',
      'org-1',
    )
    const emailFilter = filters.find((f) => f.col === 'email')
    expect(emailFilter?.method).toBe('eq')
    expect(emailFilter?.val).toBe('a_b@example.com')
  })
})
