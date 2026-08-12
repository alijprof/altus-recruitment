import { existsSync, readFileSync, statSync } from 'node:fs'

import { test, expect, type Page, type BrowserContext } from '@playwright/test'

// -----------------------------------------------------------------------
// Layer A3 sibling — authenticated, WRITE-CAPABLE smoke for Phase 8
// (Branded CV): the Branded CV panel's generate/regenerate/view cycle
// (BCV-01/05/06), and the Branding settings surfaces the feature depends on
// (BCV-04).
//
// Sibling of cv-intake.smoke.ts (frozen, Phase 6) and cv-lifecycle.smoke.ts
// (Phase 7) — NOT a replacement for either. This spec starts a FRESH scratch
// candidate under its own 'GSD Phase08 Smoke' prefix so all three specs'
// cleanup sweeps can never touch each other's rows. All three are required
// to pass together in a SERIAL (workers: 1) full-suite run — see
// playwright.smoke-auth.config.ts's own comment and 08-09-PLAN.md's "Why the
// smoke must run serially" section: trigram-fuzzy candidate search matches
// `Phase06` <-> `Phase07` <-> `Phase08` regardless of prefix distinctness, so
// prefix separation alone is not the guard — serial execution is.
//
// Runs ONLY against the FOUNDER'S OWN org — same fail-closed
// SMOKE_ALLOWED_USER_ID guard as cv-intake.smoke.ts / cv-lifecycle.smoke.ts,
// copied verbatim (re-deriving it would re-introduce the bugs its
// annotations record).
//
// MIGRATION-TOLERANT: this project's migrations are pushed to production by
// hand (see candidate-branded-cvs.ts's header comment), so this spec can run
// against an environment where `candidate_branded_cvs` has not been pushed
// yet. branded-cv-panel.tsx renders NOTHING in that case — this spec detects
// that at the Generate step and skips every branded-panel-specific test with
// an explicit reason rather than failing, while the branding-settings and
// sweep/no-errors tests still run.
//
// 08-09-PLAN.md Task 1.
// -----------------------------------------------------------------------

const STORAGE_STATE = 'tests/smoke/.auth/prod.json'
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'https://altusrecruit.com'
const FIXTURE_ROOT = 'tests/fixtures/cv-corpus'
const SCRATCH_NAME_PREFIX = 'GSD Phase08 Smoke'

// A manually-constructed, minimal but GENUINELY VALID 1x1 RGB PNG (69 bytes):
// signature + IHDR + a zlib-deflated one-scanline IDAT + IEND, each chunk's
// CRC32 computed correctly per the PNG spec — not a truncated/fake magic-byte
// stub, because assertUploadableLogo (src/lib/upload/image-signature.ts) is
// re-sniffed server-side and the browser's own <Image> preview must actually
// decode it. Verified against Pillow at authoring time (`Image.open(...).size
// == (1, 1)`, mode 'RGB'). The single pixel is the SC brand's approximate
// bottle-green (#1a6b50) purely for colour-sanity if anyone ever inspects it
// manually — this file is deleted again inside the same test via Remove.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQyg4AAAF4ANZ9BYYVAAAAAElFTkSuQmCC'

/**
 * Decodes the Supabase auth cookie inside a Playwright storageState file and
 * returns the JWT `sub` (auth user id) it will sign requests as. Fail-closed
 * by construction: any cookie shape this does not positively recognise
 * throws, and the caller refuses to run. Copied verbatim from
 * cv-intake.smoke.ts / cv-lifecycle.smoke.ts — same hardened logic, same
 * reasoning, only the error-message prefix differs.
 */
