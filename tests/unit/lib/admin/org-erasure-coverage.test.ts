/**
 * @vitest-environment node
 *
 * src/lib/admin/org-erasure.ts — Phase 8 Plan 08 GDPR sweep coverage
 * (BCV-06, T-08-52..55). candidate_branded_cvs (export) and org-logos
 * (storage) join the two existing erasure/export sweeps; a missing bucket
 * must never abort an Art.17 org erasure.
 *
 * Coverage:
 *   - ORG_EXPORT_TABLES includes candidate_branded_cvs
 *   - ORG_STORAGE_BUCKETS includes org-logos
 *   - listAllObjectPaths treats a bucket-not-found list error as zero
 *     objects, with a Sentry NOTE (org id + bucket name only, no PII, not an
 *     exception) instead of a throw
 *   - listAllObjectPaths still THROWS on a genuine list failure — the
 *     missing-bucket tolerance is narrow and does not swallow real errors
 *   - deleteAllOrgStorage completes across every bucket, including one that
 *     does not exist, without aborting the whole erasure
 *   - deleteAllOrgStorage still aborts (throws) on a genuine list failure in
 *     any bucket — the deliberate fail-closed behaviour is unchanged
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const captureExceptionMock = vi.fn()
const captureMessageMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  addBreadcrumb: vi.fn(),
}))

async function importModule() {
  return await import('@/lib/admin/org-erasure')
}

const ORG_ID = '11111111-1111-4111-8111-111111111111'

type ListResult = {
  data: Array<{ name: string; id: string | null }> | null
  error: unknown
}

function bucketNotFoundError() {
  return { message: 'Bucket not found', status: 404, statusCode: '404', name: 'StorageApiError' }
}

function genuineListError() {
  return { message: 'Internal Server Error', status: 500, statusCode: '500', name: 'StorageApiError' }
}

// A minimal fake client exposing only `storage.from(bucket).list()/.remove()`
// — the sole surface listAllObjectPaths/deleteAllOrgStorage touch. Each
// bucket's list behaviour is supplied per-test via `listImpl`; any bucket not
// explicitly configured returns an empty page (data: [], error: null), so
// tests only need to specify the bucket(s) they care about.
function fakeClient(
  listImpl: Record<string, () => Promise<ListResult>>,
  removeImpl: Record<
    string,
    (paths: string[]) => Promise<{ data: unknown[] | null; error: unknown }>
  > = {},
) {
  const storageFrom = vi.fn((bucket: string) => ({
    list: vi.fn(async () => listImpl[bucket]?.() ?? { data: [], error: null }),
    remove: vi.fn(
      async (paths: string[]) =>
        (await removeImpl[bucket]?.(paths)) ?? {
          data: paths.map((p) => ({ name: p })),
          error: null,
        },
    ),
  }))
  // reason: a deliberately narrow fake — only the storage surface these two
  // functions call is implemented; cast at the boundary, mirroring the
  // fake-client pattern used throughout this codebase's db-helper tests.
  return { storage: { from: storageFrom } } as unknown as Parameters<
    Awaited<ReturnType<typeof importModule>>['listAllObjectPaths']
  >[0]
}

beforeEach(() => {
  captureExceptionMock.mockReset()
  captureMessageMock.mockReset()
})

describe('ORG_EXPORT_TABLES / ORG_STORAGE_BUCKETS coverage', () => {
  it('ORG_EXPORT_TABLES includes candidate_branded_cvs so a GDPR export records generated-branded-copy history', async () => {
    const { ORG_EXPORT_TABLES } = await importModule()
    expect(ORG_EXPORT_TABLES).toContain('candidate_branded_cvs')
  })

  it('ORG_STORAGE_BUCKETS includes org-logos so org erasure removes the uploaded logo', async () => {
    const { ORG_STORAGE_BUCKETS } = await importModule()
    expect(ORG_STORAGE_BUCKETS).toContain('org-logos')
  })
})

describe('listAllObjectPaths — missing-bucket tolerance', () => {
  it('treats a bucket-not-found list error as zero objects, with a Sentry NOTE (org id + bucket only), no throw', async () => {
    const { listAllObjectPaths } = await importModule()
    const client = fakeClient({ 'org-logos': async () => ({ data: null, error: bucketNotFoundError() }) })

    const paths = await listAllObjectPaths(client, 'org-logos', ORG_ID)

    expect(paths).toEqual([])
    // A missing bucket is an EXPECTED pre-provisioning state, not a fault —
    // captureMessage (info), never captureException.
    expect(captureExceptionMock).not.toHaveBeenCalled()
    expect(captureMessageMock).toHaveBeenCalledTimes(1)
    const [message, ctx] = captureMessageMock.mock.calls[0] as [
      string,
      { level?: string; tags?: Record<string, unknown>; extra?: Record<string, unknown> },
    ]
    expect(message).toMatch(/bucket/i)
    expect(ctx.tags).toMatchObject({ helper: 'listAllObjectPaths', bucket: 'org-logos' })
    // PII pin: org id ONLY — never a row, a path, or any candidate-identifying value.
    expect(ctx.extra).toEqual({ org_id: ORG_ID })
  })

  it('still THROWS on a genuine list failure — the missing-bucket tolerance does not swallow real errors', async () => {
    const { listAllObjectPaths } = await importModule()
    const client = fakeClient({ cvs: async () => ({ data: null, error: genuineListError() }) })

    await expect(listAllObjectPaths(client, 'cvs', ORG_ID)).rejects.toBeTruthy()
    expect(captureMessageMock).not.toHaveBeenCalled()
  })
})

describe('deleteAllOrgStorage — missing-bucket tolerance', () => {
  it('completes across every bucket, including one that does not exist, without aborting the erasure', async () => {
    const removedFromCvs: string[][] = []
    const client = fakeClient(
      {
        cvs: async () => ({ data: [{ name: 'a.pdf', id: 'file-1' }], error: null }),
        'org-logos': async () => ({ data: null, error: bucketNotFoundError() }),
      },
      {
        cvs: async (paths) => {
          removedFromCvs.push(paths)
          return { data: paths.map((p) => ({ name: p })), error: null }
        },
      },
    )

    const total = await deleteAllOrgStorageFrom(client)

    expect(total).toBe(1)
    expect(removedFromCvs).toEqual([[`${ORG_ID}/a.pdf`]])
  })

  it('still aborts (throws) on a genuine list failure in any bucket', async () => {
    const client = fakeClient({
      'spec-audio': async () => ({ data: null, error: genuineListError() }),
    })

    await expect(deleteAllOrgStorageFrom(client)).rejects.toBeTruthy()
  })
})

// Thin indirection so both tests above share one import + call site for
// deleteAllOrgStorage(client, ORG_ID) without repeating the dynamic import.
async function deleteAllOrgStorageFrom(
  client: Parameters<Awaited<ReturnType<typeof importModule>>['deleteAllOrgStorage']>[0],
) {
  const { deleteAllOrgStorage } = await importModule()
  return deleteAllOrgStorage(client, ORG_ID)
}
