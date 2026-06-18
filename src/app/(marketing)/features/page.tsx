import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  Brain,
  Briefcase,
  Building2,
  FileText,
  Lock,
  Mail,
  MessageSquare,
  Search,
  Send,
  Shield,
  Sparkles,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// COPY PLACEHOLDER — the founder should review and refine all copy.

export const metadata = {
  title: 'Features — Altus',
  description:
    'AI CV parsing, semantic search, match scoring, spec-call transcription, and more — built into a full UK recruitment CRM.',
}

const FEATURE_SECTIONS = [
  {
    category: 'AI-powered core',
    badge: 'AI',
    features: [
      {
        icon: FileText,
        title: 'AI CV parsing',
        body: 'Upload a CV — PDF, Word, or a LinkedIn Save-to-PDF — and Altus automatically extracts name, contact details, work history, skills, and education. No re-typing. The structured data is searchable the moment parsing completes.',
      },
      {
        icon: Search,
        title: 'Semantic candidate search',
        body: 'Natural-language search across your whole database. "Senior Python dev with offshore wind experience" works — because every CV is embedded by Voyage AI and matched semantically, not just by keywords. A keyword fallback handles exact-match edge cases.',
      },
      {
        icon: Brain,
        title: 'Match scoring with explanations',
        body: 'Every candidate-to-job pair gets an AI match score and a plain-English explanation — "Strong match: 6 years Python, wind-farm SCADA experience, active offshore cert." Triage a longlist in minutes, not hours.',
      },
      {
        icon: MessageSquare,
        title: 'Spec call → structured job record',
        body: 'Record a voice note during or after your client\'s brief. Altus transcribes via OpenAI Whisper and extracts the role details into a draft job record. Review, confirm, done.',
      },
      {
        icon: Sparkles,
        title: 'AI outreach drafting',
        body: 'Personalised candidate outreach, per-candidate — not template-fill. Altus drafts the message based on the candidate\'s profile and the role. You approve before anything is sent. Your professional relationships stay yours.',
      },
    ],
  },
  {
    category: 'Candidate & pipeline management',
    features: [
      {
        icon: Users,
        title: 'Candidate database',
        body: 'A full candidate record: structured contact details, work history, skills, market status (actively looking / passive / placed / cold), consent & GDPR basis, and a chronological activity log of every interaction.',
      },
      {
        icon: Workflow,
        title: 'Pipeline & stage tracking',
        body: 'Move candidates through Shortlisted → Submitted → Interview → Offer → Placement for each job they are being considered for. Every stage move is logged in the activity timeline.',
      },
      {
        icon: Send,
        title: 'Floats / speculative submissions',
        body: 'Track speculative CVs sent to clients without a specific vacancy. Follow up when a relevant role opens. Floats have their own view so they never get lost in the active pipeline.',
      },
    ],
  },
  {
    category: 'Client & job management',
    features: [
      {
        icon: Building2,
        title: 'Client & contact management',
        body: 'Company records with sector, size, and location. Contact records for hiring managers and HR leads. Every job is linked to a client and contact so you see the full relationship in one place.',
      },
      {
        icon: Briefcase,
        title: 'Job records',
        body: 'Title, location, salary or day rate, IR35 status, job type (perm/temp), job description, and a live pipeline. Jobs are searchable, filterable, and linked to both client and spec call.',
      },
      {
        icon: BarChart3,
        title: 'Reports',
        body: 'Placement revenue by consultant, client, and job type. Candidate source attribution. Conversion rates from submission to placement. All figures scoped to your organisation.',
      },
    ],
  },
  {
    category: 'Integrations & capture',
    features: [
      {
        icon: Zap,
        title: 'Outlook email capture',
        body: 'CVs forwarded to your Altus intake address land straight in the candidate queue, parsed and ready to work with. No copy-paste, no manual file management.',
      },
      {
        icon: Mail,
        title: 'Public apply form',
        body: 'Each agency gets a shareable URL where candidates submit their CV directly. Submissions are AI-parsed and land in your database automatically, with consent recorded.',
      },
      {
        icon: FileText,
        title: 'LinkedIn PDF import',
        body: 'Use LinkedIn\'s built-in "Save to PDF" to export a profile, then upload it to Altus. The parser extracts structured data from the standard LinkedIn PDF format.',
      },
    ],
  },
  {
    category: 'Compliance & security',
    features: [
      {
        icon: Shield,
        title: 'GDPR & consent tracking',
        body: 'Consent basis and timestamp recorded for every candidate. Audit log of every access to candidate data. Compliance is built in, not retrofitted.',
      },
      {
        icon: Lock,
        title: 'Multi-tenant isolation',
        body: 'Row-level security enforced at the database layer. Your data is completely isolated from other agencies — not just filtered in application code.',
      },
    ],
  },
]

export default function FeaturesPage() {
  return (
    <>
      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1
              className="text-4xl font-bold tracking-tight sm:text-5xl"
              style={{ color: '#0A3D5C' }}
            >
              Everything a modern agency needs
            </h1>
            <p className="text-muted-foreground mt-4 text-xl">
              AI is the spine — not a bolt-on. Every feature is built to reduce the time between
              a client brief and a placed candidate.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <Button asChild size="lg" style={{ backgroundColor: '#0A3D5C' }}>
                <Link href="/sign-up">
                  Start free trial
                  <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/pricing">View pricing</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature sections ────────────────────────────────────── */}
      {FEATURE_SECTIONS.map(({ category, badge, features }, idx) => (
        <section
          key={category}
          className={`py-16 sm:py-20 ${idx % 2 === 1 ? 'border-border/60 border-t bg-slate-50' : 'border-border/60 border-t'}`}
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-10 flex items-center gap-3">
              <h2 className="text-2xl font-bold" style={{ color: '#0A3D5C' }}>
                {category}
              </h2>
              {badge && (
                <Badge style={{ backgroundColor: '#5DCAA5', color: '#0A3D5C' }}>
                  {badge}
                </Badge>
              )}
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="rounded-xl border bg-white p-6 shadow-sm"
                >
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
      ))}

      {/* ── CTA ─────────────────────────────────────────────────── */}
      <section className="border-border/60 border-t py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div
            className="rounded-2xl px-8 py-16 text-center"
            style={{ backgroundColor: '#0A3D5C' }}
          >
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Ready to see it in action?
            </h2>
            <p className="mt-4 text-lg text-white/80">
              Set up your workspace in minutes. Start with your existing candidate database.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-8 h-12 px-8 text-base font-semibold hover:bg-white/90"
              style={{ backgroundColor: '#fff', color: '#0A3D5C' }}
            >
              <Link href="/sign-up">
                Start free trial
                <ArrowRight className="ml-2 size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
