import { test, expect } from '@playwright/test'

import { ALL_GET_ROUTES } from './routes'

// Layer A — HTTP-level health. Non-destructive: GET only, anonymous, no writes.
// Catches the failure modes that kill a deploy: a route 5xx-ing, the auth guard
// regressing, or security headers being dropped.

// Security headers (HSTS in particular) only apply to https deployments. When
// the suite is pointed at a local http dev server we skip that assertion rather
// than report a false failure.
const TARGET = process.env.SMOKE_BASE_URL ?? 'https://altus-recruitment.vercel.app'
const IS_HTTPS = TARGET.startsWith('https://')

test.describe('@smoke health', () => {
  test('homepage redirects anonymous users to /sign-in', async ({ request }) => {
    const res = await request.get('/', { maxRedirects: 0 })
    expect(res.status(), 'GET / should be a 3xx redirect').toBeGreaterThanOrEqual(300)
    expect(res.status(), 'GET / should be a 3xx redirect').toBeLessThan(400)
    expect(res.headers()['location'] ?? '', 'should redirect to /sign-in').toContain('/sign-in')
  })

  test('no route returns a 5xx', async ({ request }) => {
    const failures: string[] = []
    for (const path of ALL_GET_ROUTES) {
      const res = await request.get(path, { maxRedirects: 0 })
      if (res.status() >= 500) failures.push(`${path} -> ${res.status()}`)
    }
    expect(failures, `routes returning 5xx:\n${failures.join('\n')}`).toEqual([])
  })

  test('/sign-in carries baseline security headers', async ({ request }) => {
    test.skip(!IS_HTTPS, 'security headers only asserted against https deployments')
    const res = await request.get('/sign-in')
    const h = res.headers()
    expect(h['strict-transport-security'], 'HSTS header missing').toBeTruthy()
    expect(h['x-content-type-options'], 'x-content-type-options should be nosniff').toBe('nosniff')
    expect(h['x-frame-options'] ?? '', 'x-frame-options should be SAMEORIGIN/DENY').toMatch(
      /SAMEORIGIN|DENY/i,
    )
  })

  test('unknown apply org slug does not 500 (clean not-found)', async ({ request }) => {
    const res = await request.get('/apply/__definitely-not-a-real-org__', { maxRedirects: 0 })
    expect(res.status(), 'bogus apply slug must not 5xx').toBeLessThan(500)
  })

  test('bogus invite token does not 500', async ({ request }) => {
    const res = await request.get('/accept-invite/not-a-real-token', { maxRedirects: 0 })
    expect(res.status(), 'bogus invite token must not 5xx').toBeLessThan(500)
  })
})
