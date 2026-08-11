'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { updateCandidate, type UpdateCandidateInput } from '@/lib/db/candidates'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient } from '@/lib/supabase/server'
import { sanitiseForPostgres } from '@/lib/text/postgres-safe-text'

import { editCandidateSchema } from './schema'

// Wraps the schema with the id (passed via the URL, not the form body) so we
// can validate id + patch together in a single safeParse.
const updateCandidateActionSchema = z.object({
  id: z.string().uuid('Invalid candidate id.'),
  patch: editCandidateSchema,
})

export type UpdateCandidateResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

// '' -> null (explicit clear); `undefined` -> `undefined` (the key was
// omitted from the submitted payload, so the write must leave the column
// untouched).
//
// This is DELIBERATELY NOT the bare `x || null` pattern, which collapses an
// omission into an explicit NULL. Since CR-01 (review 2026-08-11) the edit
// form submits ONLY react-hook-form's dirty fields, so an omitted key is now
// the NORMAL case for every field the recruiter did not touch — not a
// theoretical one. `x || null` on any of these would turn a one-character
// phone correction into a wipe of every other column the form renders.
//
// That is exactly why the five optional BASIC scalars (email, phone,
// location, current_role_title, current_company) were converted to
// toNullableString in the same commit as CR-01: they previously relied on
// the form always submitting all eight basics, and that assumption is now
// deliberately false.
function toNullableString(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined
  return v === '' ? null : v
}

function toNullableNumber(v: string | undefined): number | null | undefined {
  if (v === undefined) return undefined
  return v === '' ? null : Number(v)
}

/**
 * WR-08 (review 2026-08-11) — flatten the NESTED issue path.
 *
 * updateCandidateActionSchema wraps the payload as `{ id, patch }`, and
 * `error.flatten().fieldErrors` only ever keys on `path[0]`. Every field
 * error therefore arrived as `fieldErrors.patch`, and the form called
 * `form.setError('patch', …)` — a field that does not exist, so no
 * FormMessage rendered and no toast fired. The save appeared to do nothing
 * at all.
 *
 * Pre-existing shape, but 07-03/07-04 took the number of server-side
 * rejectable fields from 8 to 18 and added paths where client validation
 * does not run first (a direct action invocation, a future non-RHF caller).
 *
 * `['patch', 'work_experience', 0, 'title']` keys under `work_experience`,
 * which is the name react-hook-form knows.
 */
function toFieldErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of issues) {
    const [first, second] = issue.path
    const key = first === 'patch' ? String(second ?? 'patch') : String(first ?? 'patch')
    ;(fieldErrors[key] ??= []).push(issue.message)
  }
  return fieldErrors
}

export async function updateCandidateAction(
  id: string,
  rawPatch: unknown,
): Promise<UpdateCandidateResult> {
  const parsed = updateCandidateActionSchema.safeParse({ id, patch: rawPatch })
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createClient()

  // D-08 facts an executor might otherwise "helpfully" break:
  //   1. markCandidateFieldsFromCV only ever fills EMPTY fields
  //      (candidate-cvs.ts:427-563), so a value edited here is automatically
  //      protected from a later CV parse — no override flag is needed or
  //      wanted.
  //   2. Clearing a field back to empty deliberately makes it re-fillable by
  //      a future Accept all. That is correct behaviour, not a bug.
  //   3. Per-field accept-time controls are explicitly OUT of this phase
  //      (07-CONTEXT.md decision 6). Do not add them.
  //
  // NO app-side embedding invalidation is written here. The BEFORE UPDATE
  // trigger `invalidate_candidate_embedding` (migration 20260519092951)
  // already NULLs candidate_embedding/embedded_at whenever any of the
  // search-relevant columns this plan makes editable (skills, sector_tags,
  // seniority_level, years_experience) change — a plain UPDATE fires it, so
  // the scheduled embed-batch sweep picks the row up on its next run. The
  // non-search fields this plan adds (salary_current_estimate,
  // salary_expectation, headline, about, work_experience, education) are
  // NOT in candidateEmbeddingText (src/lib/ai/embed-text.ts), so
  // invalidating on them would buy an org a Voyage call for a
  // byte-identical embedding vector — real spend for zero benefit.
  // tests/unit/lib/ai/embedding-invalidation-contract.test.ts (Task 3) is
  // the permanent guard that keeps these two field sets in sync.
  const patch: UpdateCandidateInput = {
    // The three the schema REQUIRES — always present, always written.
    full_name: parsed.data.patch.full_name,
    market_status: parsed.data.patch.market_status,
    source: parsed.data.patch.source,

    // The five optional basics. toNullableString, NOT `x || null` — see the
    // helper's comment: under CR-01's dirty-field submission an untouched
    // key arrives `undefined`, and `undefined || null` would write NULL.
    email: toNullableString(parsed.data.patch.email),
    phone: toNullableString(parsed.data.patch.phone),
    location: toNullableString(parsed.data.patch.location),
    current_role_title: toNullableString(parsed.data.patch.current_role_title),
    current_company: toNullableString(parsed.data.patch.current_company),

    // --- Plan 07-03 additions ---------------------------------------------
    seniority_level: toNullableString(parsed.data.patch.seniority_level),
    years_experience: toNullableNumber(parsed.data.patch.years_experience),
    salary_current_estimate: toNullableNumber(parsed.data.patch.salary_current_estimate),
    salary_expectation: toNullableNumber(parsed.data.patch.salary_expectation),
    headline: toNullableString(parsed.data.patch.headline),
    about: toNullableString(parsed.data.patch.about),
    // Arrays pass through as-is: `undefined` (key omitted) skips the
    // column; `[]` (explicitly cleared by the tag-input UI) writes the
    // legitimate empty value — both columns are `text[] not null default
    // '{}'`, so an empty array is real data, not "nothing to write".
    skills: parsed.data.patch.skills,
    sector_tags: parsed.data.patch.sector_tags,
    // jsonb columns — the edit-schema row shape {title,company,dates} /
    // {school,degree,dates} already matches the candidates column shape
    // read by page.tsx's parseWorkExperience/parseEducation, so no CV-parse-
    // shape mapping (mapWorkHistory/mapEducation in candidate-cvs.ts) is
    // needed here. `?.map` on `undefined` short-circuits to `undefined`,
    // preserving the same omitted-vs-cleared distinction as the scalars.
    work_experience: parsed.data.patch.work_experience?.map((row) => ({
      title: row.title,
      company: row.company || null,
      dates: row.dates || null,
    })),
    education: parsed.data.patch.education?.map((row) => ({
      school: row.school,
      degree: row.degree || null,
      dates: row.dates || null,
    })),
  }

  // DB-boundary sanitiser over the WHOLE patch — the Phase-6 lesson. The new
  // fields are precisely the ones a recruiter fills by pasting text out of a
  // PDF CV, and a single U+0000 or lone surrogate in `about` or a
  // work_experience row would fail the entire save with 22P05. This is the
  // third write path that needs sanitiseForPostgres — the other two are
  // updateCandidateCVParse and markCandidateFieldsFromCV.
  const result = await updateCandidate(supabase, parsed.data.id, sanitiseForPostgres(patch))

  if (!result.ok) {
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath('/candidates')
  revalidatePath(`/candidates/${parsed.data.id}`)
  redirect(`/candidates/${parsed.data.id}`)
}
