---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
plan: 01
subsystem: testing
tags: [vitest, jszip, postgres, postgrest, unicode, cv-intake]

# Dependency graph
requires: []
provides:
  - "vitest.forensics.config.ts — isolated node-env runner for tests/forensics/**/*.forensic.ts (plan 06-02)"
  - "vitest.integration.config.ts — isolated node-env runner for tests/integration/**/*.test.ts (plan 06-05)"
  - "tests/integration/** excluded from the default pnpm test suite (database-free by construction)"
  - "pnpm forensics / pnpm test:integration / pnpm fixtures:regen npm scripts"
  - "jszip promoted from phantom transitive (via mammoth) to explicit devDependency, zero new bytes downloaded"
  - "tests/support/pg-legality.ts exporting classifyForPostgres() — the Postgres-legality classifier every later Wave-2 plan (06-02 forensics, 06-04+ sanitisation) depends on"
affects: [06-02, 06-03, 06-04, 06-05, 06-06, 06-07]

# Tech tracking
tech-stack:
  added: ["jszip@3.10.1 (devDependency only)"]
  patterns:
    - "Isolated vitest configs per test tier (default/forensics/integration) instead of one config with environment-variable branching"
    - "Pure, PII-safe classifier functions returning structured findings (rule/path/code/severity) instead of raw error messages"

key-files:
  created:
    - vitest.forensics.config.ts
    - vitest.integration.config.ts
    - tests/support/pg-legality.ts
    - tests/unit/lib/pg-legality.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - vitest.config.ts

key-decisions:
  - "jszip legitimacy audit run live against the npm registry (not just cited from research): 40,177,178 weekly downloads confirmed, created 2013-09-11, single long-tenured maintainer (stuk), github.com/Stuk/jszip, no install/postinstall scripts, MIT/GPL license — nothing anomalous, orchestrator's pre-decision confirmed rather than assumed"
  - "pnpm add -D jszip run with -w (workspace-root) flag since pnpm-workspace.yaml declares '.' as a workspace member — confirmed zero drift into chrome-extension/package.json"
  - "Salary/years-experience typed-column rules encode ONLY the verified matrix rows (upper-bound int4 overflow only, no unverified lower-bound/negative-number rejection) to avoid inventing unverified Postgres behaviour"
  - "Raw NUL bytes that were accidentally embedded literally (rather than as the visible \\u0000 escape-sequence text) during file authoring were normalised to escape-sequence text in both the classifier and its test file — functionally identical at runtime, but keeps both files as normal diffable/greppable UTF-8 text instead of registering as binary to git/grep/file"

requirements-completed: [CVI-01, CVI-04]

# Metrics
duration: ~25min
completed: 2026-08-09
---

# Phase 6 Plan 01: Test-Runner Wiring + jszip devDep + Postgres-Legality Classifier Summary

**Isolated vitest runners for forensics/integration suites, jszip promoted to an audited devDependency, and a 30-test-verified `classifyForPostgres()` classifier reproducing the full 25-row Postgres/PostgREST failure matrix**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-09T18:30Z (approx.)
- **Completed:** 2026-08-09T18:54Z
- **Tasks:** 3 (1 checkpoint, 2 auto)
- **Files modified:** 7 (3 created configs/support, 1 created test, 3 modified: package.json, pnpm-lock.yaml, vitest.config.ts)

## Accomplishments
- Three new isolated vitest configs/scripts (`forensics`, `test:integration`, plus `fixtures:regen`) so later Wave-2 plans have a place to land their suites without touching `package.json` again
- `pnpm test` is now database-free by construction — `tests/integration/**` is excluded in `vitest.config.ts`, verified via a live diff against the pre-plan baseline (exactly one exclude entry added)
- `jszip` promoted from a phantom transitive dependency (via `mammoth`) to an explicit, audited devDependency — confirmed zero new bytes downloaded (`pnpm add -D jszip -w` reported "Already up to date"; lockfile diff is a 3-line importer declaration only, no new `resolution:`/`dependencies:` block)
- `tests/support/pg-legality.ts` exports `classifyForPostgres()`, a pure PII-safe classifier proven against all 25 rows of the verified Postgres 17.6 + PostgREST v14.5 failure matrix from 06-RESEARCH.md, via 30 tests (one per matrix row, traceable by row number in the test name)
- Zero regressions: baseline `pnpm test` was 56 files / 490 tests passing; after this plan it is 57 files / 520 tests passing (exactly +1 file, +30 tests, nothing turned red)

## Task Commits

1. **Task 1: Package legitimacy gate — jszip** — no commit (checkpoint; see "Deviations" for how it was resolved)
2. **Task 2: Test-runner wiring and the one dependency change** - `debd826` (feat)
3. **Task 3: Postgres-legality classifier (test-only)** - `d2306ae` (test)

