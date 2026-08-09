---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
plan: 06
subsystem: cv-intake
tags: [zod, coercion, sanitisation, postgres, postgrest, claude, cv-intake, tdd, data-integrity]

# Dependency graph
requires:
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-04 layer-1 hostile fixture corpus + cv-extract-corpus.test.ts (3 designed-RED NUL assertions)"
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-05 layer-2 red suite (15 designed-RED + 7 negative controls) + hostile-payloads.ts + cv-parse-truncation.test.ts"
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-02 forensic replay (06-FORENSICS.md — all 12 real failures extract clean, so the coercion boundary is the primary production fix)"
provides:
  - "src/lib/ai/parsed-cv-schema.ts — coerceParsedCV/parsedCVSchema, the single validation boundary between Claude's tool output and every typed consumer"
  - "src/lib/text/postgres-safe-text.ts — sanitiseText/sanitiseForPostgres, recursive Postgres-legality guarantee for values AND object keys"
  - "src/lib/ai/claude.ts — CVParseTruncatedError export; parseCV now returns coerced output; tightened extract_cv_fields tool schema; max_tokens 4096"
  - "src/lib/db/types.ts — DbResult failure variant carries an optional PII-free `detail` (SQLSTATE/PostgREST code + column)"
affects: [06-07, 06-08, 06-09, 06-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coercion boundary built from z.unknown().transform(totalFunction) rather than z.coerce.* — zod's .catch() does NOT catch a throw raised inside a .transform() (verified against zod 4 this session), so 'never throws' is guaranteed by construction, not delegated to the schema"
    - "Drop-never-clamp for out-of-range model output: an unrepresentable value yields an ABSENT field, never a clamped one, so a mis-read calendar year never becomes a fabricated duration on a candidate record"
    - "Content-preserving sanitisation: exactly two sequences altered (U+0000 removed, lone surrogate -> U+FFFD); same-string-reference short-circuit so the clean 60k-char path allocates nothing"
    - "Prototype-aware recursion (isPlainObject) so a Date/Uint8Array is never rebuilt into {} by an Object.entries walk"
    - "PII-free failure detail assembled from err.code + hard-coded column names, never err.message (PostgREST echoes the offending value)"
    - "Illegal/invisible characters in new test sources built with String.fromCharCode constants — pure-ASCII source that no formatter can silently repair"

key-files:
  created:
    - src/lib/ai/parsed-cv-schema.ts
    - src/lib/text/postgres-safe-text.ts
    - tests/unit/lib/ai/parsed-cv-schema.test.ts
    - tests/unit/lib/text/postgres-safe-text.test.ts
  modified:
    - src/lib/ai/claude.ts
    - src/lib/ai/cv-extract.ts
    - src/lib/db/candidate-cvs.ts
    - src/lib/db/types.ts

key-decisions:
  - "years_experience_total drops at >= 1000 (the real numeric(4,1) cliff), NOT at >= 100 as the plan's <action> prose said — the plan's own <behavior> spec ('999.9 -> 999.9') and the expected-GREEN negative control C3c both require 999.9 to survive. Followed the behaviour spec + the column type; the <action> line was internally inconsistent with both."
  - "Rounds years_experience_total to one decimal BEFORE the cliff check, because Postgres rounds to scale then checks precision — 999.96 would become 1000.0 and raise 22003 despite being under the cliff as written."
  - "markCandidateFieldsFromCV coerces args.parsed itself rather than trusting callers. The layer-2 suite calls it directly with raw payloads, and two production callers (reconciler, acceptCVFieldsAction) feed it STORED extracted_data written before this boundary existed — coercing at the helper is what makes all three safe and heals old rows instead of re-failing them."
  - "`currency` is carried across that coercion by hand: it is the one ParsedCVSubset field the extract_cv_fields tool never returns, so toParsedCVSubset nulls it by design, but a caller who sets it explicitly is trusted (the existing D-08 mocked unit test asserts exactly this and must stay green)."
  - "updateCandidateCVParse SANITISES extracted_data but never COERCES it — coercion strips unknown keys, which would have destroyed the C1b contract (a NUL-bearing key must survive as 'badkey', not vanish). Coercion belongs on the way in (parseCV) and on the way out (toParsedCVSubset), not on the blob write."
  - "seniority_level is matched case-sensitively against the seven tool-schema values, per the plan's behaviour spec. Claude is constrained by the tool enum, so tolerant case-folding would add unspecified behaviour for no real-world gain."
  - "sanitiseForPostgres refuses to rebuild non-plain objects. The 06-RESEARCH.md sketch would have turned a Date into {} via Object.entries — harmless today (no Date reaches these patches) but a live landmine for any future caller."
  - "Module lives at src/lib/text/postgres-safe-text.ts, not the src/lib/db/ path 06-RESEARCH.md suggested: cv-extract.ts (ai layer) needs it too, and an ai/ -> db/ import is a layering inversion."

# Metrics
duration: ~35 min
completed: 2026-08-09
tasks-completed: 3
commits: 5
---

# Phase 6 Plan 6: Zod Coercion Boundary + Postgres Sanitiser Summary

Closed the two gaps that produced the customer's 12 failed CV uploads — between what
TypeScript asserted about Claude's output and what actually arrived, and between what
JavaScript calls a valid string and what Postgres will accept — turning the entire
designed-red layer-1 and layer-2 suite green without touching a single assertion.

## What shipped

**Task 1 — `src/lib/ai/parsed-cv-schema.ts` (the coercion boundary).**
`parseCV()` used to end with `return d.parsed as ParsedCV`: a type assertion over
probabilistic model output. It now ends with `coerceParsedCV(d.parsed)`. Every field is a
total function of its input — a `'£45,000'` salary becomes `45000`, a `['Jane','Doe']`
name becomes `'Jane Doe'`, a `2015` years-of-experience is DROPPED (never clamped, because
clamping writes a fabricated fact onto a candidate record). One unusable field can never
fail a whole parse. Bounds derive from the real column types, with the migration cited
above each. Every downstream consumer — `parse-cv.ts`, `reconcile-cv-parses.ts`,
`acceptCVFieldsAction` — inherits the fix from that one call.

**Task 2 — `src/lib/text/postgres-safe-text.ts` (the legality sanitiser).**
Exactly two sequences are illegal in this pipeline and both are now handled: `U+0000` is
removed (22P05) and a lone UTF-16 surrogate becomes `U+FFFD` (PGRST102, rejected by
PostgREST before Postgres is ever reached). Everything else a CV can legally contain —
`U+0001`-`U+001F`, emoji with ZWJ, astral-plane glyphs, RTL, CJK, BOM, soft hyphens,
1.1 MB values — is preserved byte-for-byte. The recursion covers object KEYS as well as
values, and refuses to rebuild non-plain objects so a `Date` is never flattened to `{}`.

**Task 3 — wiring.** `DbResult` gained an optional PII-free `detail`; `claude.ts` gained
`CVParseTruncatedError`, a tightened tool schema and 4096 max_tokens;
`normaliseWhitespace` now sanitises before collapsing whitespace; both DB write patches
are sanitised, and `markCandidateFieldsFromCV`/`toParsedCVSubset` coerce first.

## Verification

| Gate | Before | After |
|------|--------|-------|
| `pnpm typecheck` | 1 error (missing `CVParseTruncatedError` export) | clean |
| `pnpm lint` | 0 errors / 24 pre-existing warnings | 0 errors / 24 pre-existing warnings |
| `pnpm test` (unit) | **5 failed** / 581 passed | **0 failed** / 685 passed |
| `pnpm test:integration` (layer 2) | **15 failed** / 7 passed | **0 failed** / 22 passed |

The observed pre-change red state matched the plan's documented expectation exactly (3
hostile-NUL corpus + 2 truncation unit failures; 15 integration failures with the 7
negative controls green; 1 typecheck error), so no discrepancy needed recording.

