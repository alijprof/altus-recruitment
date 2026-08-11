import { existsSync, readFileSync, statSync } from 'node:fs'

import { test, expect, type Page, type BrowserContext } from '@playwright/test'

// Load-bearing app copy — imported (not hand-copied) so this spec can never
// silently drift from the literal cv-file-link.tsx actually renders as a
// disabled View control's title. Mirrors cv-intake.smoke.ts's "import,
// don't duplicate" contract for src/lib/cv/parse-messages.ts's exports.
import { CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY } from '../../../src/lib/cv/cv-file-display'

// -----------------------------------------------------------------------
// Layer A3 sibling — authenticated, WRITE-CAPABLE smoke for Phase 7 (CV
// Lifecycle and Trust): the CV files section + real signed-URL download
// (07-01), the unsure-fields confidence cue (07-02), full parsed-field
// editing (07-03 + 07-04), and match-freshness copy + Score all (07-07).
//
// Sibling of cv-intake.smoke.ts, NOT a replacement — that spec is frozen
// (Phase 6) and stays the only coverage for the upload/parse/reject
// contract. This spec starts a FRESH scratch candidate under its own
// 'GSD Phase07 Smoke' prefix so the two specs' cleanup sweeps can never
// touch each other's rows, and both are required to pass together (see
// Task 3's full-suite run instruction in 07-08-PLAN.md).
//
// Runs ONLY against the FOUNDER'S OWN org — same fail-closed
// SMOKE_ALLOWED_USER_ID guard as cv-intake.smoke.ts, copied verbatim
// (re-deriving it would re-introduce the bugs its annotations record).
//
// 07-08-PLAN.md Task 3.
// -----------------------------------------------------------------------

const STORAGE_STATE = 'tests/smoke/.auth/prod.json'
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'https://altusrecruit.com'
const FIXTURE_ROOT = 'tests/fixtures/cv-corpus'
const SCRATCH_NAME_PREFIX = 'GSD Phase07 Smoke'

// Synthetic content for the 07-03/07-04 full-field-editing round-trip.
// Clearly scratch-prefixed (never real candidate data) even though only the
// candidate's NAME is what the afterAll sweep searches on — these nested
// values are deleted for free when the candidate row itself is deleted.
const SCRATCH_SKILL = 'GSD Phase07 Smoke Skill'
const SCRATCH_WORK_TITLE = 'GSD Phase07 Smoke Recruiter'
const SCRATCH_WORK_COMPANY = 'GSD Phase07 Smoke Co'
const SCRATCH_WORK_DATES = '2020 – 2021'
const SCRATCH_SCHOOL = 'GSD Phase07 Smoke University'
const SCRATCH_DEGREE = 'GSD Phase07 Smoke Degree'
const SCRATCH_EDU_DATES = '2016 – 2020'
const SCRATCH_SENIORITY_LABEL = 'Senior'
const SCRATCH_SALARY = '65000'

