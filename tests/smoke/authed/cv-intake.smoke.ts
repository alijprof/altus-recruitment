import { existsSync, statSync } from 'node:fs'

import { test, expect, type Page, type BrowserContext } from '@playwright/test'

// Load-bearing app copy — imported (not hand-copied) so this spec can never
// silently drift from the literals cv-review-panel.tsx actually renders. This
// module (src/lib/cv/parse-messages.ts) is deliberately dependency-free and
// has NO `import 'server-only'` for exactly this reason — see its header
// comment.
import {
  CV_DAMAGED_FILE_MESSAGE,
  CV_WRONG_FORMAT_MESSAGE,
} from '../../../src/lib/cv/parse-messages'

// -----------------------------------------------------------------------
// Layer A3 — authenticated, WRITE-CAPABLE CV-intake smoke.
//
// Unlike read-only.smoke.ts (Layer A2), this spec WRITES real data: it
// creates one scratch candidate, uploads real corpus fixtures through the
// real recruiter UI (driving real Haiku calls for the Tier-1 cases), and
// asserts the honest-failure contract for the Tier-2 cases. It must run
// ONLY against the FOUNDER'S OWN org (never a customer org) — the session
// captured at tests/smoke/.auth/prod.json determines the signed-in org, so
// that session must belong to the founder before this spec ever runs.
//
// Every candidate this spec creates is recorded and deleted in `afterAll`,
// which then re-asserts (via a fresh search) that it is actually gone. A
// smoke run that leaves residue in the founder's org is itself a bug.
//
// 06-09-PLAN.md Task 3.
// -----------------------------------------------------------------------

const STORAGE_STATE = 'tests/smoke/.auth/prod.json'
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'https://altusrecruit.com'
const FIXTURE_ROOT = 'tests/fixtures/cv-corpus'

// Two genuinely non-ASCII fragments from tier1/t1-pdf-unicode.pdf's manifest
// `mustContain` list (manifest.json) — deliberately excludes the plain-ASCII
// "Solstice Grid Systems" entry, which proves nothing about unicode survival.
const UNICODE_FRAGMENTS = ['Zoë', '张伟']

function trackPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Uploads a corpus fixture through the real "Upload CV" control, then waits
 * for the panel to show the in-progress state.
 *
 * Waiting for "Parsing…" FIRST (before checking for a completed/failed
 * outcome) matters: this candidate may already have a PRIOR completed CV
 * showing "Parsing complete" on screen. If we jumped straight to polling for
 * an outcome, that stale text would satisfy the check before this upload's
 * own router.refresh() has even landed. Confirming the in-progress state
 * appears first proves we are now looking at THIS upload's row.
 */
async function uploadAndAwaitPending(page: Page, fixtureRelativePath: string) {
  await page.getByLabel('CV file').setInputFiles(`${FIXTURE_ROOT}/${fixtureRelativePath}`)
  await page.getByRole('button', { name: 'Upload CV' }).click()
  await expect(page.getByText('Parsing…')).toBeVisible({ timeout: 20_000 })
}

/** Polls the CV panel until it leaves the in-progress state, either way. */
async function waitForParseOutcome(page: Page, timeoutMs: number): Promise<'complete' | 'failed'> {
  const complete = page.getByText('Parsing complete')
  const failed = page.getByRole('alert')
  await expect(complete.or(failed)).toBeVisible({ timeout: timeoutMs })
  return (await complete.isVisible()) ? 'complete' : 'failed'
}

/**
 * Opens "Review extracted data", asserts the sheet actually holds populated
 * fields (not the empty-placeholder "Name — " row a parse-with-no-data would
 * still render), optionally asserts one of `mustContainAny` survived into the
 * rendered text, then closes the sheet again so the next test starts clean.
 */
