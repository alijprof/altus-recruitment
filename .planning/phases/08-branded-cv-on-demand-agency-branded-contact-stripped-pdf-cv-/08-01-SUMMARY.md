---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 01
subsystem: database
tags: [postgres, supabase, rls, storage, migrations, vitest]

# Dependency graph
requires: []
provides:
  - "candidate_branded_cvs table (design + code complete; NOT YET applied to production — see status below)"
  - "org-logos private Storage bucket (design + code complete; NOT YET applied to production)"
  - "organizations.logo_storage_path column (design + code complete; NOT YET applied to production)"
  - "tests/unit/supabase/phase8-migrations.test.ts — regression pins for both migrations"
affects: [08-02, 08-03, 08-04, 08-05, 08-06, 08-07, 08-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-inspection regression test (node:fs read + comment-stripped regex assertions) for migration SQL, mirroring Phase 07-05's cron-hardening.test.ts pattern"
    - "Idempotent migration guards (create table if not exists, drop policy if exists, drop trigger if exists, on conflict do nothing, add column if not exists) so a partially-applied branch can be safely re-pushed"

key-files:
  created:
    - supabase/migrations/20260812120000_candidate_branded_cvs.sql
    - supabase/migrations/20260812120100_org_logos_bucket.sql
    - tests/unit/supabase/phase8-migrations.test.ts
  modified: []

key-decisions:
  - "Used the codebase's ACTUAL domain-table RLS policy naming convention (\"tenant select\"/\"tenant insert\"/\"tenant update\"/\"tenant delete\", unqualified) rather than the plan's illustrative interfaces-block example (\"Tenant select own org <thing>\"), which does not match what's really at candidate_cvs' policy block (phase1 migration lines 477-486) — verified by direct read"
  - "candidate_branded_cvs reuses the existing cvs Storage bucket (no new bucket needed for the PDF itself); only the logo gets a new bucket (org-logos), per the plan's storage-model decisions"

patterns-established:
  - "Migration + source-inspection test pairs for schema changes that can't be exercised against a live DB in the unit suite"

requirements-completed: []  # BCV-04/05/06 are CODE-complete but NOT db-applied — see Status below. Do not mark complete until founder confirms the db push (Task 3).

duration: ~20min (Tasks 1-2 only; Task 3 is a blocking founder checkpoint)
completed: 2026-08-12
---

# Phase 8 Plan 01: Branded CV Schema Foundation Summary

**Two append-only migrations (candidate_branded_cvs table + org-logos private bucket + organizations.logo_storage_path) written, pinned by a 13-assertion source-inspection test, and committed — physical application to production is a BLOCKING founder-owned step (Task 3) that this environment cannot perform.**

## Status: CHECKPOINT-PENDING

Tasks 1 and 2 are complete, verified, and committed. Task 3 is a
`checkpoint:human-action` (`gate="blocking-human"`) — the founder must
physically run the `db push` script. Nothing in the app depends on this
schema yet; every later Phase 8 plan is written to degrade gracefully
until it's applied.

## Performance

- **Duration:** ~20 min (Tasks 1-2)
- **Completed:** 2026-08-12T12:08Z
- **Tasks:** 2 of 3 executed (Task 3 blocked on founder action)
- **Files created:** 3

## Accomplishments

- `candidate_branded_cvs` table migration: org/candidate cascade FKs, a
  named `unique (candidate_id)` constraint (the BCV-06 single-current-copy
  invariant, named so the future 08-07 upsert can target it unambiguously),
  full tenant RLS policy quad, `set_organization_id`/`set_updated_at`
  triggers, idempotent guards throughout.
- `org-logos` private Storage bucket migration: PNG/JPEG-only (no SVG —
  `@react-pdf/renderer`'s `Image` has no SVG rasterisation), 2 MiB cap,
  four `storage.objects` policies keyed on `current_organization_id()`,
  and an additive `organizations.logo_storage_path` column with a comment
  explaining it supersedes the legacy free-text `logo_url` and why
  external-URL logo fetch at render time is refused (SSRF surface).
- `tests/unit/supabase/phase8-migrations.test.ts`: 13 source-inspection
  assertions across both migrations (table create, both cascade FKs, the
  named unique constraint, RLS enabled, exactly 4 tenant policies each
  keyed on `current_organization_id()`, both triggers, idempotency guard
  counts, private-bucket tuple, mime allowlist with an explicit no-SVG
  check, size cap, four bucket policies, additive column) — all green.

## Task Commits

Each task was committed atomically:

1. **Task 1: candidate_branded_cvs table migration** - `2d8c01c` (feat)
2. **Task 2: org-logos private bucket + organizations.logo_storage_path** - `f2d316c` (feat)
3. **Task 3: [BLOCKING] Founder applies both migrations to production** — NOT EXECUTED, checkpoint surfaced (see below)

**Plan metadata:** this SUMMARY + commit (pending, committed alongside this file)

## Files Created/Modified

- `supabase/migrations/20260812120000_candidate_branded_cvs.sql` — new table, RLS, triggers, idempotent
- `supabase/migrations/20260812120100_org_logos_bucket.sql` — new bucket, RLS, `logo_storage_path` column, idempotent
- `tests/unit/supabase/phase8-migrations.test.ts` — 13-assertion source-inspection regression suite (new)

## Decisions Made

- **RLS policy naming:** the plan's `<interfaces>` block showed an
  illustrative shape (`"Tenant select own org <thing>"`) attributed to
  `candidate_cvs`'s actual policy block, but a direct read of
  `supabase/migrations/20260513152244_phase1_domain_schema.sql` lines
  477-486 shows the REAL convention for every domain table (`candidate_cvs`,
  `jobs`, `applications`, and the later `feedback` migration) is unqualified
  `"tenant select"` / `"tenant insert"` / `"tenant update"` / `"tenant
  delete"`. Followed the verified real convention rather than the plan's
  inaccurate illustrative text, per CLAUDE.md's "match existing codebase
  patterns" directive. Storage-bucket policies (a genuinely different,
  correctly-documented convention: `"Tenant select own org <bucket>"`) were
  copied verbatim from `20260517204501_storage_cvs_bucket.sql` /
  `20260610000100_voice_note_audio_bucket.sql` as shown.
- Reused the existing `cvs` bucket for the branded PDF itself (no new
  bucket) — only the org logo needed a new bucket, matching the plan's
  locked storage-model decisions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed the test's own bucket-mime-allowlist regex, which assumed an UPDATE-style `column = value` shape that doesn't exist in an INSERT ... VALUES tuple**
- **Found during:** Task 2, first test run
- **Issue:** The test asserted `/allowed_mime_types\s*=\s*array\[...\]/`, but the migration's `allowed_mime_types` column appears in the `insert into storage.buckets (...)` column list and its value `array['image/png', 'image/jpeg']` appears separately in the `values (...)` tuple — there is no `=` between them. The assertion would never match any correctly-written INSERT-shaped migration.
- **Fix:** Simplified the regex to match the literal array value directly (`/array\['image\/png',\s*'image\/jpeg'\]/`), independent of surrounding INSERT/UPDATE syntax.
- **Files modified:** `tests/unit/supabase/phase8-migrations.test.ts`
- **Verification:** `pnpm vitest run tests/unit/supabase/phase8-migrations.test.ts` — 13/13 green
- **Committed in:** `f2d316c` (Task 2 commit)

### Also noted (not a deviation, informational)

- **RLS policy naming** (see Decisions Made above) — technically a
  divergence from the plan's `<interfaces>` block literal text, but it is
  a Rule-1-class correction of an inaccuracy in that illustrative example,
  not a design change; the resulting SQL still satisfies every locked
  requirement (RLS on, 4-policy quad, `current_organization_id()` keyed)
  and the plan's `must_haves.key_links.pattern` regex checks
  (`current_organization_id\(\)`, `references public\.candidates\(id\) on
  delete cascade`) both match the committed file verbatim.

---

**Total deviations:** 1 auto-fixed (Rule 1 - test-assertion bug), plus 1 informational note (RLS naming correction against an inaccurate plan example).
**Impact on plan:** No scope creep. Both migrations implement exactly the schema the plan and research specified; the only change was fixing the test I wrote to actually match valid SQL, and using the codebase's real (verified) naming convention instead of the plan's illustrative-but-wrong example.

## Issues Encountered

- **No `node_modules` in this worktree at start.** Git worktrees don't share `node_modules` with the main checkout. Ran `pnpm install --frozen-lockfile` (fast — pnpm's global store already had every package cached) before the test suite could run. Not a deviation from the plan; just a one-time environment setup step.

