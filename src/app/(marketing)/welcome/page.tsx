import Link from 'next/link'
import {
  ArrowRight,
  Brain,
  FileText,
  MessageSquare,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PricingTable } from '@/components/marketing/pricing-table'

// COPY PLACEHOLDER — the founder should review and refine all marketing copy.
// Replace placeholder headlines, sub-copy, and feature descriptions with final
// brand voice before sharing this URL with prospects.

export const metadata = {
  title: 'Altus — AI-first recruitment CRM for UK agencies',
  description:
    'Find the right candidate in seconds using natural language. AI CV parsing, semantic search, match scoring, and voice-to-data — built for UK recruitment agencies.',
}

const VALUE_PROPS = [
  {
    icon: Search,
    title: 'Semantic candidate search',
    body: 'Type what you mean — "Senior Python dev with offshore wind experience" — and Altus finds candidates whose CVs match the concept, not just the keywords.',
  },
  {
    icon: FileText,
    title: 'AI CV parsing',
    body: 'Upload a CV (or a LinkedIn PDF) and Altus extracts name, contact details, work history, skills, and education into structured fields automatically. No re-typing.',
  },
  {
    icon: Brain,
    title: 'Match scoring with explanations',
    body: 'Every candidate-to-job match gets an AI-generated score and a plain-English explanation, so you can triage a longlist in minutes.',
  },
  {
    icon: MessageSquare,
    title: 'Spec call → job in seconds',
    body: 'Record a voice note after your client call. Altus transcribes it and extracts the brief into a draft job record — review, confirm, done.',
  },
  {
    icon: Zap,
    title: 'Outlook email capture',
    body: 'CVs emailed to your inbox land straight in the candidate queue, parsed and ready to work with. No copy-paste, no manual entry.',
  },
  {
    icon: Sparkles,
    title: 'AI outreach & follow-up',
    body: 'Per-candidate personalised outreach, not template-fill. Altus drafts the email; you approve and send. Your professional relationships stay yours.',
  },
]

export default function WelcomePage() {
  return (
    <>
      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ backgroundColor: '#0A3D5C' }}>
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:py-40">
          <div className="mx-auto max-w-3xl text-center">
            <Badge
              className="mb-6 text-xs font-semibold text-white"
              style={{ backgroundColor: 'rgba(93,202,165,0.25)', borderColor: '#5DCAA5' }}
            >
              AI-first recruitment CRM
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Find the right candidate{' '}
              <span style={{ color: '#5DCAA5' }}>in seconds</span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-white/80 sm:text-xl">
              Altus is built for UK recruitment agencies that are tired of digging through static
              keyword lists and tribal knowledge. AI is the spine — not a bolt-on.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 px-8 text-base font-semibold text-white"
                style={{ backgroundColor: '#5DCAA5' }}
              >
                <Link href="/sign-up">
                  Get started free
                  <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 border-white/30 px-8 text-base text-white hover:bg-white/10"
                style={{ backgroundColor: 'transparent' }}
              >
                <Link href="/pricing">View pricing</Link>
              </Button>
            </div>
            <p className="text-muted mt-4 text-xs text-white/50">
              No credit card required to start. Cancel anytime.
            </p>
          </div>
        </div>
      </section>

      {/* ── Social proof strip (PLACEHOLDER) ───────────────────── */}
      <section className="border-border/60 border-y bg-slate-50 py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-muted-foreground text-center text-sm">
            {/* COPY PLACEHOLDER — replace with real customer logos / quotes when available */}
            Trusted by UK recruitment agencies replacing legacy CRMs.
          </p>
        </div>
      </section>

      {/* ── Value propositions ──────────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: '#0A3D5C' }}>
              AI that works invisibly
            </h2>
            <p className="text-muted-foreground mt-4 text-lg">
              No chatbot UI. No &ldquo;ask the CRM anything&rdquo; gimmick. Just AI that happens
              — at the right moment, doing the right thing.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="relative rounded-xl border bg-white p-6 shadow-sm">
                <div
                  className="mb-4 inline-flex size-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: 'rgba(93,202,165,0.15)' }}
                >
                  <Icon className="size-5" style={{ color: '#0A3D5C' }} aria-hidden="true" />
                </div>
                <h3 className="mb-2 font-semibold" style={{ color: '#0A3D5C' }}>
                  {title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing preview ─────────────────────────────────────── */}
      <section className="border-border/60 border-t bg-slate-50 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: '#0A3D5C' }}>
              Simple, per-seat pricing
            </h2>
            <p className="text-muted-foreground mt-4 text-lg">
              AI included. No add-on tiers. No surprises.
            </p>
          </div>
          <div className="mt-12">
            <PricingTable compact />
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/pricing"
              className="text-sm font-medium underline-offset-4 hover:underline"
              style={{ color: '#0A3D5C' }}
            >
              See full plan comparison →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div
            className="rounded-2xl px-8 py-16 text-center"
            style={{ backgroundColor: '#0A3D5C' }}
          >
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Ready to replace your CRM?
            </h2>
            <p className="mt-4 text-lg text-white/80">
              {/* COPY PLACEHOLDER — refine with specific agency pain points */}
              Set up your workspace in minutes. Import your candidate database. Start placing.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-10 h-12 px-8 text-base font-semibold text-white"
              style={{ backgroundColor: '#5DCAA5' }}
            >
              <Link href="/sign-up">
                Get started free
                <ArrowRight className="ml-2 size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
