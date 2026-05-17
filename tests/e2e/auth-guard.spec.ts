import { test, expect } from '@playwright/test'

test('unauthenticated request to / redirects to /sign-in', async ({ page }) => {
  await page.goto('/')
  expect(page.url()).toContain('/sign-in')
  expect(page.url()).toContain('next=%2F')
})