## User Setup Required

**BLOCKING — Task 3 of this plan is a founder checkpoint. See "What the founder must do" below.** This is not a "nice to have before shipping" item — no later Phase 8 plan's runtime code can be exercised against production until this is done (though every later plan is written to degrade gracefully in the meantime).

### What the founder must do

1. **Review both new SQL files** — they are strictly additive: one new
   table (`candidate_branded_cvs`), one new bucket (`org-logos`), one new
   nullable column (`organizations.logo_storage_path`). No `DROP`, no
   `UPDATE`/rewrite of existing data, nothing destructive to live customer
   data.
   - `supabase/migrations/20260812120000_candidate_branded_cvs.sql`
   - `supabase/migrations/20260812120100_org_logos_bucket.sql`
2. **Run the db-push script:** `pnpm exec supabase db push --linked`
   - Do NOT use MCP `apply_migration` — it stamps the migration ledger
     with the current UTC time rather than the filename timestamp, which
     drifts a subsequent `db push` (per the 2026-07-08 memory note).
3. **Confirm** both migrations appear in the remote ledger and that
   `supabase db push` reports no drift afterwards.
4. **Regenerate types:** `pnpm db:types` (commit the result — later Phase
   8 plans use documented `as unknown as` casts only where the generated
   types still lag, mirroring `src/lib/db/organizations.ts`).
5. **Confirm in the Supabase dashboard:**
   - Storage shows an `org-logos` bucket marked **PRIVATE**.
   - Database → Tables shows `candidate_branded_cvs` with **RLS enabled**.

Reply "applied" (plus anything the push reported), or describe the
failure, to resume Phase 8 execution.

## Next Phase Readiness

- **Blocked:** every later Phase 8 plan (08-02 through 08-08) that reads or
  writes `candidate_branded_cvs`, the `org-logos` bucket, or
  `organizations.logo_storage_path` at runtime needs this migration applied
  to production first. Plans that don't touch this schema (e.g. installing
  `@react-pdf/renderer`, building the template component in isolation) are
  unaffected and can proceed in parallel per the wave plan.
- **Not blocked:** this plan's own deliverables (migration files + test)
  are code-complete, committed, and independently verifiable without a live
  database, per the source-inspection test design.

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12 (Tasks 1-2); Task 3 checkpoint-pending*
