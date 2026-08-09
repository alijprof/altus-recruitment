import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import { coerceParsedCV } from '@/lib/ai/parsed-cv-schema'
import { sanitiseForPostgres } from '@/lib/text/postgres-safe-text'
import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import { isMissingColumnError } from './postgrest-errors'
import type { DbResult } from './types'

/**
 * Build the PII-free `detail` string for a failed write (DbResult.detail).
 *
 * ONLY the error's code (a SQLSTATE like 22P05/22003/22P02, or a PostgREST
 * code like PGRST102 for errors rejected before Postgres is reached) plus a
 * hard-coded sub-operation label and, where useful, the COLUMN NAMES in the
 * failing statement.
 *
 * NEVER `err.message`: PostgREST echoes the offending value back
 * ('invalid input syntax for type integer: "£45,000"'), so a message can
 * carry a candidate's salary, email or name straight into
 * candidate_cvs.parse_error_detail and the operator's screen (ASVS V7,
 * threat T-06-21).
 */
function failureDetail(error: unknown, subop: string, columns?: string[]): string {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? ((error as { code?: string }).code ?? 'unknown')
      : 'unknown'
  const where = columns?.length ? `${subop}: ${columns.join(', ')}` : subop
  return `${code} (${where})`
}

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
    return { ok: false, code: 'internal', detail: failureDetail(error, 'candidate_cvs.select') }
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
    return { ok: false, code: 'internal', detail: failureDetail(error, 'candidate_cvs.select') }
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
    return {
      ok: false,
      code: 'internal',
      detail: failureDetail(error, 'candidate_cvs.insert', Object.keys(payload)),
    }
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
    return { ok: false, code: 'internal', detail: failureDetail(error, 'candidate_cvs.select') }
  }
  return { ok: true, data: (data?.version ?? 0) + 1 }
}

export type UpdateCandidateCVParseInput = {
  id: string
  status: ParsingStatus
  extractedData?: unknown
  parseError?: string | null
  // PII-free technical root cause (error name/status, extracted char COUNT,
  // mime type — NEVER extracted text or a PII-bearing message). Written to
  // candidate_cvs.parse_error_detail, added by migration 20260804120000.
  // Recruiter-invisible; the honest UI copy lives in parseError.
  parseErrorDetail?: string | null
}

/**
 * Update parse outcome on a candidate_cvs row. Used by the Inngest function
 * (via the service-role client) and by retryParseAction (via the SSR client).
 *
 * `parse_error_detail` (migration 20260804120000) may reach production AFTER
 * this code deploys — the founder pushes migration files manually. Writes
 * are defensive: on a PGRST204 ("column not found in schema cache") or an
 * error message mentioning the column, retry the identical update WITHOUT
 * `parse_error_detail`. The user-facing status write must never be blocked
 * by the detail write.
 */
