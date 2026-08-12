# Phase 8 Plan 09 — Verification

Status: **PARTIAL** — this run covers Task 1 (authoring
`tests/smoke/authed/branded-cv.smoke.ts` + pinning `workers: 1`) and the
autonomous-gates portion of Task 2 (typecheck, lint, prettier, full vitest
suite, local build reproduction). The mechanical code review half of Task 2
(`/gsd-code-review`), Task 3 (executing `pnpm smoke:auth` against production),
and Task 4 (founder UAT checkpoint) are explicitly OUT OF SCOPE for this run —
see "Scope note" below. This mirrors exactly how 07-08 was orchestrated (see
`07-VERIFICATION.md`).

## Scope note

This run was invoked with an explicit instruction to cover ONLY:

- Authoring `tests/smoke/authed/branded-cv.smoke.ts` (08-09-PLAN.md Task 1)
  and pinning `workers: 1` in `playwright.smoke-auth.config.ts`.
- The full autonomous gate sequence (typecheck, lint, prettier --check on
  touched files, full vitest suite, local build reproduction) — the
  gate-running half of 08-09-PLAN.md Task 2.

Explicitly excluded, per the invoking instructions:

- The mechanical code-review half of Task 2 (`/gsd-code-review` over the
  whole phase diff, 08-01 through 08-08) — the orchestrator runs this
  separately.
- Task 3 (`pnpm smoke:auth --workers=1` against the deployed production
  build) — needs a real deploy plus the founder's manual `db push` for the
  two Phase-8 migrations (`candidate_branded_cvs`,
  `org-logos` bucket), neither of which is in scope for this worktree.
- Task 4 (founder UAT checkpoint) — blocking, requires a human, and per the
  plan itself must not even be presented until Tasks 2 and 3 are both green.

Because of this scope, BCV-07 (and BCV-01 through BCV-06, which this plan's
`requirements` field also lists) are **not being marked complete** by this
run — see 08-09-SUMMARY.md's "What's still outstanding" section.

## Pre-run setup (worktree-local, not part of the phase diff)

This worktree had no `node_modules`. Not a code change:

- `pnpm install --frozen-lockfile` — installed exactly what `pnpm-lock.yaml`
  already specifies; the lockfile itself is untouched (confirmed below).
- `.env.local` created LOCALLY with placeholder (non-secret) values for the
  six required env vars `src/lib/env.ts`'s zod schema demands
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (must start `sk-ant-`),
  `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`), plus `OPENAI_API_KEY` /
  `VOYAGE_API_KEY` for clients instantiated eagerly at module-load. Same
  technique 07-08 used. This file is git-ignored (`.env*` in `.gitignore`,
  confirmed via `git check-ignore -v .env.local`) and was never staged or
  committed. Per project MEMORY the real build gate is the Vercel build —
  this local build with placeholder envs is a genuine bonus signal (Turbopack
  compile + `tsc` + static-generation pass over every route, including both
  Phase-8-touched routes), not a replacement for it.

## Task 1 — Branded-CV authed smoke spec + serial pin

Done in this run. See `tests/smoke/authed/branded-cv.smoke.ts` (authored,
commit `12dc6b4`) and `playwright.smoke-auth.config.ts`'s `workers: 1` pin
(same commit).

### Gates on the new/touched files

