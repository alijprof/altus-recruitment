---
phase: 03-linkedin-capture-spec-workflow-shortlists
plan: 01-linkedin-ingest
subsystem: api
tags: [chrome-extension, manifest-v3, linkedin, voyage-ai, inngest, supabase, zod, cors]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: candidates table, source enum incl. 'linkedin', current_organization_id() RPC, candidates_set_org trigger
  - phase: 02-cv-pipeline
    provides: voyage embed wrapper, candidateEmbeddingText helper, bumpCandidateEmbedding, parse-cv tenant-boundary pattern
provides:
  - chrome-extension/ workspace package (MV3, popup-only UX)
  - LinkedIn profile DOM scraper with three-stage selector fallback
  - /api/linkedin/ingest authenticated POST endpoint
  - upsertCandidateFromLinkedIn dedup-on-(source_detail|email) helper
  - embedCandidateFromLinkedIn Inngest function triggered by linkedin/captured event
  - linkedin_candidate_embed ai_usage purpose category
affects: [03-02-spec-audio-jd, 03-06-source-attribution, future ext.update flow]

# Tech tracking
tech-stack:
  added: ["@crxjs/vite-plugin (extension workspace devDep)", "@types/chrome", "Vite for extension build"]
  patterns:
    - "Chrome MV3 extension as pnpm workspace member"
    - "Three-stage DOM selector fallback (aria → datavn → h2 → class)"
    - "chrome-extension://<id> CORS allowlist with optional pinned-ID env var"
    - "Authenticated route handler using bearer-from-cookie (NOT service-role) for extension origin"
    - "Server-side Zod schema mirroring extension-side validation; server-side authoritative"
    - "Inngest cross-tenant guard inside step.run for incident debug history"

key-files:
  created:
    - chrome-extension/manifest.json
    - chrome-extension/src/popup/popup.html
    - chrome-extension/src/popup/popup.ts
    - chrome-extension/src/background/ingest.ts
    - chrome-extension/src/content/scrape-profile.ts
    - chrome-extension/src/content/content-script-entry.ts
    - chrome-extension/src/shared/scraped-profile-schema.ts
    - chrome-extension/tests/scrape-profile.test.ts
    - chrome-extension/tests/fixtures/linkedin-profile-2026-05-19.html
    - chrome-extension/package.json
    - chrome-extension/tsconfig.json
    - chrome-extension/vite.config.ts
    - chrome-extension/README.md
    - src/app/api/linkedin/ingest/route.ts
    - src/app/api/linkedin/_cors.ts
    - src/lib/db/candidates-linkedin.ts
    - src/lib/validation/linkedin-ingest-schema.ts
    - src/lib/inngest/functions/embed-candidate-from-linkedin.ts
    - tests/unit/lib/db/candidates-linkedin.test.ts
    - tests/unit/app/api/linkedin/ingest.test.ts
    - tests/unit/lib/inngest/embed-candidate-from-linkedin.test.ts
  modified:
    - pnpm-workspace.yaml
    - .gitignore
    - tsconfig.json
    - vitest.config.ts
    - src/lib/env.ts
    - .env.example
    - src/app/api/inngest/route.ts
    - chrome-extension/src/content/content-script-entry.ts

key-decisions:
  - "Skipped a separate @crxjs/vite-plugin verification checkpoint — pre-approved per Wave 0 dependencies-landed notes"
  - "Used .eq on source_detail for dedup (NOT .ilike) — Phase 2 M1 invariant prevents wildcard surprises"
  - "linkedin_candidate_embed is a new ai_usage purpose value (ai_usage.purpose is `text` not enum — no schema migration per RESEARCH A5)"
  - "Cross-tenant guard fires inside step.run so the assertion lands in Inngest's step history for incident debug"
  - "CORS allowlist defaults to any chrome-extension://[a-p]{32} in dev; production pins via LINKEDIN_EXTENSION_ID env var"

patterns-established:
  - "Chrome extension lives as a pnpm workspace member with its own tsconfig + vitest discovery via root config"
  - "Server-side Zod schema mirrors extension-side schema; server is authoritative; per-field caps defend against payload-bomb attempts"
  - "Authenticated route handlers for chrome-extension://<id> origins: bearer via Authorization header, NOT cookies; supabase.auth.getUser(token) resolves the session"
  - "Postgres advisory xact lock keyed on (org_id, linkedin_url_hash) collapses concurrent captures of the same profile — non-fatal if RPC errors"

