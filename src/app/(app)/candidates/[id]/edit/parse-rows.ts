// Permissive parsers for the jsonb work_experience/education columns —
// mirrors candidates/[id]/page.tsx's parseWorkExperience/parseEducation
// (same defensive shape: a malformed historical row is dropped rather than
// crashing the page), but defaults missing sub-fields to '' instead of null.
// RepeatingRows binds every field to a controlled <Input value=... />, which
// cannot take null/undefined, so '' is the right default here specifically
// (the display page's FieldRow, by contrast, wants null so it can render
// its own '—' placeholder).
//
// Co-located with the page and the schema (same convention as
// edit/schema.ts) and kept PURE — no next/*, no supabase — so the
// round-trip-safety rules below are directly testable. They decide whether
// a candidate's stored history can be edited at all, so an untested bug
// here is either a needlessly read-only section or silent data loss.

export type EditableWorkExperienceRow = { title: string; company: string; dates: string }
export type EditableEducationRow = { school: string; degree: string; dates: string }

/**
 * WR-12 (review 2026-08-11) — a display default must not become a
 * data-destroying default.
 *
 * These parsers drop any row whose title/school is not a non-empty string
 * and rebuild every surviving row with exactly three keys. Because the edit
 * action writes the WHOLE array, opening + saving the page would
 * permanently delete any stored row that failed those checks and strip any
 * extra key a past or future writer had stored. Today every writer
 * (mapWorkHistory, mapEducation, the LinkedIn ingest, this action) produces
 * {title,company,dates} with a non-empty title, so this is latent rather
 * than active — but latent data destruction is still data destruction.
 *
 * So each parser also reports whether the round trip is LOSSLESS. When it
 * isn't, the edit page renders that section read-only instead of offering
 * an editor that would silently truncate on save (the second option the
 * review offers; the hidden-passthrough alternative would have to
 * reconstruct positions for rows it cannot even display).
 *
 * `editable: false` is enforced structurally, not by trust: the section's
 * editor is never rendered, so react-hook-form can never mark that field
 * dirty, and CR-01's dirty-field submission therefore never sends it. The
 * column is untouched by definition.
 *
 * null and '' are treated as equivalent for the optional keys — the action
 * writes `row.company || null`, so a stored '' round-trips to null with no
 * change in meaning (both render as the same placeholder).
 */
export type ParsedRows<T> = { rows: T[]; editable: boolean }

function isOptionalText(v: unknown): boolean {
  return v === undefined || v === null || typeof v === 'string'
}

/** Every key present on the row must be one this editor round-trips. */
function hasOnlyKnownKeys(obj: Record<string, unknown>, known: readonly string[]): boolean {
  return Object.keys(obj).every((k) => known.includes(k))
}

const WORK_EXPERIENCE_KEYS = ['title', 'company', 'dates'] as const
const EDUCATION_KEYS = ['school', 'degree', 'dates'] as const

export function parseWorkExperienceRows(raw: unknown): ParsedRows<EditableWorkExperienceRow> {
  // `jsonb not null default '[]'`, but a null tolerates the same as an empty
  // array: nothing stored, nothing to lose, editor fully available.
  if (raw == null) return { rows: [], editable: true }
  if (!Array.isArray(raw)) return { rows: [], editable: false }

  const rows: EditableWorkExperienceRow[] = []
  let editable = true
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      editable = false
      continue
    }
    const obj = r as Record<string, unknown>
    const title = typeof obj.title === 'string' ? obj.title : ''
    if (!title || !hasOnlyKnownKeys(obj, WORK_EXPERIENCE_KEYS)) {
      editable = false
      // A row with no title cannot be displayed at all; one with extra keys
      // can be displayed, just not saved without dropping those keys.
      if (!title) continue
    }
    if (!isOptionalText(obj.company) || !isOptionalText(obj.dates)) {
      editable = false
    }
    rows.push({
      title,
      company: typeof obj.company === 'string' ? obj.company : '',
      dates: typeof obj.dates === 'string' ? obj.dates : '',
    })
  }
  return { rows, editable }
}

export function parseEducationRows(raw: unknown): ParsedRows<EditableEducationRow> {
  if (raw == null) return { rows: [], editable: true }
  if (!Array.isArray(raw)) return { rows: [], editable: false }

  const rows: EditableEducationRow[] = []
  let editable = true
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      editable = false
      continue
    }
    const obj = r as Record<string, unknown>
    const school = typeof obj.school === 'string' ? obj.school : ''
    if (!school || !hasOnlyKnownKeys(obj, EDUCATION_KEYS)) {
      editable = false
      if (!school) continue
    }
    if (!isOptionalText(obj.degree) || !isOptionalText(obj.dates)) {
      editable = false
    }
    rows.push({
      school,
      degree: typeof obj.degree === 'string' ? obj.degree : '',
      dates: typeof obj.dates === 'string' ? obj.dates : '',
    })
  }
  return { rows, editable }
}
