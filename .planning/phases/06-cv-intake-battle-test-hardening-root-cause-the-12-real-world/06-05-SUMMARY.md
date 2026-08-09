---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
plan: 05
subsystem: testing
tags: [vitest, supabase, postgres, postgrest, integration-test, cv-intake, tdd]

# Dependency graph
requires:
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-01 test-runner wiring (vitest.integration.config.ts, pnpm test:integration) + tests/support/pg-legality.ts classifier"
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-02 forensic replay findings (06-FORENSICS.md — no C7, all 12 extract clean) + parseCVDetailed stop_reason/purpose exposure"
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-03 fixture-corpus generator + jszip devDependency (referenced by tests/fixtures/cv-corpus/ conventions)"
provides:
  - "tests/integration/supabase-harness.ts — isStackUp()/getHarness() real-local-Supabase test harness with a hard localhost-only guard"
  - "tests/integration/cv-write-path.test.ts — 15 designed-RED tests (C1-C5 + silent-corruption + error-detail contract) + 7 negative controls against a real Postgres 17.6 + PostgREST v14.5"
  - "tests/fixtures/cv-corpus/hostile-payloads.ts — HOSTILE_PAYLOADS table, the canonical synthetic-payload source for layer-2 write-path testing"
  - "tests/unit/lib/ai/cv-parse-truncation.test.ts — 2 designed-RED + 2 must-not-regress tests for the max_tokens truncation class (C6)"
