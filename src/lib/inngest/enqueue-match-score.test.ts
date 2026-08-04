/**
 * @vitest-environment node
 *
 * enqueueApplicationMatchScore — SF-3 single fire-point for all four
 * application-create paths (Steele Charles feature review 2026-07-31 Batch
 * 2 Task 1). Behaviour under test:
 *   - no-ops (no inngest.send) when jobId is null (floats)
 *   - sends exactly one application/score-match event when all ids present
 *   - never throws when inngest.send rejects — captures to Sentry instead
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const send = vi.fn()
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: (...args: unknown[]) => send(...args) },
}))

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}))

import { enqueueApplicationMatchScore } from '@/lib/inngest/enqueue-match-score'

const BASE_ARGS = {
  organizationId: 'org-1',
  applicationId: 'app-1',
  candidateId: 'cand-1',
  jobId: 'job-1',
  userId: 'user-1',
}

describe('enqueueApplicationMatchScore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not call inngest.send when jobId is null (float)', async () => {
    await enqueueApplicationMatchScore({ ...BASE_ARGS, jobId: null })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not call inngest.send when organizationId or candidateId is empty', async () => {
    await enqueueApplicationMatchScore({ ...BASE_ARGS, organizationId: '' })
    await enqueueApplicationMatchScore({ ...BASE_ARGS, candidateId: '' })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends exactly one application/score-match event when all ids are present', async () => {
    send.mockResolvedValueOnce(undefined)
    await enqueueApplicationMatchScore(BASE_ARGS)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      id: 'score-match:cand-1:job-1',
      name: 'application/score-match',
      data: {
        organization_id: 'org-1',
        application_id: 'app-1',
        candidate_id: 'cand-1',
        job_id: 'job-1',
        user_id: 'user-1',
      },
    })
  })

  it('keys the Inngest dedup id on the candidate x job PAIR, not the application (M1)', async () => {
    // Two application rows for the same pair (shortlist promoted to standard,
    // or a double-clicked "Add to job") must collapse to one billed run.
    send.mockResolvedValue(undefined)
    await enqueueApplicationMatchScore(BASE_ARGS)
    await enqueueApplicationMatchScore({ ...BASE_ARGS, applicationId: 'app-2' })
    const ids = send.mock.calls.map((call) => (call[0] as { id: string }).id)
    expect(new Set(ids).size).toBe(1)
  })

  it('gives different pairs different dedup ids', async () => {
    send.mockResolvedValue(undefined)
    await enqueueApplicationMatchScore(BASE_ARGS)
    await enqueueApplicationMatchScore({ ...BASE_ARGS, candidateId: 'cand-2' })
    await enqueueApplicationMatchScore({ ...BASE_ARGS, jobId: 'job-2' })
    const ids = send.mock.calls.map((call) => (call[0] as { id: string }).id)
    expect(new Set(ids).size).toBe(3)
  })

  it('never throws when inngest.send rejects — captures to Sentry and resolves', async () => {
    send.mockRejectedValueOnce(new Error('boom'))
    await expect(enqueueApplicationMatchScore(BASE_ARGS)).resolves.toBeUndefined()
    expect(captureException).toHaveBeenCalledTimes(1)
  })
})
