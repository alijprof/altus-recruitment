import { test, expect } from '@playwright/test'

// Plan 03-06 / Task F.3 — REPEAT-02.
//
// Playwright stub for the source-attribution report.
//
// SCOPE: This file is intentionally a touchpoint stub. The full assertion
// flow requires:
//   1. Programmatic sign-in via Supabase admin client (`tests/e2e/global-
//      setup.ts` already wires up an org-A user; org-B requires extending
//      that fixture).
//   2. Seeding placed applications across two orgs with deterministic
//      source values + fees + placed_at timestamps.
//
// The auth-redirect assertion below is the only check that runs against
// the unauthenticated state — it confirms middleware protects the new
// route. The TODOs are the work to lift this from stub to full coverage.

test('unauthenticated request to /reports/source-attribution redirects to sign-in', async ({
  page,
}) => {
  await page.goto('/reports/source-attribution')
  expect(page.url()).toContain('/sign-in')
})

// TODO Plan 03-06 follow-up — wire the full flow once the fixture supports
// two-org seeding:
//
// test.fixme('renders org-A placements only, cross-org isolation', async ({ page, request }) => {
//   // 1. Seed org-A: 1 placed application, source='linkedin', fee=£5,000.
//   // 2. Seed org-B: 1 placed application, source='linkedin', fee=£9,999.
//   // 3. Sign in as org-A user.
//   // 4. Navigate to /reports/source-attribution.
//   // 5. Assert: exactly one row in the "By source" table with source='LinkedIn'
//   //    and placements=1.
//   // 6. Click "Last 30 days" preset; assert URL contains preset=30d.
//   // 7. Sign out, sign in as org-B user, navigate to same URL.
//   // 8. Assert: different row (org-A's £5,000 must NOT appear).
// })
