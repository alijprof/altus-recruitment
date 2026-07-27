// Authenticated production billing smoke driver.
//
// Consumes the session captured in tests/smoke/.auth/prod.json and walks the
// full self-serve billing flow end to end:
//   1. /settings/billing (before)  → status should be "No subscription"
//   2. POST /api/stripe/checkout {planKey:'pro'}  (the call the missing UI
//      button WOULD make — see Finding #1) → hosted Stripe Checkout URL
//   3. Stripe Checkout: pay with the 4242 test card, start the 14-day trial
//   4. /stripe/return → polls, then redirects to the dashboard
//   5. /settings/billing (after) → should show Pro + Trial + trial-end date
//   6. "Manage billing" → opens the Stripe Customer Portal
//
// Screenshots land in tests/smoke/.auth/shots/. A machine-readable summary is
// printed on the last line as `RESULT: {json}`.

import { mkdirSync } from 'node:fs'

import { chromium } from '@playwright/test'

const BASE = process.env.SMOKE_BASE_URL ?? 'https://altusrecruit.com'
const PLAN = process.env.SMOKE_PLAN ?? 'pro'
const SHOTS = 'tests/smoke/.auth/shots'
mkdirSync(SHOTS, { recursive: true })

const result = {
  base: BASE,
  plan: PLAN,
  billingBefore: null,
  checkout: null,
  cardFilled: false,
  returnHeading: null,
  landedAfterReturn: null,
  billingAfter: null,
  portal: null,
  errors: [],
}

const browser = await chromium.launch()
const context = await browser.newContext({
  storageState: 'tests/smoke/.auth/prod.json',
  baseURL: BASE,
})
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

const shot = async (name) => {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
  } catch (e) {
    result.errors.push(`shot ${name}: ${e.message}`)
  }
}
const log = (...a) => console.log('[billing]', ...a)

