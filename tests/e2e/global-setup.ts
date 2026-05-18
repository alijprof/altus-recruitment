import { chromium, type FullConfig } from '@playwright/test'

// Plan 5 Task 5.3 — E2E auth setup.
//
// Signs in as the deterministic seed owner (owner@acme-recruitment.test —
// password set by supabase/seed.sql) and persists Supabase Auth cookies to
// disk. The golden-path spec consumes the storage state so each test starts
// already-authenticated, no magic-link interception needed.
//
// Pre-requisites (one-off, see README "Running E2E tests"):
//   pnpm exec supabase start
//   pnpm exec supabase db reset      # applies migrations + seed
//
// If the seed user is missing or the dev server isn't running, this setup
// throws and Playwright aborts before any tests execute.

const STORAGE_PATH = 'tests/e2e/.auth/owner.json'
const TEST_EMAIL = 'owner@acme-recruitment.test'
const TEST_PASSWORD = 'AltusTestPassword!1'

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects[0]?.use?.baseURL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'

  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()

  // Drive the sign-in form rather than poking Supabase directly so we exercise
  // the same code path real users hit; on success the app sets the cookie via
  // /auth/callback and lands us on /.
  await page.goto('/sign-in')
  // The sign-in form is magic-link-only by default — but the page accepts a
  // ?password=true query for the E2E flow (we add this in Task 5.3, see
  // sign-in-form.tsx). If that flag is missing we surface a clear error so
  // the executor knows to wire it.
  await page.goto('/sign-in?password=1')
  await page.getByLabel(/email/i).fill(TEST_EMAIL)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Successful sign-in lands on the dashboard.
  await page.waitForURL(/\/$|\/$/, { timeout: 15_000 })
  await context.storageState({ path: STORAGE_PATH })
  await browser.close()
}
