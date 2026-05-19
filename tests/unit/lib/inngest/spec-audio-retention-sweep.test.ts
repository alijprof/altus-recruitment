/**
 * @vitest-environment node
 *
 * Pins Pitfall 10: the retention sweep MUST anchor on status_changed_at,
 * NOT created_at. A draft can sit at 'ready_for_review' for months before
 * the recruiter approves it — anchoring on created_at would silently
 * delete audio before the recruiter ever reviewed it.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-fake',
    INNGEST_EVENT_KEY: 'evt-fake',
    INNGEST_SIGNING_KEY: 'sign-fake',
  },
}))

// Capture filter calls on the from('spec_drafts') query so we can assert
// the lt() filter targets status_changed_at, not created_at.
const ltCalls: Array<{ column: string; value: string }> = []
const inCalls: Array<{ column: string; values: unknown }> = []

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        in: (column: string, values: unknown) => {
          inCalls.push({ column, values })
          return {
            lt: (column2: string, value: string) => {
              ltCalls.push({ column: column2, value })
              return {
                not: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }
            },
          }
        },
      }),
    }),
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  }),
}))

describe('spec-audio-retention-sweep — Pitfall 10', () => {
  it('anchors the retention window on status_changed_at, not created_at', async () => {
    const { specAudioRetentionSweep } = await import(
      '@/lib/inngest/functions/spec-audio-retention-sweep'
    )

    const internal = specAudioRetentionSweep as unknown as {
      fn: (ctx: {
        step: { run: (name: string, fn: () => unknown) => unknown }
      }) => Promise<unknown>
    }
    if (typeof internal.fn !== 'function') {
      throw new Error('Inngest function shape changed — expected `.fn` handler.')
    }

    await internal.fn({
      step: { run: vi.fn(async (_name: string, fn: () => unknown) => fn()) },
    })

    expect(ltCalls.length).toBeGreaterThanOrEqual(1)
    const lt = ltCalls[0]
    expect(lt?.column).toBe('status_changed_at')
    expect(lt?.column).not.toBe('created_at')

    // Sanity-check the status filter so we're sure we're only sweeping
    // approved/rejected rows (not pending/transcribing/ready_for_review).
    expect(inCalls[0]?.column).toBe('status')
    expect(inCalls[0]?.values).toEqual(['approved', 'rejected'])
  })
})