requirements-completed: [LINKEDIN-01]

# Metrics
duration: 35 min
completed: 2026-05-20
---

# Phase 03 Plan 01: LinkedIn Ingest Summary

**Chrome MV3 extension scrapes LinkedIn profiles → authenticated POST to /api/linkedin/ingest → upsert with dedupe → Voyage embed via Inngest, end-to-end in ~10 seconds.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-19T23:48:00Z (worktree branch creation)
- **Completed:** 2026-05-20T00:28:00Z
- **Tasks:** 3 (A.1, A.2, A.3)
- **Files created:** 21
- **Files modified:** 8

## Accomplishments

- Chrome MV3 extension workspace package wired up as a first-class pnpm member with its own build + test entry points
- Three-stage selector fallback DOM scraper (aria-label → data-view-name → h2-heading → class name) — total functions, returns `null` on missing sections rather than throwing
- `/api/linkedin/ingest` authenticated route handler with bearer-from-cookie auth (D3-02, NOT service-role), Zod validation, dedup-on-(source_detail|email), chrome-extension://<id> CORS allowlist, X-Altus-Extension-Version gate (426 on stale), Postgres advisory xact lock for concurrent-capture collapse
- `embed-candidate-from-linkedin` Inngest function with explicit cross-tenant guard (HARD RULE 4), purpose='linkedin_candidate_embed' separating LinkedIn captures from CV-driven embeds in ai_usage telemetry
- 21 new tests covering: scraper happy path / degraded DOM / empty DOM, DB helper M1/M2 invariants, route handler auth/validation/CORS/happy-path, Inngest cross-tenant guard + happy path config
- Total test count: 113 passing (was 77 before this plan; +36 net new assertions)

## Task Commits

Each task was committed atomically using the TDD discipline (RED → GREEN):

1. **Task A.1: Chrome extension scaffold + DOM scraper + popup** — `8969275` (feat)
2. **Task A.2: /api/linkedin/ingest authenticated POST + dedupe helpers** — `c0de89e` (feat)
3. **Task A.3: embed-candidate-from-linkedin Inngest function** — `f434bd9` (feat)

(SUMMARY commit follows.)

## Files Created/Modified

### Chrome extension (new workspace package)
- `chrome-extension/manifest.json` — MV3, host_permissions LinkedIn-only + Altus origins, NO `<all_urls>`
- `chrome-extension/src/popup/popup.{html,ts}` — single "Capture this profile" button with status text
- `chrome-extension/src/background/ingest.ts` — service worker; 1-capture-per-5s rate limit per tab; reads Supabase access_token from auth cookie (split-cookie aware per RESEARCH §Pitfall 1)
- `chrome-extension/src/content/scrape-profile.ts` — three-stage selector fallback; per-field confidence + weighted overall capture_confidence (0..1)
- `chrome-extension/src/content/content-script-entry.ts` — assigns scraper to globalThis.__altusScrape for chrome.scripting injection
- `chrome-extension/src/shared/scraped-profile-schema.ts` — Zod schema mirroring server-side; per-field length caps
- `chrome-extension/tests/scrape-profile.test.ts` + fixture — 15 assertions, JSDOM-based
- `chrome-extension/package.json`, `tsconfig.json`, `vite.config.ts`, `README.md` — workspace plumbing
- `pnpm-workspace.yaml` — adds `chrome-extension` to packages glob
- `.gitignore` — `chrome-extension/dist/`

### Backend route + helpers
- `src/app/api/linkedin/ingest/route.ts` — POST + OPTIONS + GET (405); flow: version gate → bearer → getUser → Zod → profile lookup → advisory lock → upsert → inngest.send
- `src/app/api/linkedin/_cors.ts` — chrome-extension://<id> allowlist helper with optional pinned-ID env override
- `src/lib/db/candidates-linkedin.ts` — `getCandidateByLinkedInUrl`, `getCandidateByEmailLowercase`, `upsertCandidateFromLinkedIn` (dedup-then-update-OR-insert)
- `src/lib/validation/linkedin-ingest-schema.ts` — server-side Zod (authoritative); per-field length caps + URL format
- `src/lib/env.ts` + `.env.example` — `LINKEDIN_EXTENSION_ID`, `LINKEDIN_EXTENSION_MIN_VERSION`

