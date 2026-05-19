import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// Plan 03-01 Task A.2 — LinkedIn ingest DB helpers.
//
// Three concerns, three helpers:
//   1. getCandidateByLinkedInUrl  — dedup by `source_detail` (LinkedIn URL
//      is stored verbatim per D3-03). Uses .eq, NOT .ilike (Phase 2 M1).
//   2. getCandidateByEmailLowercase — fallback dedup by lowercased email
//      (Phase 2 M2). The route handler is the authenticated context, so
//      RLS enforces tenancy — no explicit organization_id filter needed
//      because RLS reads auth.uid() → current_organization_id().
//   3. upsertCandidateFromLinkedIn — wraps the dedup-or-create branch.
//      Order: linkedin_url → email → insert. Updates fill-empty-only
//      (mirror Phase 1 D-08 "accept all only populates empty").
//
// Per HARD RULE 4: the upsert defensively asserts the dedup row's
// organization_id matches the caller's. RLS guarantees this for the
// authenticated path, but the assertion costs nothing and prevents a
// future service-role caller from silently updating a foreign org's row.
// ---------------------------------------------------------------------------

export type LinkedInDedupRow = {
  id: string
  organization_id: string
  email: string | null
}

export async function getCandidateByLinkedInUrl(
  supabase: SupabaseClient<Database>,
  linkedinUrl: string,
): Promise<DbResult<LinkedInDedupRow | null>> {
  if (!linkedinUrl || linkedinUrl.trim().length === 0) {
    return { ok: true, data: null }
  }
  const { data, error } = await supabase
    .from('candidates')
    .select('id, organization_id, email')
    .eq('source_detail', linkedinUrl)
    .limit(1)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: {
        phase: 'p3',
        layer: 'db',
        helper: 'getCandidateByLinkedInUrl',
      },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: (data as LinkedInDedupRow | null) ?? null }
}

export async function getCandidateByEmailLowercase(
  supabase: SupabaseClient<Database>,
  email: string | null | undefined,
): Promise<DbResult<LinkedInDedupRow | null>> {
  const normalised = (email ?? '').toLowerCase().trim()
  if (!normalised) return { ok: true, data: null }
  const { data, error } = await supabase
    .from('candidates')
    .select('id, organization_id, email')
    .eq('email', normalised)
    .limit(1)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: {
        phase: 'p3',
        layer: 'db',
        helper: 'getCandidateByEmailLowercase',
      },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: (data as LinkedInDedupRow | null) ?? null }
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

export type LinkedInProfileFields = {
  name: string
  headline: string | null
  current_role: string | null
  current_company: string | null
  location: string | null
  about: string | null
  skills: string[]
  work_experience: Array<{ title: string; company: string | null; dates: string | null }>
  education: Array<{ school: string; degree: string | null; dates: string | null }>
  linkedin_url: string
  email: string | null
}

export type UpsertResult = { id: string; created: boolean }

export type UpsertArgs = {
  organizationId: string
  profile: LinkedInProfileFields
}

export async function upsertCandidateFromLinkedIn(
  supabase: SupabaseClient<Database>,
  args: UpsertArgs,
): Promise<DbResult<UpsertResult>> {
  const { organizationId, profile } = args

  // 1. Dedup on LinkedIn URL (D3-04 primary key).
  const byUrl = await getCandidateByLinkedInUrl(supabase, profile.linkedin_url)
  if (!byUrl.ok) return byUrl
  let existing = byUrl.data
  // 2. Fallback: dedup on email when URL miss.
  if (!existing && profile.email) {
    const byEmail = await getCandidateByEmailLowercase(supabase, profile.email)
    if (!byEmail.ok) return byEmail
    existing = byEmail.data
  }

  if (existing) {
    // Defence-in-depth: RLS should make this impossible because the
    // authenticated client is scoped to organizationId, but we assert
    // anyway. A mismatch means RLS is misconfigured OR a future caller
    // is using service-role — fail closed.
    if (existing.organization_id !== organizationId) {
      Sentry.captureException(
        new Error('linkedin-upsert: cross-tenant dedup row'),
        {
          tags: {
            phase: 'p3',
            layer: 'db',
            helper: 'upsertCandidateFromLinkedIn',
            existing_org: existing.organization_id,
            caller_org: organizationId,
          },
        },
      )
      return { ok: false, code: 'internal' }
    }

    // UPDATE existing row — fill-empty-only on the structured fields. The
    // candidate may have manual notes/edits we don't want to clobber; the
    // "Updated existing candidate" toast in the popup signals this.
    const patch = {
      // Headline / current_role / current_company — accept the LinkedIn
      // values verbatim (most up-to-date by definition). Recruiter can
      // edit on the candidate page.
      current_role_title: profile.current_role ?? undefined,
      current_company: profile.current_company ?? undefined,
      location: profile.location ?? undefined,
      // Only fill source_detail if absent (keep the original LinkedIn URL
      // if the row already has one from a prior capture).
      ...(profile.linkedin_url ? { source_detail: profile.linkedin_url } : {}),
    } as unknown as TablesUpdate<'candidates'>

    const { data, error } = await supabase
      .from('candidates')
      .update(patch)
      .eq('id', existing.id)
      .select('id')
      .single()

    if (error || !data) {
      Sentry.captureException(error ?? new Error('linkedin-upsert: empty update'), {
        tags: {
          phase: 'p3',
          layer: 'db',
          helper: 'upsertCandidateFromLinkedIn',
          subop: 'update',
        },
      })
      return { ok: false, code: 'internal' }
    }
    return { ok: true, data: { id: existing.id, created: false } }
  }

  // INSERT new row. Per D3-03 / D3-04:
  //   - source = 'linkedin' (enum value)
  //   - source_detail = LinkedIn URL (canonical dedup key for next capture)
  //   - consent_basis = 'legitimate_interest' (Phase 1 default for non-apply
  //     pathways; the recruiter is curating, not collecting from the data
  //     subject)
  //
  // organization_id is filled by the BEFORE INSERT trigger
  // `candidates_set_org` from the session context — the authenticated
  // client carries the recruiter's auth.uid() so the trigger has
  // current_organization_id() available.
  //
  // reason: TablesInsert<'candidates'> requires organization_id at the type
  // level even though the trigger fills it. Cast through unknown narrows the
  // payload to exactly what we actually send (mirrors candidates.ts pattern).
  const insertPayload = {
    full_name: profile.name,
    email: profile.email ? profile.email.toLowerCase().trim() : null,
    location: profile.location ?? null,
    current_role_title: profile.current_role ?? null,
    current_company: profile.current_company ?? null,
    skills: profile.skills ?? [],
    source: 'linkedin' as const,
    source_detail: profile.linkedin_url,
    consent_basis: 'legitimate_interest' as const,
    consent_at: new Date().toISOString(),
    consent_text_version: 'linkedin-capture-v1',
  } as unknown as TablesInsert<'candidates'>

  const { data, error } = await supabase
    .from('candidates')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error || !data) {
    Sentry.captureException(error ?? new Error('linkedin-upsert: empty insert'), {
      tags: {
        phase: 'p3',
        layer: 'db',
        helper: 'upsertCandidateFromLinkedIn',
        subop: 'insert',
      },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id: data.id, created: true } }
}
