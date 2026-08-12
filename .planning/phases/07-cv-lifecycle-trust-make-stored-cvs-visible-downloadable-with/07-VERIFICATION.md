# Phase 7 Plan 08 — Verification

Status: **PARTIAL** — this run covers Task 1 (full autonomous gates) and the
AUTOMATED half of Task 3 (authoring `tests/smoke/authed/cv-lifecycle.smoke.ts`
and gating the spec file itself). Task 2 (mechanical code review) and the
actual execution of Task 3's browser smoke, plus Task 4 (founder UAT
checkpoint), are explicitly OUT OF SCOPE for this run — see "Scope note"
below.

## Scope note

This run was invoked with an explicit instruction to cover ONLY:

- Task 1's full gate sequence.
- Authoring `tests/smoke/authed/cv-lifecycle.smoke.ts` (Task 3's spec-writing
  half) and typechecking/linting/formatting it.

Explicitly excluded, per the invoking instructions:

- Task 2 (`/gsd-code-review`) — the orchestrator runs this in parallel with a
  dedicated reviewer agent.
- Actually executing `pnpm smoke:auth` (Task 3's run half) — the phase branch
  has not been deployed yet; this repo's documented pattern is that the authed
  smoke runs against PRODUCTION (`https://altusrecruit.com`) post-merge, not
  pre-merge, and there is no captured session (`tests/smoke/.auth/prod.json`)
  in this environment to run it with regardless.
- Task 4 (founder UAT checkpoint) — blocking, requires a human.

Because of this, Task 3's own `<done>` criterion ("Both authed specs pass...")
is **not yet met** by this run. That remains for a post-merge execution pass.

## Pre-run setup (worktree-local, not part of the phase diff)

This worktree had no `node_modules` and no local Supabase stack running.
Neither is a code change:

- `npm install -g pnpm@9` (global CLI, not a repo dependency) then
  `pnpm install --frozen-lockfile` — installed exactly what `pnpm-lock.yaml`
  already specifies; the lockfile itself is untouched (see the "no new
  dependency" assertion below).
- `.env.local` created LOCALLY with placeholder (non-secret) values for the
  five env vars `pnpm build`'s zod validation requires
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`,
  plus `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `VOYAGE_API_KEY` for a client
  instantiated eagerly at module-load in `/api/inngest`). This file is
  git-ignored (`.env*` in `.gitignore`) and was never staged or committed.
  Per project MEMORY, the real build gate is the Vercel build — this local
  build with placeholder envs is a genuine bonus signal (it exercises
  `next build`'s Turbopack compile + typecheck + static-generation pass over
  every route, including every Phase-7-touched route), not a replacement for
  it.
- `pnpm exec supabase start -x vector,logflare,edge-runtime,studio,imgproxy,realtime`
  to bring up a local Postgres 17 + PostgREST + GoTrue + Storage stack for
  `pnpm test:integration`, then `pnpm exec supabase stop` immediately after
  the suite finished (stack is NOT left running).

## Task 1 — Full autonomous gates

Command run for each, verbatim result below. All green.

### `pnpm lint`

```
✖ 32 problems (0 errors, 32 warnings)
```

**0 errors.** All 32 warnings are pre-existing `@typescript-eslint/no-unused-vars`
(mock parameter placeholders in test files) and one `no-console` unused-disable
warning in `chrome-extension/src/background/ingest.ts` — none in any file this
phase touched (`src/app/(app)/candidates/[id]/**`,
`src/app/(app)/jobs/[id]/matches/**`, `src/lib/cv/**`,
`tests/smoke/authed/cv-lifecycle.smoke.ts`). Confirmed zero warnings on the new
spec file specifically: `pnpm exec eslint tests/smoke/authed/cv-lifecycle.smoke.ts`
produced no output.

### `pnpm typecheck`

```
> tsc --noEmit
```

Clean — no output, exit 0.

### `pnpm test` (`vitest run`)

Note: the plan's literal verify command (`pnpm test --run`) does not reach
vitest as written — pnpm intercepts the bare `--run` flag itself
(`ERROR  Unknown option: 'run'`) rather than forwarding it to the `test`
script. This is a pnpm-CLI argument-passing quirk, not a code defect; the
correct invocations are `pnpm run test -- --run` or `pnpm exec vitest run`
(both forward the flag correctly). Ran both to confirm identical results:

```
 Test Files  74 passed | 4 skipped (78)
      Tests  890 passed | 28 todo (918)
```

Zero failures. Confirmed no new test regressions: this is the full existing
suite (nothing in this plan added or modified a `tests/unit/**` file), so
"no NEW failures" and "no previously-passing test whose meaning changed" both
hold trivially — the suite is byte-identical to the pre-phase baseline.

### `pnpm build` (`next build`)

Compiled successfully (Turbopack, 16-17s), `runAfterProductionCompile`
completed, `tsc` pass inside the build completed, and all 64 routes generated
— including every Phase-7-touched route:
`/candidates/[id]`, `/candidates/[id]/edit`, `/jobs/[id]/matches`, `/admin`,
`/admin/[orgId]`. No build errors once the placeholder env vars above were in
place (see "Pre-run setup").

### `pnpm test:integration` (real local Supabase, Docker)

```
 Test Files  2 passed (2)
      Tests  25 passed (25)
```

Local stack was started, all 25 integration tests passed against a real
Postgres 17.6 + PostgREST, then the stack was stopped
(`pnpm exec supabase stop` → "Stopped supabase local development setup.").

### No dependency added

```
$ git diff --stat package.json pnpm-lock.yaml
(empty)
```

Confirmed empty — no plan in this phase added a dependency.

### No migration added

```
$ git status --porcelain supabase/migrations/
(empty)
```

Confirmed empty. This phase was designed to need none — `export` already
exists in the `audit_action` enum (migration `20260513152244`:77).

**Task 1 verdict: all gates green, no dependency added, no migration added.**

## Task 2 — Mechanical code review

**NOT RUN in this pass** — explicitly excluded per the invoking instructions.
The orchestrator runs `/gsd-code-review` in parallel via a dedicated reviewer
agent. This section intentionally left for that agent to fill in.

## Task 3 — Authenticated browser pre-smoke

### Authoring (done in this run)

Created `tests/smoke/authed/cv-lifecycle.smoke.ts` (441 lines) — a sibling to
the frozen `tests/smoke/authed/cv-intake.smoke.ts`, under its own
`'GSD Phase07 Smoke'` scratch prefix (distinct from cv-intake's
`'GSD Phase06 Smoke'`, so the two specs' cleanup sweeps can never touch each
other's rows).

Copied verbatim from `cv-intake.smoke.ts` (per the plan's explicit
instruction — re-deriving these would re-introduce the bugs their inline
comments record):

- `readSessionUserId` — decodes the storageState JWT, throws on any
  unrecognised cookie shape.
- The fail-closed `SMOKE_ALLOWED_USER_ID` guard in `beforeAll` — required env
  var, compared against the decoded session's `sub`, refuses to run on
  mismatch or absence.
- `trackPageErrors` (pageerror listener).
- `uploadAndAwaitPending` / `waitForParseOutcome` shapes.
- The prefix-sweep `afterAll`: hydration-aware `.waitFor()` before every
  `count()`-equivalent read, deletes ANY row matching the prefix (not just
  tracked ones, to catch orphans from an aborted run), then re-asserts via a
  fresh server round-trip that nothing survives.
- `role="alert"` scoped to `page.locator('main')` throughout (sonner-toast
  lesson).

Imports `CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY` from
`src/lib/cv/cv-file-display.ts` (not hand-copied) and asserts the enabled
View control's `title` is NOT that literal — the plan's mandated
`cv-file-display` key-link.

Seven scenarios, serial order, matching the plan's numbered list:

1. Create scratch candidate (id tracked before any assertion that could
   throw).
2. Upload `tier1/t1-pdf-two-column.pdf`, wait for a `'complete'` outcome.
3. CV files section (07-01): scoped strictly to the "CV files" `<section>`
   (never the sibling "Latest CV" panel, which renders a View control for the
   same row) — asserts filename + absolute date + an enabled View control,
   clicks it, captures the popup via `context.waitForEvent('page')`, asserts
   the opened URL's origin differs from the app's own origin, re-requests the
   exact URL via `popup.request.get()` and asserts HTTP 200, closes the
   popup.
4. Confidence cue (07-02): asserts `getByRole('button', { name: 'Review
   extracted data' })` still resolves exactly, then asserts the unsure badge
   and the named-field line are both visible or both absent — never one
   without the other. No hard-coded count (model-dependent, would flake for
   no signal).
5. Full-field editing (07-03 + 07-04): expands the five non-default-open
   accordion sections, adds a skill chip, adds one work-history row and one
   education row (each scoped via its `role="group"` accessible name so the
   shared "Dates" label can never resolve ambiguously), sets Seniority via
   the Radix `combobox`/`option` roles, sets a salary, saves, then asserts on
   the detail page that Experience / Education / Skills / Employment
   (seniority) / Compensation (salary, formatted via the same
   `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })` the
   app itself uses) all show the values just entered.
6. Match freshness (07-07): navigates to the first open job's `/matches`
   page (read-only; asserts on structure/copy only, never candidate names, so
   no real-org PII enters an assertion or a failure message), asserts no
   copy contains `"refresh to see"`, and asserts `Score all` is visible
   whenever at least one match card is present. Skips gracefully
   (`test.skip`) if the org has no open jobs. Deliberately never clicks
   `Score all` (real Sonnet spend for no additional signal).
7. Zero uncaught `pageerror`s across the whole run.

**Known limitation flagged in the spec itself (scenario 6):** `showScoreAll`
(`src/app/(app)/jobs/[id]/matches/page.tsx`) is `false` when every visible
card is already fresh (recently (re-)scored), which is indistinguishable
client-side from "cards present but nothing needs scoring". In the org's
steady state (an unscored backlog, or newer applications outrunning the
freshness window) at least one card is expected to be non-fresh, but a job
whose top-10 happen to be entirely fresh at smoke time would fail this one
assertion. This is flagged as a code comment at the assertion site rather
than silently weakened, per the plan's literal instruction ("Assert the
Score all control exists when cards are present"). If a post-merge run trips
this specifically, it is a spec-robustness question for a human to decide
on, not a product bug.

### Gates on the new spec file (done in this run)

```
$ pnpm exec prettier --check tests/smoke/authed/cv-lifecycle.smoke.ts
All matched files use Prettier code style!   (after one --write pass)

$ pnpm exec eslint tests/smoke/authed/cv-lifecycle.smoke.ts
(no output — clean)

$ pnpm typecheck
(clean — whole-project tsc --noEmit passes with the new file included)

$ pnpm exec playwright test --config playwright.smoke-auth.config.ts --list
  ...
  [smoke-auth] › cv-lifecycle.smoke.ts:218:7 › @smoke-auth cv-lifecycle › creates a scratch candidate for this smoke run
  [smoke-auth] › cv-lifecycle.smoke.ts:233:7 › @smoke-auth cv-lifecycle › uploads a Tier-1 CV and reaches a completed parse
  [smoke-auth] › cv-lifecycle.smoke.ts:243:7 › @smoke-auth cv-lifecycle › CV files section (07-01): View opens a real, working signed URL — not a dead link
  [smoke-auth] › cv-lifecycle.smoke.ts:296:7 › @smoke-auth cv-lifecycle › Confidence cue (07-02): Review button unchanged; unsure badge and named-field line appear together or not at all
  [smoke-auth] › cv-lifecycle.smoke.ts:316:7 › @smoke-auth cv-lifecycle › Full-field editing (07-03 + 07-04): every value round-trips into Experience / Skills / Education / Compensation
  [smoke-auth] › cv-lifecycle.smoke.ts:391:7 › @smoke-auth cv-lifecycle › Match freshness (07-07): no stale "refresh to see" copy; Score all appears whenever match cards are present
  [smoke-auth] › cv-lifecycle.smoke.ts:438:7 › @smoke-auth cv-lifecycle › no uncaught client-side errors across the whole run
  Total: 24 tests in 3 files
```

`--list` is static enumeration only — no browser is launched, no network
request is made, nothing is written anywhere. It confirms the file parses,
every import resolves (including the relative import into `src/lib/cv/`),
and all seven scenarios register under the correct serial describe block
alongside the frozen `cv-intake.smoke.ts` (8 tests) and `read-only.smoke.ts`
(9 tests) — 24 tests total across the three spec files, matching expectation.

### Execution (NOT run in this pass)

`pnpm smoke:auth` was **not** run. Per the invoking instructions: the phase
branch has not been deployed, and this repo's documented pattern
(`playwright.smoke-auth.config.ts` header comment, `tests/smoke/README.md`)
is that the authed smoke targets `https://altusrecruit.com` — i.e. it is a
POST-merge, post-deploy verification step, not a pre-merge one. There is also
no captured session at `tests/smoke/.auth/prod.json` in this environment.

**This remains outstanding** and must happen — against production, with both
`cv-intake.smoke.ts` and `cv-lifecycle.smoke.ts` passing together via
`pnpm smoke:auth` — before Task 4's founder checkpoint is presented, per the
plan's own Task 3 `<done>` criterion and 07-08-PLAN.md's overall
`<success_criteria>`.

## Task 4 — Founder UAT handoff

Not reached. Blocking checkpoint, requires a human, explicitly out of scope
for this run.

## Frozen Phase-6 assertions (verified by inspection, not by running the spec)

Read directly from source (not executed) to confirm nothing in this phase's
diff broke them:

- `cv-review-panel.tsx`: the unsure badge (`hasUnsureFields ? <Badge>...`) is
  a flex SIBLING of the `<SheetTrigger>` button, never nested inside it — the
  accessible name of `getByRole('button', { name: 'Review extracted data' })`
  is unaffected.
- `cv-files-panel.tsx`: no `Alert` component and no `role="alert"` element
  anywhere in the CV files section (confirmed by reading the full file) — the
  View control for a failed row lives in this section, not inside
  `CvReviewPanel`'s `FailedState` alert.
- `cv-files-panel.tsx` uses `formatDateLong` (absolute date), never
  `formatTimeAgo`.

## Overall verdict for this run

- Task 1: **COMPLETE, all green.**
- Task 2: **NOT RUN** (out of scope — parallel reviewer).
- Task 3: **PARTIAL** — spec authored and gated (typecheck/lint/prettier/
  `--list` all clean); actual `pnpm smoke:auth` execution against
  production is outstanding.
- Task 4: **NOT REACHED** (blocking human checkpoint).

This SUMMARY/VERIFICATION pair is intentionally marked PARTIAL. Per this
run's constraints, `07-08-SUMMARY.md`, `STATE.md`, and `ROADMAP.md` are NOT
being committed by this run — that remains for the orchestrator once the
code-review pass and the post-merge smoke execution both land.

## Addendum (2026-08-12) — outstanding items closed

This addendum supersedes the "Overall verdict for this run" block above — it
records what has happened since this run closed.

- **Task 2 (code review) COMPLETE** — `07-REVIEW.md` returned FIX-FIRST with
  24 findings; all 24 closed in `07-FIXES.md`; re-review returned SHIP; final
  acknowledgement SHIP-CONFIRMED at `39866f3` (mutation-verified); a further
  hotfix-range acknowledgement SHIP-CONFIRMED covered `d821e4f..327a716`.
- **Task 3 (smoke execution) COMPLETE** post-merge on production —
  `cv-lifecycle.smoke.ts` 7/7 green 2026-08-11 18:58 at `bbdb004`, with View
  verified as a real download (302 to a signed storage URL returning 200; 404
  for fabricated ids); `cv-intake.smoke.ts` 8/8 green 18:24 at `bc3eb0a`.
  Caveat, recorded honestly: the two specs passed in separate runs and
  `read-only.smoke.ts` (9 tests) has no recorded execution this phase, so a
  single full-suite `pnpm smoke:auth` all-24-green run remains outstanding
  evidence.
- **Full-suite evidence CLOSED (2026-08-12)** — `pnpm smoke:auth --workers=1`
  ran all three specs serially against production: **24/24 green in 2.0m**
  (cv-intake 8, cv-lifecycle 7, read-only 9); scratch residue 0, SQL-verified.
  Discovery from a first, parallel attempt (22/24): the two write-capable
  specs' cleanup sweeps interfere when run concurrently — each spec's prefix
  search is trigram-fuzzy since the search-breadth migration, so it surfaces
  the *other* spec's scratch rows and the WR-R6 fail-closed guard correctly
  throws rather than delete them. No wrong deletion occurred and the retries
  swept all residue. Until the config pins `workers: 1` (or the sweeps gain an
  exact-prefix skip), serial execution is the supported full-suite mode.
- **Task 4 (founder UAT) OPEN** — the only remaining phase task.
