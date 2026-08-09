// "Would Postgres/PostgREST accept this?" — a pure, test-only classifier.
//
// PII discipline: this classifier's output is written into a committed
// markdown report by plan 06-02 (a forensic replay over REAL, if anonymised,
// production candidate data shapes). A finding MUST NEVER copy a payload
// STRING VALUE into itself — only structural metadata (`rule`, `path`,
// `code`, `severity`) and, for numeric-range findings only, the offending
// number itself (never a string, never PII). Enforced by the "PII
// discipline" describe block in tests/unit/lib/pg-legality.test.ts.
//
// This file lives under tests/ and is imported only by tests and the
// forensic runner (plan 06-02). It is deliberately NOT production
// validation — production correctness is proved by writing to a real
// Postgres (plan 06-05), per 06-RESEARCH.md §"Don't Hand-Roll". The rules
// below encode the 25-row verified failure matrix from that research
// (Postgres 17.6 + PostgREST v14.5, empirically reproduced against a real
// local Supabase stack — 06-RESEARCH.md §"Verified failure matrix").

export type PgLegalityCode = '22P05' | 'PGRST102' | '22P02' | '22003' | 'TypeError' | null

export type PgLegalityFinding = {
  rule: string
  path: string // JSON path, e.g. 'work_history[0].summary'
  code: PgLegalityCode
  severity: 'fail' | 'warn'
  value?: number // ONLY for numeric-range findings — never a string value
}

// Lone-surrogate regex (ES2018 lookbehind, verified to run on Node 24 —
// 06-RESEARCH.md §interfaces). Constructed fresh per call below rather than
// reused as a module-level `g`-flagged instance, because `RegExp.test()`
// with the `g` flag carries `lastIndex` state across calls — reusing one
// instance would silently skip matches on the second and later strings
// scanned in the same recursive walk.
const LONE_SURROGATE_SOURCE =
  '[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]'

function hasLoneSurrogate(s: string): boolean {
  return new RegExp(LONE_SURROGATE_SOURCE, 'g').test(s)
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key
}

function indexPath(base: string, i: number): string {
  return `${base}[${i}]`
}

// Int4 upper bound — salary_current_estimate / salary_expectation are
// Postgres `integer` columns (migration 20260513152244). Only the upper
// bound is verified in the failure matrix (row 12); no lower-bound or
// CHECK-constraint rejection was observed, so none is encoded here.
const INT4_MAX = 2_147_483_647

// numeric(4,1) overflow cliff — years_experience is numeric(4,1), so any
// absolute value >= 1000 fails to fit (precision 4, scale 1). Verified at
// exactly 1000 (row 15) and above (row 14, 2015).
const YEARS_OVERFLOW_ABS = 1000

// Walks every string VALUE and every object KEY at any depth, checking each
// against the two verified Unicode illegalities. This is the widest funnel:
// it covers the WHOLE `extracted_data` jsonb write, regardless of which
// typed column (if any) a given field also maps to (06-RESEARCH.md
// Pattern 1). Keys are checked too — a NUL in an object key is just as
// fatal as one in a value (verified matrix row 2).
function scanForUnicodeIllegalities(value: unknown, path: string, out: PgLegalityFinding[]): void {
  if (typeof value === 'string') {
    if (value.includes('\u0000')) {
      out.push({ rule: 'nul-in-string', path, code: '22P05', severity: 'fail' })
    }
    if (hasLoneSurrogate(value)) {
      out.push({ rule: 'lone-surrogate', path, code: 'PGRST102', severity: 'fail' })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanForUnicodeIllegalities(item, indexPath(path, i), out))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key.includes('\u0000')) {
        out.push({ rule: 'nul-in-key', path: joinPath(path, key), code: '22P05', severity: 'fail' })
      } else if (hasLoneSurrogate(key)) {
        out.push({
          rule: 'lone-surrogate',
          path: joinPath(path, key),
          code: 'PGRST102',
          severity: 'fail',
        })
      }
      scanForUnicodeIllegalities(v, joinPath(path, key), out)
    }
  }
}

// salary_current_estimate / salary_expectation: integer columns written
// from an unvalidated cast (candidate-cvs.ts). Verified rules:
//   - a non-integer number (float)         -> 22P02 (row 11)
//   - an integer > INT4_MAX                -> 22003 (row 12)
//   - a non-numeric string ("£45,000")     -> 22P02 (row 10)
//   - an object or array shape             -> 22P02 (row 13)
//   - a clean numeric string ("45000")     -> coerced cleanly, no finding (row 19)
function checkSalaryField(value: unknown, path: string, out: PgLegalityFinding[]): void {
  if (value === undefined || value === null) return

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      out.push({ rule: 'salary-invalid-type', path, code: '22P02', severity: 'fail', value })
      return
    }
    if (value > INT4_MAX) {
      out.push({ rule: 'salary-out-of-range', path, code: '22003', severity: 'fail', value })
    }
    return
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed)
      if (Number.isSafeInteger(n) && n <= INT4_MAX) return
      out.push({ rule: 'salary-out-of-range', path, code: '22003', severity: 'fail' })
      return
    }
    out.push({ rule: 'salary-invalid-type', path, code: '22P02', severity: 'fail' })
    return
  }

  // Object, array, boolean, etc. — none of these coerce to an integer.
  out.push({ rule: 'salary-invalid-type', path, code: '22P02', severity: 'fail' })
}

