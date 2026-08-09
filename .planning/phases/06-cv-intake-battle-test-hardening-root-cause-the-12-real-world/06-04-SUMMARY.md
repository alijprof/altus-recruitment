---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
plan: 04
subsystem: testing
tags: [vitest, unpdf, mammoth, cv-extraction, pii-guard, manifest-driven-testing]

# Dependency graph
requires:
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world (plan 06-03)
    provides: tests/fixtures/cv-corpus/ (24 fixtures, manifest.json, generate.mjs) and 06-FORENSICS.md
provides:
  - "Layer 1 (fast, DB-free) extraction suite driven entirely by manifest.json — extends automatically as fixtures are added"
  - "The first RED tests of Phase 6: 3 hostile fixtures proving normaliseWhitespace lets U+0000 through today"
  - "A mechanical PII tripwire over the whole tests/fixtures/ tree, proven to catch an injected violation"
affects: [06-06 (sanitiser that turns the 3 hostile tests green), 06-09 (full-suite green re-assertion after all fixes land)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Manifest-driven test generation (describe.each over manifest.json) — adding a fixture automatically adds coverage, no test-file edit needed"
    - "Coverage-tracking Set populated at the top of every generated test body (before any assertion), so a later 'exercises every fixture' check is meaningful even when the test itself is designed to fail"
    - "PII tripwire pattern: latin1 read + tight regex allow-list, false negatives tolerated, false positives are not"

key-files:
  created:
    - tests/unit/lib/ai/cv-extract-corpus.test.ts
    - tests/unit/fixtures-pii-guard.test.ts
  modified: []

key-decisions:
  - "One test per manifest entry (not one per behavior bullet) — combines resolves/minChars/mustContain/NUL-count checks into a single assertion per Tier-1/Tier-2 fixture; keeps the suite at 25 tests total and every failure message self-describing."
  - "Reject-path assertion uses try/catch + toBeInstanceOf(Error) + explicit .name comparison rather than .rejects.toMatchObject(), to avoid relying on toMatchObject's prototype-chain property resolution for plain (non-subclassed) Error instances."
  - "UK-mobile Ofcom-range check normalises to digits-only and tests a '7700900' prefix, independent of source spacing (+44 7700 900xxx vs 07700 900xxx vs no spaces) — more robust than a literal string match on 'the block after the 7'."
  - "PII guard's ALLOWLIST constant is present but empty by design — sample-cv.pdf was manually inspected (synthetic 'Jane Doe' / jane.doe@example.com / +44 7700 900100) and needed no exception, since both values already fall inside the allow-listed domain set and Ofcom range."

patterns-established:
  - "Pattern: fixture-corpus test suites read manifest.json at module scope and generate tests via describe.each/it.each — never hand-duplicate fixture expectations in test bodies."

requirements-completed: [CVI-03]

# Metrics
duration: ~25min
completed: 2026-08-09
---

# Phase 6 Plan 04: Layer-1 Manifest-Driven Extraction Suite + PII Tripwire Summary

**Manifest-driven extraction suite over all 24 corpus fixtures (22 green, 3 deliberately RED pending 06-06) plus a PII tripwire proven to catch injected violations — both DB-free, both run on every `pnpm test`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-09T19:41Z (approx, worktree branch check)
- **Completed:** 2026-08-09T19:52Z
- **Tasks:** 2 completed
- **Files modified:** 2 created

## Accomplishments

- `tests/unit/lib/ai/cv-extract-corpus.test.ts` runs the real `extractTextFromBuffer` from `src/lib/ai/cv-extract.ts` against all 24 fixtures in `tests/fixtures/cv-corpus/`, generated entirely from `manifest.json` (no hand-duplicated expectations). 10 Tier-1 parse assertions + 11 Tier-2 reject/short-extraction assertions + 1 manifest-coverage assertion all pass (22 green).
- The 3 `hostile/*` fixtures assert zero `U+0000` in extracted text and **fail today by design** — `normaliseWhitespace` does not yet strip NUL. This is the first RED test of Phase 6; a header comment documents the expected failure count (3) and the correct response (ship plan 06-06's sanitiser, never weaken the assertion).
- Mime routing always uses the manifest's `mime` field, never a filename-derived guess — this is what makes the wrong-extension fixtures (`t2-docx-renamed.pdf`, `t2-pdf-renamed.docx`) reach the intentionally "wrong" library and produce their recorded error.
- `tests/unit/fixtures-pii-guard.test.ts` walks the entire `tests/fixtures/` tree (including binaries, read as latin1) and fails on non-allow-listed email domains, UK mobiles outside the Ofcom drama range, or the literal strings `altus`/`steele`/`charles`. 36/36 green across the corpus, including the pre-existing `tests/fixtures/sample-cv.pdf`.
- Manually verified the PII guard actually fires: injected a scratch file containing `test@gmail.com` under `tests/fixtures/`, confirmed the suite failed with a clear assertion message naming the file and the offending string, then deleted the scratch file (never committed) and re-confirmed green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Manifest-driven extraction suite (layer 1)** - `510f5b1` (test)
2. **Task 2: PII tripwire over the committed corpus** - `4ce7441` (test)

**Plan metadata:** (this commit, docs-only per instructions — not committed to git, see constraints)

## Files Created/Modified

- `tests/unit/lib/ai/cv-extract-corpus.test.ts` - Layer-1 manifest-driven suite; 25 tests (22 green, 3 designed-red hostile NUL assertions)
- `tests/unit/fixtures-pii-guard.test.ts` - PII tripwire; 36 tests, all green, proven to catch an injected violation

## Decisions Made

See `key-decisions` in frontmatter. In summary: one test per manifest entry (not split by behavior bullet); explicit try/catch + `.name` comparison for reject-path assertions instead of `.rejects.toMatchObject`; digits-only normalisation for the Ofcom-range check; PII allow-list left empty after inspecting `sample-cv.pdf` and finding it already synthetic/compliant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree was behind the shared baseline; wave 1-2 dependency output (fixture corpus, manifest.json, 06-FORENSICS.md) did not exist in the agent's branch**

- **Found during:** Task setup, before Task 1 (files-to-read step)
- **Issue:** This worktree's HEAD (`d01bdc1`) predated the merge of plans 06-01/06-02/06-03 into the shared baseline branch (`phase-6/cv-intake-battle-test`, now at `f53bc88`). `tests/fixtures/cv-corpus/manifest.json`, the 24 fixture files, and `06-FORENSICS.md` — all required inputs for this plan — were missing.
- **Fix:** Per the `<worktree_branch_check>` instructions (and the explicit exception in `<destructive_git_prohibition>` permitting `git reset --hard` inside that step), verified the working tree was clean, then ran `git reset --hard f53bc8805a974d1e0ebb553cefddb4e886a9e3fa` to fast-forward the per-agent branch to the shared baseline. Re-verified: still on `worktree-agent-a7f3618b0bed0db42`, `git merge-base HEAD f53bc88... == f53bc88...`, HEAD now equals `f53bc88`.
- **Files modified:** None directly (branch pointer only) — brought `tests/fixtures/cv-corpus/**`, `06-FORENSICS.md`, and `06-0{1,2,3}-SUMMARY.md` into the worktree.
- **Verification:** `git status --short` clean before and after; `git rev-parse --abbrev-ref HEAD` confirmed still the per-agent branch; subsequent commits landed on top of `f53bc88` without incident.
- **Committed in:** N/A (branch-pointer move, not a commit of its own — pre-existing commits from the merged waves).

**2. [Rule 1 - Bug] Raw control byte (literal U+0000) landed in the committed test source during authoring**

- **Found during:** Task 1, immediately after writing `cv-extract-corpus.test.ts`
- **Issue:** The `countNul` helper's regex literal was intended to be `/\u0000/g` (the 6-character JS escape sequence) but a raw single NUL byte was written into the file instead, violating the plan's "committed sources free of raw control bytes (escape sequences only)" constraint and silently breaking the helper (it matched literal spaces, not NUL).
- **Fix:** Used a byte-level Python replace (`open(..., 'rb')` / `.replace(...)` / write back) to swap the raw `\x00` byte for the literal 6-character escape-sequence text `\u0000`, rather than relying on the same text-authoring path that produced the bug. Verified with a byte scan (`b'\x00' in data`) that no raw NUL byte remains anywhere in the file.
- **Files modified:** `tests/unit/lib/ai/cv-extract-corpus.test.ts`
- **Verification:** Byte-level scan confirms zero raw control bytes in the committed file; `pnpm exec vitest run` afterward shows `countNul` correctly reports 2/1/1 NUL occurrences for the three hostile fixtures (matching the manifest's documented counts) instead of 0.
- **Committed in:** `510f5b1` (Task 1 commit — the fix landed before the commit, so the committed file was already clean).

---

**Total deviations:** 2 auto-fixed (1 blocking/Rule 3, 1 bug/Rule 1)
**Impact on plan:** Both were necessary to execute the plan at all (missing inputs) or to ship correct, constraint-compliant code (raw control byte). No scope creep — no plan tasks were altered, added, or skipped.

## Issues Encountered

None beyond the two deviations above (both resolved before task completion).

## User Setup Required

None - no external service configuration required. This plan is entirely local/DB-free (`vitest run`, no Supabase, no network, no AI).

## Next Phase Readiness

- Layer 1 is wired and will automatically pick up any future fixture added to `manifest.json` — no test-file maintenance required.
- 3 documented RED tests (`hostile/hostile-pdf-tounicode-nul.pdf`, `hostile/hostile-docx-raw-nul.docx`, `hostile/hostile-docx-charref-nul.docx`) are the acceptance target for plan 06-06's `normaliseWhitespace` sanitiser — that plan should turn exactly these 3 green and introduce no other regressions in this file.
- Full `pnpm test` (whole repo) currently reports exactly 3 failing tests, all in `cv-extract-corpus.test.ts`, all `hostile/*` — confirmed via a full local run (58 test files, 1 failed / 578 passed / 28 todo across the suite).
- `pnpm typecheck` and `pnpm lint` are clean; the two new files produced zero new warnings (the 24 pre-existing warnings shown by `pnpm lint` are all in unrelated, previously-existing test files, out of this plan's scope).
- The PII guard is a standing tripwire for every future fixture-corpus addition across the rest of Phase 6 (waves 4-8 add more fixtures/tests) — no action needed unless a future PR needs a reviewed allow-list entry.

---
*Phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world*
*Completed: 2026-08-09*

## Self-Check: PASSED

- FOUND: `tests/unit/lib/ai/cv-extract-corpus.test.ts`
- FOUND: `tests/unit/fixtures-pii-guard.test.ts`
- FOUND: `.planning/phases/06-cv-intake-battle-test-hardening-root-cause-the-12-real-world/06-04-SUMMARY.md`
- FOUND commit: `510f5b1` (Task 1)
- FOUND commit: `4ce7441` (Task 2)
- Byte-level scan: zero raw control bytes in any file created/modified by this plan
