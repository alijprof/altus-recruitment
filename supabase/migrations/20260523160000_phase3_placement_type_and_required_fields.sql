-- Phase 3 / UAT-260523-PLACEMENT-CAPTURE
--
-- UAT 2026-05-23 finding: moving a candidate to `placed` skips fee/date/type
-- capture, so the source-attribution report shows placement counts but no
-- revenue. This migration adds the structural foundation:
--
--   1. New enum `placement_type` — (perm, contract, temp, fixed_term).
--      Distinct from `job_type` (which has no fixed_term value) and represents
--      the actual placement contract classification at the moment of placement.
--
--   2. New column `applications.placement_type` — nullable; filled by the
--      PlacementModal at the moment of moving a candidate to `placed`.
--
--   3. New column `applications.placement_currency` — ISO 4217 currency code,
--      NOT NULL default 'GBP'. Allows non-GBP placements in future without a
--      schema change.
--
--   4. CHECK constraint `placement_fields_present_when_placed` — mirrors the
--      existing `decline_reason_present_when_terminal` (phase1_domain_schema.sql
--      line 316) so the database is the final authority: any new or updated
--      `placed` row MUST carry fee_pence, placed_at, and placement_type.
--
-- NOT VALID posture:
--   The constraint is added NOT VALID (no full-table scan to validate existing
--   rows). Postgres still enforces the constraint on every INSERT and UPDATE
--   after this migration — only pre-existing rows are exempt from the one-time
--   backfill validation scan. This is the correct choice because the UAT DB
--   may have a legacy placed row (Liam's test placement from UAT) that lacks
--   the new fields. A future migration can run `validate constraint` after a
--   backfill if needed.
--
--   Append-only per CLAUDE.md — this file adds only; does not edit any prior
--   migration.

-- 1. Enum
create type public.placement_type as enum ('perm', 'contract', 'temp', 'fixed_term');

comment on type public.placement_type is
  'UAT-260523-PLACEMENT-CAPTURE: contract classification at moment of placement. '
  'Distinct from job_type (no fixed_term value there). Labels resolved at render '
  'time in src/lib/placement-types.ts — do not change values without a migration.';

-- 2. Columns
alter table public.applications
  add column if not exists placement_type public.placement_type,
  add column if not exists placement_currency text not null default 'GBP';

comment on column public.applications.placement_type is
  'UAT-260523-PLACEMENT-CAPTURE: contract type at moment of placement. '
  'NULL until the PlacementModal records it via the move_application RPC. '
  'Required (with fee_pence and placed_at) whenever stage = ''placed'' — see '
  'placement_fields_present_when_placed CHECK.';

comment on column public.applications.placement_currency is
  'UAT-260523-PLACEMENT-CAPTURE: ISO 4217 currency for the placement fee. '
  'Defaults to GBP (anchor customer). Non-nullable so aggregation is '
  'unambiguous; change via migration when multi-currency billing lands.';

-- 3. CHECK constraint — NOT VALID (see above)
alter table public.applications
  add constraint placement_fields_present_when_placed
  check (
    stage <> 'placed'
    or (fee_pence is not null and placed_at is not null and placement_type is not null)
  )
  not valid;

comment on constraint placement_fields_present_when_placed on public.applications is
  'UAT-260523-PLACEMENT-CAPTURE: mirrors decline_reason_present_when_terminal. '
  'NOT VALID: enforces on new/updated rows but does not scan existing rows '
  '(legacy placed rows from UAT may lack fields). Validate after backfill if '
  'needed. The move_application RPC pre-flights this check for a friendlier '
  'error message.';
