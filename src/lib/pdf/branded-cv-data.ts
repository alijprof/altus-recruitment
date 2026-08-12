// Contact-stripping data mapper for the agency-branded CV (BCV-03). Turns a
// `candidates` row — or any unknown/hostile value masquerading as one —
// into exactly the fields the branded template is allowed to see.
//
// WHY the output type has no email/phone/salary fields: BCV-03's "email and
// phone never render" guarantee is worth far more as a TYPE-LEVEL property
// than as a rendering discipline. If `BrandedCvData` physically cannot
// express a contact detail, no future template edit can leak one — see the
// `@ts-expect-error` compile pins and the full-serialisation runtime pin in
// tests/unit/lib/pdf/branded-cv-data.test.ts.
//
// Locked scope (08-CONTEXT.md, founder 2026-08-12 — settled, not revisited):
//   STRIPPED: email, phone.
//   KEPT: location — city/region ("Manchester, UK"), not a contact route.
//     Research Assumption A1 Reading B, CONFIRMED by the founder.
//   EXCLUDED (deliberate allowlist, not an oversight): salary_current_estimate,
//     salary_expectation, currency — commercially sensitive negotiating
//     information that must never reach a client-facing document.
//   NOT SCRUBBED: free text in headline/about. A regex scrubber's false
//     positives mangle legitimate recruiter-authored content and its false
//     negatives create false confidence — see BRANDED_CV_FREE_TEXT_WARNING
//     below, which is the UI-facing mitigation instead.
//
// NO `import 'server-only'` — must be importable from vitest, RSC and
// Server Actions alike (same constraint as parse-messages.ts and
// cv-file-display.ts). No external dependencies.
//
// `toBrandedCvData` accepts `unknown` rather than `Tables<'candidates'>`
// because `work_experience`/`education` are `Json` in the generated types
// (i.e. unknown at runtime) — this coercion must validate, never assume,
// exactly like `markCandidateFieldsFromCV` does on the write side. Every
// output object below is built with EXPLICIT LITERAL KEYS — never a spread
// of untrusted input — which is what makes both the contact-strip guarantee
// and the prototype-pollution safety true by construction, not a special
// case to remember.

export type BrandedWorkEntry = {
  title: string
  company: string
  dates: string
}

export type BrandedEducationEntry = {
  school: string
  degree: string
  dates: string
}

// Exactly these keys and nothing else — the compile-time half of BCV-03's
// guarantee. Do not add email/phone/salary fields here; see header comment.
export type BrandedCvData = {
  fullName: string
  headline: string | null
  location: string | null
  currentRoleTitle: string | null
  currentCompany: string | null
  seniorityLevel: string | null
  yearsExperience: number | null
  about: string | null
  skills: string[]
  sectorTags: string[]
  work: BrandedWorkEntry[]
  education: BrandedEducationEntry[]
}

// Shown at the Generate control. Contact fields are removed automatically,
// but free text (headline/about) is recruiter- or candidate-authored prose
// that could, in principle, contain a phone number or email typed directly
// into it. This module deliberately does NOT attempt regex scrubbing of
// free text: false positives (a UK-phone-shaped reference number, a
// postcode-shaped substring) would mangle legitimate content the recruiter
// wrote deliberately, and false negatives create false confidence — a
// scrubber that catches 90% of patterns is worse than no scrubber, because
// it invites trusting an unverified guarantee. This mirrors the project's
// "recruiter judgment, not automation" posture for anything subjective.
export const BRANDED_CV_FREE_TEXT_WARNING =
  'Contact fields are removed automatically. Check the headline and summary text yourself before sending — a recruiter or candidate can type a phone number or email into prose.'

