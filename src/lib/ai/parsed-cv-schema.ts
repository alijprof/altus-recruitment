import { z } from 'zod'

// ---------------------------------------------------------------------------
// THE COERCION BOUNDARY — where Claude's probabilistic tool output crosses
// into a strongly-typed system whose fields land in real, bounded Postgres
// columns.
//
// Why this module exists: `parseCV()` used to end with `toolUse.input as
// ParsedCV`. TypeScript asserted a shape nobody validated, so a Haiku
// mis-read (a graduation year returned as years-of-experience, a salary as
// "£45,000", a name as an array) travelled all the way to the database and
// blew up the write — 16% of one customer's bulk back-book upload, all 12
// failures landing AFTER a successful Claude call (06-FORENSICS.md).
//
// PURE module by design: NO `import 'server-only'`. Both the AI layer
// (claude.ts) and the DB layer (candidate-cvs.ts, which re-coerces STORED
// extracted_data written before this boundary existed) import it, as do the
// unit tests.
//
// Two invariants govern everything below:
//
//   1. COERCE, NEVER REJECT. Every field is independently guarded; a single
//      unusable field is dropped, never escalated into a whole-parse
//      failure. Trading a Tier-3 "silent empty profile" bug for a Tier-3
//      "whole CV lost" bug is not a fix (06-RESEARCH.md Pitfall 2).
//
//   2. NEVER INVENT DATA. A value that cannot be represented honestly is
//      DROPPED, not clamped. Clamping a mis-read calendar year (2015) to the
//      column maximum would write a fabricated fact onto a candidate record
//      — worse than an empty field, and invisible to the recruiter who would
//      have to trust it.
//
// Anti-pattern deliberately avoided: bare `z.coerce.number()`. It THROWS on
// an uncoercible value, which (per invariant 1) would convert one bad field
// into a failed parse. Every field here is a total function of its input.
// ---------------------------------------------------------------------------

// --- Column bounds. Each derives from the ACTUAL column type. --------------

// candidates.salary_current_estimate / salary_expectation:
//   `integer` (int4) — migration 20260513152244 lines 213-214.
// int4 max; anything above it raises 22003 on write.
const INT4_MAX = 2_147_483_647

// candidates.years_experience:
//   `numeric(4, 1)` — migration 20260513152244 line 217.
// Precision 4 / scale 1 means the stored value must round to something with
// at most 3 integral digits: |v| < 1000. 1000 is the exact overflow cliff
// (verified against local Postgres 17.6 — 06-RESEARCH.md verified matrix
// rows 14-15), 999.9 is legal (row 20).
const YEARS_EXPERIENCE_EXCLUSIVE_MAX = 1000

// The seven values in the extract_cv_fields tool schema's seniority_level
// enum (src/lib/ai/claude.ts). candidates.seniority_level is `text`, so an
// off-enum value would not fail the write — it would silently pollute a
// field the UI filters on, which is why it is dropped rather than stored.
const SENIORITY_LEVELS = [
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'manager',
  'director',
] as const

// --- Field coercers. Total functions: none of them throws, for any input. --
// (zod's `.catch()` does NOT catch a throw raised inside a `.transform()` —
// verified against zod 4 — so "never throws" has to be true by construction
// here, not delegated to the schema.)

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * `name` feeds `(args.parsed.name ?? '').trim()` in markCandidateFieldsFromCV
 * — an array there threw an uncaught TypeError out of the whole write helper
 * (06-RESEARCH.md class C5a). A string passes through untouched; an array of
 * strings is joined (Claude sometimes splits given/family names); everything
 * else is dropped so `.trim()` can never be reached by a non-string.
 */
function coerceName(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const joined = value
      .filter((part): part is string => typeof part === 'string')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' ')
    return joined.length > 0 ? joined : undefined
  }
  return undefined
}

