/**
 * Synthetic Claude tool-use outputs — one entry per verified failure class
 * from 06-RESEARCH.md's "Verified failure matrix" (Postgres 17.6 + PostgREST
 * v14.5, empirically reproduced against a real local Supabase stack this
 * phase). Consumed by tests/integration/cv-write-path.test.ts, which looks
 * entries up by `id` and drives the REAL updateCandidateCVParse /
 * markCandidateFieldsFromCV helpers with them.
 *
 * WARNING — do not "clean up" the strings below. Several payloads carry a
 * literal U+0000 (NUL) or an unpaired UTF-16 surrogate half, constructed
 * with explicit \u escapes. Some editors, formatters, and "normalise
 * whitespace" tooling silently strip or repair these bytes. If a payload
 * here stops reproducing the failure it claims to reproduce, that is a
 * BROKEN FIXTURE, not a fixed bug — 06-RESEARCH.md §"Anti-Patterns to
 * Avoid" flags exactly this failure mode for the PDF fixture generator, and
 * the same discipline applies here. Verify with
 * `node -e "console.log([...'<the string>'].length)"` if in doubt, or trust
 * tests/integration/cv-write-path.test.ts itself — it is the executable
 * proof this table stays honest.
 *
 * PII discipline: every payload below is synthetic (Jane Doe / Acme /
 * example.com), matching the corpus-wide identity rules from plan 06-03.
 * Nothing here was copied from a real candidate CV or a real production row
 * — see 06-FORENSICS.md, which found all 12 real failed rows extract
 * cleanly and never persisted their Claude output anywhere this file could
 * have been derived from.
 *
 * `expectedCodeToday` documents behaviour BEFORE plans 06-06/06-07 land the
 * Postgres-legality sanitiser and coercion boundary:
 *   - a Postgres SQLSTATE (e.g. '22P05', '22003', '22P02')
 *   - a PostgREST-layer code with no SQLSTATE at all ('PGRST102')
 *   - the literal string 'TypeError' for a JavaScript-level throw that
 *     never reaches Postgres or PostgREST
 *   - `null` when the payload already writes cleanly today — a negative
 *     control the eventual fix must never break
 */

export type HostilePayloadEntry = {
  id: string
  failureClass: string
  payload: unknown
  why: string
  expectedCodeToday: string | null
}

