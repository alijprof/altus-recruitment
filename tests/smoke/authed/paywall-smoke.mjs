// Paywall smoke — verifies the card-first access gate in PROD.
//
// Preconditions (run the minter first, supplying your service-role key):
//   ! SUPABASE_SERVICE_ROLE_KEY='...' node tests/smoke/authed/mint-paywall-sessions.mjs
// Then:
//   node tests/smoke/authed/paywall-smoke.mjs
//
// Asserts:
//   1. Grandfathered org (AJ, status 'active') → loads the CRM, NOT the paywall.
//   2. Gated org (SMOKE, status 'none')        → sees the PaywallScreen with the
//      3 plan cards + "Start 14-day trial" buttons (owner path).
//   3. The trial buttons are present and enabled (checkout entry point works).
//      Set SMOKE_CLICK_CHECKOUT=1 to also click and confirm the POST
//      /api/stripe/checkout returns a Stripe URL (creates a dangling Stripe
//      Checkout session — clean up with cleanup-stripe.mjs). Default: no click.
//
// Screenshots in tests/smoke/.auth/shots/. Summary printed as `RESULT: {json}`.

import { mkdirSync } from 'node:fs'

import { chromium } from '@playwright/test'

const BASE = 'https://altusrecruit.com'
const SHOTS = 'tests/smoke/.auth/shots'
const PAYWALL_HEADING = 'Start your 14-day free trial'
const DO_CLICK = process.env.SMOKE_CLICK_CHECKOUT === '1'
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
const result = {}
const log = (...a) => console.log('[paywall]', ...a)

const step = async (name, fn) => {
  try {
    result[name] = await fn()
    log(name, '→', JSON.stringify(result[name]))
  } catch (e) {
    result[name] = { error: e.message }
    log(name, 'ERROR', e.message)
  }
}

// 1. Grandfathered org → CRM, not paywall.
await step('grandfathered', async () => {
  const ctx = await browser.newContext({
    storageState: 'tests/smoke/.auth/grandfathered.json',
    baseURL: BASE,
  })
  const page = await ctx.newPage()
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const body = (await page.locator('body').innerText()).trim()
  await page.screenshot({ path: `${SHOTS}/20-grandfathered-crm.png`, fullPage: true })
  const isPaywall = body.includes(PAYWALL_HEADING)
  // CRM markers: TopNav exposes the main nav. Any of these = the real app.
  const hasNav = /Candidates|Jobs|Clients|Pipeline|Dashboard/i.test(body)
  await ctx.close()
  return {
    pass: !isPaywall && hasNav,
    isPaywall,
    hasNav,
    snippet: body.slice(0, 160),
  }
})

// 2. Gated org → PaywallScreen with plan cards + trial buttons (owner path).
await step('gated', async () => {
  const ctx = await browser.newContext({
    storageState: 'tests/smoke/.auth/gated.json',
    baseURL: BASE,
  })
  const page = await ctx.newPage()
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const body = (await page.locator('body').innerText()).trim()
  await page.screenshot({ path: `${SHOTS}/21-gated-paywall.png`, fullPage: true })

  const isPaywall = body.includes(PAYWALL_HEADING)
  const hasStarter = /Starter/.test(body)
  const hasPro = /Pro/.test(body)
  const hasScale = /Scale/.test(body)
  const trialButtons = await page.getByRole('button', { name: /start 14-day trial/i }).count()
  // CRM must NOT be visible behind/around the gate.
  const crmLeaked = /Candidates|Pipeline/i.test(body)

  let checkout = { attempted: false }
  if (DO_CLICK && trialButtons > 0) {
    // Capture the /api/stripe/checkout response without following to Stripe.
    await page.route('https://checkout.stripe.com/**', (r) => r.abort())
    const respP = page
      .waitForResponse((r) => r.url().includes('/api/stripe/checkout'), { timeout: 20000 })
      .catch(() => null)
    await page.getByRole('button', { name: /start 14-day trial/i }).first().click()
    const resp = await respP
    let hasUrl = false
    if (resp) {
      const json = await resp.json().catch(() => ({}))
      hasUrl = typeof json.url === 'string' && json.url.includes('checkout.stripe.com')
    }
    checkout = {
      attempted: true,
      status: resp ? resp.status() : null,
      returnedStripeUrl: hasUrl,
    }
  }

  await ctx.close()
  return {
    pass: isPaywall && hasStarter && hasPro && hasScale && trialButtons >= 3 && !crmLeaked,
    isPaywall,
    planCards: { hasStarter, hasPro, hasScale },
    trialButtons,
    crmLeaked,
    checkout,
  }
})

await browser.close()
console.log('RESULT: ' + JSON.stringify(result))

const ok = result.grandfathered?.pass && result.gated?.pass
process.exit(ok ? 0 : 1)
