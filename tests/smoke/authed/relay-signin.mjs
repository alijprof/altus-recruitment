// Magic-link relay — captures a Supabase session for the authenticated smoke
// (Layer A2) without anyone clicking an email link.
//
// Supabase magic-link uses PKCE: the code_verifier is stored in the browser
// context that REQUESTS the link, so the link must be opened in that SAME
// context. This script therefore stays alive across the whole flow:
//   1. requests the OTP for SMOKE_AUTH_EMAIL on /sign-in
//   2. waits for the link to appear at tests/smoke/.auth/magic-link.txt
//      (the operator / agent reads it from the inbox and writes it there)
//   3. opens the link in the same context, then saves storage state
//
// Usage:
//   SMOKE_AUTH_EMAIL=you@example.com node tests/smoke/authed/relay-signin.mjs
//   # in another step, write the sign-in URL from the inbox to:
//   #   tests/smoke/.auth/magic-link.txt
//
// Env:
//   SMOKE_AUTH_EMAIL  (required) email of an existing user on the target
//   SMOKE_BASE_URL    (optional) defaults to live production
//   RELAY_TIMEOUT_MS  (optional) how long to wait for the link (default 300000)

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { chromium } from '@playwright/test'

const BASE = process.env.SMOKE_BASE_URL ?? 'https://altusrecruit.com'
const EMAIL = process.env.SMOKE_AUTH_EMAIL
const TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS ?? 300_000)

const DIR = 'tests/smoke/.auth'
const STATE = `${DIR}/prod.json`
const LINK_FILE = `${DIR}/magic-link.txt`
const READY = `${DIR}/relay-ready`
const DONE = `${DIR}/relay-done`

if (!EMAIL) {
  console.error('Set SMOKE_AUTH_EMAIL to an existing user on the target.')
  process.exit(1)
}

mkdirSync(DIR, { recursive: true })
for (const f of [LINK_FILE, READY, DONE]) if (existsSync(f)) rmSync(f)

const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: BASE })
const page = await context.newPage()

await page.goto('/sign-in')
await page.locator('input[type=email]').first().fill(EMAIL)
await page.getByRole('button', { name: /send magic link/i }).click()
await page
  .getByText(/check .* for a sign-in link/i)
  .waitFor({ timeout: 15_000 })
  .catch(() => {})

writeFileSync(READY, EMAIL)
console.log(`[relay] OTP requested for ${EMAIL} on ${BASE}`)
console.log(`[relay] waiting for the sign-in URL at ${LINK_FILE} ...`)

const deadline = Date.now() + TIMEOUT_MS
let url = null
while (Date.now() < deadline) {
  if (existsSync(LINK_FILE)) {
    url = readFileSync(LINK_FILE, 'utf8').trim()
    if (url) break
  }
  await page.waitForTimeout(2000)
}

if (!url) {
  console.error('[relay] no sign-in URL provided before timeout')
  await browser.close()
  process.exit(2)
}

console.log('[relay] opening sign-in URL in the original PKCE context ...')
await page.goto(url)
await page
  .waitForURL((u) => !new URL(u).pathname.includes('sign-in'), { timeout: 20_000 })
  .catch(() => {})

if (new URL(page.url()).pathname.includes('sign-in')) {
  console.error(`[relay] sign-in did not complete; still at ${page.url()}`)
  await browser.close()
  process.exit(3)
}

await context.storageState({ path: STATE })
writeFileSync(DONE, 'ok')
console.log(`[relay] authenticated session saved to ${STATE}`)
await browser.close()