```
$ pnpm exec tsc --noEmit -p tsconfig.json
(clean — exit 0)

$ node -e "...regex check for /workers:\s*1/ in playwright.smoke-auth.config.ts..."
(exit 0 — workers: 1 confirmed present, outside comments)

$ pnpm exec eslint tests/smoke/authed/branded-cv.smoke.ts playwright.smoke-auth.config.ts
(no output — clean)

$ pnpm exec prettier --check tests/smoke/authed/branded-cv.smoke.ts playwright.smoke-auth.config.ts
All matched files use Prettier code style!   (after one --write pass on branded-cv.smoke.ts —
a single long expect(...).toMatch(...) line collapse; no logic change)

$ pnpm exec playwright test --config playwright.smoke-auth.config.ts --list
  [smoke-auth] › branded-cv.smoke.ts:247:7 › @smoke-auth branded-cv › creates a scratch candidate for this smoke run
  [smoke-auth] › branded-cv.smoke.ts:262:7 › @smoke-auth branded-cv › uploads a Tier-1 CV and reaches a completed parse
  [smoke-auth] › branded-cv.smoke.ts:272:7 › @smoke-auth branded-cv › Generate (BCV-01): Branded CV section appears; Generate produces a generated-date line
  [smoke-auth] › branded-cv.smoke.ts:316:7 › @smoke-auth branded-cv › Regenerate (BCV-06): still exactly ONE branded copy line after a second Generate
  [smoke-auth] › branded-cv.smoke.ts:338:7 › @smoke-auth branded-cv › View delivery (BCV-05): View downloads the real branded PDF from Storage
  [smoke-auth] › branded-cv.smoke.ts:399:7 › @smoke-auth branded-cv › No dead controls: View is a real link with an href, never a button
  [smoke-auth] › branded-cv.smoke.ts:414:7 › @smoke-auth branded-cv › Branding surfaces (BCV-04): upload widget renders; /settings links to Branding; state-preserving logo round-trip
  [smoke-auth] › branded-cv.smoke.ts:459:7 › @smoke-auth branded-cv › no uncaught client-side errors across the whole run
  ... (cv-intake.smoke.ts 8 tests, cv-lifecycle.smoke.ts 7 tests, read-only.smoke.ts 9 tests, unchanged)
  Total: 32 tests in 4 files
```

`--list` is static enumeration only — no browser is launched, no network
request is made, nothing is written anywhere. It confirms the file parses,
every import resolves, and all 8 scenarios register under the correct serial
describe block alongside the three existing spec files (24 tests before this
plan → 32 tests now).

### Frozen-file check

```
$ git diff --stat -- tests/smoke/authed/cv-intake.smoke.ts tests/smoke/authed/cv-lifecycle.smoke.ts
(empty)
```

Confirmed byte-identical — neither frozen spec was touched.

**Task 1 verdict: authored, gated, all clean.**

## Task 2 — Autonomous gates (gates portion only; code review NOT run in this pass)

Command run for each, verbatim result below. All green.

### `pnpm lint`

```
✖ 38 problems (0 errors, 38 warnings)
```

**0 errors.** All 38 warnings are pre-existing `@typescript-eslint/no-unused-vars`
on underscore-prefixed mock parameter placeholders in test files
(`tests/unit/app/apply/*.test.ts`, `tests/unit/app/candidates/*.test.ts`,
`tests/unit/lib/db/*.test.ts`, `tests/unit/lib/inngest/*.test.ts`,
`tests/unit/app/api/linkedin/ingest.test.ts`), one unused-import warning in
`src/lib/email/unsubscribe.ts`, and one `jsx-a11y/role-supports-aria-props`
warning in `src/components/app/repeating-rows.tsx` — none in either file this
plan touched. Confirmed zero warnings on the touched files specifically:
`pnpm exec eslint tests/smoke/authed/branded-cv.smoke.ts
playwright.smoke-auth.config.ts` produced no output.

### `pnpm typecheck`

```
> tsc --noEmit
```

Clean — no output, exit 0.

### `pnpm exec vitest run` (full suite)

```
 Test Files  92 passed | 4 skipped (96)
      Tests  1149 passed | 1 skipped | 28 todo (1178)
```

