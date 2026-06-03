import { test, expect, type Page } from '@playwright/test'

// Layer A — DOM-level render checks for the unauthenticated, customer-facing
// pages. HTTP 200 is not enough: a page can return 200 and still ship a white
// screen if the client bundle throws. We navigate with a real browser, assert
// the key elements are present, and fail on any uncaught client-side error.

// Collect uncaught client-side errors during a navigation. An empty array at
// the end of the test means the page hydrated cleanly.
function trackPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test.describe('@smoke public pages', () => {
  test('sign-in renders the magic-link form with no client errors', async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.goto('/sign-in')
    await expect(page.locator('input[type="email"]').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /send magic link/i })).toBeVisible()
    expect(errors, `uncaught client errors: ${errors.join(' | ')}`).toEqual([])
  })

  test('production sign-in does NOT expose the password bypass (?password=1)', async ({ page }) => {
    // Security regression guard. NEXT_PUBLIC_ALLOW_PASSWORD_AUTH must be OFF in
    // production, so the dev-only password input must never render — even when
    // the ?password=1 flag is present on the URL.
    await page.goto('/sign-in?password=1')
    await expect(page.getByRole('button', { name: /send magic link/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test('sign-up renders an email field with no client errors', async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.goto('/sign-up')
    await expect(page.locator('input[type="email"]').first()).toBeVisible()
    expect(errors, `uncaught client errors: ${errors.join(' | ')}`).toEqual([])
  })

  test('auth-code-error page renders non-empty content (not a blank 500)', async ({ page }) => {
    const res = await page.goto('/auth/auth-code-error')
    expect(res?.status() ?? 0, 'auth-code-error must not 5xx').toBeLessThan(500)
    const body = (await page.locator('body').innerText()).trim()
    expect(body.length, 'auth-code-error body should not be empty').toBeGreaterThan(0)
  })
})