/**
 * Decodes the Supabase auth cookie inside a Playwright storageState file and
 * returns the JWT `sub` (auth user id) it will sign requests as. Fail-closed
 * by construction: any cookie shape this does not positively recognise
 * throws, and the caller refuses to run. Copied verbatim from
 * cv-intake.smoke.ts (re-review HIGH there) — same hardened logic, same
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
    throw new Error(`cv-lifecycle.smoke.ts: no Supabase auth cookie found in ${storageStatePath}`)
  }
  let joined = chunks.join('')
  if (joined.startsWith('base64-')) joined = joined.slice('base64-'.length)
  const session = JSON.parse(Buffer.from(joined, 'base64').toString('utf8')) as {
    access_token?: string
  }
  if (!session.access_token) {
    throw new Error('cv-lifecycle.smoke.ts: auth cookie held no access_token')
  }
  const payloadSegment = session.access_token.split('.')[1]
  if (!payloadSegment) {
    throw new Error('cv-lifecycle.smoke.ts: access_token is not a JWT')
  }
  const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
    sub?: string
  }
  if (!payload.sub) {
    throw new Error('cv-lifecycle.smoke.ts: JWT payload carries no sub claim')
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
 * for the panel to show the in-progress state. Same shape as
 * cv-intake.smoke.ts's helper of the same name — waiting for "Parsing…"
 * FIRST (before polling for an outcome) proves we are looking at THIS
 * upload's row, not a stale "Parsing complete" left over from an earlier
 * state.
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
  // toast as a parse failure (same lesson as cv-intake.smoke.ts).
  const failed = page.locator('main').getByRole('alert')
  await expect(complete.or(failed)).toBeVisible({ timeout: timeoutMs })
  return (await complete.isVisible()) ? 'complete' : 'failed'
}

type ScratchCandidate = { id: string; name: string }

test.describe.serial('@smoke-auth cv-lifecycle', () => {
  let context: BrowserContext
  let page: Page
  let pageErrors: string[]
  const createdCandidates: ScratchCandidate[] = []

  test.beforeAll(async ({ browser }) => {
    // Redundant with global-setup.ts's whole-run gate, but explicit: this
    // spec WRITES, so it must never silently proceed against an anonymous
    // context if the session is missing or stale.
    if (!existsSync(STORAGE_STATE) || statSync(STORAGE_STATE).size < 10) {
      throw new Error(
        [
          `cv-lifecycle.smoke.ts: no authenticated session found at ${STORAGE_STATE}.`,
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
    // cv-intake.smoke.ts, same env var (one founder session, two specs).
    const allowedUserId = process.env.SMOKE_ALLOWED_USER_ID?.trim()
    if (!allowedUserId) {
      throw new Error(
        'cv-lifecycle.smoke.ts: SMOKE_ALLOWED_USER_ID is required. This spec is ' +
          "write-capable and must only ever run as the founder's own user — " +
          'set SMOKE_ALLOWED_USER_ID to that auth user id (fail-closed guard).',
      )
    }
    const sessionUserId = readSessionUserId(STORAGE_STATE)
    if (sessionUserId !== allowedUserId) {
      throw new Error(
        `cv-lifecycle.smoke.ts: session at ${STORAGE_STATE} signs requests as user ` +
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
      // Same hardened shape as cv-intake.smoke.ts's afterAll — hydration-
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
        // WR-R6 (re-review, hardened after live runs): NEVER delete a row
        // whose name lacks the scratch prefix — deletion in a live org is
        // irreversible. The detail page STREAMS in: at 'load' the previous
        // page's h1 ('Candidates') is still in the DOM, so anchor on the
        // Delete button (definitive, hydrated detail-page control) before
        // reading any heading. No button within 15s = row already gone or
        // page bounced — skip it; wrong candidate name = THROW.
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

  test('CV files section (07-01): View opens a real, working signed URL — not a dead link', async () => {
    test.setTimeout(60_000)
    const candidateId = createdCandidates[0]?.id
    expect(
      candidateId,
      'no scratch candidate id was tracked — earlier setup test must have failed',
    ).toBeTruthy()

    // Scope strictly to the "CV files" section (cv-files-panel.tsx), never
    // the sibling "Latest CV" panel — both panels render a View control for
    // the SAME row on a single-CV candidate, and this scenario is
    // specifically exercising the always-rendered CV files list (D-01).
    const cvFilesSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'CV files', exact: true }) })
    await expect(cvFilesSection).toBeVisible()

    const cvRow = cvFilesSection.locator('li').first()
    // Shows a filename — the row's own text starts with "v{n} · {filename}".
    await expect(cvRow).toContainText(/^v\d+ · /)
    // Shows an ABSOLUTE date (formatDateLong, e.g. "11 August 2026") — never
    // a relative "2 minutes ago" that could tick over mid-assertion.
    await expect(cvRow).toContainText(/\d{1,2} [A-Za-z]+ \d{4}/)

    const viewButton = cvFilesSection.getByRole('link', { name: 'View', exact: true })
    await expect(viewButton).toBeVisible()
    await expect(viewButton).toBeEnabled()
    // The disabled-state literal (imported, not hand-copied) must NOT be
    // sitting on an enabled control — proves this is the real "downloadable"
    // path, not a control that merely looks enabled.
    await expect(viewButton).not.toHaveAttribute('title', CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY)

    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 15_000 }),
      viewButton.click(),
    ])
    await popup.waitForURL(/^https?:\/\//, { timeout: 15_000 }).catch(() => {})
    const openedUrl = popup.url()
    expect(openedUrl, 'View must open a real URL, not about:blank').not.toBe('about:blank')
    expect(
      new URL(openedUrl).origin,
      'the opened URL must be the real storage origin, not a dead link back to our own app',
    ).not.toBe(new URL(BASE_URL).origin)
    // Re-request the exact signed URL to confirm it is genuinely live, not
    // merely a plausible-looking string — proves the signed URL is real.
    const fileResponse = await popup.request.get(openedUrl)
    expect(
      fileResponse.status(),
      `signed URL responded ${fileResponse.status()}, expected 200`,
    ).toBe(200)
    await popup.close()
  })

  test('Confidence cue (07-02): Review button unchanged; unsure badge and named-field line appear together or not at all', async () => {
    // FROZEN Phase-6 assertion (07-02 must have kept the badge OUTSIDE the
    // button) — the badge is a flex SIBLING of this trigger, never nested
    // inside it, so the accessible name stays exactly this literal.
    const reviewButton = page.getByRole('button', { name: 'Review extracted data', exact: true })
    await expect(reviewButton).toBeVisible()

    // D-02: rows without unsure fields render NEITHER the badge nor the
    // named-field line — no empty amber cue. Deliberately not hard-asserting
    // a count; the fixture's confidence output is model-dependent.
    const unsureBadge = page.locator('main').getByText(/^\d+ (field|fields) unsure$/)
    const unsureLine = page.locator('main').getByText(/^Unsure: .+\.$/)
    const badgeVisible = await unsureBadge.isVisible()
    const lineVisible = await unsureLine.isVisible()
    expect(
      badgeVisible,
      `unsure badge (visible=${badgeVisible}) and named-field line (visible=${lineVisible}) must appear together or not at all`,
    ).toBe(lineVisible)
  })

  test('Full-field editing (07-03 + 07-04): every value round-trips into Experience / Skills / Education / Compensation', async () => {
    test.setTimeout(90_000)
    const candidateId = createdCandidates[0]?.id
    expect(
      candidateId,
      'no scratch candidate id was tracked — earlier setup test must have failed',
    ).toBeTruthy()

    await page.goto(`/candidates/${candidateId}/edit`)

    // Expand every collapsed section this scenario touches — only "Basics"
    // is open by default (Accordion type="multiple" defaultValue=['basics']).
    for (const sectionName of [
      'Experience & seniority',
      'Compensation',
      'Skills & sectors',
      'Work history',
      'Education',
    ]) {
      await page.getByRole('button', { name: sectionName, exact: true }).click()
    }

    // Skills — add one chip via the TagInput.
    const skillsInput = page.getByLabel('Skills', { exact: true })
    await skillsInput.fill(SCRATCH_SKILL)
    await skillsInput.press('Enter')

    // Work history — add one row via RepeatingRows, scoped to its own
    // role="group" so "Dates" (a label shared with Education) can never
    // resolve ambiguously.
    await page.getByRole('button', { name: 'Add work history', exact: true }).click()
    const workRow = page.getByRole('group', { name: 'Work history 1', exact: true })
    await workRow.getByLabel('Title', { exact: true }).fill(SCRATCH_WORK_TITLE)
    await workRow.getByLabel('Company', { exact: true }).fill(SCRATCH_WORK_COMPANY)
    await workRow.getByLabel('Dates', { exact: true }).fill(SCRATCH_WORK_DATES)

    // Education — add one row, same scoped-group pattern.
    await page.getByRole('button', { name: 'Add education', exact: true }).click()
    const educationRow = page.getByRole('group', { name: 'Education 1', exact: true })
    await educationRow.getByLabel('School', { exact: true }).fill(SCRATCH_SCHOOL)
    await educationRow.getByLabel('Degree', { exact: true }).fill(SCRATCH_DEGREE)
    await educationRow.getByLabel('Dates', { exact: true }).fill(SCRATCH_EDU_DATES)

    // Seniority — a Radix Select (role="combobox" / role="option").
    await page.getByRole('combobox', { name: 'Seniority', exact: true }).click()
    await page.getByRole('option', { name: SCRATCH_SENIORITY_LABEL, exact: true }).click()

    // Salary.
    await page.getByLabel('Current salary (est.)', { exact: true }).fill(SCRATCH_SALARY)

    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.waitForURL(new RegExp(`/candidates/${candidateId}$`), { timeout: 20_000 })

    // This is the single most valuable assertion in the phase — the
    // customer's actual complaint was that edits didn't stick. Every value
    // set above must now render back on the read-only detail page.
    const main = page.locator('main')
    const sectionByHeading = (heading: string) =>
      main
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: heading, exact: true }) })

    await expect(sectionByHeading('Experience')).toContainText(SCRATCH_WORK_TITLE)
    await expect(sectionByHeading('Education')).toContainText(SCRATCH_SCHOOL)
    await expect(sectionByHeading('Skills')).toContainText(SCRATCH_SKILL)
    await expect(sectionByHeading('Employment')).toContainText(SCRATCH_SENIORITY_LABEL)

    const formattedSalary = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0,
    }).format(Number(SCRATCH_SALARY))
    await expect(sectionByHeading('Compensation')).toContainText(formattedSalary)
  })

  test('Match freshness (07-07): no stale "refresh to see" copy; Score all appears whenever match cards are present', async () => {
    test.setTimeout(45_000)
    // Read-only navigation to whatever job the founder's own org already
    // has — this scenario asserts on STRUCTURE (button/copy presence), never
    // on candidate names, so no real candidate PII enters an assertion or a
    // failure message.
    await page.goto('/jobs')
    const jobLink = page.locator('main a[href^="/jobs/"]').first()
    const noJobsHeading = page.getByRole('heading', { name: 'Jobs drive your pipeline' })
    await jobLink.or(noJobsHeading).first().waitFor({ timeout: 15_000 })
    const jobHrefs = await page
      .locator('main a[href^="/jobs/"]')
      .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''))
    const jobHref = jobHrefs.find((h) => /^\/jobs\/[0-9a-f-]{36}$/i.test(h))
    test.skip(!jobHref, 'no open jobs exist in this org to exercise the matches page against')

    await page.goto(`${jobHref}/matches`)
    const mainText = (await page.locator('main').innerText()).toLowerCase()
    expect(
      mainText,
      'stale "refresh to see" copy must not appear now that Explain self-refreshes (D-07)',
    ).not.toContain('refresh to see')

    // "Not indexed yet" only ever renders when there are zero match cards —
    // its presence/absence is a reliable, PII-free proxy for "cards present".
    const notIndexedAlert = page.getByText('Not indexed yet')
    const candidateCardLink = page.locator('main a[href^="/candidates/"]')
    await candidateCardLink.first().or(notIndexedAlert).first().waitFor({ timeout: 15_000 })
    const cardsPresent = (await candidateCardLink.count()) > 0
    if (cardsPresent) {
      // WR-R5 (re-review): "Score all" renders only when at least one card
      // is non-fresh — indistinguishable from all-fresh without reading
      // score state, so its absence is an ACCEPTED edge, not a failure.
      const scoreAll = page.getByRole('button', { name: 'Score all', exact: true })
      if ((await scoreAll.count()) > 0) {
        await expect(scoreAll, 'Score all, when offered, must be enabled').toBeEnabled()
      } else {
        console.log('[cv-lifecycle] Score all not offered — all cards fresh (accepted edge)')
      }

      // WR-R4 (re-review): the no-stale-copy grep alone is vacuous — prove
      // D-07 by CLICKING Explain where offered (one Sonnet call, pennies,
      // founder org) and asserting the outcome arrives with NO manual reload.
      const explain = page.getByRole('button', { name: 'Explain match', exact: true }).first()
      if ((await explain.count()) > 0) {
        await explain.click()
        await expect(
          page.getByText('Match explained'),
          'Explain must confirm via toast and self-refresh (D-07) — no manual reload',
        ).toBeVisible({ timeout: 60_000 })
      } else {
        console.log('[cv-lifecycle] no unexplained card — Explain click skipped (accepted edge)')
      }
    }

    // Do NOT click Score all — that spends real Sonnet budget on real data
    // for no additional signal; the Explain path already proves the wiring.
  })

  test('no uncaught client-side errors across the whole run', async () => {
    expect(pageErrors, `uncaught client errors: ${pageErrors.join(' | ')}`).toEqual([])
  })
})
