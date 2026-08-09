/**
 * @vitest-environment node
 *
 * confirmApplyAction — byte-level format sniff (plan 06-08, Task 3, T-06-29).
 *
 * The apply path's server never sees file bytes at submit — the browser PUTs
 * straight to Storage via a signed URL, so `confirmApplyAction` is the
 * earliest server-visible point. These tests drive the mismatch logic with
 * REAL corpus bytes (not synthetic stand-ins) through a mocked service
 * client whose `storage.download()` returns the fixture, forcing the code
 * down its full-download fallback path deterministically (no `createSignedUrl`
 * in the mock, matching how the two sibling confirm-action test files in
 * this directory already stub the service client).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: () => null,
  }),
}))

const SENTRY_CAPTURES: Array<{ message: string; tags?: Record<string, string> }> = []
const SENTRY_BREADCRUMBS: Array<{ message?: string; category?: string; level?: string }> = []
vi.mock('@sentry/nextjs', () => ({
  captureException: (e: unknown, ctx?: { tags?: Record<string, string> }) => {
    SENTRY_CAPTURES.push({
      message: e instanceof Error ? e.message : String(e),
      tags: ctx?.tags,
    })
  },
  addBreadcrumb: (b: { message?: string; category?: string; level?: string }) => {
    SENTRY_BREADCRUMBS.push(b)
  },
}))

vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'test' },
}))

const inngestSendMock = vi.fn(async () => undefined)
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendMock },
}))

// Org is entitled throughout — these tests are about the byte sniff, not
// the entitlement gate (covered by confirm-action-entitlement-skip.test.ts).
vi.mock('@/lib/stripe/require-entitlement', () => ({
  isOrgEntitled: vi.fn(async () => true),
}))

vi.mock('@/lib/db/organizations', () => ({
  getOrganizationBySlug: vi.fn(async () => ({ ok: true, data: { id: 'org-1' } })),
}))

type CvRow = {
  id: string
  organization_id: string
  candidate_id: string
  storage_path: string
  mime_type: string
}

// Mutable per-test fixture state — the service-client mock factory below
// reads these at CALL time (each `it()` mutates them before invoking
// confirmApplyAction), not at module-load time.
let cvRow: CvRow = {
  id: 'cv-1',
  organization_id: 'org-1',
  candidate_id: 'cand-1',
  storage_path: 'org-1/applicants/cand-1-abc.pdf',
  mime_type: 'application/pdf',
}
let downloadBytes: Uint8Array | null = null
let downloadShouldError = false

const UPDATE_CALLS: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: cvRow, error: null }),
            }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        UPDATE_CALLS.push(patch)
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({ data: { id: cvRow.id }, error: null }),
            }),
          }),
        }
      },
    }),
    storage: {
      from: () => ({
        list: async () => ({
          data: [{ name: cvRow.storage_path.split('/').pop() }],
          error: null,
        }),
        // Deliberately NO createSignedUrl on this mock — the production code
        // catches that (TypeError: not a function) and falls through to the
        // full-download fallback below, exercising that path
        // deterministically without needing to stub global fetch.
        download: async () => {
          if (downloadShouldError || downloadBytes === null) {
            return {
              data: null,
              error: downloadShouldError ? new Error('download failed') : null,
            }
          }
          // Uint8Array<ArrayBufferLike> isn't directly assignable to
          // BlobPart (TS's ArrayBufferView<ArrayBuffer> constraint) — slice
          // to a genuine, non-shared ArrayBuffer first.
          const arrayBuffer = downloadBytes.buffer.slice(
            downloadBytes.byteOffset,
            downloadBytes.byteOffset + downloadBytes.byteLength,
          ) as ArrayBuffer
          return { data: new Blob([arrayBuffer]), error: null }
        },
      }),
    },
  }),
}))

const CORPUS_DIR = join(process.cwd(), 'tests/fixtures/cv-corpus')
function corpusBytes(relPath: string): Uint8Array {
  return readFileSync(join(CORPUS_DIR, relPath))
}

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

beforeEach(() => {
  SENTRY_CAPTURES.length = 0
  SENTRY_BREADCRUMBS.length = 0
  UPDATE_CALLS.length = 0
  inngestSendMock.mockClear()
  downloadBytes = null
  downloadShouldError = false
  cvRow = {
    id: 'cv-1',
    organization_id: 'org-1',
    candidate_id: 'cand-1',
    storage_path: 'org-1/applicants/cand-1-abc.pdf',
    mime_type: PDF_MIME,
  }
})

async function callConfirm() {
  const { confirmApplyAction } = await import('@/app/(public)/apply/[orgSlug]/actions')
  return confirmApplyAction({
    candidateId: 'cand-1',
    candidateCvId: 'cv-1',
    orgSlug: 'acme-co',
  })
}

describe('confirmApplyAction — positive-contradiction rejections (plan 06-08 Task 3)', () => {
  it('DOCX bytes stored under declared PDF mime: rejected, row marked failed, inngest NOT called', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.pdf'
    cvRow.mime_type = PDF_MIME
    downloadBytes = corpusBytes('tier1/t1-docx-simple.docx')

    const result = await callConfirm()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.formError).toMatch(/isn.t a PDF or Word/)
    }
    expect(inngestSendMock).not.toHaveBeenCalled()
    const failedUpdate = UPDATE_CALLS.find((p) => p.parsing_status === 'failed')
    expect(failedUpdate).toBeDefined()
    expect(failedUpdate?.parse_error).toMatch(/isn.t a PDF or Word/)
    expect(failedUpdate?.parse_error_detail).toBe('apply-confirm: signature mismatch')
  })

  it('PDF bytes stored under declared DOCX mime: rejected, row marked failed, inngest NOT called', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.docx'
    cvRow.mime_type = DOCX_MIME
    downloadBytes = corpusBytes('tier1/t1-pdf-single-column.pdf')

    const result = await callConfirm()

    expect(result.ok).toBe(false)
    expect(inngestSendMock).not.toHaveBeenCalled()
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(true)
  })

  it('ODT bytes stored under declared PDF mime (zip + declared PDF is unambiguous): rejected', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.pdf'
    cvRow.mime_type = PDF_MIME
    downloadBytes = corpusBytes('tier2/t2-opendocument.odt')

    const result = await callConfirm()

    expect(result.ok).toBe(false)
    expect(inngestSendMock).not.toHaveBeenCalled()
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(true)
  })

  it('legacy OLE2 .doc bytes stored under an allowed mime: rejected', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.pdf'
    cvRow.mime_type = PDF_MIME
    downloadBytes = corpusBytes('tier2/t2-legacy.doc')

    const result = await callConfirm()

    expect(result.ok).toBe(false)
    expect(inngestSendMock).not.toHaveBeenCalled()
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(true)
  })

  it('RTF bytes stored under an allowed mime: rejected', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.docx'
    cvRow.mime_type = DOCX_MIME
    downloadBytes = corpusBytes('tier2/t2-plain.rtf')

    const result = await callConfirm()

    expect(result.ok).toBe(false)
    expect(inngestSendMock).not.toHaveBeenCalled()
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(true)
  })

  it('plain TXT bytes stored under an allowed mime: rejected', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.pdf'
    cvRow.mime_type = PDF_MIME
    downloadBytes = corpusBytes('tier2/t2-plain.txt')

    const result = await callConfirm()

    expect(result.ok).toBe(false)
    expect(inngestSendMock).not.toHaveBeenCalled()
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(true)
  })
})

describe('confirmApplyAction — genuine files proceed unaffected (plan 06-08 Task 3)', () => {
  it('a genuine PDF declared as PDF proceeds: entitlement gate then inngest.send', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.pdf'
    cvRow.mime_type = PDF_MIME
    downloadBytes = corpusBytes('tier1/t1-pdf-single-column.pdf')

    const result = await callConfirm()

    expect(result.ok).toBe(true)
    expect(inngestSendMock).toHaveBeenCalledTimes(1)
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(false)
  })

  it('a genuine DOCX declared as DOCX proceeds: entitlement gate then inngest.send', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.docx'
    cvRow.mime_type = DOCX_MIME
    downloadBytes = corpusBytes('tier1/t1-docx-simple.docx')

    const result = await callConfirm()

    expect(result.ok).toBe(true)
    expect(inngestSendMock).toHaveBeenCalledTimes(1)
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(false)
  })
})

describe('confirmApplyAction — inconclusive ambiguity is resolved in the applicant’s favour (T-06-34)', () => {
  it('ODT bytes stored under declared DOCX mime (zip, no DOCX entries) is NOT rejected — allowed through', async () => {
    // This is the exact fixture that proves a header-only magic-byte check
    // is insufficient (manifest.json's own rationale for t2-opendocument.odt)
    // — but on the APPLY path specifically, "zip declared as DOCX with no
    // DOCX entries found" is deliberately treated as inconclusive (the read
    // window could theoretically be incomplete for a genuine DOCX), not a
    // rejection. A false rejection of a real CV is worse than a delayed
    // honest message from the async pipeline (which downloads the FULL
    // object and would classify this ODT correctly via 06-07's
    // classifyExtractionError).
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.docx'
    cvRow.mime_type = DOCX_MIME
    downloadBytes = corpusBytes('tier2/t2-opendocument.odt')

    const result = await callConfirm()

    expect(result.ok).toBe(true)
    expect(inngestSendMock).toHaveBeenCalledTimes(1)
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(false)
    // Observability: the inconclusive zip case still leaves a breadcrumb
    // trail recording isDocxArchive's actual (false) result.
    const zipBreadcrumb = SENTRY_BREADCRUMBS.find((b) => b.message?.includes('zip signature'))
    expect(zipBreadcrumb).toBeDefined()
    expect(zipBreadcrumb?.message).toContain('isDocxArchive=false')
  })
})

describe('confirmApplyAction — a Storage read failure never blocks the application', () => {
  it('download() erroring falls through to the existing behaviour: proceeds, breadcrumb logged, inngest still called', async () => {
    cvRow.storage_path = 'org-1/applicants/cand-1-abc.pdf'
    cvRow.mime_type = PDF_MIME
    downloadShouldError = true

    const result = await callConfirm()

    expect(result.ok).toBe(true)
    expect(inngestSendMock).toHaveBeenCalledTimes(1)
    expect(UPDATE_CALLS.some((p) => p.parsing_status === 'failed')).toBe(false)
    const readFailureBreadcrumb = SENTRY_BREADCRUMBS.find((b) =>
      b.message?.includes('byte-sniff read failed'),
    )
    expect(readFailureBreadcrumb).toBeDefined()
  })
})
