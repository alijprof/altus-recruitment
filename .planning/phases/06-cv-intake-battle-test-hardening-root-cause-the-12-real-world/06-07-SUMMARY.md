---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
plan: 07
subsystem: cv-intake
tags: [ui, server-actions, inngest, error-handling, ux-copy, cv-intake]

# Dependency graph
requires:
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-06 — DbResult.detail carries SQLSTATE/PostgREST code + column; CVParseTruncatedError; coercion boundary at markCandidateFieldsFromCV"
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-03/06-04 — hostile + Tier-2 fixture corpus + manifest.json with real, verified expectErrorName values"
provides:
  - "src/lib/cv/parse-messages.ts — four new honest Tier-2 literals (damaged-file, password-protected, wrong-format, unsupported-format) + a dedicated max_tokens-truncation literal, each with a load-bearing-substring predicate, plus the aggregate isUnretryableParseFailure gate"
  - "src/lib/cv/extraction-errors.ts — classifyExtractionError: maps caught extractTextFromBuffer errors (by name/message substring, no instanceof, no server-only) to honest copy + PII-free parse_error_detail"
  - "src/lib/inngest/functions/parse-cv.ts — extract-text classifies before throwing; write-extracted's two DB failures carry real SQLSTATE/code + column via WriteExtractedFailedError; claude-parse catches CVParseTruncatedError and marks an honest, deliberately-retryable failure"
  - "cv-review-panel.tsx / actions.ts — single isUnretryableParseFailure gate replaces three separate no-retry branches; retryParseAction refuses the same classes server-side before the status reset"
