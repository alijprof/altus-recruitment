// Pre-smoke for the Finding #1 fix (quick task 260605-gtj): the NEW self-serve
// checkout UI. Unlike billing-smoke.mjs (which POSTs the endpoint directly),
// this exercises the actual customer click path:
//   1. /settings/billing renders the 3-plan picker + "Start 14-day trial" buttons
//   2. clicking the Pro button reaches hosted Stripe Checkout (the fix works)
//   3. complete the 4242 trial → /stripe/return → dashboard
//   4. /settings/billing now shows "Manage billing" (picker gone)
//   5. the WR-02 guard: a direct re-POST to /api/stripe/checkout returns 409
// Screenshots in tests/smoke/.auth/shots/. Summary on the last line as RESULT.

import { mkdirSync } from 'node:fs'

import { chromium } from '@playwright/test'

const BASE = process.env.SMOKE_BASE_URL ?? 'https://altusrecruit.com'
const SHOTS = 'tests/smoke/.auth/shots'
mkdirSync(SHOTS, { recursive: true })

const result = { base: BASE, pickerRendered: null, buttonReachedStripe: null, completed: null, billingAfter: null, guard409: null, errors: [] }
const browser = await chromium.launch()
const context = await browser.newContext({ storageState: 'tests/smoke/.auth/prod.json', baseURL: BASE })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {})
const log = (...a) => console.log('[verify-button]', ...a)

try {
  // 1. Picker renders.
  await page.goto('/settings/billing', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const body = (await page.locator('body').innerText()).trim()
  const trialButtons = page.getByRole('button', { name: /start 14-day trial/i })
  const btnCount = await trialButtons.count()
  result.pickerRendered = {
    path: new URL(page.url()).pathname,
    trialButtonCount: btnCount,
    showsStarter: body.includes('Starter'),
    showsPro: body.includes('Pro'),
    showsScale: body.includes('Scale'),
    showsCompare: body.includes('Compare all plans'),
  }
  await shot('20-picker')
  log('picker:', JSON.stringify(result.pickerRendered))
  if (btnCount < 3) throw new Error(`Expected 3 plan buttons, found ${btnCount} — fix not deployed?`)

  // 2. Click the Pro button (order is starter/pro/scale → index 1).
  await trialButtons.nth(1).click()
  await page.waitForURL((u) => String(u).includes('checkout.stripe.com'), { timeout: 30000 }).catch(() => {})
  result.buttonReachedStripe = String(page.url()).includes('checkout.stripe.com')
  await shot('21-stripe-from-button')
  log('reached Stripe Checkout via button:', result.buttonReachedStripe)
  if (!result.buttonReachedStripe) throw new Error(`Button did not navigate to Stripe Checkout; at ${page.url()}`)

  // 3. Complete the trial (select Card radio, fill iframe fields, submit).
  await page.getByText('Enter payment details').first().waitFor({ timeout: 40000 }).catch(() => {})
  await page.locator('#payment-method-accordion-item-title-card, input[type="radio"][value="card"]').first().click({ force: true }).catch(() => {})
  await page.waitForTimeout(2500)
  const fillAnywhere = async (selectors, value) => {
    for (let i = 0; i < 30; i++) {
      for (const frame of page.frames()) {
        for (const sel of selectors) {
          const loc = frame.locator(sel)
          if (await loc.count().catch(() => 0)) {
            await loc.first().fill(value).catch(() => {})
            return true
          }
        }
      }
      await page.waitForTimeout(700)
    }
    return false
  }
  const numOk = await fillAnywhere(['input[name="number"]', '#Field-numberInput', 'input[autocomplete="cc-number"]'], '4242 4242 4242 4242')
  if (!numOk) throw new Error('Could not find Stripe card number field')
  await fillAnywhere(['input[name="expiry"]', '#Field-expiryInput', 'input[autocomplete="cc-exp"]'], '12 / 34')
  await fillAnywhere(['input[name="cvc"]', '#Field-cvcInput', 'input[autocomplete="cc-csc"]'], '123')
  const nameField = page.getByPlaceholder(/full name on card|name on card|cardholder/i).first()
  if (await nameField.count()) await nameField.fill('Altus Smoke Test').catch(() => {})
  await shot('22-card-filled')
  await page.locator('[data-testid="hosted-payment-submit-button"], button.SubmitButton').first().click()
  await page.waitForURL((u) => String(u).includes('/stripe/return'), { timeout: 60000 }).catch(() => {})
  await page.waitForURL((u) => { const x = new URL(String(u)); return x.pathname === '/' && x.hostname.includes('altusrecruit') }, { timeout: 30000 }).catch(() => {})
  result.completed = { landed: new URL(page.url()).pathname }
  await shot('23-after-return')
  log('completed, landed:', result.completed.landed)

  // 4. Billing page now shows Manage billing (picker gone).
  await page.waitForTimeout(6000)
  await page.goto('/settings/billing', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const after = (await page.locator('body').innerText()).trim()
  result.billingAfter = {
    hasManageBilling: after.includes('Manage billing'),
    pickerGone: (await page.getByRole('button', { name: /start 14-day trial/i }).count()) === 0,
    showsTrial: /\bTrial\b/.test(after),
  }
  await shot('24-billing-after')
  log('billing-after:', JSON.stringify(result.billingAfter))

  // 5. WR-02 guard: a direct re-POST must be rejected with 409.
  const guard = await page.evaluate(async () => {
    const r = await fetch('/api/stripe/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planKey: 'pro' }) })
    return { status: r.status, body: (await r.text()).slice(0, 200) }
  })
  result.guard409 = { status: guard.status, is409: guard.status === 409, body: guard.body }
  log('double-subscribe guard:', JSON.stringify(result.guard409))
} catch (err) {
  result.errors.push(err.message)
  await shot('29-error')
  log('ERROR:', err.message)
} finally {
  result.pageErrors = pageErrors
  await browser.close()
  console.log('RESULT: ' + JSON.stringify(result))
}
