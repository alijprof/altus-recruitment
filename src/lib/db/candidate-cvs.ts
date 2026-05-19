import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// CV row helpers. All writes go through here so the Inngest function and the
// upload Server Action share one shape. The org_id is filled in by the
// candidate_cvs_set_org trigger; do not pass organization_id from caller code.
// ---------------------------------------------------------------------------

export type CandidateCvRow = Tables<'candidate_cvs'>

export type ParsingStatus = Database['public']['Enums']['cv_parsing_status']

/**
 * List CVs for a candidate, newest first.
 */
export async function listCandidateCVs(
  supabase: SupabaseClient<Database>,
  candidateId: string,
): Promise<DbResult<CandidateCvRow[]>> {
  const { data, error } = await supabase
    .from('candidate_cvs')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listCandidateCVs' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

/**
 * Fetch a single CV row by id (used by the review panel and the retry path).
 */
export async function getCandidateCV(
  supabase: SupabaseClient<Database>,
  cvId: string,
): Promise<DbResult<CandidateCvRow>> {
  const { data, error } = await supabase
    .from('candidate_cvs')
    .select('*')
    .eq('id', cvId)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getCandidateCV' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}

export type CreateCandidateCVInput = {
  candidateId: string
  storagePath: string
  mimeType: string
  fileSizeBytes: number
  version: number
  uploadedBy: string | null
  // Optional: pass when calling from a service-role + no-session path (e.g.
  // the public apply form). The candidate_cvs_set_org trigger uses
  // current_organization_id() which returns NULL under service-role and
  // raises 'organization_id is required and could not be resolved from auth
  // context'. Authenticated callers leave this undefined and let the trigger
  // resolve from the session.
  organizationId?: string
}

/**
 * Insert a candidate_cvs row with parsing_status='pending'. organization_id
 * is filled by the candidate_cvs_set_org BEFORE INSERT trigger from the
 * session's current_organization_id() — except for service-role callers
 * with no session, which MUST pass `organizationId` explicitly.
 */
export async function createCandidateCV(
  supabase: SupabaseClient<Database>,
  input: CreateCandidateCVInput,
): Promise<DbResult<Pick<CandidateCvRow, 'id' | 'organization_id'>>> {
  // reason: TablesInsert<'candidate_cvs'> requires organization_id at the
  // type level but the BEFORE INSERT trigger resolves it from the auth
  // context for authenticated callers. Cast through unknown narrows the
  // payload to what we actually send (matches the pattern in createCandidate).
  const payload = {
    candidate_id: input.candidateId,
    storage_path: input.storagePath,
    mime_type: input.mimeType,
    file_size_bytes: input.fileSizeBytes,
    version: input.version,
    parsing_status: 'pending' as ParsingStatus,
    uploaded_by: input.uploadedBy,
    ...(input.organizationId ? { organization_id: input.organizationId } : {}),
  } as unknown as TablesInsert<'candidate_cvs'>

  const { data, error } = await supabase
    .from('candidate_cvs')
    .insert(payload)
    .select('id, organization_id')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createCandidateCV' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * Compute the next version integer for a candidate's CV history. The
 * (candidate_id, version) unique constraint means two racing uploads
 * collide — caller surfaces a conflict.
 */
export async function nextCVVersion(
  supabase: SupabaseClient<Database>,
  candidateId: string,
): Promise<DbResult<number>> {
  const { data, error } = await supabase
    .from('candidate_cvs')
    .select('version')
    .eq('candidate_id', candidateId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'nextCVVersion' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: (data?.version ?? 0) + 1 }
}

export type UpdateCandidateCVParseInput = {
  id: string
  status: ParsingStatus
  extractedData?: unknown
  parseError?: string | null
}

/**
 * Update parse outcome on a candidate_cvs row. Used by the Inngest function
 * (via the service-role client) and by retryParseAction (via the SSR client).
 */
export async function updateCandidateCVParse(
  supabase: SupabaseClient<Database>,
  input: UpdateCandidateCVParseInput,
): Promise<DbResult<{ id: string }>> {
  const patch: TablesUpdate<'candidate_cvs'> = {
    parsing_status: input.status,
  }
  if (input.extractedData !== undefined) {
    // reason: extracted_data is a JSONB column — the generated Json union
    // does not structurally match unknown. Cast at the boundary.
    patch.extracted_data = input.extractedData as TablesUpdate<'candidate_cvs'>['extracted_data']
  }
  if (input.parseError !== undefined) {
    patch.parse_error = input.parseError
  }

  const { error } = await supabase
    .from('candidate_cvs')
    .update(patch)
    .eq('id', input.id)
    .select('id')
    .single()

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'updateCandidateCVParse' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id: input.id } }
}

// ---------------------------------------------------------------------------
// markCandidateFieldsFromCV — D-08 enforcement point.
//
// Per VERIFICATION R5 (verified against migration 20260513152244 lines
// 199–231), the candidate columns we MAY populate from a parsed CV are:
//
//   Scalars (null check):
//     email, phone, location, current_role_title, current_company,
//     seniority_level, salary_current_estimate, salary_expectation,
//     currency, years_experience
//
//   Arrays (empty-array check — `text[] not null default '{}'`):
//     skills, sector_tags
//
//   NOT on candidates (stay in extracted_data JSONB on candidate_cvs only):
//     work_history, education
//
// D-08: NEVER overwrite manually-entered fields. "Accept all" only fills
// empties. The patch object built below is the single enforcement point —
// keep this helper as the only path that maps parsed CV fields back onto
// the candidate row. If this list grows, expand both arrays together.
// ---------------------------------------------------------------------------

type ParsedCVSubset = {
  email?: string | null
  phone?: string | null
  location?: string | null
  current_role?: string | null
  current_company?: string | null
  seniority_level?: string | null
  salary_current_estimate?: number | null
  salary_expectation?: number | null
  currency?: string | null
  years_experience_total?: number | null
  skills?: string[] | null
  sector_tags?: string[] | null
}

// Scalar mapping: parsed key → candidate column. Note the rename of
// current_role → current_role_title and years_experience_total → years_experience.
const SCALAR_FIELD_MAP: Array<[keyof ParsedCVSubset, keyof Tables<'candidates'>]> = [
  ['email', 'email'],
  ['phone', 'phone'],
  ['location', 'location'],
  ['current_role', 'current_role_title'],
  ['current_company', 'current_company'],
  ['seniority_level', 'seniority_level'],
  ['salary_current_estimate', 'salary_current_estimate'],
  ['salary_expectation', 'salary_expectation'],
  ['currency', 'currency'],
  ['years_experience_total', 'years_experience'],
]

// Array mapping: parsed key → candidate column. Both are text[] with a
// `not null default '{}'` — empty array means "empty", not "set".
const ARRAY_FIELD_MAP: Array<[keyof ParsedCVSubset, keyof Tables<'candidates'>]> = [
  ['skills', 'skills'],
  ['sector_tags', 'sector_tags'],
]

export type MarkCandidateFieldsResult = {
  fieldsPopulated: string[]
}

/**
 * Build and apply a patch that ONLY populates currently-empty candidate
 * fields from a parsed CV. Never overwrites a populated value (D-08).
 *
 * The "empty" predicate differs by column type:
 *   - Scalars: `v == null` (both null and undefined)
 *   - Arrays:  `Array.isArray(v) && v.length === 0`
 */
export async function markCandidateFieldsFromCV(
  supabase: SupabaseClient<Database>,
  args: { candidateId: string; parsed: ParsedCVSubset },
): Promise<DbResult<MarkCandidateFieldsResult>> {
  const columns = [
    ...SCALAR_FIELD_MAP.map(([, col]) => col),
    ...ARRAY_FIELD_MAP.map(([, col]) => col),
  ].join(', ')

  const { data: current, error: readError } = await supabase
    .from('candidates')
    .select(columns)
    .eq('id', args.candidateId)
    .maybeSingle()

  if (readError) {
    Sentry.captureException(readError, {
      tags: { layer: 'db', helper: 'markCandidateFieldsFromCV', subop: 'read' },
    })
    return { ok: false, code: 'internal' }
  }
  if (!current) return { ok: false, code: 'not_found' }

  // current is typed loosely because we select a dynamic list — cast to a
  // shape we can index into. RLS already guarantees we read only our tenant.
  const row = current as unknown as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  for (const [parsedKey, col] of SCALAR_FIELD_MAP) {
    const candidateValue = row[col]
    const parsedValue = args.parsed[parsedKey]
    // Empty = null or undefined. Empty string also counts as empty so that
    // a candidate created with `email: ''` (form quirk) can still be filled.
    const isEmpty = candidateValue == null || candidateValue === ''
    if (isEmpty && parsedValue != null && parsedValue !== '') {
      patch[col] = parsedValue
    }
  }

  for (const [parsedKey, col] of ARRAY_FIELD_MAP) {
    const candidateValue = row[col]
    const parsedValue = args.parsed[parsedKey]
    const isEmpty = Array.isArray(candidateValue) && candidateValue.length === 0
    if (
      isEmpty &&
      Array.isArray(parsedValue) &&
      parsedValue.length > 0
    ) {
      patch[col] = parsedValue
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: { fieldsPopulated: [] } }
  }

  // reason: TablesUpdate<'candidates'> is the canonical update shape but our
  // patch is built dynamically from the column maps above. Cast at the
  // boundary so the type system still narrows the result.
  const updatePayload = patch as unknown as TablesUpdate<'candidates'>

  const { error: updateError } = await supabase
    .from('candidates')
    .update(updatePayload)
    .eq('id', args.candidateId)

  if (updateError) {
    Sentry.captureException(updateError, {
      tags: { layer: 'db', helper: 'markCandidateFieldsFromCV', subop: 'update' },
    })
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: { fieldsPopulated: Object.keys(patch) } }
}
