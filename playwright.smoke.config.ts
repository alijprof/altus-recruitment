import { defineConfig } from '@playwright/test'

// Production / preview SMOKE config — non-destructive, anonymous-only.
//
// Targets an already-deployed URL (default: live production) and runs read-only
// checks: reachability, auth-guard redirects, public-page render, security
// headers, and a no-5xx sweep across every known route. There is deliberately
// NO webServer (we test a deployed target, not a local build) and NO auth
// storage state — authenticated + mutating golden-path coverage lives in the
// local suite (tests/e2e, run via `pnpm test:e2e`).
//
//   pnpm smoke                                    # against live production
//   SMOKE_BASE_URL=https://<preview-url> pnpm smoke
//   SMOKE_CHROME=1 pnpm smoke                     # drive the real installed Chrome
//
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'https://altus-recruitment.vercel.app'
const useChrome = process.env.SMOKE_CHROME === '1'

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: /.*\.smoke\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Tolerate a single cold-start / transient network blip before failing.
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/smoke' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    ...(useChrome ? { channel: 'chrome' } : {}),
  },
  projects: [{ name: 'smoke' }],
})
