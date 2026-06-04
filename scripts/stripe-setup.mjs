// One-off Stripe TEST-mode setup for Phase 5 billing.
// Idempotent: safe to re-run. Creates 3 products + recurring GBP prices,
// a webhook endpoint (prints its signing secret), and a Customer Portal config.
// Appends the resulting env vars to .env.local (without clobbering existing).
//
// Run: STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//
// Webhook target: production (altusrecruit.com) — the permanent endpoint. It
// becomes live once Phase 5 is on main. (Preview is 401-walled, so Stripe can't
// reach it; preview testing covers everything except subscription activation.)

import Stripe from 'stripe'
import { readFileSync, appendFileSync, existsSync } from 'node:fs'

const key = process.env.STRIPE_SECRET_KEY
if (!key) { console.error('Missing STRIPE_SECRET_KEY'); process.exit(1) }
const stripe = new Stripe(key)

const WEBHOOK_URL = 'https://altusrecruit.com/api/stripe/webhook'
const API_VERSION = Stripe.PACKAGE_VERSION ? undefined : undefined // use account default
const PLANS = [
  { key: 'STARTER', name: 'Altus Starter', amount: 5900, lookup: 'altus_starter_seat_gbp_monthly' },
  { key: 'PRO', name: 'Altus Pro', amount: 8900, lookup: 'altus_pro_seat_gbp_monthly' },
  { key: 'SCALE', name: 'Altus Scale', amount: 12900, lookup: 'altus_scale_seat_gbp_monthly' },
]
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.payment_failed',
]

const mask = (s) => (s ? s.slice(0, 8) + '…' + s.slice(-4) : '(none)')

async function findOrCreateProduct(name) {
  const existing = (await stripe.products.list({ limit: 100, active: true })).data.find((p) => p.name === name)
  if (existing) { console.log(`  product exists: ${name} (${existing.id})`); return existing }
  const p = await stripe.products.create({ name })
  console.log(`  product created: ${name} (${p.id})`)
  return p
}

async function findOrCreatePrice(product, amount, lookup) {
  // lookup_key makes prices idempotent.
  const existing = (await stripe.prices.list({ lookup_keys: [lookup], limit: 1 })).data[0]
  if (existing) { console.log(`  price exists: ${lookup} (${existing.id})`); return existing }
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: 'gbp',
    recurring: { interval: 'month' },
    lookup_key: lookup,
    nickname: lookup,
  })
  console.log(`  price created: ${lookup} (${price.id}) £${amount / 100}/seat/mo`)
  return price
}

async function setupWebhook() {
  const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter((w) => w.url === WEBHOOK_URL)
  // Delete any pre-existing endpoints for this URL so we can mint a fresh,
  // known signing secret (Stripe only returns the secret at creation time).
  for (const w of existing) { await stripe.webhookEndpoints.del(w.id); console.log(`  removed stale webhook ${w.id}`) }
  const wh = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    enabled_events: EVENTS,
    description: 'Altus Phase 5 billing (test mode)',
    api_version: '2026-05-27.dahlia',
  })
  console.log(`  webhook created: ${wh.id} -> ${WEBHOOK_URL}`)
  return wh
}

async function setupPortal(products) {
  const config = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Altus — manage your subscription' },
    features: {
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address'] },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price', 'quantity'],
        proration_behavior: 'create_prorations',
        products: products.map((p) => ({ product: p.product.id, prices: [p.price.id] })),
      },
    },
  })
  console.log(`  portal config created: ${config.id}`)
  return config
}

console.log('Stripe TEST setup starting…')
console.log('account:', (await stripe.accounts.retrieve()).id || '(default)')

console.log('\n[1] products + prices')
const results = []
for (const plan of PLANS) {
  const product = await findOrCreateProduct(plan.name)
  const price = await findOrCreatePrice(product, plan.amount, plan.lookup)
  results.push({ key: plan.key, product, price })
}

console.log('\n[2] webhook endpoint')
const webhook = await setupWebhook()

console.log('\n[3] customer portal')
await setupPortal(results)

// ---- append env vars to .env.local (skip any already present) ----
const envLines = [
  `STRIPE_SECRET_KEY=${key}`,
  `STRIPE_WEBHOOK_SECRET=${webhook.secret}`,
  ...results.map((r) => `STRIPE_PRICE_${r.key}=${r.price.id}`),
]
const current = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
const toAppend = envLines.filter((l) => !current.includes(l.split('=')[0] + '='))
if (toAppend.length) {
  appendFileSync('.env.local', '\n# Phase 5 Stripe (test mode) — added by scripts/stripe-setup.mjs\n' + toAppend.join('\n') + '\n')
  console.log(`\n[4] appended ${toAppend.length} var(s) to .env.local`)
} else {
  console.log('\n[4] .env.local already has STRIPE_* vars — left unchanged')
}

console.log('\n==== SUMMARY (copy price IDs for Vercel env; secret/whsec masked) ====')
console.log('STRIPE_SECRET_KEY     =', mask(key))
console.log('STRIPE_WEBHOOK_SECRET =', mask(webhook.secret), '(full value written to .env.local)')
for (const r of results) console.log(`STRIPE_PRICE_${r.key.padEnd(7)} = ${r.price.id}`)
console.log('webhook url           =', WEBHOOK_URL, '| events:', EVENTS.length)