async function assertProfilePopulated(page: Page, mustContainAny?: string[]) {
  await page.getByRole('button', { name: 'Review extracted data' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  const text = (await sheet.innerText()).trim()
  expect(
    text.length,
    'CV review sheet rendered with next to no content — a completed parse must populate real fields',
  ).toBeGreaterThan(30)
  expect(
    text,
    `Name field rendered the empty placeholder — the parse produced no usable profile data (got: ${JSON.stringify(text.slice(0, 300))})`,
  ).not.toMatch(/Name\s*\n\s*—(\s|$)/)
  if (mustContainAny) {
    const hit = mustContainAny.some((s) => text.includes(s))
    expect(
      hit,
      `expected one of ${JSON.stringify(mustContainAny)} to survive into the rendered profile — got: ${JSON.stringify(text.slice(0, 400))}`,
    ).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
}

/** Snapshot of the CV side panel (Upload CV + Latest CV + Previous CVs) — the
 * only `<aside>` on the candidate detail page. Used to prove an immediate
 * reject never touched it (no row created, no state change of any kind). */
async function cvSidebarSnapshot(page: Page): Promise<string> {
  return (await page.locator('aside').innerText()).trim()
}

type ScratchCandidate = { id: string; name: string }

test.describe.serial('@smoke-auth cv-intake', () => {
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
          `cv-intake.smoke.ts: no authenticated session found at ${STORAGE_STATE}.`,
          'This spec writes real data and must run as a real, signed-in user in',
          "the FOUNDER'S OWN org. Capture a session first (single continuous",
          'browser context, PKCE requires it):',
          '  SMOKE_AUTH_EMAIL=you@example.com node tests/smoke/authed/relay-signin.mjs',
          'See tests/smoke/README.md → "Layer A2" / "Layer A3".',
        ].join('\n'),
      )
    }
    context = await browser.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE })
    page = await context.newPage()
    pageErrors = trackPageErrors(page)
  })

  test.afterAll(async () => {
    if (!page) return
    try {
      for (const candidate of createdCandidates) {
        await page.goto(`/candidates/${candidate.id}`)
        const deleteButton = page.getByRole('button', { name: 'Delete' })
        if ((await deleteButton.count()) === 0) {
          // Already gone (e.g. a previous partial run) — nothing to clean up.
          continue
        }
        await deleteButton.click()
        await page.getByRole('button', { name: 'Delete candidate' }).click()
        await page.waitForURL(/\/candidates(\?.*)?$/, { timeout: 15_000 })
      }
      // Re-assert every scratch candidate is actually gone, via a fresh
      // server round-trip (not just "the dialog closed without error").
      for (const candidate of createdCandidates) {
        await page.goto(`/candidates?q=${encodeURIComponent(candidate.name)}`)
        await expect(
          page.getByText('No candidates match your search.'),
          `scratch candidate "${candidate.name}" (${candidate.id}) was not removed — smoke run left residue in the founder's org`,
        ).toBeVisible({ timeout: 10_000 })
      }
    } finally {
      await context.close()
    }
  })

  test('creates a scratch candidate for this smoke run', async () => {
    const candidateName = `GSD Phase06 Smoke ${Date.now()}`
    await page.goto('/candidates/new')
    await page.getByLabel('Full name').fill(candidateName)
    // The only checkbox on this form — the GDPR consent confirmation.
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Add candidate' }).click()
    await page.waitForURL(/\/candidates\/[0-9a-f-]{36}$/, { timeout: 15_000 })
    const match = page.url().match(/\/candidates\/([0-9a-f-]{36})$/i)
    expect(match, `candidate id missing from redirect URL: ${page.url()}`).not.toBeNull()
    createdCandidates.push({ id: match![1]!, name: candidateName })
  })

  test('Tier-1 PDF: uploads, parses, and populates the reviewed profile', async () => {
    test.setTimeout(120_000)
    await uploadAndAwaitPending(page, 'tier1/t1-pdf-two-column.pdf')
    const outcome = await waitForParseOutcome(page, 90_000)
    expect(outcome, 'Tier-1 PDF fixture must parse successfully, not fail').toBe('complete')
    await assertProfilePopulated(page)
  })

  test('Tier-1 DOCX: uploads, parses, and populates the reviewed profile', async () => {
    test.setTimeout(120_000)
    await uploadAndAwaitPending(page, 'tier1/t1-docx-tables-headers-textbox.docx')
    const outcome = await waitForParseOutcome(page, 90_000)
    expect(outcome, 'Tier-1 DOCX fixture must parse successfully, not fail').toBe('complete')
    await assertProfilePopulated(page)
  })

  test('Tier-1 unicode: survives extraction into the profile with no mojibake', async () => {
    test.setTimeout(120_000)
    await uploadAndAwaitPending(page, 'tier1/t1-pdf-unicode.pdf')
    const outcome = await waitForParseOutcome(page, 90_000)
    expect(outcome, 'Tier-1 unicode fixture must parse successfully, not fail').toBe('complete')
    await assertProfilePopulated(page, UNICODE_FRAGMENTS)
  })

  test('Tier-2 wrong-extension: immediate inline refusal, no row, no spinner', async () => {
    const before = await cvSidebarSnapshot(page)
    // Real DOCX bytes labelled .pdf — mime says PDF (extension-derived), so
    // this clears the recruiter action's mime gate and is caught by the
    // byte-signature check instead (src/lib/cv/file-signature.ts), which
    // returns CV_WRONG_FORMAT_MESSAGE.
    await page.getByLabel('CV file').setInputFiles(`${FIXTURE_ROOT}/tier2/t2-docx-renamed.pdf`)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByText(CV_WRONG_FORMAT_MESSAGE)).toBeVisible({ timeout: 10_000 })
    // Immediate reject never calls router.refresh() — nothing should change.
    expect(await page.getByText('Parsing…').count()).toBe(0)
    const after = await cvSidebarSnapshot(page)
    expect(
      after,
      'the CV panel changed after a rejected upload — no row should ever be created for an immediate-reject case',
    ).toBe(before)
  })

  test('Tier-2 unsupported type: immediate inline refusal, no row, no spinner', async () => {
    const before = await cvSidebarSnapshot(page)
    // t2-plain.rtf's browser-reported mime (application/rtf) never reaches
    // the byte-signature check at all — it is rejected by the recruiter
    // action's earlier ACCEPTED_CV_MIME gate (src/app/(app)/candidates/[id]/
    // actions.ts), which uses its own generic copy, not the shared
    // CV_UNSUPPORTED_FORMAT_MESSAGE constant (that constant guards the
    // byte-signature path and the apply-form path instead). Both are
    // legitimate "unsupported format" refusals for the same underlying
    // reason: this file is not one of the two supported formats.
    await page.getByLabel('CV file').setInputFiles(`${FIXTURE_ROOT}/tier2/t2-plain.rtf`)
    await page.getByRole('button', { name: 'Upload CV' }).click()
    await expect(page.getByText('Only PDF and DOCX files are supported.')).toBeVisible({
      timeout: 10_000,
    })
    expect(await page.getByText('Parsing…').count()).toBe(0)
    const after = await cvSidebarSnapshot(page)
    expect(
      after,
      'the CV panel changed after a rejected upload — no row should ever be created for an immediate-reject case',
    ).toBe(before)
  })

  test('Tier-2 damaged file: fails honestly with NO retry control', async () => {
    test.setTimeout(90_000)
    // Passes both upload-time gates (valid "%PDF-" header, correct mime) —
    // the damage (truncated xref/trailer) is only discoverable once Inngest
    // actually tries to extract it, so this DOES enter the pending state.
    await uploadAndAwaitPending(page, 'tier2/t2-pdf-truncated.pdf')
    const outcome = await waitForParseOutcome(page, 60_000)
    expect(outcome, 'Tier-2 damaged-file fixture must fail, not parse successfully').toBe('failed')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText(CV_DAMAGED_FILE_MESSAGE)
    // No retry control anywhere in the failure alert — queried by accessible
    // role/name only, never by CSS. Retrying the SAME damaged bytes cannot
    // possibly succeed (src/lib/cv/parse-messages.ts isUnretryableParseFailure).
    await expect(alert.getByRole('button', { name: /try again/i })).toHaveCount(0)
    await expect(alert.getByRole('button')).toHaveCount(0)
  })

  test('no uncaught client-side errors across the whole run', async () => {
    expect(pageErrors, `uncaught client errors: ${pageErrors.join(' | ')}`).toEqual([])
  })
})