**Plan metadata:** pending (orchestrator commits `.planning/` artefacts separately per constraints — this plan does not commit docs)

_Note: Task 3 combined the RED (failing test) and GREEN (implementation) steps into a single `test(...)` commit rather than two separate commits. Both steps were performed and verified in sequence (test written and confirmed failing with "Cannot find package" before the classifier existed; then the classifier was implemented and all 30 tests confirmed passing) — see "Deviations" for why this is flagged._

## Files Created/Modified
- `vitest.forensics.config.ts` - Isolated node-env vitest runner for `tests/forensics/**/*.forensic.ts`, 300s timeouts (plan 06-02's forensic replay: 12 Storage downloads + up to 12 Haiku calls)
- `vitest.integration.config.ts` - Isolated node-env vitest runner for `tests/integration/**/*.test.ts`, 120s timeouts (plan 06-05's real-Supabase write-path suite)
- `vitest.config.ts` - Added `'tests/integration/**'` to the exclude array (one line + explanatory comment) so the default suite stays database-free
- `package.json` - Added `test:integration`, `forensics`, `fixtures:regen` scripts (inserted after `test:e2e:reset`); added `jszip` under `devDependencies`
- `pnpm-lock.yaml` - Minimal 3-line diff: new root importer entry for `jszip@3.10.1` (already fully resolved via `mammoth`, zero new download)
- `tests/support/pg-legality.ts` - `classifyForPostgres()` classifier + `PgLegalityFinding`/`PgLegalityCode` types; recursive Unicode-illegality scan (NUL, lone surrogates) plus typed-column rules for `salary_current_estimate`/`salary_expectation`, `years_experience_total`, `name`, `work_history`, `education`, `skills`, `sector_tags`
- `tests/unit/lib/pg-legality.test.ts` - 30 tests proving every verified matrix row, plus zero-false-positive coverage on legal-but-exotic Unicode and an explicit PII-discipline assertion

## Decisions Made
- **jszip legitimacy audit executed live, not just cited.** Per the orchestrator's pre-decision context, the install was pre-approved, but the plan's Task 1 explicitly requires the audit to still run. I queried `registry.npmjs.org/jszip` and `api.npmjs.org/downloads` directly: created 2013-09-11, 38 published versions, 40,177,178 weekly downloads (matches research exactly), single maintainer `stuk` (npm@website.stuartk.com) consistent with `github.com/Stuk/jszip`, MIT/GPL-3.0 license, **no install/postinstall/preinstall scripts** on the installed version (3.10.1) — nothing anomalous surfaced, so I proceeded per the pre-decision rather than stopping for a checkpoint.
- **`-w` (workspace-root) flag required for `pnpm add`.** `pnpm-workspace.yaml` declares `'.'` (root) and `'chrome-extension'` as workspace members, so `pnpm add -D jszip` without `-w` was rejected with `ERR_PNPM_ADDING_TO_ROOT`. Confirmed via `git diff` that `chrome-extension/package.json` has zero drift — only the intended root `package.json`/`pnpm-lock.yaml` changed.
- **Salary/years typed-column rules encode only verified matrix rows.** I deliberately did NOT add a lower-bound/negative-number rejection rule for `salary_*`, since 06-RESEARCH.md's DISPROVEN section confirms `candidates` has no CHECK constraints and the matrix only verified the upper (`> 2147483647`) bound. Inventing an unverified lower-bound rule would risk false positives the moment a real (if unusual) negative salary value appeared.
- **Byte-hygiene fix on raw NUL characters.** While authoring the classifier's NUL-detection logic (`value.includes('U+0000')`) and the test fixtures using literal NUL payloads (e.g. `'JaneU+0000Doe'`), the file-write tooling twice embedded an actual raw `0x00` byte instead of the 6-character escape-sequence text `U+0000`. This is functionally identical at the JavaScript-string level (both produce the single-character string U+0000, confirmed by the tests passing either way), but it made both files register as binary `data` to `file`/`grep` rather than UTF-8 text. I normalised the implementation file's 2 occurrences to escape-sequence text (a source-hygiene fix, no test-data intent there) and, for consistency and tooling-friendliness, also normalised the test file's 5 intentional NUL-payload occurrences the same way — the test fixtures still exercise a real single NUL character at runtime, they're just spelled as visible source text now instead of an invisible embedded byte. Verified via `git diff --stat` (line-based, not "Binary files differ") and a full re-run of all 30 tests (still 30/30 pass) after the fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pnpm add -D jszip` required the `-w` flag**
- **Found during:** Task 2
- **Issue:** The repo is a pnpm workspace (`pnpm-workspace.yaml` lists `.` and `chrome-extension`); `pnpm add -D jszip` without `-w` was rejected with `ERR_PNPM_ADDING_TO_ROOT` rather than silently succeeding.
- **Fix:** Re-ran with `pnpm add -D jszip -w`, the correct flag for adding to the workspace root (which is exactly what the plan requires — `package.json` is the file this plan owns).
- **Files modified:** package.json, pnpm-lock.yaml
- **Verification:** `git diff chrome-extension/package.json` against the base commit shows zero changes; the root `package.json`/`pnpm-lock.yaml` diff matches the plan's exact expected shape.
- **Committed in:** debd826 (Task 2 commit)

**2. [Rule 1 - Bug] Raw NUL bytes accidentally embedded literally instead of as escape-sequence source text**
- **Found during:** Task 3, during the plan's own `<done>` verification step (`grep -n "value" tests/support/pg-legality.ts` unexpectedly returned zero matches, which led to discovering `file` classified the source file as binary `data`)
- **Issue:** Two occurrences in the classifier (`value.includes('U+0000')`, `key.includes('U+0000')`) and five occurrences in the test fixtures contained a literal raw `0x00` byte rather than the 6-character escape-sequence text `U+0000`. Functionally harmless (identical runtime string value; all 30 tests passed both before and after the fix), but it broke `grep`/`file`'s text-mode detection on both files, which would have made the classifier's own source and its test fixtures unusually hard to review, diff, or grep in a future `/gsd-code-review` pass.
- **Fix:** Programmatically replaced every raw `0x00` byte with the literal 6-character ASCII text `U+0000` in both files (verified byte-for-byte: 0 remaining raw NUL bytes in either file; git now shows normal line-based diffs, not "Binary files differ").
- **Files modified:** tests/support/pg-legality.ts, tests/unit/lib/pg-legality.test.ts
- **Verification:** Re-ran the full 30-test suite after the fix — still 30/30 passing; `pnpm typecheck` and `pnpm lint` clean; `git diff --stat` on both files shows normal text-mode line counts.
- **Committed in:** d2306ae (Task 3 commit — the fix was applied before the single commit was made, so there is no separate "revert" commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correctness/reviewability. No scope creep — no new files, no new dependencies beyond the plan's own jszip, no behavior changes to the plan's specified interface.

## Issues Encountered
- Task 3's TDD flow (RED test written and confirmed failing with "Cannot find package '@/../tests/support/pg-legality'" — note the import path was also corrected from an invalid `@/..` alias trick to a proper relative `../../support/pg-legality` path before the RED confirmation — then GREEN implementation written and confirmed 30/30 passing) was committed as a single `test(...)` commit rather than the two separate `test(...)` → `feat(...)` commits described in the general TDD execution guidance. This plan's frontmatter is `type: execute`, not `type: tdd`, so the strict plan-level RED/GREEN gate-commit-sequence validation does not apply, but I'm flagging the granularity choice for transparency. No functional impact — both phases were genuinely executed and verified in order, just committed together.
- On first test run, one test assertion (`row 17: a 2-D array`) had a wrong expectation (assumed one finding when the fixture `[['a','b'],['c']]` correctly produces two — one per nested-array element). This was my own test-authoring error, not a classifier defect; fixed the assertion, confirmed the classifier's behavior was already correct (30/30 pass after the single-line test fix).

## User Setup Required
None - no external service configuration required. The jszip devDependency addition required no environment variables, dashboard steps, or manual configuration; it downloaded zero new bytes (already resolved in the lockfile via mammoth).

## Next Phase Readiness
- Plan 06-02 (forensic replay) can now run under `pnpm forensics` against `vitest.forensics.config.ts`, and import `classifyForPostgres()` from `tests/support/pg-legality.ts` to classify Claude's replayed output for the 12 production failures without writing anything to prod.
- Plan 06-03 (fixture corpus) can now use `jszip` (explicit devDependency) to build DOCX fixtures, and `pnpm fixtures:regen` is wired (though `tests/fixtures/cv-corpus/generate.mjs` does not exist yet — that script is 06-03's deliverable; running `pnpm fixtures:regen` today will fail with "Cannot find module", which is expected and correct until 06-03 lands).
- Plan 06-05 (layer-2 integration suite) can now use `pnpm test:integration` against `vitest.integration.config.ts`; the directory `tests/integration/` does not exist yet (06-05's deliverable), so the config currently reports "No test files found, exiting with code 0" — expected and correct.
- No blockers. `package.json` is now "owned" by this plan for the whole phase as intended, so 06-02 through 06-10 should not need to touch it again for scripts/deps already covered here.

---
*Phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world*
*Completed: 2026-08-09*

## Self-Check: PASSED

- FOUND: vitest.forensics.config.ts
- FOUND: vitest.integration.config.ts
- FOUND: tests/support/pg-legality.ts
- FOUND: tests/unit/lib/pg-legality.test.ts
- FOUND: commit debd826 (git log --oneline --all)
- FOUND: commit d2306ae (git log --oneline --all)
