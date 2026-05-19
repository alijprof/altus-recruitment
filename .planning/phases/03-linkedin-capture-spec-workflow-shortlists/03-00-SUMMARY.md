---
phase: 03-linkedin-capture-spec-workflow-shortlists
plan: 00-hardening
subsystem: infrastructure
tags: [phase-3, hardening, wave-0, dependencies, ffmpeg, observability, vitest]
requires:
  - phase-2 (Supabase, Sentry, Inngest, Voyage all online)
provides:
  - src/lib/ai/ffmpeg.ts (recompressToOpus + probeDurationSeconds helpers)
  - src/lib/inngest/functions/probe-ffmpeg.ts (Wave-0 ffmpeg availability probe)
  - docs/phase-3-sentry-tags.md (Phase-3 Sentry tag convention table)
  - 13 Vitest test scaffolds (.todo placeholders) so downstream plans' verify steps resolve
  - OPENAI_API_KEY env wiring in .env.example + CLAUDE.md
  - openai, fluent-ffmpeg, @ffmpeg-installer/ffmpeg dependencies installed
affects:
  - package.json (3 new deps + 1 devDep)
  - pnpm-workspace.yaml (allowBuilds entries for ffmpeg platform packages)
  - src/app/api/inngest/route.ts (registers probeFfmpeg)
  - .env.example (OPENAI_API_KEY entry)
  - CLAUDE.md (env var list)
tech-stack:
  added:
    - openai@6.38.0 (Whisper SDK — Phase 3 spec audio)
    - fluent-ffmpeg@2.1.3 (audio recompression + probe)
    - @ffmpeg-installer/ffmpeg@1.1.0 (static binary for Vercel)
    - @types/fluent-ffmpeg@2.1.28
  patterns:
    - Phase-3 Sentry tag set { phase: 'p3', layer, function|helper|route }
    - ffmpeg wrapper mirrors voyage.ts singleton + server-only + Sentry-err.name-only pattern
    - .todo placeholder skeleton across all Phase 3 plans (Nyquist gap fill)
key-files:
  created:
    - src/lib/ai/ffmpeg.ts
    - src/lib/ai/ffmpeg.test.ts
    - src/lib/inngest/functions/probe-ffmpeg.ts
    - docs/phase-3-sentry-tags.md
    - chrome-extension/tests/scrape-profile.test.ts
    - chrome-extension/tests/fixtures/linkedin-profile-2026-05-19.html
    - src/app/api/linkedin/ingest/route.test.ts
    - src/lib/db/candidates-linkedin-upsert.test.ts
    - src/lib/ai/whisper.test.ts
    - src/lib/ai/jd-extract.test.ts
    - src/lib/ai/ad-inclusivity.test.ts
    - src/lib/db/applications-pipeline-filter.test.ts
    - supabase/tests/applications-float-null-job.test.sql
    - src/lib/db/dormant-clients.test.ts
    - src/lib/ai/outreach-draft.test.ts
    - src/lib/integrations/outlook-mail-send.test.ts
    - supabase/tests/source-attribution-rpc.test.sql
  modified:
    - package.json
    - pnpm-lock.yaml
    - pnpm-workspace.yaml
    - .env.example
    - CLAUDE.md
    - src/app/api/inngest/route.ts