`git diff` against the base commit touches **only** the 8 files in the plan's
`files_modified` list. Zero changes under `tests/integration/`, `tests/fixtures/`,
`tests/unit/lib/ai/cv-extract-corpus.test.ts`, `tests/unit/lib/ai/cv-parse-truncation.test.ts`
or `tests/unit/mark-candidate-fields-from-cv.test.ts`. `package.json` and `pnpm-lock.yaml`
are untouched — no new dependency. No migration was added or needed. `parse-cv.ts` (and
therefore its tenant-boundary check) was never opened.

The local Supabase stack was started for the integration run and stopped afterwards; the
concurrently-running `altus-quay-forthports` stack was never touched.

## Deviations from Plan

### Auto-fixed / judgement calls

**1. [Plan-internal inconsistency] `years_experience_total` cliff is 1000, not 100**
- **Found during:** Task 1
- **Issue:** the plan's `<action>` says "`years_experience_total >= 100` is DROPPED", but its
  own `<behavior>` spec says `999.9 -> 999.9`, and layer-2 negative control C3c (an
  expected-GREEN test that must never go red) asserts 999.9 is stored. A >= 100 rule
  would have turned a designed-green control red.
- **Resolution:** implemented the `<behavior>` spec and the real column bound —
  `numeric(4,1)` overflows at exactly 1000. 2015 is still dropped, which is the outcome
  the `<action>` prose was reaching for. Recorded here rather than silently reconciled.
