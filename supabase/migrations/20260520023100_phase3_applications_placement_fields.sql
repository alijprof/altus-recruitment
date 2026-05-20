-- Phase 3 / Plan 03-06 / Task F.1 — REPEAT-02.
--
-- Source-attribution report (`/reports/source-attribution`, D3-22) needs to
-- aggregate placement fee revenue and time-to-place per `candidates.source`.
-- Phase 1 omitted both columns from `applications` (verified 2026-05-20 via
-- `scripts/verify-placement-fields.sh` — neither `fee_pence` nor `placed_at`
-- appears in any prior migration).
--
-- Per CLAUDE.md "Schema choices compound — ask before adding", surfaced in
-- the SUMMARY: "Phase 3 Plan F added `applications.{fee_pence|placed_at}` as
-- they were missing from Phase 1. Additive only — no breaking change."
--
-- Append-only convention (per D3-26 + CLAUDE.md): adding columns rather than
-- editing the Phase 1 commit `3f748f8` schema.
--
-- Column semantics:
--   * fee_pence bigint NULL — perm placement fee, recorded in pence so the
--     report can render `£` totals via `formatPence`. NULL means "not yet
--     entered by recruiter"; the RPC treats NULL as zero via coalesce.
--   * placed_at timestamptz NULL — explicit placement date, NULLABLE because
--     the recruiter may not record it at the moment of moving the
--     application to stage='placed'. The RPC falls back to `stage_changed_at`
--     when `placed_at IS NULL` (see source_attribution_summary RPC).
--
-- Backfill: existing stage='placed' rows (if any) get `placed_at` set to
-- `stage_changed_at` so the avg time-to-place calc has a value for legacy
-- rows. This is idempotent — `where placed_at is null` skips re-runs.
--
-- No triggers added; recruiters fill these fields manually via the existing
-- placement-marking UI. Phase 4 may extend with auto-derivation when the
-- placement workflow grows.
--
-- Manual psql smoke tests (run after `pnpm db:reset --local`):
--   1. \d public.applications
--      -- columns fee_pence (bigint) and placed_at (timestamptz) present.
--   2. select count(*) filter (where placed_at is null) from applications
--      where stage = 'placed';
--      -- should be 0 after backfill (every placed row has placed_at).

alter table public.applications
  add column if not exists fee_pence bigint,
  add column if not exists placed_at timestamptz;

-- Backfill placed_at for historical rows in stage='placed'. Idempotent.
update public.applications
   set placed_at = stage_changed_at
 where stage = 'placed' and placed_at is null;

comment on column public.applications.fee_pence is
  'Phase 3 REPEAT-02: perm placement fee in pence. NULL until recorded; '
  'source_attribution RPC coalesces NULL to 0 for revenue aggregation.';

comment on column public.applications.placed_at is
  'Phase 3 REPEAT-02: explicit placement timestamp. NULL falls back to '
  'stage_changed_at in source_attribution_summary for legacy rows.';
