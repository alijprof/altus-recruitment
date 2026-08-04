// isProfileEffectivelyEmpty — the embed + match-score contamination guard.
// NO `import 'server-only'` — src/app/(app)/jobs/[id]/matches/match-card.tsx
// (an RSC, but co-located with a barrel that must stay import-cheap) reads
// this alongside server-only Inngest functions; keeping the module free of
// server-only imports keeps it usable from either side without a boundary
// violation.
//
// SF-1 (2026-07-31 Steele Charles feature review): a CV whose text extracted
// but whose structured fields all came back empty (Haiku returned nothing
// usable, or the D-08 merge failed) was still getting embedded and
// match-scored from a bare `Name: X.` string — a candidate who is neither
// findable nor scorable was surfacing misleading match results. This
// predicate is the single guard applied at every contamination site: the
// reactive embed in parse-cv.ts, the embed-batch sweep, precompute match
// scoring, and the match-card UI badge.

/**
 * Structural, partial-style field set. Deliberately does NOT extend a
 * concrete row type — both `CandidateForEmbedding` (src/lib/db/candidates.ts)
 * and the (extended) `CandidateByIdRow` satisfy this without a cast, and a
 * caller that omits a key entirely (rather than passing it as null) is
 * treated as "empty" for that field, not a type error.
 *
 * full_name is deliberately EXCLUDED: a name alone makes a candidate neither
 * findable (nothing to match a search query against beyond the name itself)
 * nor scorable (no signal for match explanations) — that is exactly the SF-1
 * contamination shape this guard exists to catch.
 */
export type ProfileCompletenessFields = {
  current_role_title?: string | null
  current_company?: string | null
  location?: string | null
  seniority_level?: string | null
  years_experience?: number | null
  skills?: string[] | null
  sector_tags?: string[] | null
}

/**
 * The `candidates` columns this predicate reads, split by the SQL shape
 * needed to express "empty" for each.
 *
 * Review 2026-08-04 H1: `isProfileEffectivelyEmpty` used to be applied ONLY
 * post-fetch in the embed sweep, so rows it discarded kept their pre-fetch
 * state and were re-selected every run — permanently occupying the row cap
 * (the sweep could silently stop embedding anyone at all). The embed-batch
 * candidate sweep now expresses this predicate in its SQL selector
 * (NON_EMPTY_PROFILE_OR_FILTER below), and these arrays are the single
 * source of truth for WHICH columns that SQL must mention.
 *
 * If `ProfileCompletenessFields` gains a field, add it here AND to the
 * embed-batch query builder, or the SQL and TS predicates drift (the call
 * site keeps the TS predicate as a post-fetch guard and Sentry-warns when it
 * drops a row, which is how drift surfaces).
 *
 * Re-review 2026-08-04 V1 — deliberately NOT used by the reconciler's heal
 * step. Its selector keys on the narrower "merge never applied" signal
 * (skills + work_experience + education all empty, HEAL_SIGNAL_COLUMNS in
 * reconcile-cv-parses.ts): a candidate with scalars set but zero
 * skills/work/education still needs the heal, and mirroring THIS predicate
 * there excluded the exact production rows the heal was written for. Do not
 * "re-unify" the two predicates — they answer different questions
 * (contamination: "is there anything to embed/score?" vs heal: "did the
 * parse's high-value fields ever land?").
 *
 * NULL-checked (scalar) columns vs empty-array-checked (`text[] not null
 * default '{}'`) columns need different PostgREST operators, hence two lists.
 */
export const PROFILE_COMPLETENESS_SCALAR_COLUMNS = [
  'current_role_title',
  'current_company',
  'location',
  'seniority_level',
  'years_experience',
] as const

export const PROFILE_COMPLETENESS_ARRAY_COLUMNS = ['skills', 'sector_tags'] as const

/** Every column `isProfileEffectivelyEmpty` inspects, in one list. */
export const PROFILE_COMPLETENESS_COLUMNS = [
  ...PROFILE_COMPLETENESS_SCALAR_COLUMNS,
  ...PROFILE_COMPLETENESS_ARRAY_COLUMNS,
] as const

export type ProfileCompletenessColumn = (typeof PROFILE_COMPLETENESS_COLUMNS)[number]

/**
 * PostgREST `or=(…)` filter body selecting candidates that are NOT
 * effectively empty — i.e. the SQL complement of `isProfileEffectivelyEmpty`.
 *
 * Used by the embed-batch candidate sweep (review 2026-08-04 H1) so
 * contaminated rows never enter the 256-row window in the first place. Lives
 * here, next to the predicate it mirrors, so both change together.
 *
 * `col <> '{}'` is the array equivalent of `col IS NOT NULL`: both array
 * columns are `text[] not null default '{}'`, so "non-empty" is the real
 * test. `{}` contains no PostgREST-reserved character, so it needs no
 * quoting inside the or-list.
 */
export const NON_EMPTY_PROFILE_OR_FILTER = [
  ...PROFILE_COMPLETENESS_SCALAR_COLUMNS.map((c) => `${c}.not.is.null`),
  ...PROFILE_COMPLETENESS_ARRAY_COLUMNS.map((c) => `${c}.neq.{}`),
].join(',')

function isEmptyString(v: string | null | undefined): boolean {
  return v == null || v.trim().length === 0
}

function isEmptyArray(v: unknown[] | null | undefined): boolean {
  return v == null || v.length === 0
}

/**
 * True only when EVERY field below is empty (null/undefined/whitespace-only
 * string/empty array). `years_experience === 0` counts as a REAL, present
 * value — a fresh graduate with 0 years is not an empty profile.
 *
 * Manually-entered candidates with any one real field are NEVER blocked —
 * this guard only fires when the profile is functionally content-free.
 */
export function isProfileEffectivelyEmpty(c: ProfileCompletenessFields): boolean {
  if (!isEmptyString(c.current_role_title)) return false
  if (!isEmptyString(c.current_company)) return false
  if (!isEmptyString(c.location)) return false
  if (!isEmptyString(c.seniority_level)) return false
  if (c.years_experience != null) return false
  if (!isEmptyArray(c.skills)) return false
  if (!isEmptyArray(c.sector_tags)) return false
  return true
}
