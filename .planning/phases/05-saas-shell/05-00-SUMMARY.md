---
phase: 05-saas-shell
plan: 00-hardening
subsystem: infrastructure
tags: [phase-5, hardening, wave-0, stripe, billing, rls, middleware, migrations]
requires:
  - phase-1..3 (organizations, ai_usage, apply route group, middleware all online)
provides:
  - src/lib/stripe/client.ts (fail-closed Stripe singleton — null when key absent + assertStripe())
  - src/lib/stripe/plans.ts (PLANS const + PLAN_PRICE_IDS + per-seat AI caps matching pricing doc §5)
  - src/types/billing.ts (PlanKey, SubscriptionStatus, AiCaps, EntitlementStatus contracts)
  - 5 Stripe env vars declared .optional() (app boots/builds with zero Stripe config)
  - PUBLIC_PATHS extended (/api/stripe/webhook, /welcome, /pricing, /features, /docs, /status)
  - public.subscriptions (org-scoped SELECT RLS, service-role writes only)
  - public.stripe_webhook_events (idempotency ledger, RLS deny-all)
  - public.ai_cap_notifications (once-per-bucket-per-month dedup ledger, RLS deny-all)
  - organizations.stripe_customer_id + brand_primary + brand_secondary (hex-CHECK)
  - super_admin:true on founder account (alasdairj8@gmail.com)
  - getOrganizationBySlug + OrganizationApplyRow expose brand_primary/secondary (BRAND-01 key link)
affects:
  - 05-01 (billing — consumes stripe client, PLANS, subscriptions, webhook-events, ai_cap_notifications)
  - 05-02 (branding — consumes brand columns via getOrganizationBySlug)
  - 05-04 (marketing — inherits /welcome /pricing /features /docs /status from PUBLIC_PATHS)
  - 05-05 (admin — consumes super_admin flag + subscriptions/entitlement layer)
tech-stack:
  added:
    - stripe@22.2.0 (official Stripe SDK; apiVersion pinned to 2026-05-27.dahlia)
    - papaparse + @types/papaparse (CSV import for 05-03)
  patterns:
    - Fail-closed external-service client (null at call time, never crash at module load) — mirrors voyage/openai
    - RLS-enabled-no-policy = deny-all for authenticated; service-role bypasses (webhook-events, ai_cap_notifications)
    - DB-level hex CHECK as first half of brand-XSS defence (render-level half lands in 05-02)
key-files:
  created:
    - src/lib/stripe/client.ts
    - src/lib/stripe/plans.ts
    - src/types/billing.ts
    - supabase/migrations/20260604120000_phase5_saas_billing.sql
    - supabase/migrations/20260604120100_phase5_super_admin_flag.sql
  modified:
    - src/lib/env.ts (5 Stripe vars .optional())
    - src/lib/supabase/middleware.ts (PUBLIC_PATHS)
    - src/middleware.ts (matcher reviewed — no change needed)
    - src/lib/db/organizations.ts (brand columns wired into all SELECTs + types)
    - src/types/database.ts (regenerated from live schema)
key-decisions:
  - "Marketing landing pre-decided at /welcome (not /) and allowlisted in Wave 0 so 05-04 never touches middleware"
  - "AI caps use docs/cost-and-pricing-analysis.md §5 numbers (Starter cvParses 200, Pro matchScores 800, Scale matchScores 2400), superseding 05-RESEARCH placeholders"
  - "stripe_customer_id on BOTH organizations (quick lookup) and subscriptions (source of truth)"
patterns-established:
  - "Stripe isolation: phase builds + ships with no Stripe keys; live keys wired by founder pre-go-live"
  - "Service-role-only ledger tables (RLS on, zero policies) for webhook idempotency + cap-notification dedup"

# Metrics
duration: ~14min executor active (Tasks 0.1-0.3) + checkpoint resolution
completed: 2026-06-04
---

# Phase 5 — Wave 0 (SaaS Shell Hardening) Summary

