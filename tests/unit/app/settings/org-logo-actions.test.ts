/**
 * @vitest-environment node
 *
 * Plan 08-05 Task 2 — uploadOrgLogoAction + removeOrgLogoAction
 * (src/app/(app)/settings/branding/actions.ts).
 *
 * Real (unmocked) modules: @/lib/upload/image-signature (byte-level sniff —
 * the point of the test is to exercise the real magic-byte gate, not a
 * stand-in) and @/lib/branding/org-logo (buildOrgLogoPath is pure).
 *
 * Mocked: server-only, next/cache, @/lib/supabase/server,
 * @/lib/stripe/require-entitlement, @/lib/db/organizations, @sentry/nextjs —
 * mirroring the shape already used across tests/unit/app/... action tests.
 *
 * Coverage (10 behaviours from 08-05-PLAN.md):
 *   1. valid PNG from owner of entitled org → uploads, sets pointer, clears
 *      legacy logo_url, returns { ok: true }
 *   2. replace: upload NEW → update row → delete OLD, in that order
 *   3. failed Storage upload → error, organizations row untouched
 *   4. failed row update → removes the just-uploaded object (no orphan)
 *   5. non-PNG/JPEG bytes rejected before any Storage call
 *   6. oversized file rejected before Storage/gate/auth
 *   7. non-owner rejected, writes nothing
 *   8. non-entitled org rejected with ENTITLEMENT_BLOCKED_MESSAGE
 *   9. removeOrgLogoAction nulls both fields, best-effort deletes, a delete
 *      failure still returns ok:true but captures a PII-free Sentry event
 *   10. no Sentry event from either action contains org name/path/filename
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

const TEST_ENTITLEMENT_BLOCKED_MESSAGE = 'TEST: subscription inactive'
const requireEntitledOrgMock = vi.fn()
vi.mock('@/lib/stripe/require-entitlement', () => ({
  ENTITLEMENT_BLOCKED_MESSAGE: TEST_ENTITLEMENT_BLOCKED_MESSAGE,
  requireEntitledOrg: (...args: unknown[]) => requireEntitledOrgMock(...args),
}))

const getOrganizationMock = vi.fn()
const updateOrganizationMock = vi.fn()
vi.mock('@/lib/db/organizations', () => ({
  getOrganization: (...args: unknown[]) => getOrganizationMock(...args),
  updateOrganization: (...args: unknown[]) => updateOrganizationMock(...args),
}))

const order: string[] = []
const uploadMock = vi.fn()
const removeMock = vi.fn()
const storageFromMock = vi.fn(() => ({ upload: uploadMock, remove: removeMock }))
const usersMaybeSingleMock = vi.fn()
const getUserMock = vi.fn()
const fromUsersMock = vi.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle: usersMaybeSingleMock }) }),
}))
const createClientMock = vi.fn(async () => ({
  auth: { getUser: getUserMock },
  from: fromUsersMock,
  storage: { from: storageFromMock },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const OLD_PATH = `${ORG_ID}/logo-old.png`

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

function pngFile(name = 'logo.png', size = 100): File {
  const bytes = new Uint8Array(size)
  bytes.set(PNG_MAGIC)
  return new File([bytes], name, { type: 'image/png' })
}

function jpegFile(name = 'logo.jpg'): File {
  const bytes = new Uint8Array(50)
  bytes.set(JPEG_MAGIC)
  return new File([bytes], name, { type: 'image/jpeg' })
}

function svgFile(name = 'evil.svg'): File {
  return new File([new TextEncoder().encode('<svg></svg>')], name, { type: 'image/svg+xml' })
}

function formDataWith(file: File): FormData {
  const fd = new FormData()
  fd.set('file', file)
  return fd
}

function ownerRow(orgId = ORG_ID) {
  return { data: { role: 'owner', organization_id: orgId }, error: null }
}

function memberRow(orgId = ORG_ID) {
  return { data: { role: 'member', organization_id: orgId }, error: null }
}

async function importActions() {
  return await import('@/app/(app)/settings/branding/actions')
}

beforeEach(() => {
  order.length = 0
  revalidatePathMock.mockReset()
  captureExceptionMock.mockReset()
  requireEntitledOrgMock.mockReset()
  requireEntitledOrgMock.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    orgId: ORG_ID,
    status: 'active',
  })
  getOrganizationMock.mockReset()
  getOrganizationMock.mockResolvedValue({
    ok: true,
    data: { id: ORG_ID, logo_storage_path: null, logo_url: null },
  })
  updateOrganizationMock.mockReset()
  updateOrganizationMock.mockResolvedValue({ ok: true, data: {} })
  uploadMock.mockReset()
  uploadMock.mockImplementation(async () => {
    order.push('upload')
    return { data: {}, error: null }
  })
  removeMock.mockReset()
  removeMock.mockImplementation(async () => {
    order.push('remove')
    return { data: [], error: null }
  })
  storageFromMock.mockClear()
  usersMaybeSingleMock.mockReset()
  usersMaybeSingleMock.mockResolvedValue(ownerRow())
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  createClientMock.mockClear()

  // updateOrganization is call #2 in the write-new-then-delete-old ordering
  // for uploadOrgLogoAction — wrap it so `order` captures it too.
  updateOrganizationMock.mockImplementation(async () => {
    order.push('update')
    return { ok: true, data: {} }
  })
})

describe('uploadOrgLogoAction', () => {
  it('uploads a valid PNG, sets the pointer, clears logo_url, returns ok', async () => {
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(pngFile()))

    expect(result).toEqual({ ok: true })
    expect(uploadMock).toHaveBeenCalledTimes(1)
    const [path] = uploadMock.mock.calls[0] as [string, unknown, unknown]
    expect(path).toMatch(new RegExp(`^${ORG_ID}/logo-[0-9a-f-]{36}\\.png$`))
    expect(updateOrganizationMock).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ logo_storage_path: path, logo_url: null }),
    )
  })

  it('accepts a valid JPEG', async () => {
    const { uploadOrgLogoAction } = await importActions()
    const result = await uploadOrgLogoAction(formDataWith(jpegFile()))
    expect(result).toEqual({ ok: true })
    const [path] = uploadMock.mock.calls[0] as [string]
    expect(path.endsWith('.jpg')).toBe(true)
  })

  it('replacing: uploads NEW then updates the row then deletes OLD, in order', async () => {
    getOrganizationMock.mockResolvedValue({
      ok: true,
      data: { id: ORG_ID, logo_storage_path: OLD_PATH, logo_url: null },
    })
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(pngFile()))

    expect(result).toEqual({ ok: true })
    expect(order).toEqual(['upload', 'update', 'remove'])
    expect(removeMock).toHaveBeenCalledWith([OLD_PATH])
  })

  it('a failed Storage upload returns an error and never touches the row', async () => {
    uploadMock.mockResolvedValue({ data: null, error: { name: 'StorageApiError' } })
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(pngFile()))

    expect(result.ok).toBe(false)
    expect(updateOrganizationMock).not.toHaveBeenCalled()
  })

  it('a failed row update removes the just-uploaded object (no orphan)', async () => {
    updateOrganizationMock.mockResolvedValue({ ok: false, code: 'internal' })
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(pngFile()))

    expect(result.ok).toBe(false)
    expect(uploadMock).toHaveBeenCalledTimes(1)
    const [uploadedPath] = uploadMock.mock.calls[0] as [string]
    expect(removeMock).toHaveBeenCalledWith([uploadedPath])
  })

  it('rejects non-PNG/JPEG bytes (SVG) before any Storage call', async () => {
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(svgFile()))

    expect(result.ok).toBe(false)
    expect(uploadMock).not.toHaveBeenCalled()
    expect(requireEntitledOrgMock).not.toHaveBeenCalled()
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects a spoofed MIME type (PNG bytes labelled image/svg+xml is fine; real GIF bytes are not)', async () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]) // GIF89a
    const file = new File([bytes], 'sneaky.png', { type: 'image/png' })
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(file))

    expect(result.ok).toBe(false)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('rejects a file over 2 MiB before Storage/gate/auth are reached', async () => {
    const oversized = pngFile('big.png', 2 * 1024 * 1024 + 1)
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(oversized))

    expect(result.ok).toBe(false)
    expect(uploadMock).not.toHaveBeenCalled()
    expect(requireEntitledOrgMock).not.toHaveBeenCalled()
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects a non-owner and writes nothing', async () => {
    usersMaybeSingleMock.mockResolvedValue(memberRow())
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(pngFile()))

    expect(result.ok).toBe(false)
    if (!result.ok && 'formError' in result) {
      expect(result.formError).toMatch(/only owners/i)
    }
    expect(uploadMock).not.toHaveBeenCalled()
    expect(updateOrganizationMock).not.toHaveBeenCalled()
  })

  it('rejects a non-entitled org with ENTITLEMENT_BLOCKED_MESSAGE', async () => {
    requireEntitledOrgMock.mockResolvedValue({ ok: false, reason: 'not_entitled' })
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(pngFile()))

    expect(result.ok).toBe(false)
    if (!result.ok && 'formError' in result) {
      expect(result.formError).toBe(TEST_ENTITLEMENT_BLOCKED_MESSAGE)
    }
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('rejects a zero-byte or missing file before any gate', async () => {
    const { uploadOrgLogoAction } = await importActions()
    const fd = new FormData()
    fd.set('file', new File([], 'empty.png', { type: 'image/png' }))

    const result = await uploadOrgLogoAction(fd)

    expect(result.ok).toBe(false)
    expect(requireEntitledOrgMock).not.toHaveBeenCalled()
  })
})

describe('removeOrgLogoAction', () => {
  it('nulls both fields and best-effort deletes the object, returns ok', async () => {
    getOrganizationMock.mockResolvedValue({
      ok: true,
      data: { id: ORG_ID, logo_storage_path: OLD_PATH, logo_url: null },
    })
    const { removeOrgLogoAction } = await importActions()

    const result = await removeOrgLogoAction()

    expect(result).toEqual({ ok: true })
    expect(updateOrganizationMock).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ logo_storage_path: null, logo_url: null }),
    )
    expect(removeMock).toHaveBeenCalledWith([OLD_PATH])
  })

  it('a delete failure still returns ok:true but captures a PII-free Sentry event', async () => {
    getOrganizationMock.mockResolvedValue({
      ok: true,
      data: { id: ORG_ID, logo_storage_path: OLD_PATH, logo_url: null },
    })
    removeMock.mockResolvedValue({ data: null, error: { name: 'StorageApiError' } })
    const { removeOrgLogoAction } = await importActions()

    const result = await removeOrgLogoAction()

    expect(result).toEqual({ ok: true })
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const serialised = JSON.stringify(captureExceptionMock.mock.calls[0])
    expect(serialised).not.toContain(OLD_PATH)
  })

  it('rejects a non-owner and writes nothing', async () => {
    usersMaybeSingleMock.mockResolvedValue(memberRow())
    const { removeOrgLogoAction } = await importActions()

    const result = await removeOrgLogoAction()

    expect(result.ok).toBe(false)
    expect(updateOrganizationMock).not.toHaveBeenCalled()
  })

  it('rejects a non-entitled org', async () => {
    requireEntitledOrgMock.mockResolvedValue({ ok: false, reason: 'not_entitled' })
    const { removeOrgLogoAction } = await importActions()

    const result = await removeOrgLogoAction()

    expect(result.ok).toBe(false)
    if (!result.ok && 'formError' in result) {
      expect(result.formError).toBe(TEST_ENTITLEMENT_BLOCKED_MESSAGE)
    }
  })

  it('is a no-op remove when there was no prior logo (nothing to delete)', async () => {
    getOrganizationMock.mockResolvedValue({
      ok: true,
      data: {
        id: ORG_ID,
        logo_storage_path: null,
        logo_url: 'https://legacy.example.test/logo.png',
      },
    })
    const { removeOrgLogoAction } = await importActions()

    const result = await removeOrgLogoAction()

    expect(result).toEqual({ ok: true })
    expect(removeMock).not.toHaveBeenCalled()
  })
})

describe('PII discipline — no org name, storage path, or filename in any Sentry capture', () => {
  it('uploadOrgLogoAction: a failed old-object removal after a successful replace still captures no PII', async () => {
    getOrganizationMock.mockResolvedValue({
      ok: true,
      data: { id: ORG_ID, logo_storage_path: OLD_PATH, logo_url: null },
    })
    removeMock.mockResolvedValue({ data: null, error: { name: 'StorageApiError' } })
    const { uploadOrgLogoAction } = await importActions()

    const result = await uploadOrgLogoAction(formDataWith(pngFile('my-company-name-logo.png')))

    expect(result).toEqual({ ok: true })
    if (captureExceptionMock.mock.calls.length > 0) {
      const serialised = JSON.stringify(captureExceptionMock.mock.calls)
      expect(serialised).not.toContain(OLD_PATH)
      expect(serialised).not.toContain('my-company-name-logo')
    }
  })
})
