-- Phase 5 Wave 2 (05-05): plan_overrides table.
--
-- PURPOSE: Lets the super-admin extend a trial or bump AI caps for a specific
-- org without a code deploy (D-13). The entitlement helper (05-01
-- src/lib/stripe/entitlement.ts) reads this table and applies the override
-- when present. Normal behaviour (no row) is entirely unchanged.
--
-- SECURITY MODEL:
--   Writes:  service-role ONLY (via gated admin server actions). No
--            `authenticated` write policy — RLS blocks any JWT-scoped write.
--   Reads:   RLS SELECT policy scoped to the org's own row via
--            current_organization_id(). This lets the entitlement helper read
--            the org's own override under its own RLS-scoped client without
--            needing service-role for the read path. The admin queries use
--            the service-role client and bypass RLS to read all orgs' overrides
--            for the cross-org overview.
--
-- COLUMNS:
--   trial_end_override  — if set, extends the trial window beyond trial_end
--                         on the subscriptions row. Entitlement: when status is
--                         'trialing' and now() < trial_end_override, the org
--                         keeps trialing entitlement (even if trial_end passed).
--   cap_multiplier      — numeric multiplier applied to every AI cap bucket.
--                         1.0 = no change (default), 1.5 = 50% extra, 2.0 = double.
--                         Stored as null when not set (interpreted as 1.0 by code).
--                         Must be > 0 to prevent zeroing-out caps accidentally.
--   note                — free-text reason for the override (e.g. "demo extension
--                         for TechCorp — AJ 2026-06-04").
--   updated_by          — UUID of the super-admin user who last wrote this row.
--   updated_at          — auto-updated timestamp.
--
-- MIGRATION IS APPEND-ONLY — never edit this file once committed. Fix schema
-- issues in a new migration file with a later timestamp.
--
-- [BLOCKING] NOTE: After writing this file, do NOT push it — the founder
-- must run `pnpm exec supabase db push --linked` manually. Until pushed:
--   - src/types/database.ts does not contain plan_overrides
--   - Code referencing plan_overrides uses `as unknown as` cast boundaries
--     (same pattern as org brand fields in src/lib/db/organizations.ts)
--   - After push + `pnpm db:types` regeneration, cast boundaries may be removed

create table if not exists public.plan_overrides (
  -- PK is also the FK — one row per org, and the org IS the identity.
  organization_id uuid primary key references public.organizations(id) on delete cascade,

  -- Extends the effective trial window (may be later than subscriptions.trial_end).
  trial_end_override timestamptz,

  -- Cap multiplier applied to all AI cap buckets. 1.0 = baseline. Must be > 0.
  cap_multiplier numeric check (cap_multiplier > 0),

  -- Human-readable reason for the override.
  note text,

  -- Who set this override (must be a super-admin by application contract).
  updated_by uuid references auth.users(id) on delete set null,

  -- When the override was last written.
  updated_at timestamptz not null default now()
);

-- Enable RLS — mandatory on every domain table.
alter table public.plan_overrides enable row level security;

-- READ policy: an org can read its OWN override row.
-- This allows the entitlement helper (running under the org's RLS-scoped client)
-- to read the override without needing service-role for the read path.
-- Admin cross-org reads use the service-role client (which bypasses RLS entirely).
create policy "plan_overrides_select_own_org"
  on public.plan_overrides
  for select
  using (organization_id = public.current_organization_id());

-- No INSERT/UPDATE/DELETE policy for the authenticated role.
-- All writes come through admin server actions using the service-role client.
-- This makes the table effectively read-only for any JWT-scoped caller.

-- Index on updated_at for the admin overview (sort by most recently overridden).
create index if not exists plan_overrides_updated_at_idx
  on public.plan_overrides (updated_at desc);
