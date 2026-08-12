/**
 * @vitest-environment node
 *
 * Plan 08-05 Task 1 — org-logo helper (buildOrgLogoPath / resolveOrgLogoUrl /
 * downloadOrgLogo) + the organizations.ts logo_storage_path plumbing.
 *
 * Asserted invariants:
 *   - buildOrgLogoPath: org id is always the first path segment, filename is
 *     never client-supplied (T-08-23).
 *   - resolveOrgLogoUrl implements the three-step precedence rule
 *     (logo_storage_path > logo_url > null) and never throws on a failed
 *     sign — captures a PII-free Sentry event tagged with the org id only.
 *   - downloadOrgLogo returns bytes for a real stored PNG/JPEG, and null for
 *     a missing path, a download error, or bytes that fail the magic-byte
 *     re-check (never trusts the object was validated once and stays valid).
 *   - getOrganization / getOrganizationBySlug / updateOrganization all carry
 *     logo_storage_path through their SELECT strings and the patch spread,
 *     undefined-preserving (matching the existing brand_primary style).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

import {
  ORG_LOGO_BUCKET,
  ORG_LOGO_SIGNED_URL_TTL_SECONDS,
  buildOrgLogoPath,
  resolveOrgLogoUrl,
  downloadOrgLogo,
} from '@/lib/branding/org-logo'
import { getOrganization, getOrganizationBySlug, updateOrganization } from '@/lib/db/organizations'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

function pngBytes(): Uint8Array {
  return new Uint8Array([...PNG_MAGIC, 0, 0, 0, 1, 2, 3])
}

function jpegBytes(): Uint8Array {
  return new Uint8Array([...JPEG_MAGIC, 0, 0, 1, 2, 3])
}

function blobFrom(bytes: Uint8Array) {
  return { arrayBuffer: async () => bytes.buffer.slice(0) }
}

beforeEach(() => {
  captureExceptionMock.mockReset()
})

describe('buildOrgLogoPath', () => {
  it('returns {orgId}/logo-{uuid}.{ext} — org id first, no client filename', () => {
    const path = buildOrgLogoPath(ORG_ID, 'png')
    expect(path).toMatch(/^11111111-1111-4111-8111-111111111111\/logo-[0-9a-f-]{36}\.png$/)
  })

  it('honours the ext parameter for jpg', () => {
    const path = buildOrgLogoPath(ORG_ID, 'jpg')
    expect(path.endsWith('.jpg')).toBe(true)
  })

  it('produces a distinct path on every call (no collision on replace)', () => {
    const a = buildOrgLogoPath(ORG_ID, 'png')
    const b = buildOrgLogoPath(ORG_ID, 'png')
    expect(a).not.toBe(b)
  })
})

describe('resolveOrgLogoUrl', () => {
  it('returns a signed URL when logo_storage_path is set', async () => {
    const createSignedUrlMock = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.test/signed/logo.png' },
      error: null,
    })
    const client = { storage: { from: vi.fn(() => ({ createSignedUrl: createSignedUrlMock })) } }

    const url = await resolveOrgLogoUrl(client as never, {
      id: ORG_ID,
      logo_storage_path: `${ORG_ID}/logo-abc.png`,
      logo_url: 'https://old-legacy-url.example.test/logo.png',
    })

    expect(url).toBe('https://storage.example.test/signed/logo.png')
    expect(client.storage.from).toHaveBeenCalledWith(ORG_LOGO_BUCKET)
    expect(createSignedUrlMock).toHaveBeenCalledWith(
      `${ORG_ID}/logo-abc.png`,
      ORG_LOGO_SIGNED_URL_TTL_SECONDS,
    )
  })

  it('returns the raw logo_url when only the legacy field is set', async () => {
    const client = { storage: { from: vi.fn() } }

    const url = await resolveOrgLogoUrl(client as never, {
      id: ORG_ID,
      logo_storage_path: null,
      logo_url: 'https://legacy.example.test/logo.png',
    })

    expect(url).toBe('https://legacy.example.test/logo.png')
    expect(client.storage.from).not.toHaveBeenCalled()
  })

  it('returns null when neither field is set', async () => {
    const client = { storage: { from: vi.fn() } }

    const url = await resolveOrgLogoUrl(client as never, {
      id: ORG_ID,
      logo_storage_path: null,
      logo_url: null,
    })

    expect(url).toBeNull()
  })

  it('never throws on a failed sign, returns null, captures a PII-free Sentry event', async () => {
    const createSignedUrlMock = vi.fn().mockResolvedValue({
      data: null,
      error: { name: 'StorageApiError', message: 'denied' },
    })
    const client = { storage: { from: vi.fn(() => ({ createSignedUrl: createSignedUrlMock })) } }

    const url = await resolveOrgLogoUrl(client as never, {
      id: ORG_ID,
      logo_storage_path: `${ORG_ID}/logo-abc.png`,
      logo_url: null,
    })

    expect(url).toBeNull()
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const [, opts] = captureExceptionMock.mock.calls[0] ?? []
    expect((opts as { tags: Record<string, unknown> }).tags.organization_id).toBe(ORG_ID)
    // PII pin: no path, no org name anywhere in the captured call.
    const serialised = JSON.stringify(captureExceptionMock.mock.calls[0], (_k, v) =>
      v instanceof Error ? { message: v.message, name: v.name } : v,
    )
    expect(serialised).not.toContain(`${ORG_ID}/logo-abc.png`)
  })
})

describe('downloadOrgLogo', () => {
  it('returns { data, format } for a stored PNG path, re-sniffing the bytes', async () => {
    const bytes = pngBytes()
    const downloadMock = vi.fn().mockResolvedValue({ data: blobFrom(bytes), error: null })
    const client = { storage: { from: vi.fn(() => ({ download: downloadMock })) } }

    const result = await downloadOrgLogo(client as never, `${ORG_ID}/logo-abc.png`)

    expect(result).not.toBeNull()
    expect(result?.format).toBe('png')
    expect(Array.from(result?.data ?? [])).toEqual(Array.from(bytes))
    expect(client.storage.from).toHaveBeenCalledWith(ORG_LOGO_BUCKET)
  })

  it('returns { data, format } for a stored JPEG path', async () => {
    const bytes = jpegBytes()
    const downloadMock = vi.fn().mockResolvedValue({ data: blobFrom(bytes), error: null })
    const client = { storage: { from: vi.fn(() => ({ download: downloadMock })) } }

    const result = await downloadOrgLogo(client as never, `${ORG_ID}/logo-abc.jpg`)

    expect(result?.format).toBe('jpeg')
  })

  it('returns null for a missing/null path without calling Storage', async () => {
    const downloadMock = vi.fn()
    const client = { storage: { from: vi.fn(() => ({ download: downloadMock })) } }

    const result = await downloadOrgLogo(client as never, null)

    expect(result).toBeNull()
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('returns null and captures Sentry on a download error', async () => {
    const downloadMock = vi.fn().mockResolvedValue({
      data: null,
      error: { name: 'StorageApiError', message: 'not found' },
    })
    const client = { storage: { from: vi.fn(() => ({ download: downloadMock })) } }

    const result = await downloadOrgLogo(client as never, `${ORG_ID}/logo-abc.png`)

    expect(result).toBeNull()
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const serialised = JSON.stringify(captureExceptionMock.mock.calls[0])
    expect(serialised).not.toContain(`${ORG_ID}/logo-abc.png`)
  })

  it('returns null when downloaded bytes fail the magic-byte re-check', async () => {
    const notAnImage = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
    const downloadMock = vi.fn().mockResolvedValue({ data: blobFrom(notAnImage), error: null })
    const client = { storage: { from: vi.fn(() => ({ download: downloadMock })) } }

    const result = await downloadOrgLogo(client as never, `${ORG_ID}/logo-abc.png`)

    expect(result).toBeNull()
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// organizations.ts — logo_storage_path plumbing (same test file per plan's
// file list; the column change is small and directly serves this helper).
// ---------------------------------------------------------------------------

type FilterCall = { method: string; col?: string; val?: unknown }

function buildOrgReadStub(returnRow: unknown) {
  const filters: FilterCall[] = []
  let selectCols = ''
  const chain = {
    eq: (col: string, val: unknown) => {
      filters.push({ method: 'eq', col, val })
      return chain
    },
    maybeSingle: () => Promise.resolve({ data: returnRow, error: null }),
  }
  const client = {
    from: () => ({
      select: (cols: string) => {
        selectCols = cols
        return chain
      },
    }),
  }
  return { client, filters, getSelectCols: () => selectCols }
}

describe('getOrganization — logo_storage_path plumbing', () => {
  it('includes logo_storage_path in the SELECT string', async () => {
    const { client, getSelectCols } = buildOrgReadStub({
      id: ORG_ID,
      name: 'Acme',
      slug: 'acme',
      logo_url: null,
      logo_storage_path: `${ORG_ID}/logo-abc.png`,
      apply_form_enabled: true,
      stripe_customer_id: null,
      brand_primary: null,
      brand_secondary: null,
    })

    const result = await getOrganization(client as never, ORG_ID)

    expect(getSelectCols()).toContain('logo_storage_path')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.logo_storage_path).toBe(`${ORG_ID}/logo-abc.png`)
  })
})

describe('getOrganizationBySlug — logo_storage_path plumbing', () => {
  it('includes logo_storage_path in the SELECT string', async () => {
    const { client, getSelectCols } = buildOrgReadStub({
      id: ORG_ID,
      name: 'Acme',
      slug: 'acme',
      apply_form_enabled: true,
      logo_url: null,
      logo_storage_path: `${ORG_ID}/logo-abc.png`,
      brand_primary: null,
      brand_secondary: null,
    })

    const result = await getOrganizationBySlug(client as never, 'acme')

    expect(getSelectCols()).toContain('logo_storage_path')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.logo_storage_path).toBe(`${ORG_ID}/logo-abc.png`)
  })
})

describe('updateOrganization — undefined-preserving logo_storage_path write', () => {
  function buildUpdateStub(returnRow: unknown) {
    let capturedPayload: Record<string, unknown> | undefined
    const chain = {
      eq: () => chain,
      select: () => chain,
      single: () => Promise.resolve({ data: returnRow, error: null }),
    }
    const client = {
      from: () => ({
        update: (payload: unknown) => {
          capturedPayload = payload as Record<string, unknown>
          return chain
        },
      }),
    }
    return { client, getPayload: () => capturedPayload }
  }

  it('writes logo_storage_path when the patch key is present', async () => {
    const { client, getPayload } = buildUpdateStub({
      id: ORG_ID,
      name: 'Acme',
      slug: 'acme',
      logo_url: null,
      logo_storage_path: `${ORG_ID}/logo-new.png`,
      apply_form_enabled: true,
      stripe_customer_id: null,
      brand_primary: null,
      brand_secondary: null,
    })

    await updateOrganization(client as never, ORG_ID, {
      logo_storage_path: `${ORG_ID}/logo-new.png`,
    })

    expect(getPayload()).toEqual({ logo_storage_path: `${ORG_ID}/logo-new.png` })
  })

  it('omits logo_storage_path from the payload when the key is absent (undefined-preserving)', async () => {
    const { client, getPayload } = buildUpdateStub({
      id: ORG_ID,
      name: 'Acme',
      slug: 'acme',
      logo_url: null,
      logo_storage_path: null,
      apply_form_enabled: true,
      stripe_customer_id: null,
      brand_primary: null,
      brand_secondary: null,
    })

    await updateOrganization(client as never, ORG_ID, { name: 'New Name' })

    const payload = getPayload()
    expect(payload).toEqual({ name: 'New Name' })
    expect(payload).not.toHaveProperty('logo_storage_path')
  })

  it('writes logo_storage_path: null when explicitly clearing', async () => {
    const { client, getPayload } = buildUpdateStub({
      id: ORG_ID,
      name: 'Acme',
      slug: 'acme',
      logo_url: null,
      logo_storage_path: null,
      apply_form_enabled: true,
      stripe_customer_id: null,
      brand_primary: null,
      brand_secondary: null,
    })

    await updateOrganization(client as never, ORG_ID, { logo_storage_path: null })

    expect(getPayload()).toEqual({ logo_storage_path: null })
  })
})
