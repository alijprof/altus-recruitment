import { defineConfig } from '@playwright/test'

// Layer A2 — AUTHENTICATED, READ-ONLY production smoke.
//
// Consumes a Supabase session captured by the magic-link relay
// (tests/smoke/authed/relay-signin.mjs) into tests/smoke/.auth/prod.json, then
// confirms the signed-in shell renders for each main section. Read-only: it
// never creates/edits data and avoids candidate *detail* pages (which write
// audit_log entries) — list/board/aggregate views only.
//
//   # one-off: capture a session (one continuous browser context)
//   SMOKE_AUTH_EMAIL=you@example.com node tests/smoke/authed/relay-signin.mjs
//   # then:
//   pnpm smoke:auth
//
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'https://altusrecruit.com'
const useChrome = process.env.SMOKE_CHROME === '1'

export default defineConfig({
  testDir: './tests/smoke/authed',
  testMatch: /.*\.smoke\.ts/,
  globalSetup: './tests/smoke/authed/global-setup.ts',
  // fullyParallel intentionally left true — the risk this guards against is
  // not intra-file parallelism (every write-capable spec below is already
  // test.describe.serial internally) but CROSS-FILE parallelism between the
  // write-capable specs themselves. `workers: 1` is the actual guard: a
  // PARALLEL run of cv-intake.smoke.ts / cv-lifecycle.smoke.ts /
  // branded-cv.smoke.ts trips each other's fail-closed afterAll sweeps,
  // because trigram-fuzzy candidate search matches `GSD Phase06 Smoke` <->
  // `GSD Phase07 Smoke` <-> `GSD Phase08 Smoke` regardless of how distinct
  // the literal prefixes are — one spec's sweep can land on and delete rows
  // mid-creation by another spec running concurrently. Recorded as a STATE.md
  // open item after Phase 7's full-suite run and closed here (08-09-PLAN.md
  // "Why the smoke must run serially").
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/smoke-auth' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    baseURL: BASE_URL,
    storageState: 'tests/smoke/.auth/prod.json',
    trace: 'on-first-retry',
    ...(useChrome ? { channel: 'chrome' } : {}),
  },
  projects: [{ name: 'smoke-auth' }],
})