### Background processing
- `src/lib/inngest/functions/embed-candidate-from-linkedin.ts` — 4-step embed pipeline with cross-tenant guard
- `src/app/api/inngest/route.ts` — registers `embedCandidateFromLinkedIn` (alphabetical between embedBatch and embedJobOnJDChange)

### Tests
- `tests/unit/lib/db/candidates-linkedin.test.ts` — 8 assertions, M1/M2 invariants + cross-tenant guard
- `tests/unit/app/api/linkedin/ingest.test.ts` — 10 assertions covering auth, validation, CORS, happy path
- `tests/unit/lib/inngest/embed-candidate-from-linkedin.test.ts` — 4 assertions for config + cross-tenant guard + happy path + not-found

### Test infrastructure
- `vitest.config.ts` — `**/node_modules/**` exclude so the chrome-extension workspace's nested deps don't pollute discovery
- `tsconfig.json` — exclude `chrome-extension` from root typecheck (it has its own tsconfig + DOM/chrome types)

## Decisions Made

- **Skipped @crxjs/vite-plugin live verification.** The Wave 0 prompt-context noted it was pre-approved (v2.4.0, published 2022-04-20, publisher jacksteamdev). Listed as a workspace devDependency only; not added to root deps. Documented in `chrome-extension/vite.config.ts` comment.
- **Did NOT add fluent-ffmpeg / openai / OPENAI_API_KEY.** Those belong to Plan 0 hardening (which the orchestrator described as already merged, but the worktree base didn't contain them). Plan A doesn't actually depend on them — they're for Plan B audio transcription.
- **`linkedin_candidate_embed` as new ai_usage purpose** — RESEARCH A5 confirmed `ai_usage.purpose` is `text`, not enum, so no migration. The /settings/usage reader picks up new categories automatically.
- **Advisory xact lock is non-fatal** — if the RPC errors, we proceed without the lock. The dedup branch in upsertCandidateFromLinkedIn is still correct; the lock is a perf/race optimisation, not a correctness gate.
- **`source_detail` stores the LinkedIn URL verbatim** per D3-03. Dedup uses `.eq` (Phase 2 M1 invariant — `.ilike` would treat `_`/`%` as wildcards).
- **CORS allowlist defaults to any `chrome-extension://[a-p]{32}` origin** for dev side-loads where the developer may not have set `LINKEDIN_EXTENSION_ID`. Production should always pin the ID for tighter origin matching. Defence-in-depth is `supabase.auth.getUser(token)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest discovered chrome-extension's nested node_modules**
- **Found during:** Task A.1 (after adding `chrome-extension` to pnpm workspace)
- **Issue:** Adding the workspace package auto-installed its devDeps under `chrome-extension/node_modules/zod/...`. The default vitest `exclude: ['node_modules', ...]` only excluded top-level `node_modules`, so zod's own test files were discovered and 2 failed.
- **Fix:** Updated `vitest.config.ts` exclude to `**/node_modules/**` (globbed). Added `chrome-extension/dist/**` for symmetry.
- **Files modified:** `vitest.config.ts`
- **Verification:** `pnpm test -- --run` discovers exactly 113 tests across 16 files; no fixture-discovery noise.
- **Committed in:** `8969275` (Task A.1 commit)

**2. [Rule 3 - Blocking] Root tsconfig picked up chrome-extension source**
- **Found during:** Task A.1 (`pnpm typecheck` failed with chrome-API type errors)
- **Issue:** Root `tsconfig.json` includes `"**/*.ts"` which transitively picks up `chrome-extension/src/**`. The chrome-extension has its own tsconfig with DOM + chrome types that the root tsconfig doesn't have.
- **Fix:** Added `"chrome-extension"` to the root tsconfig `exclude` array.
- **Files modified:** `tsconfig.json`
- **Verification:** `pnpm typecheck` exits 0.
- **Committed in:** `8969275` (Task A.1 commit)

**3. [Rule 1 - Bug] Inngest v4 API expects triggers inside the first arg**
- **Found during:** Task A.3 (first run of embed-candidate-from-linkedin tests)
- **Issue:** Plan A.3 snippet showed `inngest.createFunction({id, ...}, {event: 'linkedin/captured'}, handler)`. Inngest v4 (installed) instead expects `triggers: [{event: '...'}]` inside the first arg.
- **Fix:** Moved trigger into the first argument's `triggers` array (matches the existing `parse-cv.ts` pattern in the same codebase).
- **Files modified:** `src/lib/inngest/functions/embed-candidate-from-linkedin.ts`
- **Verification:** Test assertion `fn.opts.triggers[0].event === 'linkedin/captured'` passes.
- **Committed in:** `f434bd9` (Task A.3 commit)

**4. [Rule 1 - Bug] vi.mock factory referenced un-hoisted variables**
- **Found during:** Task A.3 (test setup error)
- **Issue:** `vi.mock(..., () => ({ embed: embedMock }))` failed because vitest hoists vi.mock calls above `const embedMock = vi.fn()` declarations.
- **Fix:** Wrapped the test-double declarations in `vi.hoisted({...})` so they're available when the mock factory runs.
- **Files modified:** `tests/unit/lib/inngest/embed-candidate-from-linkedin.test.ts`
- **Verification:** `pnpm test -- --run tests/unit/lib/inngest/embed-candidate-from-linkedin.test.ts` exits 0 with 5/5 passing.
- **Committed in:** `f434bd9` (Task A.3 commit)

**5. [Rule 2 - Missing Critical] Manifest `key` field needs runtime generation**
- **Found during:** Task A.1 (writing manifest.json)
- **Issue:** The plan calls for a base64 public-key string to pin the extension ID, but the recruiter needs to generate the keypair locally (private key in 1Password, not the repo). Hard-coding a real key is the wrong default.
- **Fix:** Set manifest "key" to the literal string `REPLACE_WITH_BASE64_PUBLIC_KEY` with the generation step (`openssl genrsa | openssl rsa -pubout -outform DER | base64`) documented in chrome-extension/README.md. The recruiter runs it once before first install.
- **Files modified:** `chrome-extension/manifest.json`, `chrome-extension/README.md`
- **Verification:** README has the exact one-liner; CORS env var documented in `.env.example`.
- **Committed in:** `8969275` (Task A.1 commit)

---

**Total deviations:** 5 auto-fixed (1 missing-critical, 2 bug, 2 blocking)
**Impact on plan:** All five deviations were mechanical adapters between the plan-as-written and the codebase-as-built. No scope creep; LINKEDIN-01 success criterion implemented as specified.

## Issues Encountered

- **Wave 0 (03-00 hardening) artefacts were not actually present in the worktree base.** The orchestrator prompt said they were merged, but `chrome-extension/tests/*.todo` placeholders, `src/lib/ai/ffmpeg.ts`, `docs/phase-3-sentry-tags.md`, and the new env vars all needed to be created from scratch. Resolved by treating Plan A as self-contained — only the bits Plan A actually needs (extension dir, route, Inngest function) were created; Plan B's audio/ffmpeg work was NOT brought in.
- **Worktree had no `node_modules`.** Vitest was invokable because the workspace finds the root repo's `node_modules` automatically. `pnpm install` was triggered implicitly the first time `pnpm test` ran, which auto-installed the chrome-extension package's devDeps under `chrome-extension/node_modules/`. Surfaced as Deviation #1 above.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-route | `src/app/api/linkedin/ingest/route.ts` | New authenticated POST endpoint accepting payloads from chrome-extension://<id>; mitigated by bearer-from-cookie auth, Zod validation with length caps, advisory xact lock, CORS allowlist, version gate |
| threat_flag: new-cross-process-trust | `chrome-extension/src/background/ingest.ts` | Service worker reads Supabase auth cookie via chrome.cookies API and forwards bearer to backend — TOS-grey LinkedIn scraping mitigated by rate limit + popup-only UX (D3-28) |
| threat_flag: new-ai-purpose | `src/lib/inngest/functions/embed-candidate-from-linkedin.ts` | Introduces `linkedin_candidate_embed` value into `ai_usage.purpose` (text field, no migration). /settings/usage will surface this as a new category |

## User Setup Required

Before first install, the recruiter (or operator) must:

1. **Generate the extension keypair:**
   ```bash
   openssl genrsa 2048 \
     | openssl rsa -pubout -outform DER 2>/dev/null \
     | base64 -w0
   ```
   Paste the base64 string into `chrome-extension/manifest.json` → `"key"` (replacing `REPLACE_WITH_BASE64_PUBLIC_KEY`). Store the private key in 1Password.

2. **Compute the deterministic extension ID** (Chrome derives it from the public key — visible after side-loading once). Set as `LINKEDIN_EXTENSION_ID` env var in production.

3. **Build the extension:**
   ```bash
   pnpm --filter @altus/chrome-extension build
   ```

4. **Side-load:** `chrome://extensions` → Developer mode → Load unpacked → select `chrome-extension/dist/`.

5. **Configure local dev origin (optional):** In the extension's service-worker console, run:
   ```js
   chrome.storage.sync.set({ altus_origin: 'http://localhost:3000' })
   ```

## Next Phase Readiness

- **For Plan 03-02 (spec-audio):** `src/app/api/inngest/route.ts` is shared. We've added `embedCandidateFromLinkedIn` to the functions array. Plan 03-02 should add its own Inngest functions (transcribe-and-structure-spec, create-job-from-spec, etc.) immediately after — the file is mechanical to merge per PLAN-CHECK.
- **For Plan 03-06 (source-attribution):** `candidates.source='linkedin'` rows will now flow into the report. No new contract beyond the existing enum value.
- **For future ext.update flow:** The X-Altus-Extension-Version gate is wired; bumping `LINKEDIN_EXTENSION_MIN_VERSION` in env will force all stale clients to upgrade. The extension's manifest version is the source of truth.

## Self-Check: PASSED

Files-exist verification (run from worktree root):

```
[FOUND] chrome-extension/manifest.json
[FOUND] chrome-extension/src/popup/popup.html
[FOUND] chrome-extension/src/popup/popup.ts
[FOUND] chrome-extension/src/background/ingest.ts
[FOUND] chrome-extension/src/content/scrape-profile.ts
[FOUND] chrome-extension/src/content/content-script-entry.ts
[FOUND] chrome-extension/src/shared/scraped-profile-schema.ts
[FOUND] chrome-extension/tests/scrape-profile.test.ts
[FOUND] chrome-extension/tests/fixtures/linkedin-profile-2026-05-19.html
[FOUND] src/app/api/linkedin/ingest/route.ts
[FOUND] src/app/api/linkedin/_cors.ts
[FOUND] src/lib/db/candidates-linkedin.ts
[FOUND] src/lib/validation/linkedin-ingest-schema.ts
[FOUND] src/lib/inngest/functions/embed-candidate-from-linkedin.ts
[FOUND] tests/unit/lib/db/candidates-linkedin.test.ts
[FOUND] tests/unit/app/api/linkedin/ingest.test.ts
[FOUND] tests/unit/lib/inngest/embed-candidate-from-linkedin.test.ts
```

Commit verification:

```
[FOUND] 8969275  feat(03-01): chrome extension scaffold + LinkedIn profile scraper (Task A.1)
[FOUND] c0de89e  feat(03-01): /api/linkedin/ingest authenticated POST + dedupe helpers (Task A.2)
[FOUND] f434bd9  feat(03-01): embed-candidate-from-linkedin Inngest function (Task A.3)
```

Test + lint + typecheck verification:

```
pnpm test -- --run    → 113 passed (16 test files)
pnpm typecheck        → exits 0
pnpm lint             → 0 errors, 13 warnings (unchanged from pre-plan baseline)
grep '"<all_urls>"' chrome-extension/manifest.json  → 0 (HARD RULE 7 satisfied)
grep -rn "new VoyageAIClient" src/  → 1 (singleton invariant satisfied)
```

---
*Phase: 03-linkedin-capture-spec-workflow-shortlists*
*Plan: 01-linkedin-ingest*
*Completed: 2026-05-20*
