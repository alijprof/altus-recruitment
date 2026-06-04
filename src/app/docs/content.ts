// Typed documentation content for the /docs area.
// Content is seeded from the in-app /help page — the same information
// presented in a public, SEO-friendly format.
//
// No MDX dependency — a typed module keeps the build simple and avoids
// adding any new build pipeline dependencies.
//
// To add a new article: append a DocArticle to DOC_ARTICLES and create
// the corresponding route automatically (generateStaticParams picks it up).
//
// COPY PLACEHOLDER — the founder should review and refine all copy.
// These docs are suitable for sharing with prospects; avoid referencing
// internal implementation details or unshipped features.

import { PLANS } from '@/lib/stripe/plans'

// Plan figures in the billing article are derived from PLANS (the single
// source of truth) at module load, so the docs can never drift from the
// pricing page or Stripe configuration.
function formatGBP(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pence / 100)
}

const PLANS_SUMMARY = `${PLANS.starter.label} (${formatGBP(
  PLANS.starter.pricePence,
)}/seat/month), ${PLANS.pro.label} (${formatGBP(
  PLANS.pro.pricePence,
)}/seat/month), and ${PLANS.scale.label} (${formatGBP(
  PLANS.scale.pricePence,
)}/seat/month)`

const PRO_SEATS_SUMMARY = `up to ${PLANS.pro.seats} seats`

export interface DocSection {
  heading: string
  body: string[]
}

export interface DocArticle {
  slug: string
  title: string
  description: string
  sections: DocSection[]
}