Zero failures. Note on the plan's literal baseline reference: `08-09-PLAN.md`
cites a "959-test baseline recorded in STATE.md" — that figure is stale
(recorded before Phases 6, 7, and Phase-8 plans 01-08 landed their own test
files; STATE.md itself records 890 passing at the 07-08 checkpoint, already
above 959's premise). The number that matters here is failures, not the raw
count: **0 failed**, confirming this plan's file additions
(`branded-cv.smoke.ts` — a Playwright spec, not collected by vitest) did not
regress the existing suite, and nothing in the current working tree
introduced a new vitest failure.

### `pnpm build` (`next build`)

Compiled successfully (Turbopack, 17.3s), `runAfterProductionCompile`
completed (459ms), the in-build `tsc` pass completed (20.1s), and all routes
generated with the placeholder env — including both Phase-8-touched routes:
`/candidates/[id]/branded-cv` and `/settings/branding`. Exit code 0. No build
errors once the placeholder env vars above were in place (see "Pre-run
setup").

### `pnpm exec prettier --check` on every file this phase touched (this plan's own diff)

```
$ pnpm exec prettier --check tests/smoke/authed/branded-cv.smoke.ts playwright.smoke-auth.config.ts
All matched files use Prettier code style!
```

(Ran `--write` once first on `branded-cv.smoke.ts` to collapse one
over-80-char `expect(...)` call onto one line — no logic change, confirmed by
diff — then re-ran `--check` clean.)

### No dependency added

```
$ git diff --stat package.json pnpm-lock.yaml
(empty)
```

Confirmed empty — this plan added no dependency.

### No migration added

```
$ git status --porcelain supabase/migrations/
(empty)
```

Confirmed empty — this plan needed none; it consumes the `candidate_branded_cvs`
table and `org-logos` bucket added by earlier Phase-8 plans (08-01, 08-03),
neither of which this run touches.

**Task 2 (gates portion) verdict: all gates green, no dependency added, no
migration added.**

### Task 2 (code-review portion) — NOT RUN in this pass

**NOT RUN.** Explicitly excluded per the invoking instructions. The
orchestrator runs `/gsd-code-review` over the whole phase diff (every file
listed in the `files_modified` frontmatter of plans 08-01 through 08-08)
separately. This subsection intentionally left for that pass to fill in.

## Task 3 — Deployed browser pre-smoke

**NOT RUN in this pass.** Explicitly excluded per the invoking instructions:
this worktree has not been deployed, `pnpm smoke:auth` targets
`https://altusrecruit.com` post-merge/post-deploy per the documented pattern
(`playwright.smoke-auth.config.ts`'s own header comment, `tests/smoke/README.md`),
and the founder's manual `db push` for the two Phase-8 migrations
(`candidate_branded_cvs`, `org-logos`) has not landed on production — running
the smoke before that push would exercise the spec's own migration-tolerant
skip path rather than the real feature.

**This remains outstanding** and must happen — against production, with
`cv-intake.smoke.ts`, `cv-lifecycle.smoke.ts`, `read-only.smoke.ts`, AND the
new `branded-cv.smoke.ts` all passing together via `pnpm smoke:auth --workers=1`
— before Task 4's founder checkpoint is presented, per 08-09-PLAN.md's own
Task 3 `<done>` criterion and `<success_criteria>`.

## Task 4 — Founder UAT handoff

Not reached. Blocking checkpoint, requires a human, explicitly out of scope
for this run.

## Overall verdict for this run

- Task 1: **COMPLETE** — spec authored, `workers: 1` pinned, all gates on the
  touched files clean, frozen specs verified byte-identical.
- Task 2: **PARTIAL** — the autonomous gate sequence is **COMPLETE, all
  green** (lint 0 errors, typecheck clean, vitest 1149/1149 passing, build
  green, prettier clean, no new dependency/migration). The mechanical code
  review is **NOT RUN** (out of scope — separate reviewer pass).
- Task 3: **NOT RUN** (out of scope — needs a real deploy + the founder's
  migration push).
- Task 4: **NOT REACHED** (blocking human checkpoint).

This VERIFICATION/SUMMARY pair is intentionally marked PARTIAL, mirroring
07-08's precedent. `STATE.md`, `ROADMAP.md`, and `REQUIREMENTS.md` are NOT
being updated by this run — that remains for the orchestrator once the code
review, the post-deploy smoke execution, and founder UAT all land.
