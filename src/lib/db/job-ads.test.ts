/**
 * @vitest-environment node
 *
 * Plan 03-04 / Task D.2 — job_ads DB helpers.
 *
 * Asserts the helper contract:
 *  - createJobAd does NOT thread organization_id (the _set_org trigger
 *    fills it server-side per the table migration; passing it client-side
 *    would conflict with the trigger / be rejected by the cross-tenant FK
 *    guard for any non-matching value).
 *  - listJobAdsForJob filters by job_id and orders newest-first.
 *  - Both helpers Sentry-capture on error and return DbResult discriminants.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

import { createJobAd, listJobAdsForJob } from '@/lib/db/job-ads'

type FilterCall = { method: string; col?: string; val?: unknown }

function buildClient(opts: {
  insertReturn?: { data: unknown; error: unknown }
  selectReturn?: { data: unknown[] | null; error: unknown }
}) {
  const filters: FilterCall[] = []
  let insertPayload: Record<string, unknown> | null = null

  const fromImpl = (table: string) => {
    if (table !== 'job_ads') throw new Error(`unexpected table: ${table}`)
    return {
      insert: (row: Record<string, unknown>) => {
        insertPayload = row
        const single = () =>
          Promise.resolve(
            opts.insertReturn ?? { data: { id: 'ad-1' }, error: null },
          )
        return {
          select: () => ({ single }),
        }
      },
      select: () => {
        const chain: {
          eq: (col: string, val: unknown) => typeof chain
          order: (
            col: string,
            opts?: unknown,
          ) => Promise<{ data: unknown[] | null; error: unknown }>
        } = {
          eq: (col, val) => {
            filters.push({ method: 'eq', col, val })
            return chain
          },
          order: (col, opts) => {
            filters.push({ method: 'order', col, val: opts })
            return Promise.resolve(
              opts ? opts : null,
            ) as unknown as Promise<{ data: unknown[] | null; error: unknown }>
          },
        }
        // Replace order to actually resolve to the selectReturn.
        chain.order = (col, opts) => {
          filters.push({ method: 'order', col, val: opts })
          return Promise.resolve(opts.selectReturn ?? opts.selectReturn ?? { data: [], error: null }) as unknown as Promise<{ data: unknown[] | null; error: unknown }>
        }
        // We need a closure over outer opts.
        const orderResolver = (
          col: string,
          orderOpts?: unknown,
        ): Promise<{ data: unknown[] | null; error: unknown }> => {
          filters.push({ method: 'order', col, val: orderOpts })
          return Promise.resolve(opts.selectReturn ?? { data: [], error: null })
        }
        chain.order = orderResolver
        return chain
      },
    }
  }

  const client = { from: fromImpl }
  return { client, filters, getInsertPayload: () => insertPayload }
}

describe('createJobAd()', () => {
  it('does NOT include organization_id in the insert payload (filled by _set_org trigger)', async () => {
    const { client, getInsertPayload } = buildClient({})
    const result = await createJobAd(client as never, {
      job_id: 'job-1',
      body_markdown: '# Engineer',
      inclusivity_score: 85,
      inclusivity_suggestions: [{ original: 'a', improved: 'b', reason: 'c' }],
      inclusivity_dimensions: { gender: { score: 90, flagged_phrases: [], rationale: '' } },
      model: 'claude-sonnet-4-6',
      cost_pence: 2,
    })
    expect(result.ok).toBe(true)
    const payload = getInsertPayload()
    expect(payload).not.toBeNull()
    expect(payload).not.toHaveProperty('organization_id')
    expect(payload?.job_id).toBe('job-1')
    expect(payload?.body_markdown).toBe('# Engineer')
    expect(payload?.inclusivity_score).toBe(85)
    expect(payload?.model).toBe('claude-sonnet-4-6')
    expect(payload?.cost_pence).toBe(2)
  })

  it('returns { ok: true, data: { id } } on success', async () => {
    const { client } = buildClient({
      insertReturn: { data: { id: 'ad-42' }, error: null },
    })
    const result = await createJobAd(client as never, {
      job_id: 'job-1',
      body_markdown: '# x',
      model: 'claude-sonnet-4-6',
      cost_pence: 1,
    })
    expect(result).toEqual({ ok: true, data: { id: 'ad-42' } })
  })

  it('Sentry-captures and returns { ok: false, code: internal } on insert error', async () => {
    captureExceptionMock.mockReset()
    const { client } = buildClient({
      insertReturn: { data: null, error: { message: 'unique violation' } },
    })
    const result = await createJobAd(client as never, {
      job_id: 'job-1',
      body_markdown: '# x',
      model: 'claude-sonnet-4-6',
      cost_pence: 1,
    })
    expect(result).toEqual({ ok: false, code: 'internal' })
    expect(captureExceptionMock).toHaveBeenCalled()
    const tags = (captureExceptionMock.mock.calls[0]?.[1] as { tags?: Record<string, string> })
      ?.tags
    expect(tags?.layer).toBe('db')
    expect(tags?.helper).toBe('createJobAd')
  })
})

describe('listJobAdsForJob()', () => {
  it('filters by job_id and orders by created_at desc (newest first)', async () => {
    const { client, filters } = buildClient({
      selectReturn: { data: [], error: null },
    })
    await listJobAdsForJob(client as never, 'job-7')
    const eqFilter = filters.find((f) => f.method === 'eq' && f.col === 'job_id')
    expect(eqFilter?.val).toBe('job-7')
    const orderFilter = filters.find((f) => f.method === 'order' && f.col === 'created_at')
    expect(orderFilter).toBeDefined()
    expect((orderFilter?.val as { ascending: boolean }).ascending).toBe(false)
  })

  it('returns rows on success', async () => {
    const fakeRow = {
      id: 'ad-1',
      organization_id: 'org-1',
      job_id: 'job-7',
      body_markdown: '# x',
      inclusivity_score: 80,
      inclusivity_suggestions: null,
      inclusivity_dimensions: null,
      model: 'claude-sonnet-4-6',
      cost_pence: 1,
      created_by: null,
      created_at: '2026-05-20T00:00:00Z',
      updated_at: '2026-05-20T00:00:00Z',
    }
    const { client } = buildClient({
      selectReturn: { data: [fakeRow], error: null },
    })
    const result = await listJobAdsForJob(client as never, 'job-7')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toHaveLength(1)
      expect(result.data[0]?.id).toBe('ad-1')
    }
  })

  it('Sentry-captures and returns internal on error', async () => {
    captureExceptionMock.mockReset()
    const { client } = buildClient({
      selectReturn: { data: null, error: { message: 'boom' } },
    })
    const result = await listJobAdsForJob(client as never, 'job-7')
    expect(result).toEqual({ ok: false, code: 'internal' })
    expect(captureExceptionMock).toHaveBeenCalled()
    const tags = (captureExceptionMock.mock.calls[0]?.[1] as { tags?: Record<string, string> })
      ?.tags
    expect(tags?.helper).toBe('listJobAdsForJob')
  })
})