decisions:
  - D3-07 wired: OPENAI_API_KEY in env schema (optional in Plan 0; Whisper wrapper in Plan 2 will dereference at call time)
  - ffmpeg wrapper switched from createRequire pattern (voyage.ts style) to static ESM imports — Vitest mocks could not intercept createRequire'd modules, and the static-import path is equally valid because both packages are typed (fluent-ffmpeg via @types, @ffmpeg-installer cast to its documented runtime shape)
  - vi.mock hoist-safety pattern documented: mutable test state lives on globalThis (not a top-level const) so Vitest's mock factory hoisting doesn't TDZ at module load. Pattern is reusable for any future Phase-3 wrapper test
  - probe-ffmpeg Inngest function registered alphabetically between precomputeMatchesForJob and cleanupStaleSummaries in src/app/api/inngest/route.ts, matching existing ordering convention
  - Vitest config left untouched: default include glob `**/*.{test,spec}.?(c|m)[jt]s?(x)` already discovers chrome-extension/tests/*.test.ts placeholders (verified via JSON reporter — 23 test files registered)
metrics:
  duration_minutes: 14
  completed: 2026-05-19T22:42:16Z
  tasks_completed: 3
  files_created: 17
  files_modified: 6
---

# Phase 3 Plan 0: Hardening Summary

**One-liner:** Phase 3 Wave 0 hardening — install Whisper + ffmpeg deps, ship typed ffmpeg helpers with TDD coverage and an Inngest availability probe, establish phase:'p3' Sentry tag conventions, and scaffold .todo Vitest placeholders for every downstream Phase 3 plan so each plan's verification gate points to a test file that already exists.

## What changed

Three tasks executed sequentially with per-task commits:

### Task 0.1 — Dependencies + OPENAI_API_KEY env wiring (commit `312e63c`)

Added three production dependencies (`openai` 6.38.0, `fluent-ffmpeg` 2.1.3, `@ffmpeg-installer/ffmpeg` 1.1.0) and one dev dependency (`@types/fluent-ffmpeg` 2.1.28). Wired `OPENAI_API_KEY` in `.env.example` with usage comment (per D3-07; cost basis is per audio minute) and added it to CLAUDE.md's required env vars list. Set the new `@ffmpeg-installer/*` platform packages to `allowBuilds: false` in `pnpm-workspace.yaml` — the wrapper resolves the bundled binary path at runtime, no post-install script needed.

The plan's `checkpoint:human-verify` for package legitimacy was pre-approved by the orchestrator based on npm view evidence (openai = OpenAI Inc., fluent-ffmpeg = kribblo, @ffmpeg-installer = recognised publisher, all packages > 5 years old with high weekly downloads).

### Task 0.2 — ffmpeg helpers + Sentry tags + probe Inngest function (commits `97fc896` RED, `22f6c9c` GREEN)

TDD RED-GREEN. RED commit ships `src/lib/ai/ffmpeg.test.ts` asserting two behaviors:

1. `recompressToOpus()` passes `audioCodec('libopus')` + `audioBitrate('32k')` + `audioChannels(1)` + `format('ogg')` (the exact codec flag set documented in RESEARCH §"Don't Hand-Roll" Pattern 3).
2. `probeDurationSeconds()` calls fluent-ffmpeg's `ffprobe()` and rounds `format.duration` to the nearest integer (CRITICAL-2 fix — without it Plan 2's Whisper Inngest body has an unresolved placeholder for the `ai_usage.p_input_tokens` cost basis).

GREEN commit ships:

- `src/lib/ai/ffmpeg.ts` — singleton binary-path resolution at module load, `import 'server-only'`, Sentry captures with `err.name` only (R4 invariant), required Phase-3 tag set `{ phase: 'p3', layer: 'ai-wrapper', helper }` on every capture. Also exports `getFfmpegBinaryPath()` for the probe function.
- `src/lib/inngest/functions/probe-ffmpeg.ts` — one-shot function triggered by `ops/probe-ffmpeg`. Runs `ffmpeg -version` via `execFile`, emits `phase3:ffmpeg:probe:ok` info-level Sentry breadcrumb. Manual Wave-0 gate for the static binary on Vercel.
- `src/app/api/inngest/route.ts` — registers `probeFfmpeg` (alphabetical insertion).
- `docs/phase-3-sentry-tags.md` — 1-page convention table mapping every new Phase-3 file to its required Sentry tag set; includes forbidden-in-tags rules (no raw err.message, no PII) and a grep-based per-plan verification recipe.

Verification gate passed: `pnpm typecheck` clean, `pnpm test -- --run src/lib/ai/ffmpeg.test.ts` → 2/2, `grep -rn "new Anthropic(" src/` → 1 line (claude.ts only — one-Anthropic-instance invariant held), `grep -c "phase: 'p3'" docs/phase-3-sentry-tags.md` → 2.

### Task 0.3 — Vitest .todo scaffolds (commit `318ad5e`)

13 placeholder test files (10 `.ts`, 2 `.sql`, 1 `.html` fixture) covering every behavior listed in RESEARCH §"Phase Requirements → Test Map":

- LinkedIn: `chrome-extension/tests/scrape-profile.test.ts`, `src/app/api/linkedin/ingest/route.test.ts`, `src/lib/db/candidates-linkedin-upsert.test.ts`
- Spec audio + JD: `src/lib/ai/whisper.test.ts`, `src/lib/ai/jd-extract.test.ts`
- Shortlists + floats: `src/lib/db/applications-pipeline-filter.test.ts`, `supabase/tests/applications-float-null-job.test.sql`
- Job ads + inclusivity: `src/lib/ai/ad-inclusivity.test.ts`
- Dormant clients + outreach: `src/lib/db/dormant-clients.test.ts`, `src/lib/ai/outreach-draft.test.ts`, `src/lib/integrations/outlook-mail-send.test.ts`
- Source attribution: `supabase/tests/source-attribution-rpc.test.sql`

Each `.ts` placeholder uses the documented Vitest skeleton:

```ts
/**
 * @vitest-environment node|jsdom
 */
