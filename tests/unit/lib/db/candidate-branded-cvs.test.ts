/**
 * @vitest-environment node
 *
 * Phase 8 Plan 07 — candidate_branded_cvs db helper (migration-tolerant).
 *
 * Asserted invariants:
 *   - isMissingTableError (postgrest-errors.ts) is 42P01/PGRST205-only.
 *   - getBrandedCvState is a TRI-STATE resolver: ready / none / unavailable
 *     — unavailable both for a missing table AND for any other read error
 *     (never throws).
 *   - upsertBrandedCv performs an explicit read-then-update-or-insert: no
 *     existing row -> INSERT with previousStoragePath: null; existing row ->
 *     UPDATE in place (never a second row) reporting the OLD storage_path.
 *   - A concurrent-insert 23505 is recovered by re-reading + updating, not
 *     surfaced as an error.
 *   - organization_id is never set from an argument on either write path —
 *     the DB trigger owns it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const captureExceptionMock = vi.fn()
const addBreadcrumbMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
}))

beforeEach(() => {
  captureExceptionMock.mockClear()
  addBreadcrumbMock.mockClear()
})

import { isMissingTableError } from '@/lib/db/postgrest-errors'
import {
  getBrandedCvForCandidate,
  getBrandedCvState,
  upsertBrandedCv,
  type BrandedCvRow,
} from '@/lib/db/candidate-branded-cvs'

// ---------------------------------------------------------------------------
// isMissingTableError
// ---------------------------------------------------------------------------

describe('isMissingTableError', () => {
  it('matches 42P01 (Postgres undefined_table)', () => {
    expect(isMissingTableError({ code: '42P01', message: 'relation does not exist' })).toBe(true)
  })

  it('matches PGRST205 (PostgREST schema-cache table miss)', () => {
    expect(isMissingTableError({ code: 'PGRST205', message: 'Could not find the table' })).toBe(
      true,
    )
  })

  it('does NOT match a missing-COLUMN code (42703)', () => {
    expect(isMissingTableError({ code: '42703', message: 'column does not exist' })).toBe(false)
  })

  it('does NOT match a missing-COLUMN PostgREST code (PGRST204)', () => {
    expect(isMissingTableError({ code: 'PGRST204', message: 'column not found' })).toBe(false)
  })

  it('does NOT match a plain Error or null', () => {
    expect(isMissingTableError(new Error('boom'))).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fake Supabase client — mirrors the tests/unit/lib/db/* hand-rolled-stub
// pattern (see shortlists.test.ts). Matches the exact chain shapes
// candidate-branded-cvs.ts calls: select().eq().maybeSingle(),
// insert().select().single(), update().eq().select().single().
// ---------------------------------------------------------------------------

type QueryResult = { data: unknown; error: unknown }

function buildFakeClient(config: {
  selectResults?: QueryResult[]
  insertResult?: QueryResult
  updateResult?: QueryResult
}) {
  const calls = {
    selects: 0,
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  }
  let selectIndex = 0

  const client = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async (): Promise<QueryResult> => {
            const results = config.selectResults ?? [{ data: null, error: null }]
            const idx = Math.min(selectIndex, results.length - 1)
            selectIndex += 1
            calls.selects += 1
            return results[idx] as QueryResult
          },
        }),
      }),
      insert: (payload: Record<string, unknown>) => {
        calls.inserts.push(payload)
        return {
          select: (_cols: string) => ({
            single: async (): Promise<QueryResult> =>
              config.insertResult ?? { data: null, error: null },
          }),
        }
      },
      update: (payload: Record<string, unknown>) => {
        calls.updates.push(payload)
        return {
          eq: (_col: string, _val: string) => ({
            select: (_cols: string) => ({
              single: async (): Promise<QueryResult> =>
                config.updateResult ?? { data: null, error: null },
            }),
          }),
        }
      },
    }),
  }
  return { client, calls }
}

function row(overrides: Partial<BrandedCvRow> = {}): BrandedCvRow {
  return {
    id: 'branded-1',
    organization_id: 'org-1',
    candidate_id: 'cand-1',
    storage_path: 'org-1/cand-1/branded-cv-old.pdf',
    file_size_bytes: 12345,
    generated_by: 'user-1',
    generated_at: '2026-08-12T10:00:00Z',
    created_at: '2026-08-12T09:00:00Z',
    updated_at: '2026-08-12T10:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getBrandedCvState — the tri-state resolver
// ---------------------------------------------------------------------------

describe('getBrandedCvState', () => {
  it('returns { kind: "ready", row } when a row exists', async () => {
    const { client } = buildFakeClient({ selectResults: [{ data: row(), error: null }] })
    const state = await getBrandedCvState(client as never, 'cand-1')
    expect(state.kind).toBe('ready')
    if (state.kind === 'ready') expect(state.row.id).toBe('branded-1')
  })

  it('returns { kind: "none" } when no row exists', async () => {
    const { client } = buildFakeClient({ selectResults: [{ data: null, error: null }] })
    const state = await getBrandedCvState(client as never, 'cand-1')
    expect(state).toEqual({ kind: 'none' })
  })

  it('returns { kind: "unavailable" } when the table is missing (42P01)', async () => {
    captureExceptionMock.mockClear()
    const { client } = buildFakeClient({
      selectResults: [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }],
    })
    const state = await getBrandedCvState(client as never, 'cand-1')
    expect(state).toEqual({ kind: 'unavailable' })
    // Expected pre-migration state — a breadcrumb, never a captured exception.
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('returns { kind: "unavailable" } when the table is missing (PGRST205)', async () => {
    const { client } = buildFakeClient({
      selectResults: [{ data: null, error: { code: 'PGRST205', message: 'schema cache miss' } }],
    })
    const state = await getBrandedCvState(client as never, 'cand-1')
    expect(state).toEqual({ kind: 'unavailable' })
  })

  it('returns { kind: "unavailable" } — never throws — on any OTHER read error, and captures a PII-free Sentry event', async () => {
    captureExceptionMock.mockClear()
    const { client } = buildFakeClient({
      selectResults: [{ data: null, error: { code: '08006', message: 'connection failure' } }],
    })
    const state = await getBrandedCvState(client as never, 'cand-1')
    expect(state).toEqual({ kind: 'unavailable' })
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    // PII-free: no candidate id, name, storage path in the tags — only a
    // fixed layer/helper tag pair.
    const [, ctx] = captureExceptionMock.mock.calls[0] as [unknown, { tags?: Record<string, unknown> }]
    expect(ctx?.tags).toEqual({ layer: 'db', helper: 'getBrandedCvState' })
  })
})

// ---------------------------------------------------------------------------
// getBrandedCvForCandidate — DbResult-shaped, table-missing collapses to
// not_found (same as a genuinely absent row).
// ---------------------------------------------------------------------------

describe('getBrandedCvForCandidate', () => {
  it('returns ok:true with the row when it exists', async () => {
    const { client } = buildFakeClient({ selectResults: [{ data: row(), error: null }] })
    const result = await getBrandedCvForCandidate(client as never, 'cand-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.storage_path).toBe('org-1/cand-1/branded-cv-old.pdf')
  })

  it('returns not_found when the table is missing', async () => {
    const { client } = buildFakeClient({
      selectResults: [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }],
    })
    const result = await getBrandedCvForCandidate(client as never, 'cand-1')
    expect(result).toEqual({ ok: false, code: 'not_found' })
  })
})

// ---------------------------------------------------------------------------
// upsertBrandedCv
// ---------------------------------------------------------------------------

describe('upsertBrandedCv', () => {
  it('INSERTs when no row exists, and reports previousStoragePath: null', async () => {
    const inserted = row({ id: 'branded-new', storage_path: 'org-1/cand-1/branded-cv-new.pdf' })
    const { client, calls } = buildFakeClient({
      selectResults: [{ data: null, error: null }],
      insertResult: { data: inserted, error: null },
    })

    const result = await upsertBrandedCv(client as never, {
      candidateId: 'cand-1',
      storagePath: 'org-1/cand-1/branded-cv-new.pdf',
      fileSizeBytes: 999,
      generatedBy: 'user-1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.previousStoragePath).toBeNull()
      expect(result.data.row.id).toBe('branded-new')
    }
    expect(calls.inserts).toHaveLength(1)
    expect(calls.updates).toHaveLength(0)
  })

  it('UPDATEs the existing row in place (never inserts a second row) and reports the OLD storage_path', async () => {
    const existing = row({ storage_path: 'org-1/cand-1/branded-cv-old.pdf' })
    const updated = row({ storage_path: 'org-1/cand-1/branded-cv-new.pdf' })
    const { client, calls } = buildFakeClient({
      selectResults: [{ data: existing, error: null }],
      updateResult: { data: updated, error: null },
    })

    const result = await upsertBrandedCv(client as never, {
      candidateId: 'cand-1',
      storagePath: 'org-1/cand-1/branded-cv-new.pdf',
      fileSizeBytes: 1000,
      generatedBy: 'user-1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.previousStoragePath).toBe('org-1/cand-1/branded-cv-old.pdf')
      expect(result.data.row.storage_path).toBe('org-1/cand-1/branded-cv-new.pdf')
    }
    expect(calls.inserts).toHaveLength(0)
    expect(calls.updates).toHaveLength(1)
  })

  it('recovers a concurrent-insert 23505 unique violation by re-reading and updating, not surfacing an error', async () => {
    const raced = row({ storage_path: 'org-1/cand-1/branded-cv-raced-winner.pdf' })
    const updated = row({ storage_path: 'org-1/cand-1/branded-cv-new.pdf' })
    const { client, calls } = buildFakeClient({
      // 1st select: no existing row (so we attempt INSERT). 2nd select: the
      // re-read inside updateExisting's race-recovery path, after the insert
      // 23505s — this is where the OTHER request's row is now visible.
      selectResults: [
        { data: null, error: null },
        { data: raced, error: null },
      ],
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key value' } },
      updateResult: { data: updated, error: null },
    })

    const result = await upsertBrandedCv(client as never, {
      candidateId: 'cand-1',
      storagePath: 'org-1/cand-1/branded-cv-new.pdf',
      fileSizeBytes: 1000,
      generatedBy: 'user-1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.previousStoragePath).toBe('org-1/cand-1/branded-cv-raced-winner.pdf')
    }
    expect(calls.inserts).toHaveLength(1)
    expect(calls.updates).toHaveLength(1)
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('never sets organization_id on the INSERT payload — the DB trigger owns it', async () => {
    const { client, calls } = buildFakeClient({
      selectResults: [{ data: null, error: null }],
      insertResult: { data: row(), error: null },
    })
    await upsertBrandedCv(client as never, {
      candidateId: 'cand-1',
      storagePath: 'org-1/cand-1/branded-cv-new.pdf',
      fileSizeBytes: 1000,
      generatedBy: 'user-1',
    })
    expect(calls.inserts[0]).not.toHaveProperty('organization_id')
  })

  it('never sets organization_id on the UPDATE payload — the DB trigger owns it', async () => {
    const { client, calls } = buildFakeClient({
      selectResults: [{ data: row(), error: null }],
      updateResult: { data: row(), error: null },
    })
    await upsertBrandedCv(client as never, {
      candidateId: 'cand-1',
      storagePath: 'org-1/cand-1/branded-cv-new.pdf',
      fileSizeBytes: 1000,
      generatedBy: 'user-1',
    })
    expect(calls.updates[0]).not.toHaveProperty('organization_id')
  })

  it('returns an internal error carrying the missing-table code, without throwing, when the read hits an absent table', async () => {
    const { client } = buildFakeClient({
      selectResults: [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }],
    })
    const result = await upsertBrandedCv(client as never, {
      candidateId: 'cand-1',
      storagePath: 'org-1/cand-1/branded-cv-new.pdf',
      fileSizeBytes: 1000,
      generatedBy: 'user-1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('internal')
      expect(result.detail).toMatch(/^42P01/)
    }
  })
})
