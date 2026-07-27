// Post-rotation verification: one real NL query on prod. Its ai_usage write
// runs through the service-role client in the deployed lambda — success
// proves the rotated key works at runtime, not just locally.
import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: 'tests/smoke/.auth/prod.json', baseURL: 'https://altusrecruit.com' })
const page = await ctx.newPage()
await page.goto('/reports/nl', { waitUntil: 'domcontentloaded' })
await page.locator('input[type="text"], textarea').first().fill('how many placements did we make last quarter by sector?')
await page.getByRole('button', { name: /ask|run/i }).first().click()
await page.waitForTimeout(15000)
const body = (await page.locator('body').innerText()).trim()
console.log(JSON.stringify({
  matched: /matched template/i.test(body),
  hasResult: (await page.locator('table').count()) > 0 || /no (results|rows|data)|0 rows/i.test(body),
  aiError: /temporarily unavailable|ai-error|something went wrong/i.test(body),
}))
await browser.close()