/**
 * Salaries arrive as integers, floats, or human-formatted strings
 * ("£45,000", "45k"). Postgres cannot implicitly cast any of the string
 * forms to `integer` (22P02), and a float fails the same way.
 *
 * Strips currency symbols, spaces (incl. non-breaking), commas and a
 * trailing k/K multiplier, then rounds to the integer the column stores.
 * Negative and out-of-int4-range values are dropped — a negative salary is
 * never a fact worth storing, and an out-of-range one raises 22003.
 */
function coerceSalary(value: unknown): number | undefined {
  let n: number
  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string') {
    // `\s` already covers U+00A0, the non-breaking space Word and PDF
    // exporters emit — so no literal invisible character is needed (or
    // wanted) in this source file.
    const cleaned = value.replace(/[£$€]/g, '').replace(/[\s,]/g, '').trim()
    if (cleaned.length === 0) return undefined
    const kMatch = /^(-?\d+(?:\.\d+)?)[kK]$/.exec(cleaned)
    n = kMatch?.[1] !== undefined ? Number(kMatch[1]) * 1000 : Number(cleaned)
  } else {
    // Objects ({min,max}), arrays ([45000]), booleans, null — no honest
    // single integer exists, so store nothing.
    return undefined
  }
  if (!Number.isFinite(n)) return undefined
  const rounded = Math.round(n)
  if (rounded < 0 || rounded > INT4_MAX) return undefined
  return rounded
}

/**
 * `years_experience_total` was the weakest-specified field in the whole tool
 * schema (no description, no bounds) and the most likely source of the
 * customer's 12 failures: a graduation year read as a duration overflows
 * numeric(4,1) with 22003.
 *
 * DROPPED, never clamped, above the cliff. Clamping 2015 to 999.9 would
 * store a fabricated fact on a candidate record; an empty field is honest.
 * The value is rounded to the one decimal place the column actually stores
 * BEFORE the cliff check, because Postgres rounds to scale first and then
 * checks precision (999.96 -> 1000.0 -> 22003).
 */
function coerceYearsExperience(value: unknown): number | undefined {
  let n: number
  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string') {
    // Leading numeric run only: "10+" -> 10, "10 years" -> 10, "ten" -> drop.
    const match = /^\s*(\d+(?:\.\d+)?)/.exec(value)
    if (!match?.[1]) return undefined
    n = Number(match[1])
  } else {
    return undefined
  }
  if (!Number.isFinite(n)) return undefined
  const rounded = Math.round(n * 10) / 10
  if (rounded < 0 || rounded >= YEARS_EXPERIENCE_EXCLUSIVE_MAX) return undefined
  return rounded
}

/**
 * `skills` / `sector_tags` map onto `text[] not null default '{}'` columns.
 * A non-string element used to be stringified into the array by PostgREST —
 * storing the literal `{"name":"Python"}` as a skill. That is silent
 * corruption, invisible to any check that only looks at `result.ok`, so
 * non-strings are dropped.
 *
 * A non-array input is dropped ENTIRELY (undefined, not []) so the caller's
 * "is this field present?" test stays meaningful. An array that contains no
 * usable strings yields [], which the empty-only merge rule then declines to
 * write.
 */
function coerceStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function coerceObjectArray<K extends string>(
  value: unknown,
  keys: readonly K[],
): Array<Partial<Record<K, string>>> | undefined {
  if (!Array.isArray(value)) return undefined
  const out: Array<Partial<Record<K, string>>> = []
  for (const item of value) {
    // null, primitives and nested arrays are dropped — mapWorkHistory reads
    // `item.role` without a null guard (06-RESEARCH.md class C5b).
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    const mapped: Partial<Record<K, string>> = {}
    for (const key of keys) {
      const fieldValue = asString(source[key])
      if (fieldValue !== undefined) mapped[key] = fieldValue
    }
    out.push(mapped)
  }
  return out
}

const WORK_HISTORY_KEYS = ['company', 'role', 'start_date', 'end_date', 'summary'] as const
const EDUCATION_KEYS = ['institution', 'qualification', 'year'] as const

function coerceSeniority(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return (SENIORITY_LEVELS as readonly string[]).includes(value) ? value : undefined
}

