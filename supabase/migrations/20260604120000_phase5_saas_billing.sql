-- Phase 5 Wave 0: SaaS billing tables + organisations extensions.
--
-- Covers:
--   (a) subscriptions          — one row per org; service-role writes, RLS SELECT for org members
--   (b) organizations columns  — stripe_customer_id, brand_primary, brand_secondary
--   (c) stripe_webhook_events  — idempotency ledger; service-role only (RLS deny-all for authenticated)
--   (d) ai_cap_notifications   — once-per-bucket-per-month dedup for soft-cap warning emails (05-01)
--
-- SECURITY INVARIANTS (see threat model T-05-00-*):
--   subscriptions: RLS enabled; exactly ONE SELECT policy scoped to current_organization_id();
--     NO insert/update/delete policy — writes go through the Stripe webhook handler (service-role).
--   stripe_webhook_events: RLS enabled, ZERO policies — deny-all for authenticated; service-role bypasses.
--   ai_cap_notifications: same as stripe_webhook_events — service-role only; no authenticated policy.
--   brand_primary / brand_secondary: DB-level hex CHECK ('^#[0-9a-fA-F]{6}$') enforces
--     colour format before the value ever reaches the application layer (T-05-00-04 / Pitfall 5 / D-10).
--
-- Manual smoke tests (run after `pnpm exec supabase db push --linked`):
--
--   -- 1) subscriptions table exists and is accessible:
--   select * from public.subscriptions limit 1;
--   -- expect: empty result (no error)
--
--   -- 2) org brand columns exist with CHECK:
--   update public.organizations set brand_primary = 'notahex' where id = '<org-id>';
--   -- expect: ERROR violates check constraint "organizations_brand_primary_hex"
--
--   update public.organizations set brand_primary = '#1A2B3C' where id = '<org-id>';
--   -- expect: success
--
--   -- 3) stripe_webhook_events idempotency:
--   insert into public.stripe_webhook_events (stripe_event_id, event_type) values ('evt_test_1', 'checkout.session.completed');
--   insert into public.stripe_webhook_events (stripe_event_id, event_type) values ('evt_test_1', 'checkout.session.completed');
--   -- expect: second insert errors with duplicate key on stripe_event_id (PK)
--
--   -- 4) ai_cap_notifications dedup:
--   insert into public.ai_cap_notifications (organization_id, bucket, notified_month) values ('<org>', 'match_score', '2026-06');
--   insert into public.ai_cap_notifications (organization_id, bucket, notified_month) values ('<org>', 'match_score', '2026-06');
--   -- expect: second insert errors with duplicate key on (org, bucket, month)

-- ---------------------------------------------------------------------------
-- (a) subscriptions
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  -- One subscription row per org. Cascade on org delete.
  organization_id       uuid not null unique references public.organizations(id) on delete cascade,
  stripe_customer_id    text unique,
  stripe_subscription_id text unique,
  -- plan_key mirrors PlanKey in src/types/billing.ts
  plan_key              text not null default 'none'
                          check (plan_key in ('starter', 'pro', 'scale', 'none')),
  plan_seats            int not null default 0,
  -- status mirrors SubscriptionStatus in src/types/billing.ts
  status                text not null default 'none'
                          check (status in ('trialing', 'active', 'past_due', 'cancelled', 'none')),
  trial_end             timestamptz,
  current_period_end    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Keep updated_at current on every write, matching the Phase 1 pattern.
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- RLS: org members can READ their own subscription row.
-- Writes (insert/update/delete) are service-role only via the webhook handler.
alter table public.subscriptions enable row level security;

create policy "org_members_read_own_subscription"
  on public.subscriptions
  for select to authenticated
  using (organization_id = public.current_organization_id());

-- Intentionally NO insert / update / delete policy.
-- The Stripe webhook handler (05-01) uses service-role for all writes.

-- Index for the entitlement helper lookup (by org).
create index subscriptions_org_idx on public.subscriptions (organization_id);

-- ---------------------------------------------------------------------------
-- (b) organizations columns: stripe_customer_id + brand colours
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column stripe_customer_id text unique;

-- Hex colour columns with a DB-level format CHECK.
-- The regex CHECK is the DB-level half of the brand-XSS defence
-- (render-level validation is in the settings form, 05-02).
-- Uses NOT VALID + VALIDATE so no long ACCESS EXCLUSIVE lock on existing rows.
-- Existing rows have NULL (default), which satisfies `check(... is null or ...)`.
alter table public.organizations
  add column brand_primary text
    constraint organizations_brand_primary_hex
    check (brand_primary ~ '^#[0-9a-fA-F]{6}$') not valid;

alter table public.organizations validate constraint organizations_brand_primary_hex;

alter table public.organizations
  add column brand_secondary text
    constraint organizations_brand_secondary_hex
    check (brand_secondary ~ '^#[0-9a-fA-F]{6}$') not valid;

alter table public.organizations validate constraint organizations_brand_secondary_hex;

-- Grant column-level SELECT on the new brand columns to the roles that
-- the public apply page uses (anon via service-role path, and authenticated).
-- This mirrors the grant pattern for logo_url / apply_form_enabled:
-- Supabase's default "Enable RLS" model grants table-level access via RLS
-- policies, not explicit column grants. The existing policies on `organizations`
-- (see 20260513151021) already cover authenticated reads; the public apply
-- page uses service-role (bypasses RLS). No additional column grants required
-- beyond RLS, which is already in place on the organizations table.

-- ---------------------------------------------------------------------------
-- (c) stripe_webhook_events — idempotency table
-- ---------------------------------------------------------------------------

-- stripe_event_id is the Stripe event id (evt_...) used as idempotency key.
-- PK gives us a unique constraint and fast lookup in one.
create table public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type      text,
  created_at      timestamptz not null default now()
);

-- RLS: enabled, zero policies = deny-all for authenticated.
-- The webhook handler (05-01) uses service-role, which bypasses RLS.
alter table public.stripe_webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- (d) ai_cap_notifications — once-per-bucket-per-month dedup ledger
-- ---------------------------------------------------------------------------

-- Used by the AI cap enforcement in 05-01 Task 1.4 to guarantee that a
-- soft-cap warning email fires at most once per (org, cap-bucket, calendar-month).
-- notified_month is a 'YYYY-MM' string (e.g. '2026-06').
-- The UNIQUE constraint is the enforcement mechanism; the INSERT uses
-- `ON CONFLICT DO NOTHING` so the operation is idempotent.
create table public.ai_cap_notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket          text not null,
  notified_month  text not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, bucket, notified_month)
);

-- RLS: enabled, zero policies = deny-all for authenticated.
-- Cap enforcement runs server-side via claude.ts / Inngest (service-role).
alter table public.ai_cap_notifications enable row level security;

-- Index for the "has this bucket been notified this month?" lookup.
create index ai_cap_notifications_org_bucket_month_idx
  on public.ai_cap_notifications (organization_id, bucket, notified_month);