affects: [06-06, 06-07, 06-08, 06-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-database (not mocked) integration test harness resolving local Supabase credentials via the installed CLI binary directly (node_modules/.bin/supabase), sidestepping pnpm-not-on-bare-$PATH"
    - "RED-contract header comments recording the exact expected fail/pass counts, verified against a live run, so a reviewer can distinguish designed-red from new breakage"
    - "Dynamic import of the module under test so a genuinely-missing named export resolves to undefined (partial-file RED) rather than aborting collection of the whole test file"
    - "Re-read-the-row assertions (never trust result.ok alone) after every write, per 06-RESEARCH.md Pitfall 5"

key-files:
  created:
    - tests/integration/supabase-harness.ts
    - tests/integration/README.md
    - tests/integration/cv-write-path.test.ts
    - tests/fixtures/cv-corpus/hostile-payloads.ts
    - tests/unit/lib/ai/cv-parse-truncation.test.ts
  modified: []

key-decisions:
  - "Resolved local Supabase credentials via node_modules/.bin/supabase directly rather than `pnpm exec supabase` — this environment does not have bare `pnpm` on $PATH (confirmed empirically), and the compiled CLI binary works identically without depending on which package-manager wrapper is available at test-run time"
  - "organizations.slug required shortening from a full UUID to a 16-hex-char slice — the CHECK constraint organizations_slug_format (migration 20260519092943) caps slugs at 40 chars, which a `gsd-phase06-<full-uuid>` slug exceeds; discovered live on the first real run, fixed, re-verified"
  - "NUL and lone-surrogate payloads in hostile-payloads.ts are stored as literal 6-character escape-sequence TEXT (\\u0000, \\uD83D) rather than raw embedded control bytes — matches the byte-hygiene convention 06-01 established for tests/support/pg-legality.ts; caught and fixed a Write-tool artefact that had embedded 3 raw NUL bytes instead of escape text before the first commit"
  - "C3/C4 hostile payloads target markCandidateFieldsFromCV (typed candidate columns), C1/C2 target updateCandidateCVParse (extracted_data jsonb) — matches which real Postgres column each class actually writes to, per 06-RESEARCH.md's verified matrix"
  - "The BAD-ENUM test is the one case in the suite where result.ok===false is the PERMANENT expected outcome (an invalid enum value can never succeed) — it exists specifically to prove DbResult.detail will carry the SQLSTATE + column once 06-06/06-07 widen the type, satisfying the plan's 'a failed DB write's SQLSTATE is asserted on, not just the boolean failure' truth"

requirements-completed: [CVI-04]

# Metrics
duration: ~30min
completed: 2026-08-09
---

# Phase 6 Plan 05: Layer-2 Real-Supabase Write-Path Harness + RED Suite Summary

**Local-Supabase integration harness plus a 22-test class-by-class RED suite (15 designed-red, 7 negative controls) proving all six 06-RESEARCH.md failure classes against a real Postgres 17.6 + PostgREST v14.5, verified live**

## Performance

- **Duration:** ~30 min
- **Started:** ~2026-08-09T20:40Z (local stack start)
- **Completed:** 2026-08-09T21:06Z
- **Tasks:** 3 (all auto, Tasks 2-3 tdd)
- **Files modified:** 5 (all created, zero modified)

## Accomplishments
- `tests/integration/supabase-harness.ts`: `isStackUp()` (bounded, never throws/hangs — verified both up and down states complete in <1s) and `getHarness()` (seed org/candidate/candidate_cvs, `resetCandidate()`, `teardown()`), with a hard guard that refuses any non-localhost/127.0.0.1 URL
- `tests/integration/cv-write-path.test.ts`: 22 tests against the REAL `updateCandidateCVParse`/`markCandidateFieldsFromCV` helpers, re-reading the stored row on every assertion (never trusting `result.ok` alone) — verified live: **15 failed (designed-red), 7 passed (negative controls)**
- `tests/fixtures/cv-corpus/hostile-payloads.ts`: `HOSTILE_PAYLOADS` table with one entry per verified failure class plus negative controls, PII-free and synthetic throughout
- `tests/unit/lib/ai/cv-parse-truncation.test.ts`: the C6 (max_tokens truncation) RED test — verified live: **2 failed (designed-red), 2 passed (must-not-regress)**; `pnpm typecheck` reports exactly the one expected error class (missing `CVParseTruncatedError` export)
- Confirmed via `06-FORENSICS.md` (landed by plan 06-02, now visible after the required worktree reset — see Deviations) that no C7 class exists: all 12 real production failures extracted cleanly, so all six 06-RESEARCH.md classes are covered with nothing left over
- Zero regressions: `pnpm test` stayed at 57 pre-existing files / 520 baseline tests passing, plus the 2 new green tests in `cv-parse-truncation.test.ts` (522 total passed); `tests/integration/**` confirmed still excluded from the default suite
- Full local-DB cleanup verified: after every run (including the failed-run states), `select count(*) from organizations where name like 'gsd-phase06-integration-%'` returns 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Local-Supabase integration harness** - `d912365` (feat)
2. **Task 2: Hostile payload table + the class-by-class RED suite** - `30c6782` (test)
3. **Task 3: RED test for the max_tokens truncation class** - `feb9d28` (test)

**Plan metadata:** pending (orchestrator commits `.planning/` artefacts separately per this plan's constraints)

_Note: Tasks 2 and 3 are marked `tdd="true"` in the plan, but per the plan's own `<action>` guidance these are single-shot RED-suite-authoring tasks (the RED state IS the deliverable, not an intermediate step toward a same-plan GREEN) — each was committed as one `test(...)` commit after writing the assertions and verifying the exact designed-red/designed-green split against the real stack, matching the pattern 06-01 used for its own classifier test. No plan-level `type: tdd` gate applies (this plan's frontmatter is `type: execute`)._

## Files Created/Modified
- `tests/integration/supabase-harness.ts` (312 lines) - `isStackUp()` + `getHarness()`; credential resolution via `node_modules/.bin/supabase status -o env` with an env-var fallback; hard localhost/127.0.0.1-only guard; seed/reset/teardown for one organization + candidate + candidate_cvs row
- `tests/integration/README.md` - why this layer exists, how to start/run/stop the stack, what happens when it's down, the hard guard, RED discipline, cleanup discipline
- `tests/integration/cv-write-path.test.ts` (525 lines) - 22 tests: C1 (NUL, 3 tests), C2 (lone surrogate, 2), C3 (years overflow, 2 red + 2 green), C4 (salary bounds, 4 red + 1 green), C5 (JS TypeErrors, 2), silent-corruption contract (1), error-detail contract (1), negative controls (4)
- `tests/fixtures/cv-corpus/hostile-payloads.ts` (213 lines) - `HOSTILE_PAYLOADS: HostilePayloadEntry[]`, one entry per class with `{id, failureClass, payload, why, expectedCodeToday}`
- `tests/unit/lib/ai/cv-parse-truncation.test.ts` (205 lines) - mocks `@anthropic-ai/sdk` directly (not the wrapper), `server-only`, `@sentry/nextjs`, `@/lib/supabase/service`, `@/lib/stripe/cap-enforcement`, `@/lib/env`; dynamically imports `@/lib/ai/claude`

## Decisions Made
See `key-decisions` in frontmatter. The two most consequential:
1. **Credential resolution via the installed CLI binary, not `pnpm exec`** — verified this environment has no bare `pnpm` on `$PATH` (matches 06-RESEARCH.md's own Environment Availability note); invoking `node_modules/.bin/supabase` directly is more portable across whatever wraps `pnpm` on a given machine.
2. **Class-to-write-path mapping**: C1/C2 (Unicode illegalities) target `updateCandidateCVParse`'s `extracted_data` jsonb column (the "widest funnel" per 06-RESEARCH.md — Claude's entire tool-use output lands there); C3/C4/C5 target `markCandidateFieldsFromCV`'s typed `candidates` columns (`years_experience`, `salary_current_estimate`/`salary_expectation`, `full_name`, `work_experience`). This follows directly from which real Postgres column each verified-matrix row actually writes to.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree HEAD was behind the plan's required dependency commits**
- **Found during:** Setup, before Task 1
- **Issue:** The mandatory `git merge-base HEAD f53bc880...` branch check failed — this worktree's branch had been created from an earlier point in `main` (commit `d01bdc1`, before waves 1-2 of this phase landed), so `06-FORENSICS.md`, `06-02-SUMMARY.md`, `06-01-SUMMARY.md`/`06-03-SUMMARY.md`, and the `06-01`-delivered `vitest.integration.config.ts`/`tests/support/pg-legality.ts` this plan depends on (`depends_on: ["06-02", "06-03"]`) did not exist in the working tree.
- **Fix:** Per the plan's own explicit branch-check instructions ("if not, git reset --hard to it and verify"), reset the clean worktree to `f53bc8805a974d1e0ebb553cefddb4e886a9e3fa` (the merge commit landing waves 1-2). Working tree was clean beforehand (`git status --short` empty) — no work was at risk.
- **Verification:** Post-reset, `git merge-base HEAD f53bc880...` equals `f53bc880...` exactly; branch remained `worktree-agent-a0a365e9d4e6ab639` throughout (never touched `main`).
- **Committed in:** N/A (a `reset --hard` to a specified commit, not a code change; explicitly sanctioned by this task's own branch-check instructions, not the general destructive-git prohibition)

**2. [Rule 1 - Bug] `organizations.slug` CHECK constraint violation on first live run**
- **Found during:** Task 2, first `pnpm test:integration` run
- **Issue:** `getHarness()`'s seed slug (`gsd-phase06-${randomUUID()}`) is 48 characters; `organizations_slug_format` (migration `20260519092943`) caps slugs at 40 chars via `^[a-z0-9-]{3,40}$`. Every test in the file failed at `beforeAll` with `new row for relation "organizations" violates check constraint`.
- **Fix:** Shortened the slug to a 16-hex-char hyphen-free slice of the UUID (`gsd06-${slugSuffix}`, 22 chars total), keeping the full UUID in `name` for readability.
- **Files modified:** `tests/integration/supabase-harness.ts`
- **Verification:** Re-ran the full suite — seeding succeeded, all 22 tests executed (15 red / 7 green as designed) instead of 22/22 erroring at setup.
- **Committed in:** `d912365` (Task 1 commit — fixed before the commit was made)

**3. [Rule 1 - Bug] Write-tool artefact embedded raw NUL bytes instead of escape-sequence text**
- **Found during:** Task 2, immediately after drafting `hostile-payloads.ts`
- **Issue:** When writing the C1a/C1b/C1c payload strings containing a literal NUL character, the file-write tooling embedded 3 raw `0x00` bytes into the source file instead of the intended 6-character ASCII escape-sequence text ` ` — the same failure mode 06-01-SUMMARY.md documented and fixed for `tests/support/pg-legality.ts`. This would have violated this plan's own "committed sources free of raw control bytes" constraint and made the file register as binary to `grep`/`file`.
- **Fix:** Programmatically replaced all 3 raw NUL bytes with the literal text ` ` (byte-for-byte verified: 0 raw NUL bytes remaining, `file` reports "Unicode text, UTF-8 text"). Confirmed the lone-surrogate escapes (`\uD83D`, `\uDE00`) were NOT affected by the same bug — they were written correctly as literal escape-sequence text from the start.
- **Files modified:** `tests/fixtures/cv-corpus/hostile-payloads.ts`
- **Verification:** Byte-level scan for raw NUL and other raw control chars (both 0 after the fix); re-ran the full integration suite — all 3 NUL-dependent tests (C1a/b/c) still fail for the correct reason (`22P05`), proving the escape-sequence text still produces a real runtime NUL character.
- **Committed in:** `30c6782` (Task 2 commit — fixed before the commit was made)

---

**Total deviations:** 3 auto-fixed (1 blocking/setup, 2 bugs)
**Impact on plan:** All three were necessary for correctness (deviation 1: could not proceed at all without the dependency commits; deviation 2: the suite could not seed any row; deviation 3: violated an explicit hard constraint of this task). No scope creep — no new files beyond the plan's four deliverables, no new dependencies, no behavior changes to the plan's specified test contracts.

## Issues Encountered
- The plan's own Task 2 `<verify>` automated command (`const f=/(\d+) failed/.exec(t)`) has a false-negative: vitest's default reporter prints `Test Files  1 failed (1)` before `Tests  15 failed | 7 passed (22)`, so the unanchored regex matches "1" (from "Test Files") rather than "15" (from "Tests"), and the script's own `< 6` check then fails even though the real count (15) is well over the threshold. This is documented in `cv-write-path.test.ts`'s header comment (with the correct `/Tests\s+(\d+) failed/` pattern) so a future reviewer scripting against this suite's output doesn't hit the same false negative. Confirmed manually via `grep -n "failed" <output>` and the verbose per-test listing that the true state is 15 failed / 7 passed, satisfying the plan's actual `<done>` criterion ("at least six named tests fail... every negative control passes").

## User Setup Required
None - no external service configuration required. The local Supabase stack (Docker) was started and stopped entirely within this session; no secrets, dashboard steps, or environment variables were needed beyond what `supabase start` already provisions locally.

## Next Phase Readiness
- Plan 06-06 (zod coercion boundary + tightened tool schema + `CVParseTruncatedError`) and plan 06-07 (Postgres-legality sanitiser + `DbResult.detail`) now have a precise, live-verified RED target: turn exactly the 15 tests in `cv-write-path.test.ts` and the 2 tests in `cv-parse-truncation.test.ts` green, without disturbing the 7 + 2 tests that must stay green throughout.
- `HOSTILE_PAYLOADS` is available as the canonical fixture source for any later plan that needs the same synthetic hostile payloads (e.g., a future unit test on the zod coercion boundary itself).
- No blockers. The local Supabase stack was stopped (`pnpm exec supabase stop --no-backup`) at the end of this session; the `altus-quay-forthports` stack (a different project, ports `544xx`) was confirmed untouched throughout (verified via `docker ps` before and after).

---
*Phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world*
*Completed: 2026-08-09*

## Self-Check: PASSED

- FOUND: tests/integration/supabase-harness.ts
- FOUND: tests/integration/README.md
- FOUND: tests/integration/cv-write-path.test.ts
- FOUND: tests/fixtures/cv-corpus/hostile-payloads.ts
- FOUND: tests/unit/lib/ai/cv-parse-truncation.test.ts
- FOUND: .planning/phases/06-cv-intake-battle-test-hardening-root-cause-the-12-real-world/06-05-SUMMARY.md
- FOUND: commit d912365 (git log --oneline --all)
- FOUND: commit 30c6782 (git log --oneline --all)
- FOUND: commit feb9d28 (git log --oneline --all)
