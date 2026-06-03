import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { chromium, type FullConfig } from '@playwright/test'

// Plan 5 Task 5.3 — E2E auth setup (Layer B: local authenticated golden-path).
//
// Signs in as the deterministic seed owner (owner@acme-recruitment.test —
// password set by supabase/seed.sql) and persists Supabase Auth cookies to
// disk. The authenticated specs consume the storage state so each test starts
// already-authenticated, no magic-link interception needed.
//
// Pre-requisites (one-off, see tests/smoke/README.md "Layer B"):
//   pnpm exec supabase start          # local Postgres + Auth (needs Docker)
//   pnpm test:e2e:reset               # applies migrations + seed
//   # .env.local must point NEXT_PUBLIC_SUPABASE_URL at the local stack
//
// If the seed user is missing, the password flag isn't set, or the target is
// not a local database, this setup throws with an actionable message and
// Playwright aborts before any tests execute.

const STORAGE_PATH = 'tests/e2e/.auth/owner.json'
const TEST_EMAIL = 'owner@acme-recruitment.test'
const TEST_PASSWORD = 'AltusTestPassword!1'

// Resolve the Supabase URL the app-under-test will actually write to. The
// Playwright runner process usually has no env loaded, so fall back to parsing
// .env.local (which `next dev` reads).
export function resolveSupabaseUrl(): string | undefined {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)
    return match?.[1]?.trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

export function isLocalSupabase(url: string | undefined): boolean {
  if (!url) return false
  return /localhost|127\.0\.0\.1|\[::1\]|:54321/.test(url)
}

// SAFETY: the golden-path specs CREATE candidates/clients/jobs. They must only
// ever run against a throwaway database. Refuse to proceed against a non-local
// Supabase unless the operator explicitly opts in.
function assertSafeTarget(): void {
  if (process.env.ALLOW_NONLOCAL_E2E === '1') return
  const url = resolveSupabaseUrl()
  if (isLocalSupabase(url)) return
  throw new Error(
    [
      'Refusing to run the mutating E2E golden-path against a non-local Supabase.',
      `  Resolved NEXT_PUBLIC_SUPABASE_URL = ${url ?? '(unset)'}`,
      '  These tests create candidates/clients/jobs and must target a throwaway DB,',
      "  never the anchor customer's production data.",
      '  Fix: start local Supabase (pnpm exec supabase start), point .env.local at it,',
      '       seed it (pnpm test:e2e:reset), then run pnpm test:e2e.',
      '  Override (only if you truly mean it): ALLOW_NONLOCAL_E2E=1 pnpm test:e2e',
    ].join('\n'),
  )
}

export default async function globalSetup(config: FullConfig) {
  assertSafeTarget()

  const baseURL =
    config.projects[0]?.use?.baseURL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'

  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()

  // Drive the real sign-in form (same code path users hit). The password
  // fallback is gated by NEXT_PUBLIC_ALLOW_PASSWORD_AUTH=1 — set for the test
  // dev server in playwright.config.ts's webServer.env.
  await page.goto('/sign-in?password=1')
  const passwordField = page.getByLabel(/password/i)
  try {
    await passwordField.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    await browser.close()
    throw new Error(
      'E2E sign-in password field never rendered. The dev server needs ' +
        'NEXT_PUBLIC_ALLOW_PASSWORD_AUTH=1. It is set in playwright.config.ts ' +
        'webServer.env, but a pre-existing dev server on :3000 is reused as-is — ' +
        'restart it with the flag, or stop it so Playwright can spawn its own.',
    )
  }

  await page.getByLabel(/email/i).fill(TEST_EMAIL)
  await passwordField.fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Successful sign-in lands on the dashboard ("/").
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 15_000 })
  await context.storageState({ path: STORAGE_PATH })
  await browser.close()
}