export const DOC_ARTICLES: DocArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    description: 'An overview of Altus and how to set up your workspace.',
    sections: [
      {
        heading: 'What is Altus?',
        body: [
          'Altus is an AI-first recruitment CRM for UK recruitment agencies. It replaces tools like Firefish with a system where AI is the spine — not a bolt-on feature.',
          'Core AI capabilities are built into every workflow: CV parsing, semantic search, match scoring with explanations, spec-call transcription, and AI-drafted outreach. Everything else (clients, jobs, pipeline, reports) is built around those foundations.',
        ],
      },
      {
        heading: 'Creating your workspace',
        body: [
          'Sign up at altusrecruit.com/sign-up. A new organisation is created for you automatically — you are its owner. Your organisation is completely isolated from other agencies: your data is theirs, not ours to share.',
          'Once inside, start by adding a few candidates (upload a CV or add manually) and a client. Then create a job linked to that client and watch the pipeline take shape.',
        ],
      },
      {
        heading: 'Inviting your team',
        body: [
          'Go to Settings → Team and invite your consultants by email. Each invitee receives a magic-link email and joins your shared workspace automatically. Everyone on the team sees the same data; there is no per-seat data silo.',
        ],
      },
      {
        heading: 'Dashboard overview',
        body: [
          'The dashboard surfaces recent activity at a glance: candidates added today, jobs in progress, upcoming follow-ups, and quick-add shortcuts for the most common tasks.',
          'Use it as your daily command centre — a place to check what needs attention before you start making calls.',
        ],
      },
    ],
  },
  {
    slug: 'candidates',
    title: 'Candidates & CV parsing',
    description: 'How to add candidates, upload CVs, and use AI parsing.',
    sections: [
      {
        heading: 'What is a candidate?',
        body: [
          'A candidate is a person who could be placed in a role. Candidate records store contact details, work history, skills, education, market status, consent information, and a full activity log.',
        ],
      },
      {
        heading: 'Adding candidates',
        body: [
          'There are three ways to add a candidate: upload a CV (PDF or Word doc), use the LinkedIn PDF import, or let them apply through your public apply form. You can also add candidates manually.',
          'Uploading a CV triggers AI parsing automatically — Altus extracts name, contact details, work history, skills, and education into structured fields. No re-typing.',
        ],
      },
      {
        heading: 'LinkedIn PDF import',
        body: [
          "Use LinkedIn's built-in \"Save to PDF\" to export a profile (visible on any LinkedIn profile page), then upload it to Altus as you would any other CV. The parser handles the standard LinkedIn PDF format and extracts the same structured fields.",
        ],
      },
      {
        heading: 'Market status',
        body: [
          'Each candidate has a market status: Actively looking, Passively looking, Hot (recently made redundant), Placed, or Cold. Keep this up to date — it drives search filtering and the dashboard follow-up widget.',
        ],
      },
      {
        heading: 'Activity log',
        body: [
          'Every interaction with a candidate — CV upload, status change, note, application stage move, email sent — is logged in the activity timeline on their record. The timeline is chronological and organisation-scoped.',
        ],
      },
      {
        heading: 'GDPR & consent',
        body: [
          'When you add a candidate, Altus records the consent basis (e.g. legitimate interest, consent given) and timestamp automatically. This is stored immutably — you can demonstrate compliance for any candidate on request.',
        ],
      },
    ],
  },
  {
    slug: 'search',
    title: 'Semantic search',
    description: 'How candidate search works and how to get the best results.',
    sections: [
      {
        heading: 'How semantic search works',
        body: [
          'When you upload a CV, Altus embeds it into a vector store using Voyage AI. At search time, your query is embedded and matched semantically — meaning Altus understands the concept behind your words, not just the literal keywords.',
          'A keyword fallback runs in parallel to catch exact-match cases where semantic ranking misses (e.g. a specific certification code or acronym).',
        ],
      },
      {
        heading: 'Writing effective queries',
        body: [
          'Write your query as you would describe the ideal candidate to a colleague: "Senior Python developer with offshore wind SCADA experience, available immediately" works as well as or better than a keyword list.',
          'You can also search by job title, location, sector, or any combination. Altus ranks results by semantic relevance and shows a one-line match explanation for each result.',
        ],
      },
      {
        heading: 'Match explanations',
        body: [
          'Each search result includes an AI-generated match explanation — a brief description of why this candidate ranked highly for your query. Use it to triage quickly without opening every record.',
        ],
      },
    ],
  },
  {
    slug: 'clients',
    title: 'Clients & contacts',
    description: 'Managing client companies and their key contacts.',
    sections: [
      {
        heading: 'Clients vs contacts',
        body: [
          'A client is a company that pays for placements. A contact is a named person at a client — typically the hiring manager or HR lead you work with on a specific brief.',
          'Every job is linked to a client. Contacts are linked to a client and optionally to specific jobs.',
        ],
      },
      {
        heading: 'Client records',
        body: [
          'Client records store company name, sector, size, location, and a list of contacts and active jobs. Use the dormant flag to track accounts you have not worked with recently.',
        ],
      },
      {
        heading: 'Contact records',
        body: [
          'Contact records store name, email, phone, role at the client, and a full activity log of every interaction. Add a note after every call or meeting to keep the relationship history complete.',
        ],
      },
    ],
  },
  {
    slug: 'jobs',
    title: 'Jobs & vacancies',
    description: 'Creating and managing job records, from brief to placement.',
    sections: [
      {
        heading: 'What is a job?',
        body: [
          'A job (also called a role or vacancy) is a position a client wants filled. Job records capture title, location, salary or day rate, IR35 status for contract roles, job type (perm or temp/contract), and a full job description.',
        ],
      },
      {
        heading: 'Creating a job',
        body: [
          'You can create a job manually from the Jobs screen, or create one automatically from a spec call (see Spec calls). Link the job to a client and optionally to the contact who gave you the brief.',
        ],
      },
      {
        heading: 'Perm vs temp/contract',
        body: [
          'Perm jobs carry a fee percentage of first-year salary (typically 15–25%). Temp/contract jobs carry a day rate (what the candidate is paid) and a charge rate (what the client pays), with the margin being the agency\'s revenue per day.',
          'IR35 status (in or outside IR35) is recorded for contract roles. This affects how the contractor is engaged and what paperwork is required.',
        ],
      },
    ],
  },
  {
    slug: 'spec-calls',
    title: 'Spec calls',
    description: 'Recording client briefs and turning them into job records with AI.',
    sections: [
      {
        heading: 'What is a spec call?',
        body: [
          'A spec call is when a client briefs you on a new role — usually verbally over the phone. In Altus you can record a voice note during or immediately after the call.',
        ],
      },
      {
        heading: 'From voice note to job record',
        body: [
          'Upload your voice note to a spec call record. Altus transcribes it using OpenAI Whisper and extracts the key details — title, location, salary range, skills required, start date, IR35 status — into a draft job record.',
          'Review the draft, fill in anything the AI missed, and confirm. The job is created and ready to work against. No transcription, no re-typing the same information twice.',
        ],
      },
    ],
  },
  {
    slug: 'pipeline',
    title: 'Pipeline & shortlists',
    description: 'Moving candidates through stages, managing shortlists, and floats.',
    sections: [
      {
        heading: 'Pipeline stages',
        body: [
          'The pipeline tracks every candidate against every job they are being considered for. Stages run from Shortlisted → Submitted → Interview → Offer → Placement. Each stage move is logged in the activity timeline.',
        ],
      },
      {
        heading: 'Shortlists',
        body: [
          'A shortlist is your internal working set of candidates for a job before you submit anyone to the client. Use it to gather and rank candidates without creating formal applications.',
        ],
      },
      {
        heading: 'Floats / speculative submissions',
        body: [
          'A float (or spec CV) is a speculative submission — you are sending a candidate to a client without a specific live vacancy, because you believe the client should meet them.',
          'Floats are tracked separately so you can follow up if a relevant role opens up. A float can be converted to a formal application if a matching vacancy is created.',
        ],
      },
      {
        heading: 'Placements',
        body: [
          'A placement is the revenue event: a candidate starts the role. Altus records the placement date and fee type (perm percentage or temp margin) and feeds it into reports.',
        ],
      },
    ],
  },
  {
    slug: 'reports',
    title: 'Reports',
    description: 'Placement revenue, source attribution, and team activity reports.',
    sections: [
      {
        heading: 'What reports are available?',
        body: [
          'Reports show placement revenue (perm fees and temp/contract margin) broken down by consultant, client, and job type. Source attribution shows where your placed candidates originated — apply form, LinkedIn, referral, or direct.',
          'Activity reports show call volume, submissions, interviews, and conversion rates across the team.',
        ],
      },
      {
        heading: 'Data scope',
        body: [
          'All report figures are scoped to your organisation only — you never see data from other agencies. Figures update in real time as placements are logged.',
        ],
      },
    ],
  },
  {
    slug: 'settings',
    title: 'Settings & team',
    description: 'Profile, organisation settings, team management, and AI usage.',
    sections: [
      {
        heading: 'Profile settings',
        body: [
          'Update your display name and email from Settings → Profile. Email changes require re-verification via magic link.',
        ],
      },
      {
        heading: 'Organisation settings',
        body: [
          'Organisation owners can update the organisation name and logo from Settings → Organisation. The logo appears on your public apply form.',
        ],
      },
      {
        heading: 'Team management',
        body: [
          'Invite teammates by email from Settings → Team. Invited users receive a magic-link and join your shared workspace. Owners can remove team members; removed members lose access immediately.',
        ],
      },
      {
        heading: 'AI usage',
        body: [
          'Settings → Usage shows month-to-date AI spend broken down by feature (CV parsing, semantic search embeddings, match scoring, spec-call transcription, writing). This is important for understanding cost as you scale your candidate database.',
          'Usage resets on the first of each calendar month.',
        ],
      },
    ],
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    description: 'LinkedIn, Outlook, and the public apply form.',
    sections: [
      {
        heading: 'Public apply form',
        body: [
          'Each organisation gets a shareable URL (e.g. altusrecruit.com/apply/your-slug) where candidates can submit their CV directly. Submissions are AI-parsed and land in your candidate database automatically, with consent recorded.',
          'Enable the apply form and copy your URL from Settings → Organisation.',
        ],
      },
      {
        heading: 'LinkedIn PDF import',
        body: [
          "Use LinkedIn's built-in \"Save to PDF\" feature to export any LinkedIn profile, then upload the PDF to Altus. The parser handles the standard LinkedIn PDF format and extracts structured candidate data.",
        ],
      },
      {
        heading: 'Outlook email capture',
        body: [
          'Connect your Outlook account from Settings → Integrations. CVs emailed to your inbox are automatically forwarded to the Altus candidate queue, parsed, and ready to work with.',
        ],
      },
    ],
  },
  {
    slug: 'billing',
    title: 'Billing & plans',
    description: 'Subscription plans, per-seat pricing, and AI usage caps.',
    sections: [
      {
        heading: 'Plans',
        body: [
          `Altus offers three plans: ${PLANS_SUMMARY}. AI usage is bundled — there are no AI add-on tiers.`,
          `Pro is the recommended plan for most agencies: ${PRO_SEATS_SUMMARY} and generous AI caps across CV parsing, match scoring, search, and spec-call transcription.`,
        ],
      },
      {
        heading: 'AI usage caps',
        body: [
          'Each plan includes per-seat AI caps per calendar month. Caps cover: CV parses, match scores, semantic searches, spec-call minutes, and AI writing calls.',
          'Core CRM features (viewing candidates, clients, jobs, activity) are never blocked by AI caps. Caps only apply to AI-generated outputs.',
        ],
      },
      {
        heading: 'Upgrading or downgrading',
        body: [
          'Upgrades take effect immediately. Downgrades take effect at the next billing cycle. You can manage your subscription from Settings → Billing.',
        ],
      },
    ],
  },
]

// Quick-lookup map slug → article
export const DOC_BY_SLUG: Record<string, DocArticle | undefined> = Object.fromEntries(
  DOC_ARTICLES.map((a) => [a.slug, a]),
)
