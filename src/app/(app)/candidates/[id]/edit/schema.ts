import { z } from 'zod'

import { createCandidateSchema } from '../../new/schema'

// Edit form reuses the create schema minus the consent fields — consent is
// captured once at creation time (D-12 / GDPR Art. 7) and remains immutable
// in Phase 1. A consent_withdrawn_at flow is deferred to Phase 3 per
// CONTEXT.md `<deferred>`.
//
// Plan 07-03 (CLT-04) widens this schema to cover every AI-parsed candidate
// field, not just the original 8 basics — see 07-CONTEXT.md decision 3.
// Same Plan-3 convention as the base schema: optional TEXT fields stay
// `string | undefined` (not transformed) so react-hook-form's input/output
// types align under @hookform/resolvers 5 (new/schema.ts:9-11 records why a
// `.transform()` on a scalar optional text field breaks resolver type
// inference). Numeric fields (years_experience, the two salaries) are
// therefore validated AS STRINGS with a `.refine()`, matching the pattern
// already used for `jobs/new/schema.ts`'s `numericString` — the edit
// ACTION (actions.ts) is where '' is coerced to null and numeric strings are
// converted to numbers, not this schema.
//
// The two array editors (skills/sector_tags tag-inputs, and the
// work_experience/education repeating-row editors) are a different UI
// paradigm — not native `<input>` elements bound 1:1 via `register()` — so
// the same transform-pipeline caveat does not apply to the ARRAY-level
// filtering below (dropping blank tags / blank-title-or-school rows). Only
// the array's overall shape changes across parse (RawRow[] -> FilteredRow[],
// both still string[]/object[] at the TypeScript level), not any individual
// scalar leaf field's own input/output type.

// The seven values in the extract_cv_fields tool schema's seniority_level
// enum, mirrored from src/lib/ai/parsed-cv-schema.ts:57-65 (SENIORITY_LEVELS,
// not exported there). candidates.seniority_level is plain `text`, so an
// off-vocabulary value would not fail the write — it would silently pollute
// a field the UI filters on (parsed-cv-schema.ts:53-56), which is why this
// is a closed enum rather than free text.
export const SENIORITY_LEVEL_VALUES = [
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'manager',
  'director',
] as const

export const SENIORITY_LEVEL_LABELS: Record<(typeof SENIORITY_LEVEL_VALUES)[number], string> = {
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  lead: 'Lead',
  principal: 'Principal',
  manager: 'Manager',
  director: 'Director',
}

// '' is the "cleared" sentinel (matches the `x || null` coercion the action
// applies to every other optional scalar). Kept as its own enum member
// rather than a bare z.string() so an off-vocabulary paste is rejected at
// validation time instead of silently written.
const seniorityLevelSchema = z.enum([...SENIORITY_LEVEL_VALUES, '']).optional()

// candidates.years_experience is `numeric(4,1)` (migration 20260513152244:217).
// Precision 4 / scale 1 means the stored value must have at most 3 integral
// digits: the exact overflow cliff is 1000 (mirrors
// YEARS_EXPERIENCE_EXCLUSIVE_MAX in parsed-cv-schema.ts:51 — verified against
// Postgres 17.6 there). Comes off an <input> as a string; z.coerce.number()
// is deliberately avoided (it would change the field's TypeScript type to
// `number`, breaking the string-typed RHF binding), so this validates the
// STRING form directly.
const YEARS_EXPERIENCE_EXCLUSIVE_MAX = 1000

const yearsExperienceSchema = z
  .string()
  .trim()
  .max(10, 'Too long')
  .refine((v) => {
    if (v === '') return true
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n < YEARS_EXPERIENCE_EXCLUSIVE_MAX
  }, 'Enter a number of years between 0 and 999.9')
  .optional()

// candidates.salary_current_estimate / salary_expectation are `integer`
// (int4, max 2,147,483,647 — parsed-cv-schema.ts:40-43), but no real salary
// approaches that. 10_000_000 mirrors the sane ceiling already used for job
// salaries (jobs/new/schema.ts:56, clients/[id]/jobs/new/schema.ts:52).
// Decimals are rejected (not rounded) — an edit-form salary is a fact the
// recruiter is typing deliberately, unlike a CV-parse guess.
const SALARY_CEILING = 10_000_000

