// Synthetic sample data for new-org onboarding seeding.
//
// ALL data here is clearly fictitious:
//  - Names: obviously invented/fictional (with a comment)
//  - Emails: example.com (RFC 2606 reserved — never delivered to a real inbox)
//  - Companies: fictional UK-style agency clients
//
// Do NOT use real names, real emails, or real companies here.
// This data is created under seedSampleDataAction which guards idempotency —
// repeat clicks will not create duplicate records.

import type { CreateCandidateInput } from '@/lib/db/candidates'
import type { CreateClientInput } from '@/lib/db/clients'
import type { CreateJobInput } from '@/lib/db/jobs'

// ---------------------------------------------------------------------------
// Candidate definitions (no org_id — the DB trigger fills it from the session)
// ---------------------------------------------------------------------------

export type SampleCandidateInput = Omit<CreateCandidateInput, 'consent_at' | 'consent_text_version'>

export const SAMPLE_CANDIDATES: SampleCandidateInput[] = [
  {
    full_name: 'Alexandra Thornton-Sample',
    email: 'a.thornton@example.com',
    phone: null,
    location: 'London, UK',
    current_role_title: 'Senior Software Engineer',
    current_company: 'Fictitious Tech Ltd',
    market_status: 'actively_looking',
    source: 'direct_add',
    consent_basis: 'legitimate_interest',
  },
  {
    full_name: 'Marcus Okafor-Demo',
    email: 'm.okafor@example.com',
    phone: null,
    location: 'Manchester, UK',
    current_role_title: 'Head of Finance',
    current_company: 'Invented Capital Partners',
    market_status: 'passively_looking',
    source: 'direct_add',
    consent_basis: 'legitimate_interest',
  },
  {
    full_name: 'Priya Ravensworth-Sample',
    email: 'p.ravensworth@example.com',
    phone: null,
    location: 'Edinburgh, UK',
    current_role_title: 'Marketing Director',
    current_company: 'Synthetic Media Group',
    market_status: 'hot',
    source: 'direct_add',
    consent_basis: 'legitimate_interest',
  },
]

// ---------------------------------------------------------------------------
// Client (company) definitions
// ---------------------------------------------------------------------------

export const SAMPLE_CLIENTS: CreateClientInput[] = [
  {
    name: 'Fictitious Engineering Co.',
    industry: 'Technology',
    website: 'https://example.com',
    notes: 'Sample client — created by onboarding seed. Safe to delete.',
  },
  {
    name: 'Demo Professional Services Ltd',
    industry: 'Professional Services',
    website: null,
    notes: 'Sample client — created by onboarding seed. Safe to delete.',
  },
]

// ---------------------------------------------------------------------------
// Job definitions
// These reference the FIRST created client (by index), resolved at seed time.
// ---------------------------------------------------------------------------

// A partial job definition without company_id — the seed action fills that in
// from the created client.
export type SampleJobInput = Omit<CreateJobInput, 'company_id'>

export const SAMPLE_JOBS: SampleJobInput[] = [
  {
    title: 'Senior Software Engineer (Sample)',
    job_type: 'perm',
    hiring_context: 'new_role',
    location: 'London, UK (Hybrid)',
    salary_min: 70000,
    salary_max: 90000,
    description:
      'This is a sample job created during onboarding. ' +
      'Delete this record and add your real vacancies to get started.',
    status: 'open',
  },
]