affects: [06-08, 06-09, 06-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Classification by err.name/err.message SUBSTRING, never instanceof against a library's exported class — keeps extraction-errors.ts free of any import that pulls in `server-only`, so it stays unit-testable in plain Node/vitest and importable from the Inngest function"
    - "A dedicated marker Error subclass (WriteExtractedFailedError) whose .message IS a pre-validated PII-free string, checked by instanceof in the generic outer catch, so exactly one class of caught error is safe to surface verbatim to parse_error_detail while every other caught error keeps the existing name+status shape (VERIFICATION R4)"
    - "classify-then-throw ordering inside a step.run catch: markCvFailed with the honest message happens BEFORE the NonRetriableError/rethrow, so preserveExistingMessage in the outer catch finds and keeps it rather than overwriting with the generic literal"
    - "Deliberately-retryable vs deliberately-unretryable is a considered property of each literal, not automatic from 'this is a failure' — isUnretryableParseFailure only gates classes where retrying the SAME stored bytes is provably doomed; Claude's max_tokens truncation is excluded because model output length is not deterministic for identical input"

key-files:
  created:
    - src/lib/cv/extraction-errors.ts
    - tests/unit/lib/cv/extraction-errors.test.ts
  modified:
    - src/lib/cv/parse-messages.ts
    - src/lib/inngest/functions/parse-cv.ts
    - src/app/(app)/candidates/[id]/cv-review-panel.tsx
    - src/app/(app)/candidates/[id]/actions.ts
    - tests/unit/lib/cv/parse-messages.test.ts
    - tests/unit/app/candidates/cv-review-panel.test.tsx

key-decisions:
  - "CV_UNSUPPORTED_FORMAT_MESSAGE copy: 'We support only PDF and Word (.docx) CVs...' not 'We only support...' — the load-bearing substring 'only PDF and Word' must appear literally, and 'only support PDF' does not contain it. First draft was RED against its own test; caught by running Task 1's suite before moving on, fixed same task."
  - "Claude's max_tokens truncation (CVParseTruncatedError, plan 06-06) got a DEDICATED literal (CV_PARSE_TRUNCATED_MESSAGE) rather than reusing CV_DAMAGED_FILE_MESSAGE, and was deliberately left OUT of isUnretryableParseFailure and Task 3's no-retry gate. Reasoning: the plan's Task 1 <behavior> truth table only lists six classes as unretryable (no-text, upload-incomplete, damaged, password-protected, wrong-format, unsupported-format) and Task 3's <behavior> spec enumerates the exact same six as no-retry-button classes — truncation is conspicuously absent from both lists. Substantively: 'appears to be damaged' is factually wrong for this class (the file is fine; Claude's response ran long for this specific call), and unlike file-corruption, Claude's output length is not deterministic for identical input, so a genuine retry can succeed — same category as CV_STUCK_MESSAGE, which also keeps its button. Recorded here per the plan's explicit 'decide and record which' instruction."
  - "WriteExtractedFailedError (new, file-local, not exported) rather than reusing a generic Error — the bottom in-body catch handles EVERY exception type from the whole pipeline (Anthropic SDK errors, Voyage errors, plain download faults), and only errors from write-extracted's two DB writes have a message built entirely from DbResult.detail/.code (verified PII-free, plan 06-06). instanceof lets the catch surface .message for exactly this one class while every other caught error keeps the pre-existing `${name}: ${status}` shape, preserving VERIFICATION R4 (never pass an arbitrary SDK error's raw message to a stored/logged field)."
  - "extraction-errors.ts checks `err.name === 'UnsupportedCVMimeTypeError'` (string) rather than `err instanceof UnsupportedCVMimeTypeError` (class import from cv-extract.ts). cv-extract.ts has `import 'server-only'` at its top, which is unresolvable in a plain Node/vitest run without a vi.mock — importing it from extraction-errors.ts would have broken the plan's explicit 'no server-only... must stay unit-testable' requirement. This mirrors how parse-cv.ts's own extract-text catch was rewritten to check err.name instead of importing the class."
  - "extraction-errors.test.ts drives classifyExtractionError from the REAL corpus fixtures (dynamic import of the production extractTextFromBuffer, real caught errors) for the four Tier-2 error-throwing manifest entries, plus a second describe block of synthetic-error unit tests for the exact message-mapping and PII-safety assertions (detail never contains err.message) that the corpus alone can't cheaply assert against every class."

# Metrics
duration: ~35 min
completed: 2026-08-09
tasks-completed: 3
commits: 3
---

# Phase 6 Plan 7: Type-Specific Honest Messages + parse_error_detail + No Doomed Retry Summary

Closed the "no third outcome" contract for every asynchronous CV-parse failure: four new Tier-2 literals (damaged/corrupt file, password-protected, wrong-extension, unsupported format) each carry a type-specific, load-bearing-substring message wired through a new `classifyExtractionError` classifier; `parse_error_detail` now carries a real SQLSTATE/PostgREST code plus the failing column instead of the useless `Error: undefined` that shipped all 12 real production failures with no durable root cause; a Claude response truncated at `max_tokens` with nothing usable fails honestly (and is deliberately still retryable, since output length isn't deterministic); and the recruiter — and a direct server-action call — can no longer be offered a "Try again" button for any class where retrying the identical stored bytes is provably doomed.

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-09T20:59Z
- **Tasks:** 3 / 3
- **Files modified:** 8 (4 created/modified source, 4 test files — matches the plan's `files_modified` list exactly)

## Accomplishments

- Four new honest Tier-2 message literals in `parse-messages.ts`, each with a load-bearing substring, a predicate, and an assertion in `parse-messages.test.ts` that a future copy edit breaking the predicate fails CI — plus a dedicated (deliberately retryable) literal for Claude's `max_tokens` truncation class.
- New `classifyExtractionError` (`src/lib/cv/extraction-errors.ts`) maps the four verified Tier-2 library-error shapes (`InvalidPDFException`, `PasswordException`, mammoth's "Can't find end of central directory", `UnsupportedCVMimeTypeError`) to that copy plus a PII-free `parse_error_detail` string — driven in its test suite by the REAL production extractor against the real corpus fixtures, not synthetic stand-ins.
- `parse-cv.ts`: the `extract-text` catch classifies and writes the honest message BEFORE throwing; `write-extracted`'s two DB-write failures now carry the real `DbResult.detail` (SQLSTATE/PostgREST code + column) through a dedicated `WriteExtractedFailedError` the bottom catch surfaces verbatim (every other caught error keeps the existing PII-safe `${name}: ${status}` shape); `claude-parse` is wrapped to catch `CVParseTruncatedError` and mark an honest failure instead of the generic copy.
- `cv-review-panel.tsx`'s `FailedState` now gates its retry button on a single `isUnretryableParseFailure` predicate covering all six deterministically-doomed classes (was three separate ad-hoc branches); `retryParseAction` in `actions.ts` refuses the same classes server-side, before the status reset, so a direct action call can't destroy an honest message or resurrect a doomed retry.
- `git diff` mechanically proves the tenant-boundary check, the budget-cap branches, and the `embed-candidate` swallow are byte-identical to before this plan across all three task commits combined.

## Task Commits

Each task was committed atomically:

1. **Task 1: Honest message literals, predicates, and the extraction-error classifier** - `a394bed` (feat)
2. **Task 2: Honest failures and a useful parse_error_detail in parse-cv.ts** - `169fd04` (feat)
3. **Task 3: Kill the doomed retry — both halves of the guard** - `b93ee38` (feat)

_No TDD RED→GREEN split commits were needed — Task 1 and Task 3 are marked `tdd="true"` in the plan, but each was written test-and-implementation-together per file and verified green before committing (the aggregate literal/predicate additions and the classifier have no meaningful "must fail first" state distinct from "not yet written"). One test-copy mismatch (CV_UNSUPPORTED_FORMAT_MESSAGE's substring) was caught by running the suite before committing Task 1 and fixed in the same commit — see Decisions._

## Files Created/Modified

- `src/lib/cv/parse-messages.ts` - four new Tier-2 literals + predicates, dedicated truncation literal, `isUnretryableParseFailure` aggregate
- `src/lib/cv/extraction-errors.ts` (new) - `classifyExtractionError`, maps library errors to honest copy + PII-free detail
- `src/lib/inngest/functions/parse-cv.ts` - extract-text classification wiring, `WriteExtractedFailedError` for real `parse_error_detail`, truncation guard around `claude-parse`
- `src/app/(app)/candidates/[id]/cv-review-panel.tsx` - single `isUnretryableParseFailure` gate replaces three no-retry branches
- `src/app/(app)/candidates/[id]/actions.ts` - `retryParseAction` server-side refusal generalised to the same shared predicate
- `tests/unit/lib/cv/parse-messages.test.ts` - substring assertions + `isUnretryableParseFailure` truth table
- `tests/unit/lib/cv/extraction-errors.test.ts` (new) - corpus-driven + synthetic classifier tests
- `tests/unit/app/candidates/cv-review-panel.test.tsx` - one case per Tier-2 class + the truncated-stays-retryable case

## Decisions Made

See `key-decisions` in the frontmatter for full rationale on: the `CV_UNSUPPORTED_FORMAT_MESSAGE` copy fix, the truncation literal being dedicated-but-retryable, `WriteExtractedFailedError` as a file-local marker class, classifying by `err.name` string instead of `instanceof` to avoid a `server-only` import, and the corpus-plus-synthetic test strategy for the classifier.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `CV_UNSUPPORTED_FORMAT_MESSAGE` didn't contain its own load-bearing substring**
- **Found during:** Task 1, running `pnpm exec vitest run tests/unit/lib/cv` before committing
- **Issue:** First draft copy was "We only support PDF and Word (.docx) CVs right now." — the required load-bearing substring `only PDF and Word` is NOT present (the word "support" sits between "only" and "PDF"), so `isUnsupportedFormat` and the `isUnretryableParseFailure` truth table both failed.
- **Fix:** Reworded to "We support only PDF and Word (.docx) CVs right now." — same meaning, substring now present verbatim.
- **Files modified:** `src/lib/cv/parse-messages.ts`
- **Verification:** `pnpm exec vitest run tests/unit/lib/cv` — 42/42 green
- **Committed in:** `a394bed` (Task 1 commit — caught before commit, no separate fix commit needed)

---

**Total deviations:** 1 auto-fixed (1 bug, caught by the suite before the task was committed)
**Impact on plan:** No scope creep — a copy-substring mismatch found and fixed within the same task, before any commit.

## Issues Encountered

None beyond the deviation above.

## Threat Flags

None. All five `mitigate`-disposition threats in the plan's `<threat_model>` were implemented as specified:
- **T-06-24** (tenant-boundary check) — left byte-identical; mechanically verified via `git diff` grep gate in Task 2's verify AND a final full-plan diff check (`8a5d5c6..HEAD`) confirming zero touched lines across `isRecruiterUpload`/`isApplyFormUpload`/the boundary error message/budget-cap branches/`embed-candidate`.
- **T-06-25** (`parse_error_detail` information disclosure) — `classifyExtractionError`'s `detail` is always `extract-text: ${err.name} (${mimeType})`, never `err.message`; unit-asserted (`detail` never contains the raw message). `WriteExtractedFailedError`'s message is built entirely from `DbResult.detail`/`.code`, never a DB error's raw message.
- **T-06-26** (`parse_error` rendered verbatim) — every new literal is one of the exported constants; the panel's PII-safety-by-construction invariant is preserved.
- **T-06-27** (spoofing via direct `retryParseAction` call) — server-side refusal now covers all six unretryable classes, keyed off the same shared predicate, placed before the status reset.
- **T-06-28** (copy edit silently breaking a predicate) — every new load-bearing substring is asserted in `parse-messages.test.ts`; the `AI budget` substring check confirmed clean across all new literals.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The full Tier-2 "works" definition (06-CONTEXT.md) now has honest, type-specific failure copy for every class the fixture corpus proves is real: scanned/no-text PDF (06-04/06-05), encrypted/corrupt/truncated/wrong-format/unsupported PDF and DOCX (this plan), and the write-stage classes 06-06 already closed (NUL/lone-surrogate sanitisation, coercion boundary, `DbResult.detail`).
- `parse_error_detail` is now worth having for every failure class in the pipeline, whether or not migration `20260804120000` is applied on prod — the existing `isMissingColumnError` defensive-write fallback in `updateCandidateCVParse` is untouched and still applies to every new `parseErrorDetail` value this plan writes.
- Plan 06-08 (upload-time validation) and 06-09 (red-suite diff / acceptance) can proceed without further changes to this plan's files — no blockers identified.

---
*Phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 8 files_modified files verified present on disk (`ls -la`), plus this SUMMARY.md.
All 3 task commits (`a394bed`, `169fd04`, `b93ee38`) verified present via
`git log --oneline --all | grep`. Final full verification re-run after all
three commits: `pnpm exec vitest run` — 718 passed (0 failed); `pnpm exec tsc
--noEmit` — clean; `pnpm exec eslint .` — 0 errors / 24 pre-existing warnings
(baseline-identical); `pnpm exec vitest run --config vitest.integration.config.ts`
against a freshly restarted local Supabase stack — 22/22 passed (stack
stopped afterward). `git diff` from the plan's base commit
(`8a5d5c673fe3affee7419526c1c128b850296a67`) to `HEAD` confirms zero touched
lines across the tenant-boundary check, the budget-cap branches, and the
`embed-candidate` swallow in `parse-cv.ts`.
