import 'server-only'

import type { Tables } from '@/types/database'

// ---------------------------------------------------------------------------
// Pure builders for the strings we feed to Voyage. Decision D2-01: candidate
// embedding is HYBRID — a structured summary block (Name / Role / Company /
// Location / Skills / Seniority / Years / Sectors) concatenated with the
// raw CV text capped to MAX_CV_CHARS_FOR_EMBED. Job embedding is the
// structured job summary plus the JD body (no hybrid — the description IS
// the narrative).
//
// Pure functions on purpose: unit-testable, no side effects, no SDK calls.
// ---------------------------------------------------------------------------

/**
 * Maximum CV characters embedded after the structured summary. Voyage-3
 * accepts 32k tokens (~120k chars); 30k chars ≈ 7.5k tokens ≈ £0.0045 per
 * embed, comfortably under the cap and well-priced per CV.
 */
export const MAX_CV_CHARS_FOR_EMBED = 30_000

// Fields used to build the candidate structured summary. Mirror the trigger
// in `invalidate_candidate_embedding` — keep this list and that trigger
// definition in sync. (See `src/lib/ai/embed-text.test.ts` for shape tests.)
type CandidateEmbedFields = Pick<
  Tables<'candidates'>,
  | 'full_name'
  | 'current_role_title'
  | 'current_company'
  | 'location'
  | 'skills'
  | 'seniority_level'
  | 'years_experience'
  | 'sector_tags'
>

function nonEmptyArray<T>(arr: T[] | null | undefined): arr is T[] {
  return Array.isArray(arr) && arr.length > 0
}

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Build the embedding-input string for a candidate. Skips any field that is
 * null/undefined/empty so we never emit `Location: null.` or `Skills: .`.
 * When `cvText` is non-null, appends `\n\n---\n\n${cvText.slice(0, 30000)}`.
 */
export function candidateEmbeddingText(c: CandidateEmbedFields, cvText: string | null): string {
  const parts: string[] = []
  if (nonEmpty(c.full_name)) parts.push(`Name: ${c.full_name}.`)
  if (nonEmpty(c.current_role_title)) parts.push(`Role: ${c.current_role_title}.`)
  if (nonEmpty(c.current_company)) parts.push(`Company: ${c.current_company}.`)
  if (nonEmpty(c.location)) parts.push(`Location: ${c.location}.`)
  if (nonEmptyArray(c.skills)) parts.push(`Skills: ${c.skills.join(', ')}.`)
  if (nonEmpty(c.seniority_level)) parts.push(`Seniority: ${c.seniority_level}.`)
  if (c.years_experience != null) parts.push(`Years: ${c.years_experience}.`)
  if (nonEmptyArray(c.sector_tags)) parts.push(`Sectors: ${c.sector_tags.join(', ')}.`)

  let out = parts.join(' ')
  if (cvText != null && cvText.length > 0) {
    out += `\n\n---\n\n${cvText.slice(0, MAX_CV_CHARS_FOR_EMBED)}`
  }
  return out.trim()
}

type JobEmbedFields = Pick<
  Tables<'jobs'>,
  | 'title'
  | 'location'
  | 'job_type'
  | 'hiring_context'
  | 'salary_min'
  | 'salary_max'
  | 'currency'
  | 'description'
>

/**
 * Build the embedding-input string for a job. Structured header + the JD
 * body verbatim (D2-01: the description IS the narrative). No truncation
 * on the description — JDs rarely exceed 4k chars.
 */
export function jobEmbeddingText(j: JobEmbedFields): string {
  const header: string[] = []
  if (nonEmpty(j.title)) header.push(`Title: ${j.title}.`)
  if (nonEmpty(j.location)) header.push(`Location: ${j.location}.`)
  if (nonEmpty(j.job_type)) header.push(`Type: ${j.job_type}.`)
  if (nonEmpty(j.hiring_context)) header.push(`Hiring context: ${j.hiring_context}.`)
  if (j.salary_min != null || j.salary_max != null) {
    const lo = j.salary_min ?? '?'
    const hi = j.salary_max ?? '?'
    const cur = nonEmpty(j.currency) ? j.currency : ''
    header.push(`Salary: ${lo}-${hi} ${cur}.`.replace(/\s+\./, '.'))
  }

  let out = header.join(' ')
  if (nonEmpty(j.description)) {
    out += `\n\nDescription: ${j.description}`
  }
  return out.trim()
}
