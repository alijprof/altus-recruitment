'use server'

// T-05-03-01: PapaParse yields strings only. Every cell is treated as an
// inert string — no formula evaluation. A non-empty email is shape-validated
// (EMAIL_RE) in this action before any DB write; createCandidate itself does
// no validation, so this is the only guard against storing junk emails.
// T-05-03-02: Only counts/tags are sent to Sentry — never candidate names
// or emails (CLAUDE.md PII rule).
// T-05-03-03: All writes go through RLS-scoped createCandidate. The org is
// derived from the caller's Supabase session (via the trigger), NEVER from
// a CSV column — cross-tenant injection is structurally impossible.
// T-05-03-04: Batch capped at MAX_IMPORT_ROWS to prevent runaway action time.

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import Papa from 'papaparse'

import { findCandidateByEmail, createCandidate } from '@/lib/db/candidates'
import { CURRENT_CONSENT_VERSION } from '@/lib/legal/consent'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient } from '@/lib/supabase/server'

import { mapRow, type MappedCandidate } from './column-map'

// Hard cap: avoids runaway Server Action time and DB pressure.
const MAX_IMPORT_ROWS = 500

// Minimal email shape check. candidates.email has no DB CHECK and
// createCandidate does no validation, so a non-empty-but-malformed email
// would otherwise be stored verbatim. We never store junk: a non-empty email
// that fails this is counted as an error row so it surfaces in the summary.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type ImportSummary = {
  created: number
  skippedNoName: number
  skippedDuplicate: number
  errors: number
  truncated: boolean
  totalInput: number
}

export type ImportCandidatesResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string }

/**
 * Server Action: parse a CSV string (from the client wizard) and create
 * candidates via the existing createCandidate path.
 *
 * Validation: a non-empty email is shape-checked against EMAIL_RE here (this
 * action is the only validation layer — createCandidate does none). Rows with
 * a malformed email are counted as `errors` and skipped, never stored. An
 * empty/absent email is allowed (email is optional on candidates).
 *
 * Deduplication: email is lowercased + trimmed. If an email already exists
 * in the caller's org, the row is counted as `skippedDuplicate` and skipped.
 * This mirrors the write-boundary lowercasing already in createCandidate
 * (260604-cn5 fix).
 *
 * The `organization_id` comes exclusively from the authenticated session via
 * the candidates_set_org DB trigger — it is never read from the CSV.
 */
export async function importCandidatesAction(
  csvText: string,
): Promise<ImportCandidatesResult> {
  const supabase = await createClient()

  // Auth gate — must be signed in.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, error: 'You must be signed in to import candidates.' }
  }

  // Entitlement gate — block bulk CRM writes for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  // Resolve org for the dedupe lookup (findCandidateByEmail requires explicit
  // org id). The RLS trigger will also enforce org scoping at write time.
  const { data: orgId, error: orgError } = await supabase.rpc('current_organization_id')
  if (orgError || !orgId) {
    Sentry.captureException(orgError ?? new Error('import: no org id'), {
      tags: { action: 'importCandidatesAction', step: 'org_resolve' },
    })
    return { ok: false, error: 'Could not determine your organisation. Please try again.' }
  }

  if (!csvText || csvText.trim().length === 0) {
    return { ok: false, error: 'The CSV is empty. Please upload a file with data.' }
  }

  // Parse the CSV. transformHeader normalises headers to lowercase + trimmed
  // so HEADER_ALIASES comparisons are consistent.
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  })

  const rawRows = parsed.data
  const totalInput = rawRows.length

  // Truncation guard (T-05-03-04).
  const truncated = totalInput > MAX_IMPORT_ROWS
  const rowsToProcess = truncated ? rawRows.slice(0, MAX_IMPORT_ROWS) : rawRows

  const summary: ImportSummary = {
    created: 0,
    skippedNoName: 0,
    skippedDuplicate: 0,
    errors: 0,
    truncated,
    totalInput,
  }

  for (const rawRow of rowsToProcess) {
    const mapped: MappedCandidate | null = mapRow(rawRow)

    // No resolvable full_name — skip.
    if (!mapped) {
      summary.skippedNoName++
      continue
    }

    // Dedupe by lowercased email (only when email provided).
    if (mapped.email) {
      const normEmail = mapped.email.toLowerCase().trim()
      if (normEmail) {
        // Reject malformed emails: candidates.email has no DB CHECK and
        // createCandidate does no validation, so storing this would persist
        // junk. Count as an error row (surfaces in summary) and skip — never
        // store. (Empty emails fall through this block and are allowed.)
        if (!EMAIL_RE.test(normEmail)) {
          summary.errors++
          continue
        }
        const existingResult = await findCandidateByEmail(supabase, normEmail, orgId as string)
        if (existingResult.ok && existingResult.data !== null) {
          summary.skippedDuplicate++
          continue
        }
        if (!existingResult.ok) {
          // findCandidateByEmail already sent to Sentry; count as error + skip.
          summary.errors++
          continue
        }
      }
    }

    // Create via the existing path (RLS-scoped; org set by DB trigger).
    const result = await createCandidate(supabase, {
      full_name: mapped.full_name,
      email: mapped.email ?? null,
      phone: mapped.phone ?? null,
      location: mapped.location ?? null,
      current_role_title: mapped.current_role_title ?? null,
      current_company: mapped.current_company ?? null,
      // Default imported candidates to passively_looking (sensible neutral status).
      market_status: 'passively_looking',
      // 'direct_add' is the closest existing enum value for recruiter-initiated
      // imports. No 'import' enum value exists; direct_add is the approved
      // fallback per plan spec (do NOT invent new enum values).
      source: 'direct_add',
      // legitimate_interest is the appropriate basis for imported contacts
      // where the agency has a pre-existing professional relationship. The
      // recruiter is responsible for ensuring this basis holds.
      consent_basis: 'legitimate_interest',
      consent_at: new Date().toISOString(),
      consent_text_version: CURRENT_CONSENT_VERSION,
    })

    if (result.ok) {
      summary.created++
    } else {
      // createCandidate already logs to Sentry with tags only (no PII).
      summary.errors++
    }
  }

  // Invalidate cached candidate listings so newly imported rows appear without
  // a hard refresh. Mirrors the createCandidateAction (candidates/new) pattern.
  if (summary.created > 0) {
    revalidatePath('/candidates')
    revalidatePath('/')
  }

  return { ok: true, summary }
}
