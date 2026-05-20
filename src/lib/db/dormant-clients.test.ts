/**
 * @vitest-environment node
 *
 * Plan 03-05 / Task E.1 — REPEAT-01.
 *
 * Asserts that `getDormantClients` calls the `dormant_clients` RPC with the
 * threshold defaults from D3-19 (60-day dormant, 90-day long-dormant) and
 * surfaces RPC failures as `{ ok: false, code: 'internal' }`.
 *
 * Cross-org invisibility is enforced server-side by the RPC running
 * `security invoker` — there is no client-side org filter to test here.
 * The acceptance criteria documents the manual psql smoke test that proves
 * cross-org rows are invisible.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

import { getDormantClients } from '@/lib/db/dormant-clients'

type RpcCall = { fn: string; args: Record<string, unknown> }

function buildClient(opts: {
  rpcData?: unknown
  rpcError?: { message: string } | null
}) {
  const rpcCalls: RpcCall[] = []
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      return Promise.resolve({
        data: opts.rpcData ?? null,
        error: opts.rpcError ?? null,
      })
    },
  }
  return { client, rpcCalls }
}

describe('getDormantClients (REPEAT-01)', () => {
  it('calls the dormant_clients RPC with default thresholds (60 / 90 per D3-19)', async () => {
    const { client, rpcCalls } = buildClient({ rpcData: [] })
    await getDormantClients(client as never)

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({
      fn: 'dormant_clients',
      args: { p_dormant_days: 60, p_long_dormant_days: 90 },
    })
  })

  it('respects custom threshold opts', async () => {
    const { client, rpcCalls } = buildClient({ rpcData: [] })
    await getDormantClients(client as never, { dormantDays: 30, longDormantDays: 75 })

    expect(rpcCalls[0]).toEqual({
      fn: 'dormant_clients',
      args: { p_dormant_days: 30, p_long_dormant_days: 75 },
    })
  })

  it('returns DbResult { ok: true, data } shape with the RPC rows', async () => {
    const rpcRows = [
      {
        client_id: 'company-1',
        client_name: 'Acme',
        last_contacted_at: '2026-02-01T00:00:00Z',
        days_since: 108,
        is_long_dormant: true,
        last_placement_summary: 'Senior Python Engineer placed Jan 2026',
      },
    ]
    const { client } = buildClient({ rpcData: rpcRows })
    const result = await getDormantClients(client as never)

    expect(result).toEqual({ ok: true, data: rpcRows })
  })

  it('returns { ok: false, code: "internal" } on RPC error', async () => {
    const { client } = buildClient({ rpcError: { message: 'permission denied' } })
    const result = await getDormantClients(client as never)

    expect(result).toEqual({ ok: false, code: 'internal' })
  })

  it('normalizes a null data response to an empty array', async () => {
    const { client } = buildClient({ rpcData: null })
    const result = await getDormantClients(client as never)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })
})