const MAX_NAME_LENGTH = 120
const MAX_HEADLINE_LENGTH = 200
const MAX_ABOUT_LENGTH = 2500
const MAX_STRING_LENGTH = 200
const MAX_WORK_ENTRIES = 20
const MAX_EDUCATION_ENTRIES = 12
const MAX_SKILLS = 60
const MAX_SECTOR_TAGS = 12

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads a string field, trimmed and length-capped. Never throws. */
function str(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

/**
 * Like str() but always returns a string (empty when absent/invalid) — for
 * required sub-entry fields (title/company/dates, school/degree/dates)
 * where the caller's "all fields blank" check decides whether to keep the
 * whole entry.
 */
function entryStr(value: unknown, maxLength: number): string {
  return str(value, maxLength) ?? ''
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Reads a single named field off an untrusted object, explicitly refusing
 * `__proto__`/`constructor`/`prototype`. Every caller below reads a fixed,
 * known field name — never an attacker-controlled key — so this is a
 * defence-in-depth belt on top of the "never spread untrusted input"
 * discipline the header comment describes, not the only thing standing
 * between hostile jsonb and prototype pollution.
 */
function safeField(entry: Record<string, unknown>, key: string): unknown {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined
  return Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : undefined
}

/**
 * Coerces an unknown value into a deduplicated, trimmed, capped string
 * array. Non-array input, non-string members, and blank strings all
 * degrade gracefully rather than throwing or polluting the output.
 */
function strArray(value: unknown, maxLength: number, cap: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const cleaned = str(item, maxLength)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
    if (out.length >= cap) break
  }
  return out
}

function workEntries(value: unknown): BrandedWorkEntry[] {
  if (!Array.isArray(value)) return []
  const out: BrandedWorkEntry[] = []
  for (const raw of value) {
    if (!isPlainObject(raw)) continue
    const title = entryStr(safeField(raw, 'title'), MAX_STRING_LENGTH)
    const company = entryStr(safeField(raw, 'company'), MAX_STRING_LENGTH)
    const dates = entryStr(safeField(raw, 'dates'), MAX_STRING_LENGTH)
    if (!title && !company && !dates) continue
    out.push({ title, company, dates })
    if (out.length >= MAX_WORK_ENTRIES) break
  }
  return out
}

function educationEntries(value: unknown): BrandedEducationEntry[] {
  if (!Array.isArray(value)) return []
  const out: BrandedEducationEntry[] = []
  for (const raw of value) {
    if (!isPlainObject(raw)) continue
    const school = entryStr(safeField(raw, 'school'), MAX_STRING_LENGTH)
    const degree = entryStr(safeField(raw, 'degree'), MAX_STRING_LENGTH)
    const dates = entryStr(safeField(raw, 'dates'), MAX_STRING_LENGTH)
    if (!school && !degree && !dates) continue
    out.push({ school, degree, dates })
    if (out.length >= MAX_EDUCATION_ENTRIES) break
  }
  return out
}

/**
 * Builds the allowlisted, contact-stripped view of a candidate row that the
 * branded template is allowed to see. Accepts `unknown` and never throws,
 * even on a hostile or malformed value — every output object is built with
 * explicit literal keys, never a spread of the input, so email/phone/salary
 * can never leak through even if somehow present on `candidate`.
 */
export function toBrandedCvData(candidate: unknown): BrandedCvData {
  const row = isPlainObject(candidate) ? candidate : {}

  return {
    fullName: str(safeField(row, 'full_name'), MAX_NAME_LENGTH) ?? '',
    headline: str(safeField(row, 'headline'), MAX_HEADLINE_LENGTH),
    location: str(safeField(row, 'location'), MAX_STRING_LENGTH),
    currentRoleTitle: str(safeField(row, 'current_role_title'), MAX_STRING_LENGTH),
    currentCompany: str(safeField(row, 'current_company'), MAX_STRING_LENGTH),
    seniorityLevel: str(safeField(row, 'seniority_level'), MAX_STRING_LENGTH),
    yearsExperience: num(safeField(row, 'years_experience')),
    about: str(safeField(row, 'about'), MAX_ABOUT_LENGTH),
    skills: strArray(safeField(row, 'skills'), MAX_STRING_LENGTH, MAX_SKILLS),
    sectorTags: strArray(safeField(row, 'sector_tags'), MAX_STRING_LENGTH, MAX_SECTOR_TAGS),
    work: workEntries(safeField(row, 'work_experience')),
    education: educationEntries(safeField(row, 'education')),
  }
}
