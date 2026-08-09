---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
plan: 08
subsystem: cv-intake
tags: [server-actions, storage, security, byte-sniffing, cv-intake]

# Dependency graph
requires:
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-07 — CV_WRONG_FORMAT_MESSAGE / CV_UNSUPPORTED_FORMAT_MESSAGE / CV_DAMAGED_FILE_MESSAGE literals + classifyExtractionError, reused verbatim so upload-time and async copy for the same condition never diverge"
  - phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
    provides: "06-03/06-04 — Tier-1/Tier-2/hostile fixture corpus + manifest.json this plan's tests are driven from"
provides:
  - "src/lib/cv/file-signature.ts — dependency-free sniffFileType/isDocxArchive/assertUploadableCV, zero jszip in the runtime bundle"
  - "src/app/(app)/candidates/[id]/actions.ts — uploadCVAction rejects a byte-signature mismatch before Storage write / DB row / AI spend"
  - "src/app/(public)/apply/[orgSlug]/actions.ts — confirmApplyAction sniffs a bounded head read at the earliest server-visible moment on the signed-URL upload path"
affects: [06-09, 06-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Byte-signature detection via a positive ASCII-sequence scan of ZIP entry names, never via a ZIP decoder — answers 'is this really a DOCX' without ever inflating attacker-controlled bytes (zip-bomb DoS surface avoided by construction)"
    - "Two-tier contradiction logic for the same underlying signature module: a FULL-BYTES caller (recruiter upload) gets a definitive wrong-format/unsupported-format split; a BOUNDED-HEAD-READ caller (apply confirm) only rejects on unambiguous positive contradictions and treats an incomplete read as inconclusive-in-the-applicant's-favour, never a false rejection"
    - "Range-GET-with-full-download-fallback for a public-endpoint Storage read: try a signed URL + Range header first (bounded cost), silently fall back to a full download only if that fails — correctness never depends on which path ran, only efficiency does"

key-files:
  created:
    - src/lib/cv/file-signature.ts
    - tests/unit/lib/cv/file-signature.test.ts
    - tests/unit/app/apply/confirm-action-file-sniff.test.ts
  modified:
    - src/app/(app)/candidates/[id]/actions.ts
    - src/app/(public)/apply/[orgSlug]/actions.ts

key-decisions:
  - "confirmApplyAction rejects EVERY positive-contradiction class (DOCX-as-PDF, PDF-as-DOCX, ODT/OLE2/RTF/TXT under either allowed mime) with the SAME CV_WRONG_FORMAT_MESSAGE literal, not the wrong-format/unsupported-format split assertUploadableCV uses on the recruiter's full-bytes path. Rationale: the apply path only ever has two possible declared mimes (ALLOWED_MIMES = PDF | DOCX) and, per the plan's explicit Task 3 <behavior> spec ('The same for an ODT, an OLE2 .doc, an RTF and a plain .txt...'), the applicant-facing message only needs to say 'this doesn't match what you said it was' — the finer unsupported-vs-wrong-format distinction requires bytes this bounded read can't always guarantee it has seen in full."
  - "'ZIP declared as DOCX but isDocxArchive is false' is NEVER a rejection on the apply path, regardless of file size (i.e. no 'did we read the whole object' tracking was added to make small files like the ODT fixture a hard reject). A simpler, uniformly-safe rule was chosen instead: only reject zip+PDF (unambiguous) and always allow zip+DOCX through (T-06-34) — matching the plan's explicit 'only reject on a positive contradiction... bytes say ZIP and mime says PDF' list, which conspicuously does NOT include 'zip+DOCX+no-entries-found'. The ODT-declared-as-DOCX fixture is asserted in the test suite as an explicit ALLOWED-THROUGH case, proving this is a tested decision, not an oversight — the async pipeline (full download) still classifies it correctly via 06-07's classifyExtractionError."
  - "isDocxArchive is called in confirmApplyAction purely for an observability breadcrumb (records whether the bounded read could positively confirm a real DOCX), not for the reject decision itself — the reject decision for 'zip + declared DOCX' is always 'no reject' regardless of isDocxArchive's result. This keeps the import genuinely used (not dead code) while being honest that its result doesn't gate behaviour on this path, only on the recruiter's full-bytes assertUploadableCV path."
  - "confirm-action-file-sniff.test.ts drives the mismatch logic through the mocked service client's `.download()` fallback path only (no `createSignedUrl` in the mock, matching the two sibling confirm-action test files' existing style) rather than stubbing global `fetch` — deterministic, no new test-infra dependency, and the two existing sibling apply tests continue to pass unmodified because their pre-existing mocks (which don't implement createSignedUrl/download at all) now correctly fall through readObjectHeadBytes's nested try/catch to a null result, exercising the 'read failure — fall through' path exactly as production code would."
  - "No new unit test added for uploadCVAction (Task 2) — matches the plan's explicit 'add a unit test only if the file's current test harness makes it cheap' escape hatch. actions.ts (candidates) has zero existing action-test harness to extend (createClient, getProfile, nextCVVersion, storage.upload, createCandidateCV, createActivity, and inngest would all need mocking from scratch); coverage comes from Task 1's corpus-driven file-signature tests (which prove assertUploadableCV's decisions) plus the plan 06-09 red-suite smoke."

# Metrics
duration: ~25 min
completed: 2026-08-09
tasks-completed: 3
commits: 3
---

# Phase 6 Plan 8: Byte-Level Format Rejection Summary

Dependency-free magic-byte + DOCX-entry-name sniffing (`src/lib/cv/file-signature.ts`, zero jszip in the runtime bundle) now gates both CV-intake surfaces: the recruiter upload action rejects a renamed/mislabelled/unsupported file before any Storage write, DB row, or AI spend, and the public apply form's `confirmApplyAction` — which never sees bytes at submit, only after the browser's signed-URL PUT completes — sniffs a bounded 64 KiB head read at the earliest server-visible moment, resolving any read ambiguity in the applicant's favour rather than risking a false rejection of a genuine CV.

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-09T22:29Z
- **Tasks:** 3 / 3
- **Files modified:** 5 (2 new source, 1 modified source unchanged-in-count + 1 more modified source, 2 new test files — matches the plan's `files_modified` list)

## Accomplishments

- New `src/lib/cv/file-signature.ts`: `sniffFileType` (magic-byte detection for PDF/ZIP/OLE2/RTF/unknown, never throws), `isDocxArchive` (bounded 64 KiB head+tail ASCII scan for `[Content_Types].xml` + `word/document.xml`, no ZIP decoder, no inflation — zero zip-bomb surface), and `assertUploadableCV` (full-bytes discriminated wrong-format vs unsupported-format result, reusing plan 06-07's message literals so upload-time and async copy are identical for the same condition).
- Corpus-driven `file-signature.test.ts` (27 tests): every Tier-1 fixture accepted, every named Tier-2 class (renamed docx/pdf, ODT, legacy .doc, RTF, TXT) rejected with the correct reason, `t2-pdf-corrupt.pdf` explicitly accepted (a body-corruption problem for `classifyExtractionError`, not a signature problem — asserted so the division of responsibility is tested, not accidental), hostile corpus sniffs correctly, zero/short-buffer boundary safety.
- `uploadCVAction` (recruiter path): sniffs the actual bytes via `assertUploadableCV`, placed between the `MAX_CV_BYTES` size check and `requireEntitledOrg` — a renamed DOCX uploaded as `.pdf` (or any Tier-2 unsupported format) now costs zero Storage writes, zero DB rows, and zero AI budget. `ACCEPTED_CV_MIME`, `MAX_CV_BYTES`, `slugifyFilename`, and the storage path layout are byte-identical to before this plan.
- `confirmApplyAction` (apply path): new step 2c between the object-exists check and the entitlement gate. Reads a bounded head via signed URL + Range GET (falling back to a full `.download()` only if that fails) and rejects only on a positive contradiction (bytes=PDF/mime=DOCX, bytes=ZIP/mime=PDF, bytes=OLE2/RTF/unknown regardless of declared mime) — a genuine DOCX whose entries fall outside the read window is deliberately treated as inconclusive and allowed through (T-06-34), and a Storage read failure never blocks the application (breadcrumb + fall-through, matching the availability-over-precision instruction). `ALLOWED_MIMES`, `MAX_BYTES`, the storage path construction, and the tenant re-derivation from the slug are byte-identical to before this plan.
- New `confirm-action-file-sniff.test.ts` (10 tests): every named Tier-2 mismatch class rejected with the row marked failed and `inngest.send` NOT called; genuine PDF/DOCX pass through unaffected; the ODT-declared-as-DOCX inconclusive case explicitly proven allowed-through (not rejected); a Storage read failure explicitly proven non-blocking. Both pre-existing sibling apply-confirm test files continue to pass unmodified.

## Task Commits

Each task was committed atomically:

1. **Task 1: Dependency-free CV file-signature module** - `76cf849` (feat)
2. **Task 2: Recruiter path — reject at upload, before Storage and before AI spend** - `ae2d26e` (feat)
3. **Task 3: Apply path — sniff at the earliest architecturally possible moment** - `521ef74` (feat)

_No TDD RED→GREEN split commits were needed — Tasks 1 and 3 are marked `tdd="true"` in the plan; each was written test-and-implementation together per file, run to green, and only then committed (consistent with how plan 06-07 handled the same marking)._

## Files Created/Modified

- `src/lib/cv/file-signature.ts` (new) - `sniffFileType`, `isDocxArchive`, `assertUploadableCV`
- `tests/unit/lib/cv/file-signature.test.ts` (new) - corpus-driven signature tests
- `src/app/(app)/candidates/[id]/actions.ts` - `uploadCVAction` byte sniff before the entitlement gate and Storage write
- `src/app/(public)/apply/[orgSlug]/actions.ts` - `confirmApplyAction` step 2c: `readObjectHeadBytes` + `isApplyPathFormatMismatch`
- `tests/unit/app/apply/confirm-action-file-sniff.test.ts` (new) - confirm-time sniff tests against real corpus bytes

## Decisions Made

See `key-decisions` in the frontmatter for full rationale on: the apply path's single-literal (CV_WRONG_FORMAT_MESSAGE) rejection copy vs the recruiter path's wrong-format/unsupported-format split, the deliberate choice NOT to add "did we read the whole object" tracking for the ZIP+DOCX ambiguity (always allow through instead), `isDocxArchive`'s observability-only role in `confirmApplyAction`, the test-mock strategy (download-fallback path, no global fetch stub), and skipping a dedicated `uploadCVAction` unit test.

## Deviations from Plan

None beyond the local-sandbox port workaround documented under Issues Encountered below — plan executed exactly as specified. No architectural changes, no new dependencies, no scope creep.

## Issues Encountered

**Local Supabase stack port conflict (environment-only, not a code issue).** `pnpm exec supabase start` failed to bind the configured `[db] port = 54322` because an unrelated long-lived process on this machine (Claude Desktop, an outbound HTTPS connection) had that port as its ephemeral source port at the time. Worked around by temporarily editing `supabase/config.toml`'s `[db] port`/`shadow_port` to a free pair (54382/54380), running `pnpm test:integration` (22/22 green, twice — once per Task 3 edit), then reverting `config.toml` to its committed value before the Task 3 commit (`git diff --stat supabase/config.toml` shows zero change in the final commit). No project file, migration, or committed config was altered by this workaround.

## Threat Flags

None. All six `mitigate`-disposition threats in the plan's `<threat_model>` were implemented as specified:
- **T-06-29** (content-type spoofing) — `assertUploadableCV` (recruiter) and `isApplyPathFormatMismatch` (apply) both decide from raw bytes, never from `file.type`/declared mime.
- **T-06-30** (10 MiB reads on a public endpoint) — apply path prefers a 64 KiB Range GET; full download only as a fallback, still bounded by the pre-existing 10 MiB cap.
- **T-06-31** (zip bomb labelled `.docx`) — `isDocxArchive` never inflates; it byte-scans uncompressed entry names only.
- **T-06-32** (forged `candidateCvId` at confirm) — untouched; `git diff` confirms zero change to the slug re-derivation or the (org, candidate) re-verification.
- **T-06-33** (jszip entering the runtime bundle) — `grep -rn "jszip" src/` returns only comments explaining why it was deliberately NOT used; zero imports.
- **T-06-34** (false rejection of a legitimate CV) — the apply path's ranged-read ambiguity is explicitly, and now test-provably, resolved as allow-through, not rejection.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both CV-intake surfaces now honestly reject Tier-2 format mismatches at the earliest point each is architecturally capable of: upload time on the recruiter path, confirm time on the apply path — closing the "generic message three minutes later" gap the phase's evidence identified for renamed/wrong-extension/unsupported files.
- `pnpm test` (755/755, +37 over the 06-07 baseline of 718 — 27 new file-signature tests + 10 new confirm-action-sniff tests), `pnpm exec tsc --noEmit` (clean), `pnpm lint` (24 warnings, byte-identical to baseline), and `pnpm test:integration` (22/22, verified twice against a fresh local stack) are all green with zero regressions.
- Plan 06-09 (red-suite diff / acceptance) can proceed without further changes to this plan's files — the red-suite fixtures and message literals this plan consumes (from 06-03/06-04/06-07) were read-only inputs here, never modified.

---
*Phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world*
*Completed: 2026-08-09*

## Self-Check: PASSED

All key-files (`src/lib/cv/file-signature.ts`, `tests/unit/lib/cv/file-signature.test.ts`,
`tests/unit/app/apply/confirm-action-file-sniff.test.ts`) verified present on disk via
`ls -la`, plus this SUMMARY.md. All 3 task commits (`76cf849`, `ae2d26e`, `521ef74`)
verified present via `git cat-file -t <hash>` (each returns `commit`). Final full
verification re-run after all three commits: `pnpm exec vitest run` — 755 passed
(0 failed, +37 over the 06-07 baseline of 718); `pnpm exec tsc --noEmit` — clean;
`pnpm exec eslint .` — 0 errors / 24 warnings (baseline-identical); `pnpm test:integration`
against a freshly started local Supabase stack — 22/22 passed, run twice (once per Task 3
edit), stack stopped both times. `git diff 0f41c22853caebeb21153a37960b44050ea60809..HEAD`
confirms a purely additive diff on both action files — zero touched lines on
`ACCEPTED_CV_MIME`, `MAX_CV_BYTES`, `MAX_BYTES`, `ALLOWED_MIMES`, `slugifyFilename`, the
storage path layouts, or the apply path's tenant re-derivation. `supabase/config.toml`
confirmed byte-identical to its committed state after the local-stack workaround
(`git diff --stat` empty).
