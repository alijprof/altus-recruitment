/**
 * @vitest-environment node
 *
 * Unit tests for the entitlement GATE helpers — quick task 260618-sjo.
 *
 * Policy under test: entitled ⟺ status ∈ {'trialing', 'active'}.
 * No carve-out for 'none' (the layout gates that card-first).
 *
 * Covers:
 *   - isEntitledStatus: the pure allow/deny matrix.
 *   - isOrgEntitled: true for trialing/active, false for none/past_due/cancelled,
 *     fail-CLOSED (false) on a thrown getEntitlement error.
 *   - requireEntitledOrg: unauthenticated, profile-miss, not-entitled, entitled,
 *     and fail-CLOSED on a thrown error.
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

vi.mock('@/lib/db/profiles', () => ({
  getProfile: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import type { Mock } from 'vitest'
import { getEntitlement } from '@/lib/stripe/entitlement'
import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'

import {
  ENTITLED_STATUSES,
  ENTITLEMENT_BLOCKED_MESSAGE,
  isEntitledStatus,
  isOrgEntitled,
  requireEntitledOrg,
} from '@/lib/stripe/require-entitlement'

const mockGetEntitlement = getEntitlement as Mock
const mockGetProfile = getProfile as Mock
const mockCreateClient = createClient as Mock

function entitlementWithStatus(status: string) {
  return {
    planKey: 'pro',
    planSeats: 1,
    activeSeats: 1,
    status,
    trialEnd: null,
    currentPeriodEnd: null,
    aiCaps: { matchScores: 1, cvParses: 1, searches: 1, specMinutes: 1, writingCalls: 1 },
    aiUsageThisMonth: { matchScores: 0, cvParses: 0, searches: 0, specMinutes: 0, writingCalls: 0 },
    softCapBreached: false,
    hardCapBreached: false,
  }
}

// Build a Supabase-server-client stub whose getUser resolves to the given user.
function makeClientStub(user: { id: string } | null) {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user }, error: null }),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ENTITLED_STATUSES + isEntitledStatus', () => {
  it('treats trialing and active (and only those) as entitled', () => {
    expect([...ENTITLED_STATUSES].sort()).toEqual(['active', 'trialing'])
    expect(isEntitledStatus('trialing')).toBe(true)
    expect(isEntitledStatus('active')).toBe(true)
  })

  it.each(['none', 'past_due', 'cancelled'] as const)(
    'treats %s as NOT entitled',
    (status) => {
      expect(isEntitledStatus(status)).toBe(false)
    },
  )

  it('exposes a non-empty blocked message', () => {
    expect(ENTITLEMENT_BLOCKED_MESSAGE.length).toBeGreaterThan(0)
  })
})

describe('isOrgEntitled', () => {
  it.each(['trialing', 'active'] as const)('returns true for %s', async (status) => {
    mockGetEntitlement.mockResolvedValue(entitlementWithStatus(status))
    expect(await isOrgEntitled('org-1')).toBe(true)
  })

  it.each(['none', 'past_due', 'cancelled'] as const)(
    'returns false for %s',
    async (status) => {
      mockGetEntitlement.mockResolvedValue(entitlementWithStatus(status))
      expect(await isOrgEntitled('org-1')).toBe(false)
    },
  )

  it('fails CLOSED (false) when getEntitlement throws', async () => {
    mockGetEntitlement.mockRejectedValue(new Error('db blip'))
    expect(await isOrgEntitled('org-1')).toBe(false)
  })
})

describe('requireEntitledOrg', () => {
  it('returns unauthenticated when there is no user', async () => {
    mockCreateClient.mockResolvedValue(makeClientStub(null))
    const gate = await requireEntitledOrg()
    expect(gate).toEqual({ ok: false, reason: 'unauthenticated' })
  })

  it('returns unauthenticated when the profile is missing', async () => {
    mockCreateClient.mockResolvedValue(makeClientStub({ id: 'user-1' }))
    mockGetProfile.mockResolvedValue({ ok: false, code: 'not_found' })
    const gate = await requireEntitledOrg()
    expect(gate).toEqual({ ok: false, reason: 'unauthenticated' })
  })

  it.each(['trialing', 'active'] as const)(
    'returns ok:true with resolved ids for %s',
    async (status) => {
      mockCreateClient.mockResolvedValue(makeClientStub({ id: 'user-1' }))
      mockGetProfile.mockResolvedValue({ ok: true, data: { organization_id: 'org-1' } })
      mockGetEntitlement.mockResolvedValue(entitlementWithStatus(status))
      const gate = await requireEntitledOrg()
      expect(gate).toEqual({ ok: true, userId: 'user-1', orgId: 'org-1', status })
    },
  )

  it.each(['none', 'past_due', 'cancelled'] as const)(
    'returns not_entitled for %s',
    async (status) => {
      mockCreateClient.mockResolvedValue(makeClientStub({ id: 'user-1' }))
      mockGetProfile.mockResolvedValue({ ok: true, data: { organization_id: 'org-1' } })
      mockGetEntitlement.mockResolvedValue(entitlementWithStatus(status))
      const gate = await requireEntitledOrg()
      expect(gate).toEqual({ ok: false, reason: 'not_entitled', status })
    },
  )

  it('fails CLOSED (not_entitled) when resolution throws', async () => {
    mockCreateClient.mockResolvedValue(makeClientStub({ id: 'user-1' }))
    mockGetProfile.mockResolvedValue({ ok: true, data: { organization_id: 'org-1' } })
    mockGetEntitlement.mockRejectedValue(new Error('db blip'))
    const gate = await requireEntitledOrg()
    expect(gate).toEqual({ ok: false, reason: 'not_entitled' })
  })
})