**Laid the entire SaaS-shell foundation: Stripe fully isolated behind optional env (app builds with zero keys), the billing/branding/idempotency schema live on the linked DB with correct RLS, the new public routes allowlisted, and the founder marked super_admin — so Waves 1–2 can build billing, branding, onboarding, marketing, and admin in parallel.**

## Performance
- **Tasks:** 3 auto-tasks (0.1–0.3) + 1 blocking human-action checkpoint (0.4) resolved
- **Executor active:** ~14 min; remainder was the migration-push checkpoint
- **Completed:** 2026-06-04

## Accomplishments
- Stripe env isolation + fail-closed client + `PLANS` (per-seat AI caps exact to pricing doc §5) + billing type contracts.
- `PUBLIC_PATHS` pre-emptively extended for all Phase-5 public surfaces incl. `/api/stripe/webhook` and the `/welcome` landing — closes the exact middleware-omission class that caused P0/P1 bugs 260527-x2q / 260528-0rd.
- Phase-5 schema applied to the linked DB: `subscriptions`, `stripe_webhook_events`, `ai_cap_notifications`, + `organizations` brand/stripe columns — all with RLS exactly to spec (subscriptions: 1 org-scoped SELECT policy, no writes; ledgers: deny-all).
- Brand columns wired into the org DB helper (BRAND-01 key link consumed by 05-02).
- `super_admin:true` set on the founder account by the guarded migration (no manual step needed).

## Task Commits
1. **Task 0.1: Stripe env + PLANS + billing types + fail-closed client** — `2819fb8` (feat)
2. **Task 0.2: Extend PUBLIC_PATHS for new public routes incl. /welcome** — `535f6b3` (feat)
3. **Task 0.3: Phase-5 migrations + brand columns wired into org DB helper** — `8d22617` (feat)
4. **Checkpoint fix: invalid NOT VALID on inline CHECK** — `8c72ff0` (fix)

## Deviations (important for Wave 2's migration push)
1. **Migration syntax bug caught at push, fixed in place.** `20260604120000` used `ADD COLUMN … CHECK (…) NOT VALID`, which is invalid Postgres (NOT VALID is only legal on `ADD CONSTRAINT`). The push failed at that statement (SQLSTATE 42601) and **rolled back cleanly** (verified: zero partial objects). Fixed to a plain inline CHECK (validates instantly on the tiny organizations table) — committed `8c72ff0` — and re-pushed successfully. *Editing a committed migration is normally forbidden, but this one had never applied to any environment, so there was no applied state to diverge from.* **Lesson for Wave 2: dry-run-validate new migration SQL before the push.**
2. **Pre-existing migration-history drift reconciled.** The linked DB had 3 migrations (delete_candidate_rpc, search_candidates_partial_match, delete_job_and_company_rpcs) recorded under auto-timestamps that didn't match the committed round-number filenames, blocking ALL pushes. Resolved with `supabase migration repair --status reverted <3 drifted versions>` then re-push (the 3 are idempotent `create or replace function`, so re-apply was a no-op). Remote history now matches local files exactly.
3. **Production-DB writes are founder-run only.** The harness auto-mode classifier hard-blocks the agent from any production-DB mutation (CLI push, MCP SQL). Migration pushes are run by the founder via a double-click `.command` helper; the agent verifies the result read-only via the Supabase MCP. This applies again to Wave 2.

## Verification (all green)
- `pnpm typecheck` exit 0 (against regenerated `database.ts`); `pnpm lint` exit 0 (pre-existing warnings only).
- Live DB: 3 tables + 3 org columns present; migration history = exactly the 5 reconciled local migrations; `super_admin='true'`.
- RLS posture verified: subscriptions (1 SELECT policy, 0 writes), stripe_webhook_events + ai_cap_notifications (RLS on, 0 policies = deny-all).
- Security advisor: only INFO `rls_enabled_no_policy` on the two deny-all ledgers (by design); all WARNs pre-existing (no new functions created in Wave 0).
- App boots/builds with zero Stripe env (isolation proven by typecheck + optional env schema).

## Ready for Wave 1
05-01 (billing), 05-02 (branding), 05-03 (onboarding), 05-04 (marketing) can now build in parallel on this foundation. 05-05 (admin) follows in Wave 2.
