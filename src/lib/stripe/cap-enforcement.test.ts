/**
 * @vitest-environment node
 *
 * Unit tests for checkCap — 05-01 Task 1.4
 *
 * Tests the cap enforcement logic:
 *   <80%  → mode 'normal', allow true
 *   80%   → mode 'soft',   allow true
 *   100%  → mode 'hard',   allow false (match_score)
 *   100%  → mode 'hard',   allow false (cv_parse — queues, never blocks)
 *
 * TDD gate: written BEFORE the implementation exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    INNGEST_EVENT_KEY: 'test',
    INNGEST_SIGNING_KEY: 'test',
    MAX_MONTHLY_MATCH_SPEND_PENCE: 10000,
    NODE_ENV: 'test',
  },
}))

vi.mock('@/lib/stripe/entitlement', () => ({
  getEntitlement: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

// require-entitlement pulls in createClient/getProfile at module load (via its
// requireEntitledOrg export). cap-enforcement only consumes its PURE
// isEntitledStatus helper — stub the I/O deps so the real predicate runs while
// the module imports cleanly under Vitest.
vi.mock('@/lib/db/profiles', () => ({
  getProfile: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import type { Mock } from 'vitest'
import { getEntitlement } from '@/lib/stripe/entitlement'
import { createServiceClient } from '@/lib/supabase/service'
import { PLANS } from '@/lib/stripe/plans'

import { checkCap } from '@/lib/stripe/cap-enforcement'

const mockGetEntitlement = getEntitlement as Mock
const mockCreateServiceClient = createServiceClient as Mock

// Stub service client with no-op for ai_cap_notifications inserts
function makeServiceClientStub(insertResult: { error: null | { code: string } }) {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: insertResult.error ? null : { id: 'new' }, error: insertResult.error }),
        }),
      }),
    }),
  }
}

const BASE_ENTITLEMENT = {
  planKey: 'pro' as const,
  planSeats: 1,
  activeSeats: 1,
  status: 'active' as const,
  aiCaps: {
    matchScores: PLANS.pro.aiCaps.matchScores * 1,
    cvParses: PLANS.pro.aiCaps.cvParses * 1,
    searches: PLANS.pro.aiCaps.searches * 1,
    specMinutes: PLANS.pro.aiCaps.specMinutes * 1,
    writingCalls: PLANS.pro.aiCaps.writingCalls * 1,
  },
  softCapBreached: false,
  hardCapBreached: false,
}

describe('checkCap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateServiceClient.mockReturnValue(makeServiceClientStub({ error: null }))
  })

  it('<80% usage → normal mode, allow true', async () => {
    mockGetEntitlement.mockResolvedValue({
      ...BASE_ENTITLEMENT,
      aiUsageThisMonth: {
        matchScores: Math.floor(BASE_ENTITLEMENT.aiCaps.matchScores * 0.5),
        cvParses: 0,
        searches: 0,
        specMinutes: 0,
        writingCalls: 0,
      },
      softCapBreached: false,
      hardCapBreached: false,
    })

    const result = await checkCap('org-1', 'match_score')

    expect(result.allow).toBe(true)
    expect(result.mode).toBe('normal')
    expect(result.bucket).toBe('matchScores')
  })

  it('80% usage on bucket → soft mode, allow true', async () => {
    const cap = BASE_ENTITLEMENT.aiCaps.matchScores
    mockGetEntitlement.mockResolvedValue({
      ...BASE_ENTITLEMENT,
      aiUsageThisMonth: {
        matchScores: Math.floor(cap * 0.80),
        cvParses: 0,
        searches: 0,
        specMinutes: 0,
        writingCalls: 0,
      },
      softCapBreached: true,
      hardCapBreached: false,
    })

    const result = await checkCap('org-1', 'match_score')

    expect(result.allow).toBe(true)
    expect(result.mode).toBe('soft')
    expect(result.bucket).toBe('matchScores')
  })

  it('100% usage on match_score → hard mode, allow false', async () => {
    const cap = BASE_ENTITLEMENT.aiCaps.matchScores
    mockGetEntitlement.mockResolvedValue({
      ...BASE_ENTITLEMENT,
      aiUsageThisMonth: {
        matchScores: cap,
        cvParses: 0,
        searches: 0,
        specMinutes: 0,
        writingCalls: 0,
      },
      softCapBreached: true,
      hardCapBreached: true,
    })

    const result = await checkCap('org-1', 'match_score')

    expect(result.allow).toBe(false)
    expect(result.mode).toBe('hard')
    expect(result.bucket).toBe('matchScores')
  })

  it('100% usage on cv_parse → hard mode, allow false (cv_parse queues)', async () => {
    const cap = BASE_ENTITLEMENT.aiCaps.cvParses
    mockGetEntitlement.mockResolvedValue({
      ...BASE_ENTITLEMENT,
      aiUsageThisMonth: {
        matchScores: 0,
        cvParses: cap,
        searches: 0,
        specMinutes: 0,
        writingCalls: 0,
      },
      softCapBreached: true,
      hardCapBreached: true,
    })

    const result = await checkCap('org-1', 'cv_parse')

    expect(result.allow).toBe(false)
    expect(result.mode).toBe('hard')
    expect(result.bucket).toBe('cvParses')
  })

  // Entitlement-status deny matrix (audit blocker 2, quick task 260618-sjo).
  // A capped purpose UNDER cap must still be DENIED when the org is not
  // entitled (status ∉ {trialing, active}).
  it.each(['none', 'past_due', 'cancelled'] as const)(
    'non-entitled status %s → hard deny even under cap',
    async (status) => {
      mockGetEntitlement.mockResolvedValue({
        ...BASE_ENTITLEMENT,
        status,
        aiUsageThisMonth: {
          matchScores: 0,
          cvParses: 0,
          searches: 0,
          specMinutes: 0,
          writingCalls: 0,
        },
        softCapBreached: false,
        hardCapBreached: false,
      })

      const result = await checkCap('org-1', 'match_score')

      expect(result.allow).toBe(false)
      expect(result.mode).toBe('hard')
      expect(result.bucket).toBe('matchScores')
    },
  )

  it.each(['trialing', 'active'] as const)(
    'entitled status %s under cap → allow',
    async (status) => {
      mockGetEntitlement.mockResolvedValue({
        ...BASE_ENTITLEMENT,
        status,
        aiUsageThisMonth: {
          matchScores: Math.floor(BASE_ENTITLEMENT.aiCaps.matchScores * 0.1),
          cvParses: 0,
          searches: 0,
          specMinutes: 0,
          writingCalls: 0,
        },
        softCapBreached: false,
        hardCapBreached: false,
      })

      const result = await checkCap('org-1', 'match_score')

      expect(result.allow).toBe(true)
      expect(result.mode).toBe('normal')
      expect(result.bucket).toBe('matchScores')
    },
  )

  it('unknown purpose → normal mode, allow true (unknown purposes are not capped)', async () => {
    mockGetEntitlement.mockResolvedValue({
      ...BASE_ENTITLEMENT,
      aiUsageThisMonth: {
        matchScores: 0,
        cvParses: 0,
        searches: 0,
        specMinutes: 0,
        writingCalls: 0,
      },
      softCapBreached: false,
      hardCapBreached: false,
    })

    const result = await checkCap('org-1', 'some_internal_purpose')

    expect(result.allow).toBe(true)
    expect(result.mode).toBe('normal')
  })
})
