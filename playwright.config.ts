import { defineConfig } from '@playwright/test'

// Plan 5 Task 5.3 — Playwright config. globalSetup signs in as the seed
// owner and writes storage state to tests/e2e/.auth/owner.json; the
// "authenticated" project consumes that state so each test starts already
// signed in. The "unauthenticated" project covers the auth-guard smoke test.

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Phase 1 has a tiny suite; avoid DB collisions.
  timeout: 30_000,
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'unauthenticated',
      testMatch: /auth-guard\.spec\.ts/,
      use: {
        // No storage state — fresh anonymous context.
      },
    },
    {
      name: 'authenticated',
      testIgnore: /auth-guard\.spec\.ts/,
      use: {
        storageState: 'tests/e2e/.auth/owner.json',
      },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The golden-path suite signs in with the always-available password method
    // (global-setup clicks the "password instead" toggle). No env flag needed —
    // password sign-in is a first-class feature, not a dev-only gate.
  },
})
