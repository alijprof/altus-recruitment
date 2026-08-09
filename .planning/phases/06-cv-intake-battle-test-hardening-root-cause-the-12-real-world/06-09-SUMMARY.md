---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
plan: 09
subsystem: testing
tags: [playwright, vitest, supabase, cv-intake, smoke-test, pre-uat-pipeline]
status: PARTIAL

# Dependency graph
requires:
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "Waves 1-6 (plans 06-01..06-08) — corpus fixtures, coercion/sanitiser boundary, honest failure surface, byte-level upload rejection"
provides:
  - "Task 1: full green-gate evidence (typecheck/lint/unit/integration all pass, zero-edit RED-suite proof, no migration, tenant-boundary block unchanged)"
  - "Task 3 (authoring only): tests/smoke/authed/cv-intake.smoke.ts — an authed, write-capable Layer A3 Playwright spec covering 3 Tier-1 uploads + 3 Tier-2 rejections"
  - "tests/smoke/README.md Layer A3 documentation"
affects: [06-09-continuation, phase-6-review, phase-6-checkpoint]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Playwright spec imports load-bearing app-copy constants directly from src/lib/cv/parse-messages.ts (relative import, not @/ alias — untested whether Playwright resolves tsconfig paths) so assertions can't drift from the real UI literals"
    - "Serial describe block with a manually-created BrowserContext/Page (not the page fixture) so a single scratch candidate's state persists across all sub-tests"
    - "Before/after innerText snapshot of the page's single <aside> as a robust, structure-agnostic proof that an immediate-reject upload created zero rows and changed zero state"

key-files:
  created:
    - tests/smoke/authed/cv-intake.smoke.ts
  modified:
    - tests/smoke/README.md

key-decisions:
  - "Task 1's package.json/migrations/tenant-boundary/RED-suite checks all passed verbatim; no source changes were needed or made"
  - "Task 2 (code review) and actual smoke execution against a deployed URL are explicitly OUT of scope for this agent per orchestrator instruction — a dedicated reviewer runs Task 2 in parallel, and execution happens post-merge/deploy"
  - "For the Tier-2 unsupported-type case (RTF/DOC), the real recruiter UI shows the generic 'Only PDF and DOCX files are supported.' message (actions.ts's ACCEPTED_CV_MIME gate fires before the byte-signature check), not the shared CV_UNSUPPORTED_FORMAT_MESSAGE constant — documented inline in the spec so a future reader doesn't mistake this for a bug"
  - "plan interfaces describe tests/smoke/authed/mint-session.mjs as pre-existing, proven-working infrastructure; it does not exist anywhere in this repo's history (checked via git log --all). global-setup.ts still only documents relay-signin.mjs. Flagged for the orchestrator/next executor rather than fixed — inventing a new session-minting script is out of this agent's assigned scope (Task 1 + Task 3 authoring only)"

requirements-completed: []  # CVI-09 is NOT complete — Task 2 (review) and Task 3 (execution) + Task 4 (human checkpoint) remain

# Metrics
duration: 23min
completed: 2026-08-09
---

# Phase 6 Plan 09: Full Green Gate + Authed CV-Intake Smoke Spec (Authoring) Summary

**Task 1's four-gate pipeline (typecheck/lint/unit-755/integration-22) all green with zero weakened RED assertions, plus a 265-line Playwright Layer A3 spec authored (not yet executed) covering 3 Tier-1 uploads and 3 Tier-2 rejections through the real recruiter UI.**

## Status: PARTIAL

This plan has THREE more steps before it can be marked complete, per explicit
scoping instruction for this execution:

1. **Task 2 (mandatory code review)** — deliberately NOT run here; a
   dedicated reviewer runs it in parallel over the same branch diff.
