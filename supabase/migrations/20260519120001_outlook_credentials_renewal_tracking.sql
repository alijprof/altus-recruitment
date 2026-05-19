-- Plan 4 Task 4.4 — renewal-attempt tracking on outlook_credentials.
--
-- The 6-hourly refresh-outlook-subscription Inngest function records
-- the outcome of each attempt so a streak of failures is visible at-a-
-- glance in the row (the application can also alert on this via the
-- next-pass detection of "prior attempt also failed").
--
-- Additive only — no behavioural change in Plan 0's schema; existing
-- rows get NULL for both columns and the trigger function in 0.3 is
-- unaffected.

alter table public.outlook_credentials
  add column if not exists last_renewal_error text,
  add column if not exists last_renewal_attempt_at timestamptz;

comment on column public.outlook_credentials.last_renewal_error is
  'Plan 4: NULL when the most recent renewal attempt succeeded; otherwise the scrubbed error code (e.g. ''ServiceUnavailable:503'' or ''recreated-after-expiry'').';
comment on column public.outlook_credentials.last_renewal_attempt_at is
  'Plan 4: UTC timestamp of the most recent renewal attempt, regardless of outcome.';
