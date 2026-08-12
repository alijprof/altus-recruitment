/**
 * @vitest-environment node
 *
 * RESID-02 (Phase 8 re-review, 2026-08-12) — regression coverage for the
 * CR-01 missing-column-tolerance hotfix in src/lib/db/organizations.ts.
 *
 * CR-01 ended a live production incident: organizations.logo_storage_path
 * shipped in code ahead of its migration (20260812120100), and PostgREST
 * fails a SELECT naming an unknown column WHOLE (42703) — every reader in
 * this module 404'd the public apply form and 400'd Stripe checkout/portal
 * for roughly 40 minutes. The fix (commits 6861dfc / 871b8b6) added a
 * retry-without-the-column fallback to getOrganization, getOrganizationBySlug
 * and updateOrganization. The re-review (08-REVIEW.md RESID-02) found this
 * fix had ZERO regression coverage anywhere in the suite — nothing exercised
 * 42703 against organizations.ts. This file closes that gap.
 *
 * The invariant that matters most: updateOrganization must NEVER retry when
 * the caller is actually trying to WRITE logo_storage_path and the column is
 * missing — that would silently drop the write and fake success to
 * uploadOrgLogoAction (the silent-failure class CLAUDE.md forbids). It must
 * instead fail loudly ({ ok: false }).
 *
 * Mocking pattern mirrors tests/unit/lib/db/candidate-branded-cvs.test.ts
 * and tests/unit/lib/branding/org-logo.test.ts (hand-rolled Supabase client
 * stubs matching the exact chain shapes organizations.ts calls).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

beforeEach(() => {
  captureExceptionMock.mockClear()
})

import { getOrganization, getOrganizationBySlug, updateOrganization } from '@/lib/db/organizations'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const MISSING_COLUMN_ERROR = {
  code: '42703',
  message: 'column "logo_storage_path" does not exist',
}
const OTHER_ERROR = { code: '08006', message: 'connection failure' }

type QueryResult = { data: unknown; error: unknown }

/**
 * Mirrors the `.select(cols).eq(col, val).maybeSingle()` chain used by
 * getOrganization / getOrganizationBySlug. Each call to maybeSingle()
 * consumes the next entry in `results` (clamped once exhausted), so a
 * two-entry array models "first select fails, retry select succeeds".
 */
function buildSelectStub(results: QueryResult[]) {
  const selectCalls: string[] = []
  let callIndex = 0
  const client = {
    from: (_table: string) => ({
      select: (cols: string) => {
        selectCalls.push(cols)
        return {
          eq: (_col: string, _val: string) => ({
            maybeSingle: async (): Promise<QueryResult> => {
              const idx = Math.min(callIndex, results.length - 1)
              callIndex += 1
              return results[idx] as QueryResult
            },
          }),
        }
      },
    }),
  }
  return { client, selectCalls, callCount: () => callIndex }
}

/**
 * Mirrors the `.update(payload).eq(col, val).select(cols).single()` chain
 * used by updateOrganization.
 */
function buildUpdateStub(results: QueryResult[]) {
  const selectCalls: string[] = []
  const payloads: Record<string, unknown>[] = []
  let callIndex = 0
  const client = {
    from: (_table: string) => ({
      update: (payload: Record<string, unknown>) => {
        payloads.push(payload)
        return {
          eq: (_col: string, _val: string) => ({
            select: (cols: string) => {
              selectCalls.push(cols)
              return {
                single: async (): Promise<QueryResult> => {
                  const idx = Math.min(callIndex, results.length - 1)
                  callIndex += 1
                  return results[idx] as QueryResult
                },
              }
            },
          }),
        }
      },
    }),
  }
  return { client, selectCalls, payloads, callCount: () => callIndex }
}

const PRE_MIGRATION_ROW = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  logo_url: null,
  apply_form_enabled: true,
  stripe_customer_id: null,
  brand_primary: null,
  brand_secondary: null,
}

const PRE_MIGRATION_APPLY_ROW = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  apply_form_enabled: true,
  logo_url: null,
  brand_primary: null,
  brand_secondary: null,
}

describe('getOrganization — 42703 (missing logo_storage_path column) retry', () => {
  it('(a) retries without logo_storage_path on 42703 and returns the row with logo_storage_path: null', async () => {
    const { client, selectCalls, callCount } = buildSelectStub([
      { data: null, error: MISSING_COLUMN_ERROR },
      { data: PRE_MIGRATION_ROW, error: null },
    ])

    const result = await getOrganization(client as never, ORG_ID)

    expect(callCount()).toBe(2)
    expect(selectCalls[0]).toContain('logo_storage_path')
    expect(selectCalls[1]).not.toContain('logo_storage_path')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.logo_storage_path).toBeNull()
      expect(result.data.id).toBe(ORG_ID)
    }
  })

  it('(b) does NOT retry on a non-42703 error and returns internal', async () => {
    const { client, callCount } = buildSelectStub([{ data: null, error: OTHER_ERROR }])

    const result = await getOrganization(client as never, ORG_ID)

    expect(callCount()).toBe(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('internal')
    expect(captureExceptionMock).toHaveBeenCalled()
  })

  it('(d) does not retry when the first query succeeds', async () => {
    const { client, callCount } = buildSelectStub([
      {
        data: { ...PRE_MIGRATION_ROW, logo_storage_path: `${ORG_ID}/logo.png` },
        error: null,
      },
    ])

    const result = await getOrganization(client as never, ORG_ID)

    expect(callCount()).toBe(1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.logo_storage_path).toBe(`${ORG_ID}/logo.png`)
  })
})