export async function updateCandidateCVParse(
  supabase: SupabaseClient<Database>,
  input: UpdateCandidateCVParseInput,
): Promise<DbResult<{ id: string }>> {
  // reason: built as a Record<string, unknown> and cast at the boundary —
  // src/types/database.ts is generated and will not contain
  // parse_error_detail until the founder regenerates it (do NOT run
  // `pnpm db:types` here; it needs a linked DB). Same idiom as the dynamic
  // patch built in markCandidateFieldsFromCV below.
  const patch: Record<string, unknown> = {
    parsing_status: input.status,
  }
  if (input.extractedData !== undefined) {
    patch.extracted_data = input.extractedData
  }
  if (input.parseError !== undefined) {
    patch.parse_error = input.parseError
  }
  if (input.parseErrorDetail !== undefined) {
    patch.parse_error_detail = input.parseErrorDetail
  }

  const runUpdate = (p: Record<string, unknown>) =>
    supabase
      .from('candidate_cvs')
      .update(p as unknown as TablesUpdate<'candidate_cvs'>)
      .eq('id', input.id)
      .select('id')
      .single()

  // THE DB-BOUNDARY SANITISER. extracted_data is the widest funnel in the
  // whole pipeline — Claude's entire tool output is written verbatim into
  // that one jsonb column — so a single U+0000 or lone surrogate anywhere in
  // it used to fail the whole write (22P05 / PGRST102) and, since the
  // Inngest retry replays the memoized claude-parse step, fail identically
  // forever. Sanitising the PATCH covers every field at once, keys included,
  // and covers every caller: the Inngest function, retryParseAction, and the
  // reconciler. Content-preserving: only those two sequences are altered.
  const safePatch = sanitiseForPostgres(patch)
  let sentColumns = Object.keys(safePatch)

  let { error } = await runUpdate(safePatch)

  if (
    error &&
    'parse_error_detail' in safePatch &&
    isMissingColumnError(error, 'parse_error_detail')
  ) {
    // Pre-migration deploy is an EXPECTED state, not an error — breadcrumb
    // only, never captureException.
    Sentry.addBreadcrumb({
      category: 'cv-parse',
      message: 'parse_error_detail column missing from schema cache — retried without it',
      level: 'info',
    })
    const withoutDetail: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(safePatch)) {
      if (key !== 'parse_error_detail') withoutDetail[key] = value
    }
    sentColumns = Object.keys(withoutDetail)
    ;({ error } = await runUpdate(withoutDetail))
  }

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'updateCandidateCVParse' },
    })
    return {
      ok: false,
      code: 'internal',
      // Columns of the statement that actually failed — after the
      // pre-migration fallback above, if it fired.
      detail: failureDetail(error, 'candidate_cvs.update', sentColumns),
    }
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
//   JSONB arrays (empty-array check on the candidate column):
//     work_history → work_experience, education → education
//     Migration 20260522094604 added these columns so LinkedIn capture +
//     PDF-derived CV parses can populate the candidate page directly.
//
// D-08: NEVER overwrite manually-entered fields. "Accept all" only fills
// empties. The patch object built below is the single enforcement point —
// keep this helper as the only path that maps parsed CV fields back onto
// the candidate row. If this list grows, expand both arrays together.
// ---------------------------------------------------------------------------

export type ParsedCVSubset = {
  name?: string | null
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
  // Optional structured arrays from CV parsing. Each mapped to the matching
  // jsonb candidate column shape (see mapWorkHistory / mapEducation).
  work_history?: Array<{
    company?: string
    role?: string
    start_date?: string
    end_date?: string
    summary?: string
  }> | null
  education?: Array<{
    institution?: string
    qualification?: string
    year?: string
  }> | null
}

/**
 * Convert a stored `candidate_cvs.extracted_data` JSON blob (or the direct
 * return value of `parseCV()`, which is written verbatim into that column)
 * into the `ParsedCVSubset` shape consumed by `markCandidateFieldsFromCV`.
 *
 * Single source of truth for this mapping — src/lib/inngest/functions/
 * parse-cv.ts (Step 4, fresh parse) and reconcile-cv-parses.ts (heal-
 * unmerged-profiles, re-processing a stored row) both call this so the
 * field mapping never drifts between the two call sites.
 */
export function toParsedCVSubset(extracted: unknown): ParsedCVSubset {
  // Routed through the coercion boundary, which replaces the fourteen
  // per-field `as` casts this function used to carry. That matters most for
  // STORED extracted_data: rows written BEFORE the boundary existed still
  // hold whatever Claude said at the time, and the reconciler re-processes
  // them (heal-unmerged-profiles). Coercing on the way out means an old row
  // carrying years_experience_total: 2015 heals instead of re-failing.
  const e = coerceParsedCV(extracted)
  return {
    name: e.name ?? null,
    email: e.email ?? null,
    phone: e.phone ?? null,
    location: e.location ?? null,
    current_role: e.current_role ?? null,
    current_company: e.current_company ?? null,
    seniority_level: e.seniority_level ?? null,
    salary_current_estimate: e.salary_current_estimate ?? null,
    salary_expectation: e.salary_expectation ?? null,
    // parseCV's tool schema doesn't return `currency` — leave null and let
    // the candidate column keep its 'GBP' default.
    currency: null,
    years_experience_total: e.years_experience_total ?? null,
    skills: e.skills ?? null,
    sector_tags: e.sector_tags ?? null,
    // JSONB-array fields — added 2026-05-22 to populate the
    // candidates.work_experience and candidates.education columns
    // introduced for the LinkedIn-PDF flow.
    work_history: e.work_history ?? null,
    education: e.education ?? null,
  }
}

