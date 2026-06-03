import { test, expect } from '@playwright/test'

import { PROTECTED_ROUTES } from './routes'

// Layer A — multi-tenancy's first line of defence. Every authenticated route
// must bounce an anonymous request to /sign-in. A regression here (a route
// added without going through the (app) group / middleware matcher) is exactly
// the kind of cross-tenant exposure CLAUDE.md calls the worst possible bug, so
// each route gets its own test for a precise failure signal.

test.describe('@smoke auth-guard', () => {
  for (const path of PROTECTED_ROUTES) {
    test(`anonymous GET ${path} redirects to /sign-in`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status(), `${path} should be a 3xx redirect`).toBeGreaterThanOrEqual(300)
      expect(res.status(), `${path} should be a 3xx redirect`).toBeLessThan(400)
      expect(res.headers()['location'] ?? '', `${path} should redirect to /sign-in`).toContain(
        '/sign-in',
      )
    })
  }
})