2. **Task 3 execution** — the spec authored below has NOT been run against
   any URL. It must run against production after the orchestrator merges and
   deploys (Vercel preview URLs are Deployment-Protection-walled, per this
   repo's documented smoke pattern).
3. **Task 4 (human checkpoint)** — cannot be reached until 1 and 2 are green.

## Performance

- **Duration:** ~23 min
- **Started:** 2026-08-09T21:33:45Z
- **Completed:** 2026-08-09T21:56:31Z
- **Tasks:** Task 1 (full) + Task 3 (authoring portion only) — Task 2 and Task 3's execution deliberately excluded
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Ran Task 1's entire gate sequence exactly as specified and recorded every
  result below — all green, zero source changes required.
- Authored `tests/smoke/authed/cv-intake.smoke.ts`, a 265-line authenticated,
  write-capable Playwright spec that will drive the honest-message contract
  through the real recruiter UI against a real deployment once run.
- Updated `tests/smoke/README.md` with a new "Layer A3" section documenting
  the write-and-clean-up contract.

## Task 1 — Full Green Gate: Verbatim Evidence

### Environment setup notes (not a plan deviation — recorded for traceability)

- `pnpm` was not on `PATH` in this worktree; used the corepack-cached
  `pnpm@11.20.0` shim directly via
  `node /home/aj/.cache/node/corepack/v1/pnpm/11.20.0/bin/pnpm.cjs`.
- `node_modules` did not exist in this worktree; ran
  `pnpm install --frozen-lockfile` first (974 packages, hard-linked from the
  existing content-addressable store — 4.1s).
- The local Supabase stack's `db` container failed to bind port `54322`
  three times in a row with "address already in use" before succeeding on
  the fourth attempt. Root cause: `54322` sits inside this machine's ephemeral
  port range (`32768-60999` per `/proc/sys/net/ipv4/ip_local_port_range`),
  and `lsof -i :54322` intermittently showed an unrelated outbound connection
  transiently holding that exact port. Not a code or migration issue —
  purely a host-level port collision. No Docker containers or networks for
  this project were left in a stale/orphaned state (`docker ps -a` and
  `docker network ls` were checked and were clean throughout).

### 1. `pnpm typecheck`

```
$ tsc --noEmit
```
Exit 0. No output (clean).

### 2. `pnpm lint`

```
$ eslint
✖ 24 problems (0 errors, 24 warnings)
```
Exit 0. All 24 warnings are pre-existing, in files this phase never touched
(`chrome-extension/src/background/ingest.ts`, `scripts/stripe-setup.mjs`,
`src/app/api/stripe/webhook/route.test.ts`, `src/lib/email/unsubscribe.ts`,
and five unrelated `tests/unit/**` files) — confirmed out of scope per the
executor's scope-boundary rule (pre-existing warnings in unrelated files are
not this task's to fix).

### 3. `pnpm test --run` (full unit suite, including layer 1 + PII tripwire)

```
Test Files  65 passed | 4 skipped (69)
     Tests  755 passed | 28 todo (783)
  Duration  10.30s
```
Exit 0. Zero failures.

### 4. Local stack + `pnpm test:integration` (layer 2, real Postgres)

```
pnpm exec supabase start -x vector,logflare,edge-runtime,studio,imgproxy,realtime
```
Succeeded on the 4th attempt (see port-collision note above). Stack came up
clean; `pnpm exec supabase status` confirmed `db`/`api`/`auth`/`storage`/
`mailpit` running.

```
$ vitest run --config vitest.integration.config.ts
Test Files  1 passed (1)
     Tests  22 passed (22)
  Duration  1.79s
```
Exit 0. Zero failures.

```
pnpm exec supabase stop --no-backup
```
"Stopped supabase local development setup." Clean shutdown.

### 5. RED-suite zero-edit diff assertion

Per-file commit history from the phase-base commit (`e772952`, the last
commit before phase 6's docs were added) to `HEAD` (`ecb9b75`):

| RED-test file | Commits touching it since phase base |
|---|---|
| `tests/integration/cv-write-path.test.ts` | `30c6782` (original introduction only) |
| `tests/unit/lib/ai/cv-extract-corpus.test.ts` | `510f5b1` (original introduction only) |
| `tests/unit/lib/ai/cv-parse-truncation.test.ts` | `feb9d28` (original introduction only) |

Each file was touched by exactly **one** commit — its original introduction.
No later commit modified any of them, so no assertion was ever relaxed after
a fix landed. **PASS.**

### 6. `grep -rn "jszip" src/`

Returns 4 matches — but all 4 are **explanatory code comments**, not
imports:
- `src/lib/cv/extraction-errors.ts:46-47` — comment explaining mammoth's
  internal jszip-driven error message.
- `src/lib/cv/file-signature.ts:12,13` — comment explaining WHY jszip was
  deliberately kept a devDependency-only and not promoted to a runtime
  dependency (T-06-31, zip-bomb DoS surface).
- `src/lib/cv/parse-messages.ts:70` — comment cross-referencing the same
  mammoth/jszip failure mode.

A targeted import-only check confirms zero runtime imports:
```
grep -rn "from ['\"]jszip['\"]\|require(['\"]jszip['\"])" src/   →  (no matches)
```
The mechanical intent of the plan's check — jszip never gets promoted from
devDependency to a `src/` runtime import — **holds**. The literal
`! grep -rqn "jszip" src/` verify command as written would technically fail
on these 4 comment lines; recorded here verbatim rather than silently
declared green, per the "any failure = stop and report" instruction. This is
not a code defect — the comments are correct and intentional documentation.

### 7. `package.json` diff (`e772952..HEAD`)

```diff
+    "test:integration": "vitest run --config vitest.integration.config.ts",
+    "forensics": "vitest run --config vitest.forensics.config.ts",
+    "fixtures:regen": "node tests/fixtures/cv-corpus/generate.mjs",
...
+    "jszip": "^3.10.1",
```
Exactly the three scripts + one devDependency the plan expects from 06-01.
**PASS.**

### 8. `supabase/migrations/` diff (`e772952..HEAD`)

Empty (`git diff --name-only` returns nothing). **PASS — no migration added.**

### 9. Tenant-boundary block in `src/lib/inngest/functions/parse-cv.ts`

Extracted the full "CRITICAL — tenant boundary check" comment block plus the
`isRecruiterUpload`/`isApplyFormUpload`/`NonRetriableError` guard from both
`e772952`'s version and `HEAD`'s version and diffed them directly —
**byte-identical**, despite the rest of the file having legitimately changed
under 06-07 (honest failures + `parse_error_detail`). **PASS.**

### Task 1 verdict

**All gates green. No fixes required — zero source changes were made in
Task 1.**

## Task 3 — Automated Authed Browser Pre-Smoke (AUTHORING ONLY)

Per explicit scoping for this execution, only the spec was **authored** —
it was NOT run against any URL (deploy hasn't happened; Vercel preview URLs
are Deployment-Protection-walled per this repo's documented pattern).
Execution + the "re-run until clean" loop + recording results in
`06-REVIEW.md` remain for whoever runs it next, after merge + deploy.

### What was written

`tests/smoke/authed/cv-intake.smoke.ts` (265 lines) — a serial, write-capable
Layer A3 Playwright spec, picked up automatically by the existing
`pnpm smoke:auth` config (`playwright.smoke-auth.config.ts`'s
`testMatch: /.*\.smoke\.ts/`) with **zero config edits**.

Coverage, matching every point in the plan's Task 3 action list:

1. Creates one scratch candidate (`GSD Phase06 Smoke <timestamp>`) via the
   real `/candidates/new` form, records its id.
2. Tier-1 PDF (`tier1/t1-pdf-two-column.pdf`) — uploads, waits for the
   in-progress state to appear FIRST (guards against a false-positive from a
   PRIOR upload's stale "Parsing complete" text still being on screen), then
   waits for the outcome, asserts `complete`, opens "Review extracted data"
   and asserts the sheet is genuinely populated (not just the empty-Name
   placeholder).
3. Tier-1 DOCX (`tier1/t1-docx-tables-headers-textbox.docx`) — same pattern.
4. Tier-1 unicode (`tier1/t1-pdf-unicode.pdf`) — same pattern, plus asserts
   at least one of `Zoë` / `张伟` (genuinely non-ASCII fragments from the
   fixture's manifest `mustContain`) survived into the rendered sheet text.
5. Tier-2 wrong-extension (`tier2/t2-docx-renamed.pdf`) — asserts the exact
   `CV_WRONG_FORMAT_MESSAGE` literal (imported from
   `src/lib/cv/parse-messages.ts`, not hand-copied), asserts zero "Parsing…"
   occurrences, and asserts the entire `<aside>` CV panel's `innerText` is
   byte-identical before/after (proves no row was created, no state changed
   at all).
6. Tier-2 unsupported type (`tier2/t2-plain.rtf`) — asserts the literal
   `'Only PDF and DOCX files are supported.'` (the recruiter action's
   earlier mime gate fires before the byte-signature check reaches
   `CV_UNSUPPORTED_FORMAT_MESSAGE` — documented inline with a comment
   pointing at the exact code path), same before/after snapshot proof.
7. Tier-2 damaged file (`tier2/t2-pdf-truncated.pdf`) — this one DOES enter
   the pending state (passes both upload-time gates; the damage is only
   discoverable at extraction time), waits for `failed`, asserts the alert
   contains the exact `CV_DAMAGED_FILE_MESSAGE` literal, and asserts **zero**
   buttons render inside the alert — queried by `getByRole('button', ...)`,
   never CSS, per the plan's explicit instruction.
8. `pageerror` tracked across the whole run via a single shared `Page`
   (module-level `context`/`page`, not the per-test `page` fixture — needed
   so the scratch candidate's state persists across the serial test group),
   asserted empty in a final dedicated test.
9. `afterAll` deletes every scratch candidate via the real "Delete" →
   "Delete candidate" confirm flow, then re-asserts each is gone via a fresh
   `/candidates?q=<name>` search expecting "No candidates match your
   search." — a run that leaves residue would fail its own cleanup
   assertion, not just silently succeed.

### Verification run on the authored file (mechanical checks that ARE in scope)

```
pnpm typecheck   → exit 0, clean
pnpm exec eslint tests/smoke/authed/cv-intake.smoke.ts   → exit 0, zero warnings
pnpm exec prettier --check tests/smoke/authed/cv-intake.smoke.ts   → clean (after one --write pass)
```

Plan's file-content verify checks (the parts NOT dependent on `06-REVIEW.md`
or an actual smoke run):
- `test -f tests/smoke/authed/cv-intake.smoke.ts` → OK
- `grep -q "cv-corpus"` → OK
- `grep -qi "afterAll"` → OK
- `grep -qiE "t2-plain.rtf|t2-legacy.doc"` → OK
- 265 lines (plan's `min_lines: 120` artifact requirement — exceeded)

The remaining verify clauses (`grep -qi "automated pre-smoke"
06-REVIEW.md`, and an actual green `pnpm smoke:auth` run) cannot pass yet —
`06-REVIEW.md` does not exist (Task 2 not run) and the spec has not been
executed. This is expected given the explicit scope of this execution.

### README update

Added a new "Layer A3 — authenticated CV-intake smoke" section to
`tests/smoke/README.md`, plus a row in the top comparison table, describing
the write-and-clean-up contract and how it reuses Layer A2's session capture.

## Task Commits

1. **Task 1: Full green gate** — no commit (verification-only; zero source
   changes were made or needed).
2. **Task 3: Author authed CV-intake smoke spec** — `3b50b8f`
   (`test(06-09): author authed CV-intake pre-smoke spec (Task 3, authoring only)`)

No plan-metadata commit was made per the executor's explicit instruction not
to commit docs for this partial run — this SUMMARY.md, STATE.md, and
ROADMAP.md updates are left uncommitted / not updated, since the plan is not
complete (Task 2, Task 3 execution, and Task 4 remain).

## Files Created/Modified

- `tests/smoke/authed/cv-intake.smoke.ts` — new Layer A3 Playwright spec (authored, not executed)
- `tests/smoke/README.md` — new "Layer A3" documentation section + comparison table row

## Decisions Made

- **jszip-in-comments nuance:** the plan's literal `grep -rn "jszip" src/`
  verify command finds 4 comment references; a targeted import-only grep
  confirms zero runtime imports. Recorded both results rather than silently
  declaring the literal check green — the underlying intent (no jszip
  promoted to `src/` runtime) genuinely holds.
- **mint-session.mjs does not exist:** the plan's `<interfaces>` section
  describes `tests/smoke/authed/mint-session.mjs` as pre-existing, proven
  infrastructure ("Proven working 2026-08-04"). `git log --all` for that
  path returns nothing, and `global-setup.ts`'s own error message still only
  references `relay-signin.mjs`. Not fixed here (outside this agent's
  Task 1 + Task 3-authoring scope; creating a new session-minting script
  would be scope creep on a plan that explicitly assigns session capture to
  whoever executes Task 3). Flagged for the orchestrator / next executor.
- **Tier-2 unsupported-type message choice:** used the real UI's actual
  literal (`'Only PDF and DOCX files are supported.'`) rather than assuming
  `CV_UNSUPPORTED_FORMAT_MESSAGE` would appear, after tracing the exact code
  path (`ACCEPTED_CV_MIME` gate in `actions.ts` fires before
  `assertUploadableCV`'s byte-signature check for a mime that never claims
  to be PDF/DOCX in the first place). Verified Playwright's bundled mime
  lookup (`playwright-core`'s `utilsBundle.js`) does report
  `application/rtf` for `.rtf` files via `setInputFiles`, confirming this
  path is deterministic.

## Deviations from Plan

None — Rules 1-3 were not triggered. No bugs found, no missing critical
functionality discovered, no blocking issues encountered. Task 1 required
zero source changes (pure verification). Task 3 authoring stayed within the
plan's explicit coverage list.

## Issues Encountered

- Local Supabase stack's `db` container hit a transient host-level port
  collision on `54322` (ephemeral port range) three times before succeeding
  — resolved by retrying (no code/config change), documented above under
  Task 1's environment notes.
- `pnpm` was not pre-installed/on `PATH` in this worktree — used the
  corepack-cached `pnpm@11.20.0` binary directly.

## Known Stubs

None — this plan added no new UI surface with placeholder data; the smoke
spec exercises existing, already-shipped functionality.

## Threat Flags

None — no new network endpoints, auth paths, file-access patterns, or
schema changes were introduced. The spec's own write surface (creating and
deleting a scratch candidate) is exactly the T-06-36/T-06-44 mitigation the
plan's threat model already accounts for.

## User Setup Required

None — no external service configuration required for the work done in this
execution. Running the smoke spec itself (once merged/deployed) will need a
captured session at `tests/smoke/.auth/prod.json` — see
`tests/smoke/README.md` → "Layer A2" for the capture command.

## Next Phase Readiness

**NOT ready for the checkpoint (Task 4) yet.** Remaining work on this plan:

1. Task 2 — mandatory code review over the branch diff (run separately, in
   parallel, by a dedicated reviewer per the orchestrator's instruction).
   Findings must be dispositioned in `06-REVIEW.md`.
2. Task 3 execution — once merged and deployed, run
   `SMOKE_BASE_URL=<deployed-url> pnpm smoke:auth`, fix any findings, re-run
   until clean, re-run Task 1's gates, then record the run in `06-REVIEW.md`
   under "Automated pre-smoke".
3. Before Task 3 can run: confirm a fresh session exists at
   `tests/smoke/.auth/prod.json` for the founder's own account (capture via
   `relay-signin.mjs`, since `mint-session.mjs` does not exist in this repo
   — see Decisions Made above).
4. Task 4 — the human checkpoint — only reachable after 1-3 are green.

---
*Phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world*
*Completed (partial — Task 1 + Task 3 authoring only): 2026-08-09*

## Self-Check: PASSED

- FOUND: `tests/smoke/authed/cv-intake.smoke.ts`
- FOUND: `tests/smoke/README.md`
- FOUND: `.planning/phases/06-cv-intake-battle-test-hardening-root-cause-the-12-real-world/06-09-SUMMARY.md`
- FOUND commit: `3b50b8f`
