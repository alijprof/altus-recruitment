/**
 * @vitest-environment node
 *
 * cv-file-display — the pure filename derivation + download-eligibility
 * predicate shared by the RSC candidate page, the client View control, and
 * the Playwright smoke spec (07-08-PLAN.md). Every case here mirrors a
 * behaviour bullet in 07-01-PLAN.md Task 1.
 */
import { describe, expect, it } from 'vitest'

import {
  CV_FILE_FALLBACK_NAME,
  CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY,
  cvDisplayFilename,
  isCvFileDownloadable,
} from '@/lib/cv/cv-file-display'
import { CV_DAMAGED_FILE_MESSAGE, CV_UPLOAD_INCOMPLETE_MESSAGE } from '@/lib/cv/parse-messages'

describe('cvDisplayFilename', () => {
  it('strips a leading uuid-and-hyphen prefix from the basename', () => {
    expect(
      cvDisplayFilename('org/cand/3f2504e0-4f89-11d3-9a0c-0305e82c3301-jane-smith-cv.pdf'),
    ).toBe('jane-smith-cv.pdf')
  })

  it('leaves a basename with no uuid prefix untouched', () => {
    expect(cvDisplayFilename('org/cand/no-uuid-here.docx')).toBe('no-uuid-here.docx')
  })

  it('falls back to the placeholder for an empty string', () => {
    expect(cvDisplayFilename('')).toBe(CV_FILE_FALLBACK_NAME)
  })

  it('falls back to the placeholder for null', () => {
    expect(cvDisplayFilename(null)).toBe(CV_FILE_FALLBACK_NAME)
  })

  it('falls back to the placeholder for undefined', () => {
    expect(cvDisplayFilename(undefined)).toBe(CV_FILE_FALLBACK_NAME)
  })

  it('falls back to the placeholder when the basename is only the uuid prefix', () => {
    expect(cvDisplayFilename('org/cand/3f2504e0-4f89-11d3-9a0c-0305e82c3301-')).toBe(
      CV_FILE_FALLBACK_NAME,
    )
  })
})

describe('isCvFileDownloadable', () => {
  it('returns false when the upload never finished', () => {
    expect(
      isCvFileDownloadable({
        storage_path: 'org/cand/uuid-file.pdf',
        parse_error: CV_UPLOAD_INCOMPLETE_MESSAGE,
      }),
    ).toBe(false)
  })

  it('returns true for a complete parse with no error', () => {
    expect(
      isCvFileDownloadable({ storage_path: 'org/cand/uuid-file.pdf', parse_error: null }),
    ).toBe(true)
  })

  it('returns true for a pending parse with no error', () => {
    expect(
      isCvFileDownloadable({ storage_path: 'org/cand/uuid-file.pdf', parse_error: null }),
    ).toBe(true)
  })

  it('returns true for a failed parse that is not upload-incomplete (a damaged file)', () => {
    expect(
      isCvFileDownloadable({
        storage_path: 'org/cand/uuid-file.pdf',
        parse_error: CV_DAMAGED_FILE_MESSAGE,
      }),
    ).toBe(true)
  })

  it('returns false for a null storage_path', () => {
    expect(isCvFileDownloadable({ storage_path: null, parse_error: null })).toBe(false)
  })

  it('returns false for an empty storage_path', () => {
    expect(isCvFileDownloadable({ storage_path: '', parse_error: null })).toBe(false)
  })
})

describe('CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY', () => {
  it('points the recruiter at the Upload CV control', () => {
    expect(CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY).toMatch(/Upload CV/)
  })
})
