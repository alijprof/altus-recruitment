-- Stripe webhook status ledger — audit §4.10 (Steele Charles feature
-- review 2026-07-31, Batch 2 Task 3).
--
-- Today `stripe_webhook_events` records COMPLETION only (a row exists iff
-- processing finished without throwing). A handler that throws leaves NO
-- durable trace at all — the only signal is a transient 500 in Vercel logs
-- and a Sentry exception that scrolls off. This migration adds a status
-- ledger so a failed event is durably visible (status='error') and a
-- long-stuck event can be alerted on by the daily reconcile sweep, WITHOUT
-- changing the existing idempotency contract: a 'processed' (or legacy
-- NULL, back-dated below) row still short-circuits reprocessing; a
-- 'received' or 'error' row does NOT — those must still be re-driven by
-- Stripe's retry.
--
-- RLS stays enabled with zero policies (service-role only, matches the
-- table's existing posture) — this is a global operational ledger, not
-- tenant data, and is intentionally excluded from org export/erasure.
--
-- No existing row is modified in a way that changes behaviour: the
-- 'processed' default below is a truthful backfill (every pre-existing row
-- was written ONLY on successful completion under the old contract), so
-- today's idempotency semantics for historical rows are preserved exactly.
-- Additive + idempotent only — safe to re-push.

alter table public.stripe_webhook_events
  add column if not exists status text not null default 'processed';

alter table public.stripe_webhook_events
  add column if not exists error_detail text;

alter table public.stripe_webhook_events
  add column if not exists processed_at timestamptz;

alter table public.stripe_webhook_events
  drop constraint if exists stripe_webhook_events_status_check;

alter table public.stripe_webhook_events
  add constraint stripe_webhook_events_status_check
  check (status in ('received', 'processed', 'error'));

-- Partial index for the reconcile sweep's stuck-row query
-- (status <> 'processed' AND created_at < now() - interval '1 hour').
create index if not exists stripe_webhook_events_unprocessed_idx
  on public.stripe_webhook_events (created_at)
  where status <> 'processed';