// Map parsed.work_history (CV shape) onto candidates.work_experience
// (LinkedIn-capture-ish shape). Skips entries without a role.
function mapWorkHistory(
  items: NonNullable<ParsedCVSubset['work_history']>,
): Array<{ title: string; company: string | null; dates: string | null }> {
  const out: Array<{ title: string; company: string | null; dates: string | null }> = []
  for (const item of items) {
    const title = (item.role ?? '').trim()
    if (!title) continue
    const start = (item.start_date ?? '').trim()
    const end = (item.end_date ?? '').trim()
    let dates: string | null = null
    if (start && end) dates = `${start} - ${end}`
    else if (start) dates = `${start} - Present`
    else if (end) dates = end
    out.push({
      title,
      company: (item.company ?? '').trim() || null,
      dates,
    })
  }
  return out
}

// Map parsed.education (CV shape) onto candidates.education
function mapEducation(
  items: NonNullable<ParsedCVSubset['education']>,
): Array<{ school: string; degree: string | null; dates: string | null }> {
  const out: Array<{ school: string; degree: string | null; dates: string | null }> = []
  for (const item of items) {
    const school = (item.institution ?? '').trim()
    if (!school) continue
    out.push({
      school,
      degree: (item.qualification ?? '').trim() || null,
      dates: (item.year ?? '').trim() || null,
    })
  }
  return out
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
  // COERCE FIRST — before a single field is read. This helper is called with
  // three different provenances: a fresh parseCV result (already coerced), a
  // STORED extracted_data blob (the reconciler, and acceptCVFieldsAction's
  // "Accept all" button — both re-processing rows written before the
  // coercion boundary existed), and whatever a future caller passes. Only
  // coercing here makes all three safe, and it is what stops
  // `(parsed.name ?? '').trim()` and `item.role` below from throwing an
  // uncaught TypeError on a non-string name or a null work_history element.
  // Idempotent: coercing an already-coerced value is a no-op.
  const parsed: ParsedCVSubset = {
    ...toParsedCVSubset(args.parsed),
    // `currency` is the one ParsedCVSubset field the extract_cv_fields tool
    // never returns, so toParsedCVSubset deliberately nulls it. A caller who
    // sets it explicitly (rather than a model that guessed it) is trusted —
    // carry it across the boundary when it is a string.
    currency: typeof args.parsed.currency === 'string' ? args.parsed.currency : null,
  }

  // Select * so we don't 400 if the migration that added work_experience /
  // education hasn't yet applied on this environment. Reading the full row
  // for a single id costs us only the embedding (halfvec) extra bytes,
  // which is negligible. The empty-checks below tolerate missing columns
  // because they short-circuit on `undefined` (not an array).
  const { data: current, error: readError } = await supabase
    .from('candidates')
    .select('*')
    .eq('id', args.candidateId)
    .maybeSingle()

  if (readError) {
    Sentry.captureException(readError, {
      tags: { layer: 'db', helper: 'markCandidateFieldsFromCV', subop: 'read' },
    })
    return { ok: false, code: 'internal', detail: failureDetail(readError, 'candidates.read') }
  }
  if (!current) return { ok: false, code: 'not_found' }

  // current is typed loosely because we select a dynamic list — cast to a
  // shape we can index into. RLS already guarantees we read only our tenant.
  const row = current as unknown as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  for (const [parsedKey, col] of SCALAR_FIELD_MAP) {
    const candidateValue = row[col]
    const parsedValue = parsed[parsedKey]
    // Empty = null or undefined. Empty string also counts as empty so that
    // a candidate created with `email: ''` (form quirk) can still be filled.
    const isEmpty = candidateValue == null || candidateValue === ''
    if (isEmpty && parsedValue != null && parsedValue !== '') {
      patch[col] = parsedValue
    }
  }

  for (const [parsedKey, col] of ARRAY_FIELD_MAP) {
    const candidateValue = row[col]
    const parsedValue = parsed[parsedKey]
    const isEmpty = Array.isArray(candidateValue) && candidateValue.length === 0
    if (isEmpty && Array.isArray(parsedValue) && parsedValue.length > 0) {
      patch[col] = parsedValue
    }
  }

  // Name — special-case D-08. full_name is NOT NULL so the column is never
  // truly null; treat empty string as fillable. Beyond that, allow an
  // *upgrade*: if the user typed a partial (e.g., 'Liam') and the CV fills
  // in a strict extension ('Liam Steele' — same case-insensitive prefix +
  // a trailing space + more text), promote to the more complete value.
  // This handles the common quick-add-then-upload-CV flow without
  // clobbering an intentional full name with a CV-extracted variant.
  const parsedName = (parsed.name ?? '').trim()
  const currentName = String(row['full_name'] ?? '').trim()
  if (parsedName) {
    if (!currentName) {
      patch['full_name'] = parsedName
    } else if (
      parsedName.length > currentName.length &&
      parsedName.toLowerCase().startsWith(currentName.toLowerCase() + ' ')
    ) {
      patch['full_name'] = parsedName
    }
  }

  // JSONB array fields — same fill-empty rule, but each needs a mapper to
  // translate the parsed-CV shape to the candidate-column shape.
  const candidateWorkExperience = row['work_experience']
  const workExperienceEmpty =
    Array.isArray(candidateWorkExperience) && candidateWorkExperience.length === 0
  if (workExperienceEmpty && Array.isArray(parsed.work_history) && parsed.work_history.length > 0) {
    const mapped = mapWorkHistory(parsed.work_history)
    if (mapped.length > 0) patch['work_experience'] = mapped
  }

  const candidateEducation = row['education']
  const educationEmpty = Array.isArray(candidateEducation) && candidateEducation.length === 0
  if (educationEmpty && Array.isArray(parsed.education) && parsed.education.length > 0) {
    const mapped = mapEducation(parsed.education)
    if (mapped.length > 0) patch['education'] = mapped
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: { fieldsPopulated: [] } }
  }

  // The second DB-boundary sanitiser (the first is in
  // updateCandidateCVParse). Coercion above guarantees SHAPE and RANGE;
  // this guarantees Postgres LEGALITY of the string content — a NUL that
  // travelled from a CV through Claude into a name or a skill would
  // otherwise fail the whole merge with 22P05.
  const safePatch = sanitiseForPostgres(patch)

  // reason: TablesUpdate<'candidates'> is the canonical update shape but our
  // patch is built dynamically from the column maps above. Cast at the
  // boundary so the type system still narrows the result.
  const updatePayload = safePatch as unknown as TablesUpdate<'candidates'>

  const { error: updateError } = await supabase
    .from('candidates')
    .update(updatePayload)
    .eq('id', args.candidateId)

  if (updateError) {
    Sentry.captureException(updateError, {
      tags: { layer: 'db', helper: 'markCandidateFieldsFromCV', subop: 'update' },
    })
    return {
      ok: false,
      code: 'internal',
      detail: failureDetail(updateError, 'candidates.update', Object.keys(safePatch)),
    }
  }

  return { ok: true, data: { fieldsPopulated: Object.keys(patch) } }
}
