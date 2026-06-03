import { test, expect, type Page } from '@playwright/test'

// Layer A2 — authenticated, READ-ONLY production smoke. Consumes the session
// stored by the magic-link relay and confirms the signed-in shell renders for
// each main section without errors. Deliberately avoids candidate *detail*
// pages (those write audit_log entries) — list/board/aggregate views only, so
// a smoke run leaves no meaningful trace in the customer's audit trail.

const SECTIONS: { path: string; label: string }[] = [
  { path: '/', label: 'dashboard' },
  { path: '/candidates', label: 'candidates list' },
  { path: '/jobs', label: 'jobs list' },
  { path: '/clients', label: 'clients list' },
  { path: '/pipeline', label: 'pipeline board' },
  { path: '/search', label: 'search' },
  { path: '/reports', label: 'reports' },
  { path: '/settings', label: 'settings' },
]

function trackPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test.describe('@smoke-auth read-only', () => {
  for (const { path, label } of SECTIONS) {
    test(`${label} renders for an authenticated user`, async ({ page }) => {
      const errors = trackPageErrors(page)
      const res = await page.goto(path)
      expect(res?.status() ?? 0, `${label} must not 5xx`).toBeLessThan(500)
      // Session is valid — we are NOT bounced back to /sign-in.
      expect(
        new URL(page.url()).pathname,
        `${label}: session invalid (redirected to sign-in — state expired?)`,
      ).not.toContain('/sign-in')
      // The authenticated shell rendered real content.
      const body = (await page.locator('body').innerText()).trim()
      expect(body.length, `${label}: empty body`).toBeGreaterThan(0)
      expect(errors, `${label} uncaught client errors: ${errors.join(' | ')}`).toEqual([])
    })
  }
})
