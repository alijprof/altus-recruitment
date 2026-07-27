# Paywall grandfathering — production data operation

**Date:** 2026-06-06
**Context:** The card-first paywall gate (quick-260605-x9l) gates any org whose
entitlement status is not `trialing`/`active`. Existing production orgs had NO
subscription row (status `none`) and would have been locked out on deploy. This
is the deploy-time grandfathering step the PLAN deferred (PLAN.md objective note).

**Authorised by:** founder, 2026-06-06 (explicit confirmation — scope + shape).

## What was done

Inserted a permanent "comp" subscription row (no Stripe customer; not billed) for
the two real orgs. SMOKE was intentionally LEFT un-grandfathered to serve as the
live paywall-fires control during the smoke.

```sql
insert into public.subscriptions
  (organization_id, plan_key, plan_seats, status,
   stripe_customer_id, stripe_subscription_id, trial_end, current_period_end)
values
  ('cb70bfc3-d916-4831-a21d-0331b2b9efe3', 'scale', 99, 'active', null, null, null, null), -- AJ
  ('d7820945-21f8-4bb4-9bb7-680794096201', 'scale', 99, 'active', null, null, null, null)  -- Altus Consultancy
on conflict (organization_id) do nothing;
```

| Org | org_id | Decision |
|-----|--------|----------|
| AJ | cb70bfc3-d916-4831-a21d-0331b2b9efe3 | comp Scale/active — ENTITLED |
| Altus Consultancy | d7820945-21f8-4bb4-9bb7-680794096201 | comp Scale/active — ENTITLED |
| SMOKE | d7da1fae-55b1-4873-9e17-65641ebe311a | NOT comped — GATED (control) |

## Rationale for the shape

- **status `active`**: passes the gate (entitled = trialing|active).
- **plan_key `scale`, plan_seats 99**: maximum AI-cap + seat headroom; a comped org
  must never hit a cap. Cap math verified safe at this shape (no div-by-zero/negatives).
- **stripe_customer_id / stripe_subscription_id NULL**: no Stripe customer — these are
  free comps, never charged.
- **on conflict do nothing**: never clobber a real Stripe-backed row.

## Known limitations (accepted — "ship as-is")

- A comped org's `/settings/billing` shows a **"Manage billing"** button that returns
  HTTP 400 ("No billing account found") because there is no Stripe customer. Benign
  dead-end; full app access is unaffected.
- A comped org **cannot self-serve a paid Stripe checkout** later (the double-subscribe
  guard rejects any `active`/`trialing`/`past_due` row, and the billing UI hides the
  checkout cards when status ≠ `none`). Conversion path if ever needed: create the real
  Stripe subscription out-of-band → the webhook upsert (`onConflict organization_id`)
  cleanly overwrites the comp row. (Self-upgrade fix was offered and deferred.)

## Reversal

```sql
delete from public.subscriptions
where organization_id in (
  'cb70bfc3-d916-4831-a21d-0331b2b9efe3',
  'd7820945-21f8-4bb4-9bb7-680794096201'
) and stripe_customer_id is null and stripe_subscription_id is null;
```

## NOT a migration

This is prod-data-specific (real org UUIDs). It is deliberately NOT a migration —
a fresh DB has no such orgs. Any new org created after deploy goes through the
normal card-first trial.