const salaryStringSchema = z
  .string()
  .trim()
  .max(12, 'Too long')
  .refine((v) => {
    if (v === '') return true
    const n = Number(v)
    return Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= SALARY_CEILING
  }, 'Enter a whole non-negative number')
  .optional()

// T-07-13 (unbounded free text): length caps so a paste cannot bloat the row
// or the embedding input. 300/5000 match candidates.headline (app cap) and
// candidates.about (app cap).
const headlineSchema = z.string().trim().max(300, 'Too long').optional()
const aboutSchema = z.string().trim().max(5000, 'Too long').optional()

// Skills / sector_tags — text[] not null default '{}'. Tag-input UI (07-04)
// emits a string[], not a bound native <input>, so array-level transforms are
// safe here (see file header). Trim + drop blanks, then cap each surviving
// entry at 100 chars (T-07-13) — an over-length entry REJECTS the whole
// array parse (mirrors spec/[id]/review/actions.ts:47-48's
// `z.string().trim().max(500)` pattern) rather than silently truncating a
// value the recruiter typed on purpose.
const TAG_ENTRY_MAX_CHARS = 100

const tagArraySchema = z
  .array(z.string())
  .transform((arr) => arr.map((s) => s.trim()).filter((s) => s.length > 0))
  .pipe(z.array(z.string().max(TAG_ENTRY_MAX_CHARS, `Each entry must be ${TAG_ENTRY_MAX_CHARS} characters or fewer`)))
  .optional()

// work_experience / education — jsonb not null default '[]'. Row shape
// matches the candidates column shape DIRECTLY (see interfaces block in
// 07-03-PLAN.md: `{ title, company, dates }` / `{ school, degree, dates }`,
// as read by page.tsx's parseWorkExperience/parseEducation) — no CV-parse-
// shape mapping is needed here, unlike candidate-cvs.ts's mapWorkHistory/
// mapEducation which translate the DIFFERENT Claude tool-output shape.
const workExperienceRowSchema = z.object({
  title: z.string().trim().max(255, 'Too long'),
  company: z.string().trim().max(255, 'Too long').optional(),
  dates: z.string().trim().max(100, 'Too long').optional(),
})

const educationRowSchema = z.object({
  school: z.string().trim().max(255, 'Too long'),
  degree: z.string().trim().max(255, 'Too long').optional(),
  dates: z.string().trim().max(100, 'Too long').optional(),
})

// Rows with a blank title/school are dropped rather than rejected — an empty
// row is what a repeating-row editor produces when the recruiter adds a row
// and removes it, or leaves a trailing blank row unfilled; there is nothing
// to save, not an error to surface.
const workExperienceArraySchema = z
  .array(workExperienceRowSchema)
  .transform((rows) => rows.filter((r) => r.title.length > 0))
  .optional()

const educationArraySchema = z
  .array(educationRowSchema)
  .transform((rows) => rows.filter((r) => r.school.length > 0))
  .optional()

export const editCandidateSchema = createCandidateSchema
  .omit({
    consent_basis: true,
    consent_confirmed: true,
  })
  .extend({
    seniority_level: seniorityLevelSchema,
    years_experience: yearsExperienceSchema,
    salary_current_estimate: salaryStringSchema,
    salary_expectation: salaryStringSchema,
    headline: headlineSchema,
    about: aboutSchema,
    skills: tagArraySchema,
    sector_tags: tagArraySchema,
    work_experience: workExperienceArraySchema,
    education: educationArraySchema,
  })

export type EditCandidateInput = ReturnType<typeof editCandidateSchema.parse>

// Row types for the two repeating-row array editors (work_experience,
// education) — exported so 07-04's components and this schema cannot drift
// on the {title,company,dates} / {school,degree,dates} shape.
export type WorkExperienceRow = z.infer<typeof workExperienceRowSchema>
export type EducationRow = z.infer<typeof educationRowSchema>

export {
  MARKET_STATUS_VALUES,
  MARKET_STATUS_LABELS,
  CANDIDATE_SOURCE_VALUES,
  CANDIDATE_SOURCE_LABELS,
} from '../../new/schema'
