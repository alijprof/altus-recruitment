---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 03
subsystem: pdf
tags: [contact-stripping, magic-byte-sniffing, tdd, branded-cv, upload-validation]

# Dependency graph
requires: []
provides:
  - "toBrandedCvData(candidate: unknown): BrandedCvData — allowlist mapper with a type-level guarantee that email/phone/salary fields cannot be expressed on the output"
  - "assertUploadableLogo(bytes, declaredMime, byteLength) — PNG/JPEG magic-byte sniff + declared-MIME agreement gate for logo uploads"
affects: [08-04 (branded PDF template — consumes BrandedCvData), 08-05 (logo upload Server Action — consumes assertUploadableLogo)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit literal-key object construction (never spread untrusted input) as the mechanism that makes a security guarantee true by construction rather than a rendering discipline to remember"
    - "unknown-accepting, never-throwing pure mappers for jsonb columns whose generated TS type is Json (defensive coercion, not assumption)"
    - "Offset-0-only magic-byte sniffing for upload gates where the consuming library has zero tolerance for a prefixed/shifted header (contrast the PDF sniffer's 1024-byte search window, needed because pdf.js itself tolerates a BOM preamble)"

key-files:
  created:
    - src/lib/pdf/branded-cv-data.ts
    - src/lib/upload/image-signature.ts
    - tests/unit/lib/pdf/branded-cv-data.test.ts
    - tests/unit/lib/upload/image-signature.test.ts
  modified: []

key-decisions:
  - "location is KEPT on the branded CV (not stripped) — founder-confirmed 2026-08-12, settled per 08-CONTEXT.md Research Assumption A1 Reading B; encoded as the presence of a `location` key on BrandedCvData, tested by a dedicated retention case alongside the strip pin"
  - "salary_current_estimate/salary_expectation/currency are excluded as a deliberate allowlist decision (not an oversight) — commercially sensitive negotiating information that must never reach a client-facing document"
  - "Free text (headline/about) is NOT regex-scrubbed — BRANDED_CV_FREE_TEXT_WARNING is the UI-facing mitigation instead, documented inline as a deliberate limitation"

patterns-established:
  - "BrandedCvData's contact-strip guarantee is pinned two ways in the same test suite: a runtime full-JSON-serialisation substring check AND a compile-time @ts-expect-error access — either one regressing independently is caught"
  - "Prototype-pollution safety is achieved by never reading arbitrary object keys (only ever named literals via a safeField helper) rather than by sanitising dangerous keys after the fact"

requirements-completed: [BCV-03, BCV-04]

# Metrics
duration: 5min
completed: 2026-08-12
---

# Phase 08 Plan 03: Branded-CV pure modules Summary

**Contact-stripping `toBrandedCvData` mapper (email/phone/salary excluded, location kept per founder sign-off) plus a dependency-free PNG/JPEG magic-byte sniffer (`assertUploadableLogo`) for logo uploads — both built TDD with 74 passing tests.**

## Performance

- **Duration:** 5 min (commit-to-commit)
- **Started:** 2026-08-12T13:08:54+01:00
- **Completed:** 2026-08-12T13:12:35+01:00
- **Tasks:** 2
- **Files modified:** 4 (all created)

## Accomplishments
- `BrandedCvData` type physically cannot express `email`, `phone`, or any salary field — no future template edit can leak one, pinned by both a full-JSON-serialisation runtime test and `@ts-expect-error` compile-time assertions
- `location` (city/region) is retained on the branded copy per the founder's 2026-08-12 confirmation, verified by a dedicated retention test sitting right next to the strip pin
- Defensive coercion of hostile/malformed `work_experience`/`education` jsonb (null, string, number, object, array-of-strings, array-of-objects-with-bad-members) never throws, drops all-blank entries, and caps volume/length so a corrupted row cannot produce an unbounded document
- Prototype-pollution safety (`__proto__`/`constructor` keys ignored) achieved structurally — the mapper never reads an arbitrary key, only named literals
- `assertUploadableLogo` rejects SVG/GIF/PDF/WebP/executable-masquerading-as-logo uploads and enforces declared-MIME-vs-bytes agreement, mirroring the CV upload sniffer's discipline without coupling to it

## Task Commits

Each task was committed as a RED/GREEN TDD pair:

1. **Task 1: Contact-stripping branded-CV data mapper**
   - `b5d3503` (test) — failing test suite: serialisation pin, location retention, defensive coercion, prototype-pollution, volume caps
   - `ec468eb` (feat) — `toBrandedCvData` implementation, 45/45 tests green
2. **Task 2: PNG/JPEG magic-byte sniffer for logo uploads**
   - `422664a` (test) — failing test suite: signature detection, spoofing/polyglot rejection, MIME-agreement gate, size cap
   - `eb3ded9` (feat) — `sniffImageType`/`assertUploadableLogo` implementation, 29/29 tests green

**Plan metadata:** this commit (docs: complete plan)

_Both tasks are `tdd="true"` — no REFACTOR commit was needed; each GREEN implementation passed on the first attempt with no follow-up cleanup._

## Files Created/Modified
- `src/lib/pdf/branded-cv-data.ts` — `toBrandedCvData` allowlist mapper, `BrandedCvData`/`BrandedWorkEntry`/`BrandedEducationEntry` types, `BRANDED_CV_FREE_TEXT_WARNING` constant (200 lines)
- `src/lib/upload/image-signature.ts` — `sniffImageType`, `assertUploadableLogo`, `MAX_LOGO_BYTES`, `LOGO_WRONG_FORMAT_MESSAGE`, `LOGO_UNSUPPORTED_FORMAT_MESSAGE`, `LOGO_TOO_LARGE_MESSAGE` (109 lines)
- `tests/unit/lib/pdf/branded-cv-data.test.ts` — 45 tests covering every `<behavior>` bullet
- `tests/unit/lib/upload/image-signature.test.ts` — 29 tests covering every `<behavior>` bullet

## Decisions Made
- Followed the plan's field list exactly: `BrandedCvData` keys are `fullName`, `headline`, `location`, `currentRoleTitle`, `currentCompany`, `seniorityLevel`, `yearsExperience`, `about`, `skills`, `sectorTags`, `work`, `education` — nothing more, nothing less
- `byteLength` is a separate parameter on `assertUploadableLogo` (not derived from `bytes.length`) so a caller holding only a head-read of a larger upload can still enforce the size cap against the true full byte count — matches the plan's exact signature `assertUploadableLogo(bytes, declaredMime, byteLength)`
- Ran `pnpm install --frozen-lockfile` at the start of execution because this worktree had no `node_modules` yet — installed exactly what `pnpm-lock.yaml` specifies with zero modification to `package.json`/`pnpm-lock.yaml` (verified via `git status` before and after)

## Deviations from Plan

None — plan executed exactly as written. Both modules match the plan's exported symbol lists, `<interfaces>` field inventory, and threat-model mitigations (T-08-11 through T-08-16) precisely.

## Issues Encountered
- This worktree had no `node_modules` at the start of execution (each git worktree has its own working directory). Resolved with `pnpm install --frozen-lockfile`, which installs strictly from the committed lockfile and cannot modify `package.json`/`pnpm-lock.yaml` — confirmed clean via `git status --short` immediately after.

## User Setup Required

None — no external service configuration required. Both modules are dependency-free and require no environment variables or dashboard setup.

## Next Phase Readiness

- `BrandedCvData` is ready for 08-04 (the `@react-pdf/renderer` template) to consume as its sole input type — the compile-time absence of contact/salary fields means the template cannot accidentally render them even if a future edit tries.
- `assertUploadableLogo` is ready for 08-05 (the logo upload Server Action) to gate Storage writes — no Storage write has happened yet in this plan (by design; this plan is pure modules only).
- No blockers. `pnpm vitest run tests/unit/lib/pdf/branded-cv-data.test.ts tests/unit/lib/upload/image-signature.test.ts` (74/74 green), `pnpm typecheck` (clean, proving the `@ts-expect-error` pins still error), and `pnpm lint` (0 errors; 25 pre-existing warnings in unrelated files, none introduced by this plan) all pass.

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12*

## Self-Check: PASSED

All 4 created files verified present on disk; all 4 task commits (`b5d3503`, `ec468eb`, `422664a`, `eb3ded9`) verified present in `git log --all`.
