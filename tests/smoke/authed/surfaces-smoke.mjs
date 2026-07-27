// Authenticated smoke of the remaining Phase 5 surfaces:
//   /admin (super-admin gate + per-tenant AI cost), /admin/[org] detail,
//   branding settings (set a colour) → public apply page reflects it,
//   CSV import wizard, dashboard onboarding state.
// Each surface is isolated; one failure doesn't abort the others. Screenshots
// in tests/smoke/.auth/shots/. Summary printed as `RESULT: {json}`.

import { mkdirSync } from 'node:fs'

import { chromium } from '@playwright/test'

const BASE = 'https://altusrecruit.com'
const ORG_ID = 'cb70bfc3-d916-4831-a21d-0331b2b9efe3'
const ORG_SLUG = 'altus'
const TEST_COLOUR = '#6C2BD9' // distinct purple, unlike defaults (#0A3D5C / #5DCAA5)
const SHOTS = 'tests/smoke/.auth/shots'
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ storageState: 'tests/smoke/.auth/prod.json', baseURL: BASE })
const page = await context.newPage()
const result = {}
const log = (...a) => console.log('[surfaces]', ...a)

const step = async (name, fn) => {
  try {
    result[name] = await fn()
    log(name, '→', JSON.stringify(result[name]))
  } catch (e) {
    result[name] = { error: e.message }
    log(name, 'ERROR', e.message)
    await page.screenshot({ path: `${SHOTS}/err-${name}.png`, fullPage: true }).catch(() => {})
  }
}

// 1. /admin — super-admin gate + tenant AI-cost overview.
await step('admin', async () => {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const path = new URL(page.url()).pathname
  const body = (await page.locator('body').innerText()).trim()
  await page.screenshot({ path: `${SHOTS}/10-admin.png`, fullPage: true })
  return {
    path,
    gatePassed: path.startsWith('/admin'),
    hasTenantOverview: body.includes('Tenant Overview'),
    hasAiCostColumn: body.includes('Month AI cost'),
    mentionsAJ: /\bAJ\b/.test(body),
  }
})

// 2. /admin/[org] — per-tenant subscription + AI usage detail.
await step('adminDetail', async () => {
  await page.goto(`/admin/${ORG_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const body = (await page.locator('body').innerText()).trim()
  await page.screenshot({ path: `${SHOTS}/11-admin-detail.png`, fullPage: true })
  return {
    hasSubscription: body.includes('Subscription'),
    showsProTrial: /\bPro\b/.test(body) && /\bTrial|trialing\b/i.test(body),
    hasAiUsage: body.includes('AI usage'),
  }
})

// 3. /settings/branding — set a primary colour and save.
await step('branding', async () => {
  await page.goto('/settings/branding', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const hexInput = page.locator('input.font-mono').first()
  const rendered = await hexInput.count()
  if (!rendered) throw new Error('branding hex input not found')
  await hexInput.fill(TEST_COLOUR)
  const saveBtn = page.getByRole('button', { name: /save branding/i })
  await saveBtn.click()
  // Sonner success toast.
  const toastOk = await page
    .getByText(/branding saved/i)
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  await page.screenshot({ path: `${SHOTS}/12-branding.png`, fullPage: true })
  return { rendered: !!rendered, savedToast: toastOk, setColour: TEST_COLOUR }
})

// 4. Public apply page reflects the brand colour (CSS var injection).
await step('applyColour', async () => {
  await page.goto(`/apply/${ORG_SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const brandPrimary = await page.evaluate(() => {
    const el = document.querySelector('[style*="--brand-primary"]')
    return el ? el.style.getPropertyValue('--brand-primary').trim() : null
  })
  await page.screenshot({ path: `${SHOTS}/13-apply.png`, fullPage: true })
  return {
    brandPrimary,
    matchesSet: !!brandPrimary && brandPrimary.toLowerCase() === TEST_COLOUR.toLowerCase(),
  }
})

// 5. CSV import wizard renders (no actual import — avoid writing candidates).
await step('csvImport', async () => {
  await page.goto('/candidates/import', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const body = (await page.locator('body').innerText()).trim()
  const fileInput = await page.locator('#csv-upload, input[type="file"]').count()
  await page.screenshot({ path: `${SHOTS}/14-import.png`, fullPage: true })
  return {
    hasFileInput: fileInput > 0,
    mentionsUpload: /upload csv|download example|import candidates/i.test(body),
    snippet: body.slice(0, 200),
  }
})

// 6. Dashboard — onboarding checklist state (likely complete/hidden for an
//    established org with 36 candidates; we just record what renders).
await step('dashboard', async () => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const body = (await page.locator('body').innerText()).trim()
  await page.screenshot({ path: `${SHOTS}/15-dashboard.png`, fullPage: true })
  return {
    hasGetStarted: body.includes('Get started'),
    hasSeedButton: body.includes('Seed sample data'),
    rendered: body.length > 0,
  }
})

await browser.close()
console.log('RESULT: ' + JSON.stringify(result))
