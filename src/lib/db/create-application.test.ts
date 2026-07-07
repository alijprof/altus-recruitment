/**
 * @vitest-environment node
 *
 * min-25: createApplication error mapping. After the uniqueness index was
 * scoped to active stages, a 23505 now means a LIVE duplicate application
 * (not "re-application forever blocked"), so it maps to a 'duplicate' code
 * (friendly UX) and is NOT logged to Sentry as an exception. Any other DB
 * error still maps to 'internal' and IS captured.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

import { createApplication } from '@/lib/db/applications'

// Minimal client whose insert().select().single() resolves to a given result.
function clientReturning(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => result,
        }),
      }),
    }),
  }
}

type ClientArg = Parameters<typeof createApplication>[0]
const INPUT = { jobId: 'job-1', candidateId: 'cand-1' }

describe('createApplication error mapping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps a 23505 unique violation to code "duplicate" and does NOT log to Sentry', async () => {
    const client = clientReturning({ data: null, error: { code: '23505', message: 'dup' } })
    const result = await createApplication(client as unknown as ClientArg, INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('duplicate')
    expect(captureException).not.toHaveBeenCalled()
  })

  it('maps a non-23505 DB error to "internal" and logs to Sentry', async () => {
    const client = clientReturning({ data: null, error: { code: '23503', message: 'fk' } })
    const result = await createApplication(client as unknown as ClientArg, INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('internal')
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('returns ok with the row on success', async () => {
    const row = { id: 'app-1', job_id: 'job-1', candidate_id: 'cand-1' }
    const client = clientReturning({ data: row, error: null })
    const result = await createApplication(client as unknown as ClientArg, INPUT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual(row)
    expect(captureException).not.toHaveBeenCalled()
  })
})
