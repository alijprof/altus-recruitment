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