try {
  // ---- 1. Billing page (before) -------------------------------------------
  await page.goto('/settings/billing', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const beforePath = new URL(page.url()).pathname
  const beforeBody = (await page.locator('body').innerText()).trim()
  result.billingBefore = {
    path: beforePath,
    authed: !beforePath.includes('/sign-in'),
    hasChoosePlan: beforeBody.includes('Choose a plan'),
    hasManageBilling: beforeBody.includes('Manage billing'),
    statusSnippet: beforeBody.slice(0, 300),
  }
  await shot('01-billing-before')
  log('billing-before path=', beforePath, 'authed=', result.billingBefore.authed)
  if (beforePath.includes('/sign-in')) throw new Error('Session invalid — bounced to /sign-in')

  // ---- 2. Start checkout (programmatic — no UI trigger exists) -------------
  const checkout = await page.evaluate(async (plan) => {
    const r = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planKey: plan }),
    })
    return { status: r.status, body: await r.text() }
  }, PLAN)
  log('checkout response', checkout.status, checkout.body.slice(0, 200))
  let checkoutUrl = null
  try {
    checkoutUrl = JSON.parse(checkout.body).url
  } catch {
    /* leave null */
  }
  result.checkout = { status: checkout.status, url: checkoutUrl, body: checkout.body.slice(0, 300) }
  if (!checkoutUrl) throw new Error(`No checkout URL (status ${checkout.status}): ${checkout.body}`)

  // ---- 3. Stripe Checkout: select Card + fill the 4242 test card ----------
  await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' })
  await page.getByText('Enter payment details').first().waitFor({ timeout: 40000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await shot('02-stripe-checkout')

  // Select the "Card" payment method by its RADIO — this expands the inline
  // card form (number/expiry/cvc live in a Stripe Elements iframe; cardholder
  // name + country are on the main page). Force the click (custom-styled).
  const cardRadio = page
    .locator('#payment-method-accordion-item-title-card, input[type="radio"][value="card"]')
    .first()
  if (await cardRadio.count()) {
    await cardRadio.click({ force: true }).catch(() => {})
  } else {
    await page.locator('input[type="radio"]').first().click({ force: true }).catch(() => {})
  }
  await page.waitForTimeout(2500)
  await shot('02b-card-expanded')

  // Search every frame (and the main page) for each field, with retries. Stripe
  // Payment Element ids: Field-numberInput / Field-expiryInput / Field-cvcInput
  // / Field-postalCodeInput / Field-countryInput.
  const fillAnywhere = async (selectors, value) => {
    for (let attempt = 0; attempt < 30; attempt++) {
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
  const selectAnywhere = async (selectors, value) => {
    for (const frame of page.frames()) {
      for (const sel of selectors) {
        const loc = frame.locator(sel)
        if (await loc.count().catch(() => 0)) {
          await loc.first().selectOption(value).catch(() => {})
          return true
        }
      }
    }
    return false
  }

  const numOk = await fillAnywhere(
    ['input[name="number"]', '#Field-numberInput', 'input[autocomplete="cc-number"]'],
    '4242 4242 4242 4242',
  )
  if (!numOk) {
    await shot('99-no-card-field')
    throw new Error('Could not find Stripe card number field in any frame')
  }
  await fillAnywhere(['input[name="expiry"]', '#Field-expiryInput', 'input[autocomplete="cc-exp"]'], '12 / 34')
  await fillAnywhere(['input[name="cvc"]', '#Field-cvcInput', 'input[autocomplete="cc-csc"]'], '123')
  // Cardholder name lives on the main page (not the iframe). Country defaults to
  // United Kingdom and no postal field is shown, so leave both alone.
  const nameField = page.getByPlaceholder(/full name on card|name on card|cardholder/i).first()
  if (await nameField.count()) await nameField.fill('Altus Smoke Test').catch(() => {})
  void selectAnywhere // kept for resilience on configs that do show a country select
  result.cardFilled = true
  await shot('03-card-filled')

  // Submit — the blue "Start trial" button (trialing subscription).
  const submit = page.locator('[data-testid="hosted-payment-submit-button"], button.SubmitButton').first()
  if (await submit.count()) {
    await submit.click()
  } else {
    await page.getByText('Start trial', { exact: true }).first().click()
  }
  log('submitted Stripe Checkout, waiting for return…')

  // ---- 4. /stripe/return → dashboard --------------------------------------
  await page.waitForURL((u) => String(u).includes('/stripe/return'), { timeout: 60000 }).catch(() => {})
  if (page.url().includes('/stripe/return')) {
    result.returnHeading = await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => null)
    await shot('04-stripe-return')
    log('return page heading:', result.returnHeading)
  }
  // Return page polls then router.replace('/').
  await page
    .waitForURL(
      (u) => {
        const url = new URL(String(u))
        return url.pathname === '/' && url.hostname.includes('altusrecruit')
      },
      { timeout: 30000 },
    )
    .catch(() => {})
  result.landedAfterReturn = new URL(page.url()).pathname
  await shot('05-after-return')
  log('landed after return:', result.landedAfterReturn)

  // ---- 5. Billing page (after) — give the webhook a moment ----------------
  await page.waitForTimeout(6000)
  await page.goto('/settings/billing', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const afterBody = (await page.locator('body').innerText()).trim()
  const trialMatch = afterBody.match(/Trial ends:\s*([^\n]+)/)
  result.billingAfter = {
    hasManageBilling: afterBody.includes('Manage billing'),
    showsTrial: /\bTrial\b/.test(afterBody),
    showsPro: /\bPro\b/.test(afterBody),
    trialEnds: trialMatch ? trialMatch[1].trim() : null,
    snippet: afterBody.slice(0, 400),
  }
  await shot('06-billing-after')
  log('billing-after:', JSON.stringify(result.billingAfter))

  // ---- 6. Manage billing → Stripe Customer Portal -------------------------
  const manage = page.getByRole('button', { name: /manage billing/i })
  if (await manage.count()) {
    await manage.click()
    await page
      .waitForURL((u) => String(u).includes('stripe.com'), { timeout: 30000 })
      .catch(() => {})
    const portalUrl = page.url()
    result.portal = {
      reached: portalUrl.includes('stripe.com'),
      url: portalUrl.includes('stripe.com') ? portalUrl.split('?')[0] : portalUrl,
    }
    await shot('07-portal')
    log('portal:', JSON.stringify(result.portal))
  } else {
    result.portal = { reached: false, url: null, note: 'Manage billing button not found' }
  }
} catch (err) {
  result.errors.push(err.message)
  await shot('99-error')
  log('ERROR:', err.message)
} finally {
  result.pageErrors = pageErrors
  await browser.close()
  console.log('RESULT: ' + JSON.stringify(result))
}
