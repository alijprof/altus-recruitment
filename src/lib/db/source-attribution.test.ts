/**
 * @vitest-environment node
 *
 * Plan 03-06 / Task F.2 — REPEAT-02.
 *
 * Asserts the contract for `getSourceAttribution`:
 *  - calls the `source_attribution_summary` RPC with `p_from` + `p_to`
 *    matching the helper args verbatim (date strings, no transformation);
 *  - returns DbResult<{ ok: true, data }> with rows passed through;
 *  - returns { ok: false, code: 'internal' } on RPC error and Sentry-captures.
 *
 * Cross-org invisibility is enforced server-side by `security invoker` on the
 * RPC — there is no client-side org filter to test here. The DB-level
 * pgsql harness in `supabase/tests/source-attribution-rpc.test.sql` covers
 * that branch (and CRITICAL-3: the `coalesce(placed_at, stage_changed_at)`
 * fallback for legacy NULL placed_at rows).
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

import { getSourceAttribution } from '@/lib/db/source-attribution'

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

describe('getSourceAttribution (REPEAT-02)', () => {
  it('calls source_attribution_summary RPC with p_from + p_to as supplied', async () => {
    const { client, rpcCalls } = buildClient({ rpcData: [] })
    await getSourceAttribution(client as never, {
      from: '2026-02-19',
      to: '2026-05-20',
    })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({
      fn: 'source_attribution_summary',
      args: { p_from: '2026-02-19', p_to: '2026-05-20' },
    })
  })

  it('returns DbResult { ok: true, data } with RPC rows verbatim', async () => {
    const rpcRows = [
      {
        source: 'linkedin',
        placements_count: 3,
        total_fee_pence: 1_500_000,
        avg_time_to_place_days: 42.5,
      },
      {
        source: 'apply_form',
        placements_count: 1,
        total_fee_pence: 400_000,
        avg_time_to_place_days: 21,
      },
    ]
    const { client } = buildClient({ rpcData: rpcRows })
    const result = await getSourceAttribution(client as never, {
      from: '2026-01-01',
      to: '2026-12-31',
    })

    expect(result).toEqual({ ok: true, data: rpcRows })
  })

  it('returns { ok: false, code: "internal" } on RPC error and Sentry-captures', async () => {
    captureExceptionMock.mockClear()
    const { client } = buildClient({ rpcError: { message: 'permission denied' } })
    const result = await getSourceAttribution(client as never, {
      from: '2026-01-01',
      to: '2026-12-31',
    })

    expect(result).toEqual({ ok: false, code: 'internal' })
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const [, ctx] = captureExceptionMock.mock.calls[0]!
    expect(ctx).toMatchObject({
      tags: {
        phase: 'p3',
        layer: 'db',
        helper: 'getSourceAttribution',
      },
    })
  })

  it('normalizes a null data response to an empty array', async () => {
    const { client } = buildClient({ rpcData: null })
    const result = await getSourceAttribution(client as never, {
      from: '2026-01-01',
      to: '2026-12-31',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })
})