function coerceConfidence(value: unknown): Record<string, 'high' | 'medium' | 'low'> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, 'high' | 'medium' | 'low'> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === 'high' || raw === 'medium' || raw === 'low') out[key] = raw
  }
  return out
}

// --- The schema -------------------------------------------------------------
// Every field is `z.unknown().transform(...)`: the transform is a total
// function, so the object-level parse cannot fail on field content. The
// `.catch()` calls are belt-and-braces for a future edit that makes a
// transform fallible. Unknown keys are stripped by zod's default object
// behaviour — Claude cannot invent a column.

export const parsedCVSchema = z.object({
  name: z.unknown().transform(coerceName).catch(undefined),
  email: z.unknown().transform(asString).catch(undefined),
  phone: z.unknown().transform(asString).catch(undefined),
  location: z.unknown().transform(asString).catch(undefined),
  current_role: z.unknown().transform(asString).catch(undefined),
  current_company: z.unknown().transform(asString).catch(undefined),
  work_history: z
    .unknown()
    .transform((value) => coerceObjectArray(value, WORK_HISTORY_KEYS))
    .catch(undefined),
  skills: z.unknown().transform(coerceStringArray).catch(undefined),
  education: z
    .unknown()
    .transform((value) => coerceObjectArray(value, EDUCATION_KEYS))
    .catch(undefined),
  salary_current_estimate: z.unknown().transform(coerceSalary).catch(undefined),
  salary_expectation: z.unknown().transform(coerceSalary).catch(undefined),
  seniority_level: z.unknown().transform(coerceSeniority).catch(undefined),
  years_experience_total: z.unknown().transform(coerceYearsExperience).catch(undefined),
  sector_tags: z.unknown().transform(coerceStringArray).catch(undefined),
  confidence_per_field: z.unknown().transform(coerceConfidence).catch({}),
})

/**
 * The validated shape of a parsed CV. `name` is OPTIONAL: Claude's tool
 * schema marks it required, but a model can still omit it (or return a
 * shape we refuse to store), and pretending otherwise at the type level is
 * exactly the lie this module exists to end. `confidence_per_field` is the
 * only guaranteed key — coercion always produces at least `{}`.
 */
export type ParsedCV = {
  name?: string
  email?: string
  phone?: string
  location?: string
  current_role?: string
  current_company?: string
  work_history?: Array<{
    company?: string
    role?: string
    start_date?: string
    end_date?: string
    summary?: string
  }>
  skills?: string[]
  education?: Array<{ institution?: string; qualification?: string; year?: string }>
  salary_current_estimate?: number
  salary_expectation?: number
  seniority_level?: string
  years_experience_total?: number
  sector_tags?: string[]
  confidence_per_field: Record<string, 'high' | 'medium' | 'low'>
}

/**
 * Coerce ANY input into a storable `ParsedCV`. Never throws, never rejects:
 * a non-object input (null, a string, a number — a truncated or confused
 * tool response) yields an empty profile, which the truncation guard in
 * `parseCV` then refuses to store as a success.
 *
 * Fields whose value could not be represented honestly are ABSENT from the
 * result rather than present-and-undefined, so `'salary_expectation' in
 * parsed` stays a meaningful question for callers.
 */
export function coerceParsedCV(input: unknown): ParsedCV {
  const result = parsedCVSchema.safeParse(input)
  // Partial<> because the failure branch (a non-object input) contributes no
  // keys at all — without it TypeScript narrows the union to `{}`.
  const parsed: Partial<z.infer<typeof parsedCVSchema>> = result.success ? result.data : {}
  const out: ParsedCV = { confidence_per_field: parsed.confidence_per_field ?? {} }
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'confidence_per_field' || value === undefined)
      continue
      // reason: `parsed` is the output of parsedCVSchema, whose per-field
      // transforms produce exactly the ParsedCV value types; the index write
      // is the one place TypeScript cannot follow that correspondence.
    ;(out as Record<string, unknown>)[key] = value
  }
  return out
}
