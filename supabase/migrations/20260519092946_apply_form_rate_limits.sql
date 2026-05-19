-- apply_form_rate_limits — Postgres-backed rate limit table for the public
-- apply form (no Redis in our stack).
--
-- D2-12: 5-minute sliding window, 3 submissions per IP per org per window
-- (Plan 3 enforces the count; this table holds the rows). IP is hashed
-- before storage — GDPR requires us not to retain raw IPs.
--
-- Intentionally NO RLS: this table is service-role only. Writes happen
-- from the apply-form server action (Plan 3) using createServiceClient().
-- No authenticated role should ever read or write here. Belt-and-braces:
-- explicit REVOKE on authenticated + anon.
--
-- Manual smoke tests after apply:
--
--   -- 1) authenticated cannot read:
--   set role authenticated;
--   select * from public.apply_form_rate_limits;
--   -- expect: permission denied OR no rows visible (REVOKE makes the
--   --         permission-denied path the right answer)
--
--   -- 2) service_role can read + write:
--   set role service_role;
--   insert into public.apply_form_rate_limits (ip_hash, organization_id)
--     values ('test-hash', '<org-id>');
--   select * from public.apply_form_rate_limits;
--   -- expect: success; row visible

create table public.apply_form_rate_limits (
  ip_hash text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  window_start timestamptz not null default now(),
  count integer not null default 1,
  primary key (ip_hash, organization_id, window_start)
);

create index apply_form_rate_limits_window_idx
  on public.apply_form_rate_limits (organization_id, window_start desc);

-- intentionally no RLS: this table is service-role only; writes happen
-- from the apply-form server action which uses createServiceClient().
-- No authenticated role should read this.
revoke all on public.apply_form_rate_limits from authenticated, anon;