import { describe, it } from 'vitest'
describe('<feature> (<requirement-id>)', () => {
  it.todo('<assertion-summary>')
})
```

`.todo()` keeps each entry in CI output as a yellow reminder rather than green-passing or red-failing. Downstream plans replace `.todo` with `.it` bodies.

The chrome-extension HTML fixture is intentionally empty — Plan 03-01 captures the anonymized real LinkedIn DOM as part of its scrape work.

`vitest.config.ts` left untouched: its default include glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) already discovers the new `chrome-extension/tests/*.test.ts` files (verified via `pnpm exec vitest --run --reporter=json` → `numTotalTestSuites: 57`, includes the chrome-extension suite).

## Deviations from Plan

Three small adaptations applied automatically (none rise to a Rule-4 architectural change).

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ffmpeg wrapper static-import refactor**
- **Found during:** Task 0.2 GREEN gate (test re-run after voyage.ts pattern copy)
- **Issue:** Initial wrapper used `createRequire(import.meta.url)` for `@ffmpeg-installer/ffmpeg` + `fluent-ffmpeg` (mirroring voyage.ts). Vitest's module interceptor cannot mock `createRequire`'d modules, so the tests bypassed the mocks and tried to spawn a real ffmpeg child process.
- **Fix:** Switched to static `import` statements (`import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'`, `import fluentFfmpeg from 'fluent-ffmpeg'`). Both packages have functional ESM entry points / TS types — the createRequire dance in voyage.ts was a workaround for the broken `voyageai` ESM build, not a general rule.
- **Files modified:** `src/lib/ai/ffmpeg.ts` (commit 22f6c9c).
- **Commit:** `22f6c9c`

**2. [Rule 3 - Blocking] Vitest mock hoist-safety pattern**
- **Found during:** Task 0.2 RED → GREEN transition
- **Issue:** Vitest hoists `vi.mock` factory invocations above all top-level `const`/`function` declarations in the test module. A top-level `const recordedRef = { value: [] }` referenced inside the mock factory triggered a TDZ ReferenceError at module load.
- **Fix:** Stashed mutable recorded-calls state on `globalThis.__ffmpegTestRecord` and accessed it via a lazy `getRecordedRef()` helper. Builder function moved inside the mock factory closure so it doesn't depend on any top-level declaration. Pattern is documented inline in the test file for reuse by Plan 03-02's Whisper wrapper test.
- **Files modified:** `src/lib/ai/ffmpeg.test.ts` (commit 97fc896 + 22f6c9c iteration).
- **Commit:** `97fc896`

**3. [Rule 3 - Blocking] Inngest createFunction signature**
- **Found during:** Task 0.2 typecheck gate
- **Issue:** First draft of `probe-ffmpeg.ts` used the three-arg `createFunction(config, trigger, handler)` signature. The Inngest version in use (`inngest@4.4.0`) accepts only two args, with triggers declared inside the config object (`triggers: [{ event: '...' }]`) — matching the existing pattern in `parse-cv.ts` and `cleanup-stale-summaries.ts`.
- **Fix:** Folded the trigger into the config object.
- **Files modified:** `src/lib/inngest/functions/probe-ffmpeg.ts` (commit 22f6c9c).
- **Commit:** `22f6c9c`

### Auth gates

None — Task 0.1 made no API calls. The package-legitimacy human-verify checkpoint was pre-approved by the orchestrator (auto-approved by orchestrator — see Task 0.1 detail) per the explicit instruction in `<human_verify_preapproval>`.

## Verification

| Gate                                                                 | Result                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install` clean with 3 new deps                                 | PASS (openai 6.38.0, fluent-ffmpeg 2.1.3, @ffmpeg-installer/ffmpeg 1.1.0 all resolved)                                       |
| `.env.example` contains `OPENAI_API_KEY=`                            | PASS (1 occurrence)                                                                                                          |
| `pnpm test -- --run src/lib/ai/ffmpeg.test.ts`                       | PASS (2/2)                                                                                                                   |
| `grep -c "phase: 'p3'" docs/phase-3-sentry-tags.md`                  | PASS (2 occurrences — column header + grep recipe block)                                                                     |
| `grep -rn "new Anthropic(" src/` returns exactly 1 line              | PASS (only `src/lib/ai/claude.ts:16` — one-Anthropic-instance invariant held)                                                |
| Full `pnpm test -- --run`                                            | PASS (23 test files, 145 tests: 79 passing + 66 todo, 0 failures)                                                            |
| `pnpm typecheck`                                                     | PASS (clean)                                                                                                                 |
| `pnpm lint`                                                          | PASS (0 errors, 12 pre-existing warnings unrelated to this plan)                                                             |

## TDD Gate Compliance

Plan-level TDD gate sequence (Task 0.2 is `tdd="true"`):

1. `test(03-00): RED — ffmpeg recompress + probe-duration wrapper` → commit `97fc896` (failing test for non-existent wrapper)
2. `feat(03-00): GREEN — ffmpeg helpers, probe-ffmpeg Inngest, Sentry tags` → commit `22f6c9c` (wrapper + Inngest + docs, tests pass)
3. No REFACTOR commit — the wrapper landed in its final shape during GREEN (Vitest mock-pattern iteration happened in the same GREEN diff; no behavior change between iterations).

Gate verified by `git log --oneline -5`:

```
318ad5e test(03-00): scaffold Vitest .todo placeholders for every Phase 3 behavior
22f6c9c feat(03-00): GREEN — ffmpeg helpers, probe-ffmpeg Inngest, Sentry tags
97fc896 test(03-00): RED — ffmpeg recompress + probe-duration wrapper
312e63c chore(03-00): add openai/fluent-ffmpeg deps + OPENAI_API_KEY env
```

## Known Stubs

The 13 `.todo` placeholder test files from Task 0.3 are documented stubs. They are not bugs — they are the explicit Wave-0 deliverable per the plan's RESEARCH §Wave 0 Gaps. Each downstream Phase 3 plan (03-01 through 03-06) replaces its corresponding `.todo` entries with real `.it` bodies. CI surfaces them as yellow reminders, not failures.

The empty `chrome-extension/tests/fixtures/linkedin-profile-2026-05-19.html` is similarly intentional — Plan 03-01 captures the anonymized real LinkedIn DOM snapshot.

## Deferred Issues

None. Lint shows 12 pre-existing warnings (rate-limit / cv-related tests with intentionally underscored unused parameters) — out of scope per the SCOPE BOUNDARY rule.

## Risks carried forward

- **ffmpeg static-binary Vercel function size:** RESEARCH §Environment Availability flags that `@ffmpeg-installer/ffmpeg` may push a single Vercel function over the 50 MiB unzipped limit. The probe-ffmpeg Inngest function exists specifically to verify this in production. **Manual gate before Plan 03-02 starts:** deploy the worktree, fire `inngest.send({ name: 'ops/probe-ffmpeg', data: {} })` from the dashboard, confirm the `phase3:ffmpeg:probe:ok` breadcrumb appears in Sentry. If the deploy blows the size limit, lift the spec-audio Inngest function to a self-hosted worker (documented fallback in RESEARCH).
- **OPENAI_API_KEY absent:** Plan 0 leaves the key optional in env schema. Plan 03-02's Whisper wrapper dereferences `env.OPENAI_API_KEY` at call time; if absent, the SDK surfaces a clean auth error in Sentry rather than crashing on boot. No action required here.

## Self-Check: PASSED

Verified the following claims via filesystem and git:

- `src/lib/ai/ffmpeg.ts`: FOUND
- `src/lib/ai/ffmpeg.test.ts`: FOUND
- `src/lib/inngest/functions/probe-ffmpeg.ts`: FOUND
- `docs/phase-3-sentry-tags.md`: FOUND
- All 13 placeholder test files (10 .ts + 2 .sql + 1 .html): FOUND
- Commit `312e63c`: FOUND (Task 0.1)
- Commit `97fc896`: FOUND (Task 0.2 RED)
- Commit `22f6c9c`: FOUND (Task 0.2 GREEN)
- Commit `318ad5e`: FOUND (Task 0.3)
