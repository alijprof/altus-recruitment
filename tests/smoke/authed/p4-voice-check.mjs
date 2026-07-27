import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: 'tests/smoke/.auth/prod.json', baseURL: 'https://altusrecruit.com' })
const page = await ctx.newPage()
await page.goto('/candidates', { waitUntil: 'domcontentloaded' })
const uuid = /\/candidates\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
await page.waitForFunction(() => document.querySelectorAll('a[href^="/candidates/"]').length > 1, null, { timeout: 25000 }).catch(() => {})
const hrefs = await page.$$eval('a[href^="/candidates/"]', els => els.map(e => e.getAttribute('href')))
const detail = hrefs.find(h => uuid.test(h ?? ''))
if (!detail) { console.log(JSON.stringify({ skipped: 'no detail link', sample: hrefs.slice(0, 5) })); process.exit(0) }
await page.goto(detail, { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})
const btn = page.getByRole('link', { name: /voice note/i }).or(page.getByRole('button', { name: /voice note/i })).first()
const visible = await btn.isVisible().catch(() => false)
let capture = {}
if (visible) {
  await btn.click()
  await page.waitForLoadState('networkidle').catch(() => {})
  const body = (await page.locator('body').innerText()).trim()
  capture = { capturePath: new URL(page.url()).pathname, hasRecorderOrUpload: /record|upload/i.test(body) }
  await page.screenshot({ path: 'tests/smoke/.auth/shots/p4-14-voice-final.png', fullPage: true })
}
console.log(JSON.stringify({ detail, voiceBtnVisible: visible, ...capture }))
await browser.close()
