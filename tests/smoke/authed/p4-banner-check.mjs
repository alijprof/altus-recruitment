import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: 'tests/smoke/.auth/prod.json', baseURL: 'https://altusrecruit.com' })
const page = await ctx.newPage()
await page.goto('/candidates/509b3248-10a7-4413-b20d-d065a76f32aa/voice-notes/new', { waitUntil: 'networkidle' })
const body = (await page.locator('body').innerText()).trim()
const reviewLink = await page.locator('a[href*="/voice-notes/"][href$="/review"]').first().getAttribute('href').catch(() => null)
console.log(JSON.stringify({
  bannerShown: /awaiting your review/i.test(body),
  reviewLink,
}))
await browser.close()
