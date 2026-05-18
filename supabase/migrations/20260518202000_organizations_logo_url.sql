-- Plan 5 VERIFICATION R2: add organizations.logo_url so the Settings page
-- OrganizationForm can persist a logo URL. Phase 1 ships text-only — the
-- bucket-backed upload UI is deferred to Phase 2 (per the plan §Out of scope).
--
-- Idempotent so re-running `supabase db reset` on a partially migrated branch
-- doesn't error.

alter table public.organizations
  add column if not exists logo_url text;

comment on column public.organizations.logo_url is
  'Optional URL to the organisation logo. Phase 1 ships a plain text field; '
  'a full Supabase-Storage-backed upload UI is deferred to Phase 2.';