describe('getOrganizationBySlug — 42703 (missing logo_storage_path column) retry', () => {
  it('(a) retries without logo_storage_path on 42703 and returns the row with logo_storage_path: null', async () => {
    const { client, selectCalls, callCount } = buildSelectStub([
      { data: null, error: MISSING_COLUMN_ERROR },
      { data: PRE_MIGRATION_APPLY_ROW, error: null },
    ])

    const result = await getOrganizationBySlug(client as never, 'acme')

    expect(callCount()).toBe(2)
    expect(selectCalls[0]).toContain('logo_storage_path')
    expect(selectCalls[1]).not.toContain('logo_storage_path')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.logo_storage_path).toBeNull()
      expect(result.data.slug).toBe('acme')
    }
  })

  it('(b) does NOT retry on a non-42703 error and returns internal', async () => {
    const { client, callCount } = buildSelectStub([{ data: null, error: OTHER_ERROR }])

    const result = await getOrganizationBySlug(client as never, 'acme')

    expect(callCount()).toBe(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('internal')
    expect(captureExceptionMock).toHaveBeenCalled()
  })

  it('(d) does not retry when the first query succeeds', async () => {
    const { client, callCount } = buildSelectStub([
      {
        data: { ...PRE_MIGRATION_APPLY_ROW, logo_storage_path: `${ORG_ID}/logo.png` },
        error: null,
      },
    ])

    const result = await getOrganizationBySlug(client as never, 'acme')

    expect(callCount()).toBe(1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.logo_storage_path).toBe(`${ORG_ID}/logo.png`)
  })
})

describe('updateOrganization — 42703 retry is gated on the write not touching logo_storage_path', () => {
  it('(c) retries when the patch does NOT include logo_storage_path and the column is missing', async () => {
    const { client, selectCalls, payloads, callCount } = buildUpdateStub([
      { data: null, error: MISSING_COLUMN_ERROR },
      { data: PRE_MIGRATION_ROW, error: null },
    ])

    const result = await updateOrganization(client as never, ORG_ID, { name: 'New Name' })

    expect(callCount()).toBe(2)
    // updateOrganization re-issues .update() on retry too (not just .select()) —
    // the retry replays the same payload against the pre-migration column set.
    expect(payloads).toEqual([{ name: 'New Name' }, { name: 'New Name' }])
    expect(selectCalls[0]).toContain('logo_storage_path')
    expect(selectCalls[1]).not.toContain('logo_storage_path')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.logo_storage_path).toBeNull()
  })

  it('(c) does NOT retry, and returns { ok: false }, when the patch includes logo_storage_path and the column is missing — no silent drop', async () => {
    const { client, callCount } = buildUpdateStub([{ data: null, error: MISSING_COLUMN_ERROR }])

    const result = await updateOrganization(client as never, ORG_ID, {
      logo_storage_path: `${ORG_ID}/logo-new.png`,
    })

    expect(
      callCount(),
      "must issue exactly ONE update attempt — a retry here would silently drop the caller's " +
        'logo_storage_path write and fake success to uploadOrgLogoAction',
    ).toBe(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('internal')
    expect(captureExceptionMock).toHaveBeenCalled()
  })

  it('(c) does NOT retry when logo_storage_path is explicitly set to null and the column is missing', async () => {
    // Explicit null is still "the caller is trying to write the column" —
    // patch.logo_storage_path !== undefined — so the guard must fail loudly
    // rather than silently accepting a write to a column that does not exist.
    const { client, callCount } = buildUpdateStub([{ data: null, error: MISSING_COLUMN_ERROR }])

    const result = await updateOrganization(client as never, ORG_ID, { logo_storage_path: null })

    expect(callCount()).toBe(1)
    expect(result.ok).toBe(false)
  })

  it('(d) does not retry when the first query succeeds', async () => {
    const { client, callCount } = buildUpdateStub([
      {
        data: { ...PRE_MIGRATION_ROW, logo_storage_path: `${ORG_ID}/logo.png` },
        error: null,
      },
    ])

    const result = await updateOrganization(client as never, ORG_ID, { name: 'New Name' })

    expect(callCount()).toBe(1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.logo_storage_path).toBe(`${ORG_ID}/logo.png`)
  })
})
