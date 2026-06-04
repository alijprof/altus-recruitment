import Link from 'next/link'
import { Check } from 'lucide-react'

import { PricingTable } from '@/components/marketing/pricing-table'
import { PLANS } from '@/lib/stripe/plans'

// COPY PLACEHOLDER — the founder should review and refine all marketing copy
// before sharing this URL with prospects.

// Format pence to a GBP display string: 5900 → "£59"
function formatGBP(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pence / 100)
}

export const metadata = {
  title: 'Pricing — Altus',
  description: `Simple per-seat pricing with AI bundled. ${PLANS.starter.label} ${formatGBP(
    PLANS.starter.pricePence,
  )}, ${PLANS.pro.label} ${formatGBP(PLANS.pro.pricePence)}, ${PLANS.scale.label} ${formatGBP(
    PLANS.scale.pricePence,
  )} per seat per month.`,
}

const FAQ_ITEMS = [
  {
    q: 'What counts as a "seat"?',
    a: 'A seat is one Altus user (recruiter, consultant, or admin). AI usage caps are per seat — the more seats on your plan, the more total AI capacity your team has.',
  },
  {
    q: 'Is AI included or an add-on?',
    a: 'AI is bundled into every plan. There are no AI add-on tiers. The per-seat AI caps (CV parses, searches, match scores, spec-call minutes) are designed to comfortably cover normal agency workload.',
  },
  {
    q: 'What happens if we hit an AI cap?',
    a: 'We will notify you before you reach the cap. You can upgrade your plan or wait for the monthly reset. Core CRM features (viewing candidates, clients, jobs) are never blocked by AI caps.',
  },
  {
    q: 'Can we start with Starter and upgrade later?',
    a: 'Yes. You can upgrade or downgrade at any time. Upgrades take effect immediately; downgrades take effect at the next billing cycle.',
  },
  {
    q: 'Is there a free trial?',
    a: 'You can start your workspace without a payment method and explore the app. Full AI features require an active plan. Contact us if you need a longer evaluation period.',
  },
  {
    q: 'Are prices ex-VAT?',
    a: 'Yes. Prices shown are ex-VAT. UK VAT is added at checkout where applicable.',
  },
]

const INCLUDED_IN_ALL = [
  'AI CV parsing (automatic on upload)',
  'Semantic candidate search',
  'Match scoring with explanations',
  'Spec-call transcription → draft job',
  'Candidate pipeline & shortlists',
  'Float / speculative submissions',
  'Client & contact management',
  'Outlook email capture',
  'LinkedIn PDF import',
  'Public apply form',
  'Multi-recruiter workspace',
  'GDPR consent & audit log',
  'Activity timeline per record',
  'Reports — placement revenue & source attribution',
  'Team invitations',
]

export default function PricingPage() {
  return (
    <>
      {/* ── Header ──────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1
              className="text-4xl font-bold tracking-tight sm:text-5xl"
              style={{ color: '#0A3D5C' }}
            >
              Simple, per-seat pricing
            </h1>
            <p className="text-muted-foreground mt-4 text-xl">
              AI bundled. No add-on tiers. No surprises.
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              Prices are per seat per month, billed monthly, ex-VAT.{' '}
              {/* COPY PLACEHOLDER — add founding-price framing here if applicable */}
              Founding price — locked in for the life of your subscription.
            </p>
          </div>
        </div>
      </section>

      {/* ── Pricing cards (PLANS-driven) ────────────────────────── */}
      <section>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <PricingTable />
        </div>
      </section>

      {/* ── Included in every plan ──────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl">
            <h2
              className="mb-8 text-2xl font-bold tracking-tight"
              style={{ color: '#0A3D5C' }}
            >
              Everything included in every plan
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Features included in all plans">
              {INCLUDED_IN_ALL.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm">
                  <Check
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: '#5DCAA5' }}
                    aria-hidden="true"
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section className="border-border/60 border-t py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl">
            <h2
              className="mb-10 text-2xl font-bold tracking-tight"
              style={{ color: '#0A3D5C' }}
            >
              Frequently asked questions
            </h2>
            <dl className="space-y-8">
              {FAQ_ITEMS.map(({ q, a }) => (
                <div key={q}>
                  <dt className="mb-2 font-semibold">{q}</dt>
                  <dd className="text-muted-foreground text-sm leading-relaxed">{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────── */}
      <section className="border-border/60 border-t py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-bold" style={{ color: '#0A3D5C' }}>
            Ready to get started?
          </h2>
          <p className="text-muted-foreground mt-2">
            No credit card required. Cancel anytime.
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <Link
              href="/sign-up?plan=pro"
              className="inline-flex h-10 items-center rounded-md px-6 text-sm font-semibold text-white"
              style={{ backgroundColor: '#0A3D5C' }}
            >
              Start with Pro
            </Link>
            <Link
              href="/sign-up"
              className="text-muted-foreground hover:text-foreground inline-flex h-10 items-center rounded-md border px-6 text-sm font-medium transition-colors"
            >
              Compare all plans
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