export const HOSTILE_PAYLOADS: HostilePayloadEntry[] = [
  // -------------------------------------------------------------------
  // C1 — NUL (U+0000) inside extracted_data jsonb. Verified matrix rows
  // 1-3. Target: updateCandidateCVParse (candidate_cvs.extracted_data).
  // Widest funnel: the whole Claude tool-use output is written verbatim
  // into this one jsonb column.
  // -------------------------------------------------------------------
  {
    id: 'C1a',
    failureClass: 'C1 — NUL in an extracted_data STRING VALUE',
    payload: { name: 'Jane\u0000Doe', confidence_per_field: {} },
    why: 'mammoth and unpdf are both verified to emit a literal U+0000 from real-world DOCX/PDF artefacts (06-RESEARCH.md §Code Examples: a broken ToUnicode CMap, or a raw/entity-encoded NUL inside a <w:t> run). Postgres rejects U+0000 in any text/jsonb write with 22P05.',
    expectedCodeToday: '22P05',
  },
  {
    id: 'C1b',
    failureClass: 'C1 — NUL in an extracted_data object KEY',
    payload: { ['bad\u0000key']: 'value', name: 'Jane Doe', confidence_per_field: {} },
    why: 'row 2 of the verified matrix: a NUL in an object KEY is exactly as fatal as one in a value — a sanitiser that only walks values misses this class.',
    expectedCodeToday: '22P05',
  },
  {
    id: 'C1c',
    failureClass: 'C1 — NUL nested at work_history[0].summary',
    payload: {
      name: 'Jane Doe',
      work_history: [{ role: 'Dev', summary: 'Text\u0000here' }],
      confidence_per_field: {},
    },
    why: 'row 3 of the verified matrix: the sanitiser must recurse into nested arrays/objects, not just top-level fields.',
    expectedCodeToday: '22P05',
  },
  // -------------------------------------------------------------------
  // C2 — lone UTF-16 surrogate half inside extracted_data jsonb. Verified
  // rows 4-5. Rejected by PostgREST BEFORE Postgres ever sees the request
  // — a classifier keyed only on Postgres SQLSTATEs misses this class
  // entirely.
  // -------------------------------------------------------------------
  {
    id: 'C2a',
    failureClass: 'C2 — lone HIGH surrogate (\\uD83D) in extracted_data',
    payload: { name: '\uD83D', confidence_per_field: {} },
    why: 'a truncated multi-token emoji echoed back by Claude can leave an unpaired high surrogate half; PostgREST rejects the entire JSON body as "Empty or invalid json" before Postgres is ever reached.',
    expectedCodeToday: 'PGRST102',
  },
  {
    id: 'C2b',
    failureClass: 'C2 — lone LOW surrogate (\\uDE00) in extracted_data',
    payload: { name: '\uDE00', confidence_per_field: {} },
    why: 'same mechanism as C2a, from the other half of a surrogate pair.',
    expectedCodeToday: 'PGRST102',
  },
  // -------------------------------------------------------------------
  // C3 — years_experience_total numeric(4,1) overflow. Verified rows
  // 14-15 (the cliff is exactly |v| >= 1000) and row 20 (999.9/12.75 are
  // legal). Target: markCandidateFieldsFromCV (candidates.years_experience).
  // -------------------------------------------------------------------
  {
    id: 'C3a',
    failureClass: 'C3 — years_experience_total as a calendar year (2015)',
    payload: { years_experience_total: 2015 },
    why: "the extract_cv_fields tool schema's years_experience_total has no description and no bounds (src/lib/ai/claude.ts:273) — a Haiku mis-read of a graduation year overflows numeric(4,1).",
    expectedCodeToday: '22003',
  },
  {
    id: 'C3b',
    failureClass: 'C3 — years_experience_total at the exact overflow cliff (1000)',
    payload: { years_experience_total: 1000 },
    why: 'row 15: 1000 is the exact cliff — numeric(4,1) requires |v| to round to something under 10^3.',
    expectedCodeToday: '22003',
  },
  {
    id: 'C3c',
    failureClass: 'C3 negative control — years_experience_total 999.9 is legal',
    payload: { years_experience_total: 999.9 },
    why: 'row 20: just under the cliff, writes cleanly today — a future fix must never mangle this.',
    expectedCodeToday: null,
  },
  {
    id: 'C3d',
    failureClass: 'C3 negative control — years_experience_total 12.5 is legal',
    payload: { years_experience_total: 12.5 },
    why: 'an ordinary duration value — writes cleanly today.',
    expectedCodeToday: null,
  },
  // -------------------------------------------------------------------
  // C4 — salary_current_estimate / salary_expectation integer-column
  // violations. Verified rows 10-13, 19. Target: markCandidateFieldsFromCV
  // (candidates.salary_current_estimate / candidates.salary_expectation).
  // -------------------------------------------------------------------
  {
    id: 'C4a',
    failureClass: 'C4 — salary_current_estimate as a currency-formatted string',
    payload: { salary_current_estimate: '£45,000' },
    why: 'row 10: Postgres cannot implicitly cast "£45,000" text to an integer column.',
    expectedCodeToday: '22P02',
  },
  {
    id: 'C4b',
    failureClass: 'C4 — salary_current_estimate as a float',
    payload: { salary_current_estimate: 45000.5 },
    why: 'row 11: salary_current_estimate is a Postgres int4 column (migration 20260513152244); a float fails to cast.',
    expectedCodeToday: '22P02',
  },
  {
    id: 'C4c',
    failureClass: 'C4 — salary_current_estimate exceeding the int4 range',
    payload: { salary_current_estimate: 3_000_000_000 },
    why: 'row 12: 3,000,000,000 exceeds the int4 max (2,147,483,647).',
    expectedCodeToday: '22003',
  },
  {
    id: 'C4d',
    failureClass: 'C4 — salary_expectation as an object shape ({min,max})',
    payload: { salary_expectation: { min: 40000, max: 50000 } },
    why: 'row 13: an object shape cannot cast to integer at all.',
    expectedCodeToday: '22P02',
  },
  {
    id: 'C4e',
    failureClass: 'C4 negative control — salary_current_estimate as a clean numeric string',
    payload: { salary_current_estimate: '45000' },
    why: 'row 19: PostgREST/Postgres coerce a clean numeric string cleanly today — a future fix must keep this working.',
    expectedCodeToday: null,
  },
  // -------------------------------------------------------------------
  // C5 — JavaScript-level shape violations in markCandidateFieldsFromCV,
  // thrown BEFORE any Postgres call — no SQLSTATE at all.
  // -------------------------------------------------------------------
  {
    id: 'C5a',
    failureClass: 'C5 — name returned as an array instead of a string',
    payload: { name: ['Jane', 'Doe'] },
    why: 'src/lib/db/candidate-cvs.ts calls (args.parsed.name ?? "").trim() — an array has no .trim(), throwing an uncaught TypeError out of the helper.',
    expectedCodeToday: 'TypeError',
  },
  {
    id: 'C5b',
    failureClass: 'C5 — work_history containing a null element',
    payload: { work_history: [null, { role: 'Dev' }] },
    why: 'mapWorkHistory reads item.role without a null guard — a null array element throws "Cannot read properties of null".',
    expectedCodeToday: 'TypeError',
  },
  // -------------------------------------------------------------------
  // Silent-corruption contract (Tier-3 violation per 06-CONTEXT.md — NOT
  // a write failure today, which is exactly the problem). Row 21.
  // -------------------------------------------------------------------
  {
    id: 'SKILLS-OBJ',
    failureClass: 'Silent corruption — skills as an array of objects',
    payload: { skills: [{ name: 'Python' }] },
    why: 'row 21: writes successfully today but silently stores the JSON text \'{"name":"Python"}\' as a skills[] element — data corruption, not a write failure, and therefore invisible to any check that only looks at result.ok.',
    expectedCodeToday: null,
  },
  // -------------------------------------------------------------------
  // Error-detail contract — a write that can NEVER succeed (invalid enum
  // value). Proves DbResult carries a `detail` field with the SQLSTATE +
  // column once plan 06-06/06-07 widens the type; today there is no
  // `detail` field on DbResult at all (src/lib/db/types.ts).
  // -------------------------------------------------------------------
  {
    id: 'BAD-ENUM',
    failureClass: 'Error-detail contract — invalid cv_parsing_status enum value',
    payload: 'done',
    why: "cv_parsing_status only has pending|complete|failed (migration 20260513152244) — an invalid value can never succeed, so the contract under test is that DbResult.detail carries the SQLSTATE + column, NOT that the write eventually passes.",
    expectedCodeToday: '22P02',
  },
]