- **Files:** `src/lib/ai/parsed-cv-schema.ts`
- **Commit:** f179c35

**2. [Rule 2 - correctness] Coercion moved INTO `markCandidateFieldsFromCV`**
- **Found during:** Task 3
- **Issue:** the plan routes `toParsedCVSubset` through `coerceParsedCV`, but the layer-2
  suite calls `markCandidateFieldsFromCV` directly, and `acceptCVFieldsAction` passes
  stored `extracted_data` straight to it — both bypass `toParsedCVSubset` entirely. Without
  coercion in the helper, C3/C4/C5/SKILLS-OBJ stay red and the two real production callers
  stay unprotected.
- **Resolution:** the helper coerces `args.parsed` itself (idempotent, so a fresh
  already-coerced parse is unaffected), carrying `currency` across by hand.
- **Files:** `src/lib/db/candidate-cvs.ts`
- **Commit:** 1bdb0f9

**3. [Rule 1 - bug] `sanitiseForPostgres` must not rebuild non-plain objects**
- **Found during:** Task 2
- **Issue:** the 06-RESEARCH.md sketch recurses into anything where `typeof value ===
  'object'`. `Object.entries(new Date())` is `[]`, so that sketch silently converts a Date
  into `{}`.
- **Resolution:** prototype check before rebuilding; Date/Uint8Array/Map pass through
  untouched, with tests.
- **Files:** `src/lib/text/postgres-safe-text.ts`
- **Commit:** af3f697

**4. [Housekeeping] Prettier rewrapped one untouched line**
- `DOCX_MIME` in `src/lib/ai/cv-extract.ts` collapsed onto a single line when the file was
  formatted. Formatting-only, same string value.

### Byte-hygiene note (differs from 06-05's convention, deliberately)

`tests/fixtures/cv-corpus/hostile-payloads.ts` stores illegal characters as literal
6-character escape TEXT (a backslash, a u, and four hex digits). The two new test files could not use that convention:
authoring `\u` escapes through this tooling materialised them as RAW bytes on disk (a raw
NUL was written into the first draft of `postgres-safe-text.test.ts`, and a raw lone
surrogate is not even representable in UTF-8 — it would have been silently corrupted into
U+FFFD, disarming the test while it still "passed"). Both new test files therefore build
every illegal/invisible character with `String.fromCharCode`, keeping their sources pure
ASCII. Two raw artefacts that slipped into production sources (an NBSP inside a regex
character class, a raw ZWJ) were located byte-by-byte and removed before their commits;
`src/`'s new files and both new test files are verified free of raw control bytes.

## Authentication Gates

None.

## Known Stubs

None. Every new code path is wired to a real consumer and exercised by tests against a
real Postgres.

## Deferred Issues

One out-of-scope finding logged to `deferred-items.md` (D-06-06-01):
`Sentry.captureException(error)` in the DB helpers still passes the raw PostgrestError,
whose message can echo a candidate value — the same exposure `DbResult.detail` was
carefully designed to avoid, on a different sink. Pre-existing across every helper in the
file; this plan's changes strictly reduce how often those captures fire.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change was
introduced. The threat register's `mitigate` dispositions were implemented as specified:
T-06-19 (coercion at the single producer of `ParsedCV`), T-06-20 (`sanitiseForPostgres` at
the DB choke point, proved against real Postgres), T-06-21 (`detail` built from `err.code`
plus hard-coded column names, never `err.message`), T-06-23 (`parse-cv.ts` untouched).

## Self-Check: PASSED

All 8 source/test files and both planning artifacts verified present on disk; all 5
commits verified present on `worktree-agent-a5027e0a09b561892`
(9aa11af, f179c35, 861257b, af3f697, 1bdb0f9, on top of base f0e9b5f). A final
control-byte scan across every touched source file returned clean.

## What this does NOT close

- The 12 real production rows are not retried here — that is plan 06-10's acceptance run.
- Migration `20260804120000` (`parse_error_detail`) remains unapplied in production; the
  pre-migration fallback in `updateCandidateCVParse` is preserved verbatim, so this work
  is correct either way.