// years_experience_total: numeric(4,1) column. Verified rules:
//   - |v| >= 1000 (number or numeric string) -> 22003 "numeric field overflow" (rows 14, 15)
//   - a non-numeric string ("10+")           -> 22P02 (row 16)
//   - 999.9 / 12.75                          -> legal, rounds silently, no finding (row 20)
function checkYearsExperienceField(value: unknown, path: string, out: PgLegalityFinding[]): void {
  if (value === undefined || value === null) return

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      out.push({ rule: 'years-invalid-type', path, code: '22P02', severity: 'fail' })
      return
    }
    if (Math.abs(value) >= YEARS_OVERFLOW_ABS) {
      out.push({ rule: 'years-overflow', path, code: '22003', severity: 'fail', value })
    }
    return
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed)
      if (Math.abs(n) >= YEARS_OVERFLOW_ABS) {
        out.push({ rule: 'years-overflow', path, code: '22003', severity: 'fail', value: n })
      }
      return
    }
    out.push({ rule: 'years-invalid-type', path, code: '22P02', severity: 'fail' })
    return
  }

  out.push({ rule: 'years-invalid-type', path, code: '22P02', severity: 'fail' })
}

// candidates.name is a string that `.trim()` is called on downstream
// (candidate-cvs.ts:440) — anything else throws a TypeError before any DB
// call happens (verified: JavaScript-level failures, not a Postgres code).
function checkNameField(value: unknown, path: string, out: PgLegalityFinding[]): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'string') {
    out.push({ rule: 'name-not-string', path, code: 'TypeError', severity: 'fail' })
  }
}

// work_history: an array mapped element-by-element onto
// candidates.work_experience. A null (or otherwise non-object) element
// throws when the mapper reads `.role` off it — a JavaScript TypeError, not
// a Postgres rejection (verified: JavaScript-level failures).
function checkWorkHistoryField(value: unknown, path: string, out: PgLegalityFinding[]): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) return
  value.forEach((item, i) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') {
      out.push({
        rule: 'work-history-null-element',
        path: indexPath(path, i),
        code: 'TypeError',
        severity: 'fail',
      })
    }
  })
}

// education: same shape and same mapper pattern as work_history
// (candidate-cvs.ts mapEducation) — a null/non-object element is the same
// class of defect, kept as a distinct rule name for a precise error message.
function checkEducationField(value: unknown, path: string, out: PgLegalityFinding[]): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) return
  value.forEach((item, i) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') {
      out.push({
        rule: 'education-null-element',
        path: indexPath(path, i),
        code: 'TypeError',
        severity: 'fail',
      })
    }
  })
}

// skills / sector_tags: text[] columns. Verified rules:
//   - a 2-D array (an array element that is itself an array) -> 22P02 "malformed JSON array" (row 17)
//   - an array of OBJECTS -> WRITES SUCCESSFULLY, silently stored as JSON
//     text per element (row 21) — a Tier-3 data-corruption WARN, not a
//     write failure. code is deliberately `null`: nothing rejects the write.
//   - numbers / null elements -> coerced silently, no finding (row 22)
function checkTextArrayField(value: unknown, path: string, out: PgLegalityFinding[]): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) return
  value.forEach((item, i) => {
    if (Array.isArray(item)) {
      out.push({ rule: 'nested-array', path: indexPath(path, i), code: '22P02', severity: 'fail' })
      return
    }
    if (item !== null && typeof item === 'object') {
      out.push({
        rule: 'skills-object-elements',
        path: indexPath(path, i),
        code: null,
        severity: 'warn',
      })
    }
    // Strings, numbers and null elements are coerced/stored cleanly.
  })
}

/**
 * Classifies a parsed candidate-CV payload (Claude's tool-use output,
 * pre-write) against the verified Postgres 17.6 + PostgREST v14.5 failure
 * matrix. Returns one finding per violation found; an empty array means the
 * payload would write cleanly.
 *
 * Two passes:
 *   1. A universal Unicode-illegality scan over every string value and
 *      object key, at any depth — this covers the `extracted_data` jsonb
 *      write, which carries the entire object.
 *   2. Typed-column rules keyed on the specific top-level fields that
 *      `markCandidateFieldsFromCV` maps onto real, typed Postgres columns.
 */
export function classifyForPostgres(parsed: unknown): PgLegalityFinding[] {
  const findings: PgLegalityFinding[] = []

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return findings
  }

  const record = parsed as Record<string, unknown>

  scanForUnicodeIllegalities(record, '', findings)

  checkSalaryField(record.salary_current_estimate, 'salary_current_estimate', findings)
  checkSalaryField(record.salary_expectation, 'salary_expectation', findings)
  checkYearsExperienceField(record.years_experience_total, 'years_experience_total', findings)
  checkNameField(record.name, 'name', findings)
  checkWorkHistoryField(record.work_history, 'work_history', findings)
  checkEducationField(record.education, 'education', findings)
  checkTextArrayField(record.skills, 'skills', findings)
  checkTextArrayField(record.sector_tags, 'sector_tags', findings)

  return findings
}