function readSessionUserId(storageStatePath: string): string {
  const state = JSON.parse(readFileSync(storageStatePath, 'utf8')) as {
    cookies?: Array<{ name: string; value: string }>
  }
  const chunks = (state.cookies ?? [])
    .filter((c) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    .map((c) => c.value)
  if (chunks.length === 0) {
    throw new Error(`branded-cv.smoke.ts: no Supabase auth cookie found in ${storageStatePath}`)
  }
  let joined = chunks.join('')
  if (joined.startsWith('base64-')) joined = joined.slice('base64-'.length)
  const session = JSON.parse(Buffer.from(joined, 'base64').toString('utf8')) as {
    access_token?: string
  }
  if (!session.access_token) {
    throw new Error('branded-cv.smoke.ts: auth cookie held no access_token')
  }
  const payloadSegment = session.access_token.split('.')[1]
  if (!payloadSegment) {
    throw new Error('branded-cv.smoke.ts: access_token is not a JWT')
  }
  const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
    sub?: string
  }
  if (!payload.sub) {
    throw new Error('branded-cv.smoke.ts: JWT payload carries no sub claim')
  }
  return payload.sub
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Uploads a corpus fixture through the real "Upload CV" control, then waits
 * for the panel to show the in-progress state. Copied verbatim from
 * cv-lifecycle.smoke.ts.
 */
async function uploadAndAwaitPending(page: Page, fixtureRelativePath: string) {
  await page.getByLabel('CV file').setInputFiles(`${FIXTURE_ROOT}/${fixtureRelativePath}`)
  await page.getByRole('button', { name: 'Upload CV' }).click()
  await expect(page.locator('main').getByText('Parsing…', { exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

/** Polls the CV panel until it leaves the in-progress state, either way. */
async function waitForParseOutcome(page: Page, timeoutMs: number): Promise<'complete' | 'failed'> {
  const complete = page.getByText('Parsing complete')
  // Scoped inside <main> — sonner toasts portal to a body-level region and
  // also carry role="alert"; an unscoped query could misclassify a stray
  // toast as a parse failure.
  const failed = page.locator('main').getByRole('alert')
  await expect(complete.or(failed)).toBeVisible({ timeout: timeoutMs })
  return (await complete.isVisible()) ? 'complete' : 'failed'
}

type ScratchCandidate = { id: string; name: string }

test.describe.serial('@smoke-auth branded-cv', () => {
  let context: BrowserContext
  let page: Page
  let pageErrors: string[]
  const createdCandidates: ScratchCandidate[] = []
  // Set false in the Generate test the first time the "Branded CV" section
  // is absent from the candidate page (pre-migration environment). Every
  // subsequent branded-panel-specific test reads this to skip itself with an
  // explicit reason instead of failing against a feature that legitimately
  // hasn't shipped to this database yet.
  let brandedCvAvailable = true

  test.beforeAll(async ({ browser }) => {
    // Redundant with global-setup.ts's whole-run gate, but explicit: this
    // spec WRITES, so it must never silently proceed against an anonymous
    // context if the session is missing or stale.
    if (!existsSync(STORAGE_STATE) || statSync(STORAGE_STATE).size < 10) {
      throw new Error(
        [
          `branded-cv.smoke.ts: no authenticated session found at ${STORAGE_STATE}.`,
          'This spec writes real data and must run as a real, signed-in user in',
          "the FOUNDER'S OWN org. Capture a session first (single continuous",
          'browser context, PKCE requires it):',
          '  SMOKE_AUTH_EMAIL=you@example.com node tests/smoke/authed/relay-signin.mjs',
          'See tests/smoke/README.md → "Layer A2" / "Layer A3".',
        ].join('\n'),
      )
    }
    // Fail-closed org guard: this spec writes real rows in a real org, so "a
    // session file exists" is not enough — the session must provably belong
    // to the allow-listed founder account. The env var is REQUIRED; without
    // it, or with a mismatched session, refuse to run. Same guard as
    // cv-intake.smoke.ts / cv-lifecycle.smoke.ts, same env var (one founder
    // session, all write-capable specs).
    const allowedUserId = process.env.SMOKE_ALLOWED_USER_ID?.trim()
    if (!allowedUserId) {
      throw new Error(
        'branded-cv.smoke.ts: SMOKE_ALLOWED_USER_ID is required. This spec is ' +
          "write-capable and must only ever run as the founder's own user — " +
          'set SMOKE_ALLOWED_USER_ID to that auth user id (fail-closed guard).',
      )
    }
    const sessionUserId = readSessionUserId(STORAGE_STATE)
    if (sessionUserId !== allowedUserId) {
      throw new Error(
        `branded-cv.smoke.ts: session at ${STORAGE_STATE} signs requests as user ` +
          `${sessionUserId}, not the allow-listed ${allowedUserId}. Refusing to run ` +
          'a write-capable smoke under a session that may belong to a customer org.',
      )
    }
    context = await browser.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE })
    page = await context.newPage()
    pageErrors = trackPageErrors(page)
  })

  test.afterAll(async () => {
    if (!page) return
    try {
      // Sweep-delete ANY row matching the scratch prefix — including orphans
      // from a prior aborted run that never made it into `createdCandidates`
      // (a serial-mode failure skips later tests but must not poison future
      // runs). Bounded loop; rows link as /candidates/<uuid> from the list.
      // Same hardened shape as cv-lifecycle.smoke.ts's afterAll — hydration-
      // aware waits throughout, never a one-shot count() on a fresh page.
      for (let sweep = 0; sweep < 10; sweep++) {
        await page.goto(`/candidates?q=${encodeURIComponent(SCRATCH_NAME_PREFIX)}`)
        await page
          .locator('main a[href^="/candidates/"]')
          .first()
          .or(page.getByText('No candidates match your search.'))
          .first()
          .waitFor({ timeout: 10_000 })
        // Only detail links (uuid) count — a bare prefix selector would also
        // match the "Add candidate" → /candidates/new link and loop forever.
        const hrefs = await page
          .locator('main a[href^="/candidates/"]')
          .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''))
        const target = hrefs.find((h) => /^\/candidates\/[0-9a-f-]{36}$/i.test(h))
        if (!target) break
        await page.goto(target)
        // NEVER delete a row whose name lacks the scratch prefix — deletion
        // in a live org is irreversible. The detail page STREAMS in: at
        // 'load' the previous page's h1 ('Candidates') is still in the DOM,
        // so anchor on the Delete button (definitive, hydrated detail-page
        // control) before reading any heading. No button within 15s = row
        // already gone or page bounced — skip it; wrong candidate name =
        // THROW. Same guard as cv-lifecycle.smoke.ts's afterAll.
        const deleteButton = page.getByRole('button', { name: 'Delete' })
        try {
          await deleteButton.waitFor({ timeout: 15_000 })
        } catch {
          continue
        }
        const headingText = (await page.locator('main h1').first().innerText()).trim()
        if (headingText === 'Candidates') {
          // Stale paint still present despite the button — retry next pass.
          continue
        }
        if (!headingText.includes(SCRATCH_NAME_PREFIX)) {
          throw new Error(
            `sweep landed on a NON-SCRATCH candidate at ${target} ("${headingText.slice(0, 40)}") — refusing to delete; investigate the search results`,
          )
        }
        await deleteButton.click()
        const confirmButton = page.getByRole('button', { name: 'Delete candidate' })
        await confirmButton.waitFor({ timeout: 10_000 })
        await confirmButton.click()
        await page.waitForURL(/\/candidates(\?.*)?$/, { timeout: 15_000 })
      }
      // Then re-assert NOTHING matching the prefix survives, via a fresh
      // server round-trip. Residue after the sweep is a hard failure.
      await page.goto(`/candidates?q=${encodeURIComponent(SCRATCH_NAME_PREFIX)}`)
      await expect(
        page.getByText('No candidates match your search.'),
        `scratch residue matching "${SCRATCH_NAME_PREFIX}" remains in the founder's org — delete it manually before the next run`,
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await context.close()
    }
  })

  test('creates a scratch candidate for this smoke run', async () => {
    const candidateName = `${SCRATCH_NAME_PREFIX} ${Date.now()}`
    await page.goto('/candidates/new')
    await page.getByLabel('Full name').fill(candidateName)
    // The only checkbox on this form — the GDPR consent confirmation.
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Add candidate' }).click()
    await page.waitForURL(/\/candidates\/[0-9a-f-]{36}$/, { timeout: 15_000 })
    const match = page.url().match(/\/candidates\/([0-9a-f-]{36})$/i)
    // Track BEFORE any assertion can throw — a candidate that exists but was
    // never recorded would survive cleanup as residue.
    if (match) createdCandidates.push({ id: match[1]!, name: candidateName })
    expect(match, `candidate id missing from redirect URL: ${page.url()}`).not.toBeNull()
  })

  test('uploads a Tier-1 CV and reaches a completed parse', async () => {
    test.setTimeout(120_000)
    await uploadAndAwaitPending(page, 'tier1/t1-pdf-two-column.pdf')
    const outcome = await waitForParseOutcome(page, 90_000)
    expect(
      outcome,
      'the Tier-1 fixture must parse successfully to exercise the rest of this spec',
    ).toBe('complete')
  })

  test('Generate (BCV-01): Branded CV section appears; Generate produces a generated-date line', async () => {
    test.setTimeout(60_000)
    const candidateId = createdCandidates[0]?.id
    expect(
      candidateId,
      'no scratch candidate id was tracked — earlier setup test must have failed',
    ).toBeTruthy()

    // The candidate detail page is where uploadAndAwaitPending/
    // waitForParseOutcome already left us; re-navigate defensively so this
    // test is independently re-runnable even if an earlier test in the file
    // navigated elsewhere.
    await page.goto(`/candidates/${candidateId}`)
    // Wait for the page to fully settle before checking for the (possibly
    // absent) Branded CV section — anchoring on the always-present "CV
    // files" heading avoids a race against streaming/hydration.
    await expect(
      page.locator('main').getByRole('heading', { name: 'CV files', exact: true }),
    ).toBeVisible({ timeout: 15_000 })

    const brandedSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Branded CV', exact: true }) })
    const sectionPresent = (await brandedSection.count()) > 0
    if (!sectionPresent) {
      brandedCvAvailable = false
      test.skip(
        true,
        'Branded CV panel not present on this candidate page — candidate_branded_cvs ' +
          'migration not yet pushed to this environment (migration-tolerant skip per ' +
          '08-09-PLAN.md; this project pushes migrations to production by hand)',
      )
      return
    }

    const generateButton = brandedSection.getByRole('button', { name: 'Generate', exact: true })
    await expect(generateButton).toBeVisible()
    await generateButton.click()
    await expect(page.getByText('Branded CV generated')).toBeVisible({ timeout: 20_000 })
    await expect(brandedSection).toContainText(/Branded copy · generated \d{1,2} [A-Za-z]+ \d{4}/, {
      timeout: 15_000,
    })
  })

  test('Regenerate (BCV-06): still exactly ONE branded copy line after a second Generate', async () => {
    test.skip(!brandedCvAvailable, 'Branded CV panel unavailable — skipped alongside Generate')
    test.setTimeout(45_000)

    const brandedSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Branded CV', exact: true }) })
    // The button's label flips to "Regenerate" once a row exists (set by the
    // prior Generate test in this same serial run).
    const regenerateButton = brandedSection.getByRole('button', { name: 'Regenerate', exact: true })
    await expect(regenerateButton).toBeVisible()
    await regenerateButton.click()
    await expect(page.getByText('Branded CV generated')).toBeVisible({ timeout: 20_000 })

    // The UI-observable half of the single-row invariant: exactly one
    // "Branded copy · generated …" line, never two stacked from an
    // accidental insert-instead-of-update.
    const copyLines = brandedSection.getByText(/^Branded copy · generated /)
    await expect(copyLines).toHaveCount(1)
    await expect(copyLines.first()).toContainText(/\d{1,2} [A-Za-z]+ \d{4}/)
  })

  test('View delivery (BCV-05): View downloads the real branded PDF from Storage', async () => {
    test.skip(!brandedCvAvailable, 'Branded CV panel unavailable — skipped alongside Generate')
    test.setTimeout(60_000)
    const candidateId = createdCandidates[0]?.id
    expect(
      candidateId,
      'no scratch candidate id was tracked — earlier setup test must have failed',
    ).toBeTruthy()

    const brandedSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Branded CV', exact: true }) })
    const viewButton = brandedSection.getByRole('link', { name: 'View', exact: true })
    await expect(viewButton).toBeVisible()
    await expect(viewButton).toHaveAttribute(
      'href',
      new RegExp(`^/candidates/${candidateId}/branded-cv$`),
    )

    // Live-run discovery (Phase-7 addendum, 2026-08-12): the signed Supabase
    // URL serves the file as a DOWNLOAD (Content-Disposition), so the popup
    // never commits a document — popup.url() stays blank forever and any
    // URL-wait races a window that never closes. The correct observable is
    // Playwright's download event. target=_blank downloads surface on the
    // popup page in some Chromium versions and on the opener in others —
    // race both, same pattern as cv-lifecycle.smoke.ts's CV-files View test.
    const popupPromise = context.waitForEvent('page', { timeout: 15_000 }).catch(() => null)
    const openerDownload = page.waitForEvent('download', { timeout: 25_000 }).catch(() => null)
    await viewButton.click()
    const popup = await popupPromise
    const popupDownload = popup
      ? popup.waitForEvent('download', { timeout: 25_000 }).catch(() => null)
      : Promise.resolve(null)
    const download = await Promise.race([
      openerDownload.then((d) => d && (['opener', d] as const)),
      popupDownload.then((d) => d && (['popup', d] as const)),
      new Promise<null>((r) => setTimeout(() => r(null), 26_000)),
    ])
    expect(download, 'clicking View must start a real file download').not.toBeNull()
    const [, dl] = download!
    const downloadUrl = dl.url()
    // The download's source URL must be the real storage origin — a dead
    // link or an app-origin error page can't produce this.
    expect(
      new URL(downloadUrl).origin,
      'the download must come from the storage origin, not our own app',
    ).not.toBe(new URL(BASE_URL).origin)
    expect(downloadUrl, 'download URL must be a signed storage object URL').toContain(
      '/storage/v1/object/sign/',
    )
    expect(downloadUrl, 'download URL must reference the branded-cv storage object').toContain(
      'branded-cv-',
    )
    const suggested = dl.suggestedFilename()
    expect(suggested, `downloaded filename should be a PDF (got "${suggested}")`).toMatch(/\.pdf$/i)
    await dl.cancel().catch(() => {})
    if (popup && !popup.isClosed()) await popup.close().catch(() => {})
  })

  test('No dead controls: View is a real link with an href, never a button', async () => {
    test.skip(!brandedCvAvailable, 'Branded CV panel unavailable — skipped alongside Generate')

    const brandedSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Branded CV', exact: true }) })
    const viewLink = brandedSection.getByRole('link', { name: 'View', exact: true })
    await expect(viewLink).toBeVisible()
    await expect(viewLink).toHaveAttribute('href', /\/branded-cv$/)
    // Structural pin against the 2026-08-11 View-CV incident class: a
    // client async action masquerading as a document-opening control. No
    // button named "View" may exist anywhere in this section.
    await expect(brandedSection.getByRole('button', { name: 'View', exact: true })).toHaveCount(0)
  })

  test('Branding surfaces (BCV-04): upload widget renders; /settings links to Branding; state-preserving logo round-trip', async () => {
    test.setTimeout(45_000)

    // /settings no longer offers a logo field, but links to Branding
    // (08-06-PLAN.md Task 2 — the duplicate field was removed there).
    await page.goto('/settings')
    await expect(page.getByText('Logo and colours live in Branding.')).toBeVisible({
      timeout: 15_000,
    })
    const brandingLink = page.locator('main').getByRole('link', { name: /^Branding/ })
    await expect(brandingLink).toBeVisible()
    await expect(brandingLink).toHaveAttribute('href', '/settings/branding')
    await expect(page.getByLabel('Logo file')).toHaveCount(0)

    // Branding page: upload widget renders (file input + PNG/JPEG help
    // text) — true regardless of whether the org currently has a logo.
    await page.goto('/settings/branding')
    const logoInput = page.getByLabel('Logo file', { exact: true })
    await expect(logoInput).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/PNG or JPEG, up to 2 MB\./)).toBeVisible()

    // State-preserving (T-08-57): only mutate branding when the org
    // currently has NO logo — never touch a logo the founder has already
    // configured.
    const noLogoState = page.getByText('No logo yet')
    const hasNoLogo = await noLogoState.isVisible().catch(() => false)
    test.skip(
      !hasNoLogo,
      'org already has a logo configured — refusing to mutate founder-set branding (T-08-57)',
    )

    await logoInput.setInputFiles({
      name: 'gsd-phase08-smoke-logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    })
    await page.getByRole('button', { name: 'Upload logo', exact: true }).click()
    await expect(page.getByText('Logo uploaded')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByAltText('Organisation logo preview')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByText('Logo removed')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('No logo yet')).toBeVisible({ timeout: 15_000 })
  })

  test('no uncaught client-side errors across the whole run', async () => {
    expect(pageErrors, `uncaught client errors: ${pageErrors.join(' | ')}`).toEqual([])
  })
})
