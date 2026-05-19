/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({ env: {} }))

import type { SupabaseClient } from '@supabase/supabase-js'

import { checkApplyFormRateLimit } from '@/lib/integrations/apply-form-rate-limit'
import type { Database } from '@/types/database'

// Build a fake Supabase client that pretends to be the
// apply_form_rate_limits table. The state map stores rows keyed by the
// composite PK so we can simulate the select / insert / update flow.

type Row = { count: number }

function makeFakeClient() {
  const state = new Map<string, Row>()

  const tableApi = {
    select: () => ({
      eq: (_c1: string, v1: string) => ({
        eq: (_c2: string, v2: string) => ({
          eq: (_c3: string, v3: string) => ({
            maybeSingle: async () => {
              const key = `${v1}|${v2}|${v3}`
              return { data: state.get(key) ?? null, error: null }
            },
          }),
        }),
      }),
    }),
    insert: async (payload: {
      ip_hash: string
      organization_id: string
      window_start: string
      count: number
    }) => {
      const key = `${payload.ip_hash}|${payload.organization_id}|${payload.window_start}`
      state.set(key, { count: payload.count })
      return { error: null }
    },
    update: (patch: { count: number }) => ({
      eq: (_c1: string, v1: string) => ({
        eq: (_c2: string, v2: string) => ({
          eq: (_c3: string, v3: string) => {
            const key = `${v1}|${v2}|${v3}`
            const existing = state.get(key)
            if (existing) state.set(key, { count: patch.count })
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }),
  }

  return {
    state,
    client: {
      from: (_table: string) => tableApi,
    } as unknown as SupabaseClient<Database>,
  }
}

describe('checkApplyFormRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-19T10:00:00Z'))
  })

  it('allows the first 3 submissions in a window and blocks the 4th', async () => {
    const { client } = makeFakeClient()
    const args = { ipHash: 'h1', organizationId: 'org-1' }

    // call 1: no row → insert count=1, allowed
    expect((await checkApplyFormRateLimit(client, args)).allowed).toBe(true)
    // call 2: count=1 (<3) → update to 2, allowed
    expect((await checkApplyFormRateLimit(client, args)).allowed).toBe(true)
    // call 3: count=2 (<3) → update to 3, allowed
    expect((await checkApplyFormRateLimit(client, args)).allowed).toBe(true)
    // call 4: count=3 (>=3) → denied
    expect((await checkApplyFormRateLimit(client, args)).allowed).toBe(false)
  })

  it('resets when the window advances (different bucket)', async () => {
    const { client } = makeFakeClient()
    const args = { ipHash: 'h2', organizationId: 'org-1' }

    await checkApplyFormRateLimit(client, args)
    await checkApplyFormRateLimit(client, args)
    await checkApplyFormRateLimit(client, args)
    expect((await checkApplyFormRateLimit(client, args)).allowed).toBe(false)

    // Advance time past the 5-minute bucket boundary.
    vi.setSystemTime(new Date('2026-05-19T10:06:00Z'))

    expect((await checkApplyFormRateLimit(client, args)).allowed).toBe(true)
  })

  it('different orgs do not share a bucket', async () => {
    const { client } = makeFakeClient()
    const ip = 'shared-ip'

    await checkApplyFormRateLimit(client, { ipHash: ip, organizationId: 'org-A' })
    await checkApplyFormRateLimit(client, { ipHash: ip, organizationId: 'org-A' })
    await checkApplyFormRateLimit(client, { ipHash: ip, organizationId: 'org-A' })
    expect(
      (await checkApplyFormRateLimit(client, { ipHash: ip, organizationId: 'org-A' })).allowed,
    ).toBe(false)

    expect(
      (await checkApplyFormRateLimit(client, { ipHash: ip, organizationId: 'org-B' })).allowed,
    ).toBe(true)
  })

  it('different IPs do not share a bucket', async () => {
    const { client } = makeFakeClient()
    const org = 'org-X'

    await checkApplyFormRateLimit(client, { ipHash: 'ip-A', organizationId: org })
    await checkApplyFormRateLimit(client, { ipHash: 'ip-A', organizationId: org })
    await checkApplyFormRateLimit(client, { ipHash: 'ip-A', organizationId: org })
    expect(
      (await checkApplyFormRateLimit(client, { ipHash: 'ip-A', organizationId: org })).allowed,
    ).toBe(false)

    expect(
      (await checkApplyFormRateLimit(client, { ipHash: 'ip-B', organizationId: org })).allowed,
    ).toBe(true)
  })
})
