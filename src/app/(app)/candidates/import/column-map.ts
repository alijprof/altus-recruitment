// CSV column-mapping for the candidate import wizard.
//
// HEADER_ALIASES maps every known synonym (normalised to lowercase+trimmed) to
// the canonical CreateCandidateInput field name. The importer calls
// Papa.parse with `transformHeader: h => h.trim().toLowerCase()` so all
// incoming header keys are already normalised before mapRow touches them.
//
// CSV-injection guard (T-05-03-01): PapaParse yields plain strings. No
// eval/formula execution happens here — we treat every cell value as an
// inert string regardless of leading characters (=, +, -, @, etc.).
// Validation (Zod) inside createCandidate enforces field constraints before
// the DB write.

export const HEADER_ALIASES: Record<string, string> = {
  // full_name
  'first name': 'full_name',
  firstname: 'full_name',
  'first_name': 'full_name',
  name: 'full_name',
  'full name': 'full_name',
  'full_name': 'full_name',
  candidate: 'full_name',
  // email
  email: 'email',
  'email address': 'email',
  'email_address': 'email',
  'e-mail': 'email',
  'e_mail': 'email',
  // phone
  phone: 'phone',
  mobile: 'phone',
  telephone: 'phone',
  tel: 'phone',
  // location
  location: 'location',
  city: 'location',
  town: 'location',
  // current_role_title
  role: 'current_role_title',
  title: 'current_role_title',
  'current role': 'current_role_title',
  'current_role': 'current_role_title',
  'job title': 'current_role_title',
  'job_title': 'current_role_title',
  position: 'current_role_title',
  // current_company
  company: 'current_company',
  employer: 'current_company',
  'current company': 'current_company',
  'current_company': 'current_company',
  organisation: 'current_company',
  organization: 'current_company',
}

export type MappedCandidate = {
  full_name: string
  email: string | null
  phone: string | null
  location: string | null
  current_role_title: string | null
  current_company: string | null
}

/**
 * Map a PapaParse row (keys already lowercased + trimmed) to a MappedCandidate.
 *
 * Returns null when no resolvable full_name can be found — callers must skip
 * null rows and count them as skippedNoName.
 *
 * Security note: cell values are treated as plain strings throughout. Leading
 * formula characters (=, +, -, @) are intentionally left in place and stored
 * verbatim — the application never evaluates them.
 */
export function mapRow(row: Record<string, string>): MappedCandidate | null {
  const mapped: Record<string, string | null> = {
    full_name: null,
    email: null,
    phone: null,
    location: null,
    current_role_title: null,
    current_company: null,
  }

  for (const [header, value] of Object.entries(row)) {
    const canonical = HEADER_ALIASES[header.trim().toLowerCase()]
    if (!canonical) continue
    // Only set the canonical field if not already set (first-match wins, so
    // 'name' takes precedence over a later 'full name' column if both exist).
    if (mapped[canonical] === null && value !== undefined) {
      const trimmed = String(value).trim()
      mapped[canonical] = trimmed.length > 0 ? trimmed : null
    }
  }

  // A row with no full_name is un-importable — return null for the caller to
  // count as skippedNoName.
  if (!mapped['full_name']) return null

  return {
    full_name: mapped['full_name'] as string,
    email: mapped['email'] ?? null,
    phone: mapped['phone'] ?? null,
    location: mapped['location'] ?? null,
    current_role_title: mapped['current_role_title'] ?? null,
    current_company: mapped['current_company'] ?? null,
  }
}

/**
 * Detect which canonical fields are present in a set of CSV headers.
 * Used by the wizard to render the column-mapping preview.
 */
export function detectMapping(headers: string[]): Record<string, string | null> {
  const detected: Record<string, string | null> = {
    full_name: null,
    email: null,
    phone: null,
    location: null,
    current_role_title: null,
    current_company: null,
  }

  for (const header of headers) {
    const norm = header.trim().toLowerCase()
    const canonical = HEADER_ALIASES[norm]
    if (canonical && detected[canonical] === null) {
      detected[canonical] = header // store original header (for display)
    }
  }

  return detected
}
