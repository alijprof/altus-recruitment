// ---------------------------------------------------------------------------
// POSTGRES-LEGALITY SANITISER — the last choke point before a CV's parsed
// content crosses into the database.
//
// Postgres rejects exactly TWO things a CV pipeline can realistically
// produce. Verified 2026-08-09 against Postgres 17.6 + PostgREST v14.5, by
// writing each sequence to a real local stack (06-RESEARCH.md verified
// failure matrix):
//
//   U+0000                -> 22P05 "unsupported Unicode escape sequence"
//                            (Postgres rejects NUL in any text/jsonb value)
//   lone UTF-16 surrogate -> PGRST102 "Empty or invalid json"
//                            (rejected by PostgREST BEFORE Postgres sees it —
//                             which is why a classifier keyed only on
//                             SQLSTATEs misses this class entirely)
//
// EVERYTHING ELSE IS LEGAL AND MUST BE PRESERVED: U+0001-U+001F, emoji, ZWJ
// sequences, RTL text, astral-plane glyphs, BOM, soft hyphens, non-breaking
// spaces, 1.1 MB values. This is a CV — the content IS the product. Stripping
// "control characters" wholesale is an anti-pattern: it silently mangles
// candidate data to fix two specific sequences, and the recruiter never finds
// out. Only these two sequences are touched, and the lone surrogate becomes
// U+FFFD rather than vanishing so the loss stays visible.
//
// WHY NUL IS DELETED WHILE A LONE SURROGATE IS REPLACED (review 2026-08-09
// ME-01 — a deliberate, recorded decision, not an oversight):
// The two are treated differently, and that asymmetry is a fair criticism.
// Deleting a NUL can merge words: the documented real-world source is a PDF
// ToUnicode CMap mapping a glyph to U+0000 (06-RESEARCH §Code Examples,
// reproduced in hostile/hostile-pdf-tounicode-nul.pdf), so if the mapped
// glyph is the SPACE in a name, `Jane<NUL>Doe` becomes `JaneDoe` and that is
// what markCandidateFieldsFromCV writes to candidates.full_name. Replacing
// NUL with U+FFFD (or with a space, which normaliseWhitespace would then
// collapse) would keep the loss visible and is arguably the better rule.
//
// It is NOT changed here because the deleting behaviour is the pinned
// contract of the layer-2 suite: tests/integration/cv-write-path.test.ts
// asserts the STORED values `'JaneDoe'` (C1a), the key `badkey` (C1b) and
// `'Texthere'` (C1c), read back from a real Postgres. That file is one of
// three red-suite files kept byte-identical to its original RED commit —
// that byte-identity is the evidence that no assertion was weakened after
// the fix landed, and it is worth more than this preference. Changing the
// substitution would require editing it, which is not a trade worth making
// for a case that has never been observed in production (the forensic
// replay of all 12 real failed rows found ZERO NULs in extracted text).
//
// To revisit: change the substitution AND the three C1 assertions in the
// same commit, deliberately, with the red-suite freeze explicitly lifted
// first. Do not change one without the other.
//
// WHY src/lib/text/ AND NOT src/lib/db/ (a deliberate deviation from
// 06-RESEARCH.md, which suggested src/lib/db/postgres-safe-text.ts):
// src/lib/ai/cv-extract.ts needs this too — the locked fix policy is defence
// in depth, stopping a NUL in the extracted text before Claude can echo it
// AND at the DB boundary in case Claude produces one independently. An `ai/`
// module importing from `db/` is a layering inversion, so the shared
// primitive lives in neutral `text/`. Pure module: NO `import 'server-only'`.
// ---------------------------------------------------------------------------

// Built from code points, never written as literal characters: a committed
// source file must contain no raw NUL and no raw lone surrogate (the latter
// is not even representable in UTF-8 — writing one to disk corrupts it into
// U+FFFD, which would silently disarm both this module and its tests).
const NUL = String.fromCharCode(0x00)
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd)

// A UTF-16 surrogate half with no matching partner. ES2018 lookbehind,
// supported natively on Node 24 and by the project's ES2022 target.
// Two regexes, not one: `.test()` on a /g regex advances `lastIndex` and
// would make consecutive calls return alternating answers.
const LONE_SURROGATE_TEST = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const LONE_SURROGATE_REPLACE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * Make a single string legal for a Postgres text/jsonb write, altering
 * nothing else.
 *
 * Returns the SAME REFERENCE when the string is already legal — the common
 * path over a 60k-character CV then costs two scans and zero allocations.
 */
export function sanitiseText(s: string): string {
  const hasNul = s.includes(NUL)
  const hasLoneSurrogate = LONE_SURROGATE_TEST.test(s)
  if (!hasNul && !hasLoneSurrogate) return s

  let out = s
  // split/join rather than a regex: a NUL regex literal would put a raw
  // control byte in this file (and trips eslint's no-control-regex).
  if (hasNul) out = out.split(NUL).join('')
  if (hasLoneSurrogate) out = out.replace(LONE_SURROGATE_REPLACE, REPLACEMENT_CHAR)
  return out
}

/**
 * Plain objects (and null-prototype objects) are the only ones we may
 * rebuild. A Date, a Uint8Array, a Map — anything with its own prototype —
 * must pass through untouched: `Object.entries(new Date())` is `[]`, so
 * rebuilding one would silently replace a timestamp with `{}`.
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null
  return proto === Object.prototype || proto === null
}

/**
 * Recursively sanitise every string in a value — including OBJECT KEYS,
 * which are exactly as fatal as values (a NUL in a key raises the same
 * 22P05, verified). Numbers, booleans, null, undefined and non-plain objects
 * are returned unchanged.
 *
 * Applied to the patch object immediately before every candidate /
 * candidate_cvs write, so no output Claude can produce can make the write
 * fail.
 */
export function sanitiseForPostgres<T>(value: T): T {
  if (typeof value === 'string') return sanitiseText(value) as unknown as T
  if (Array.isArray(value)) return value.map((item) => sanitiseForPostgres(item)) as unknown as T
  if (value !== null && typeof value === 'object') {
    if (!isPlainObject(value)) return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[sanitiseText(key)] = sanitiseForPostgres(item)
    }
    return out as unknown as T
  }
  return value
}
