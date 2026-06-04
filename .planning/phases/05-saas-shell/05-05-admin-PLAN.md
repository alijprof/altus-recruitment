---
phase: 05-saas-shell
plan: 05
type: execute
wave: 2
depends_on: ["05-00", "05-01"]
files_modified:
  - src/app/admin/layout.tsx
  - src/app/admin/page.tsx
  - src/app/admin/[orgId]/page.tsx
  - src/app/admin/actions.ts
  - src/lib/admin/guard.ts
  - src/lib/admin/queries.ts
  - supabase/migrations/20260604130000_phase5_admin_overrides.sql
  - src/types/database.ts
autonomous: false
requirements: [ADMIN-01]

must_haves:
  truths:
    - "A super-admin can open /admin and see every org's AI-cost + billing/subscription state"
    - "A non-super-admin who navigates to /admin is silently redirected to / (the route's existence is not revealed)"
    - "The super-admin gate runs BEFORE any service-role / cross-org read — the cross-tenant read path is unreachable from tenant routes"
    - "A super-admin can override a plan limit / extend a trial without a code deploy"
  artifacts:
    - path: "src/app/admin/layout.tsx"
      provides: "Super-admin gate — checks app_metadata.super_admin before rendering any admin child"
      contains: "super_admin"
    - path: "src/lib/admin/guard.ts"
      provides: "requireSuperAdmin() — identity + super_admin check, returns only after the gate passes"
      exports: ["requireSuperAdmin"]
    - path: "src/lib/admin/queries.ts"
      provides: "Service-role cross-org reads (per-tenant AI cost + billing), callable only after the gate"
      exports: ["getAllOrgsBillingOverview", "getOrgAdminDetail"]
    - path: "supabase/migrations/20260604130000_phase5_admin_overrides.sql"
      provides: "Override storage (trial extension / cap bump) read by the entitlement layer"
      contains: "plan_overrides"
  key_links:
    - from: "src/app/admin/layout.tsx"
      to: "requireSuperAdmin"
      via: "gate before children render"
      pattern: "requireSuperAdmin|super_admin"
    - from: "src/lib/admin/queries.ts"
      to: "createServiceClient"
      via: "cross-org reads only after the gate"
      pattern: "createServiceClient"
---

<objective>
The lean super-admin operations console (ADMIN-01, D-13/D-14): a `/admin` area, gated to the platform owner (super_admin flag), providing (a) a per-tenant AI-cost + billing/subscription dashboard — the founder's margin-protection view, reading `ai_usage` + the `subscriptions` table cross-org via service-role — and (b) plan-limit + trial overrides (extend a trial, bump a cap) without a code deploy. No impersonation, no audit layer in v1 (explicitly descoped).

This is the SINGLE highest-severity item in Phase 5: the only deliberate cross-tenant read path in the whole app. The gate MUST run before any service-role call and MUST be unreachable from any normal RLS-scoped route. This plan treats the gate as the security boundary and builds it first.

Purpose: Gives the founder margin visibility (which tenant is burning AI budget) and the ability to extend a trial / bump a cap for a customer without shipping code — the operational minimum to run a small SaaS.
Output: super-admin guard + layout gate, cross-org service-role queries, overview + per-org detail pages, override actions + an overrides migration the entitlement layer reads.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/05-saas-shell/05-CONTEXT.md
@.planning/phases/05-saas-shell/05-RESEARCH.md
@CLAUDE.md
@src/lib/supabase/service.ts
@src/lib/supabase/server.ts

<interfaces>
<!-- Depends on 05-00 (super_admin flag, subscriptions table) + 05-01 (subscriptions DB layer + entitlement). -->

From src/lib/supabase/server.ts: createClient() — getUser() returns user.app_metadata (super_admin flag lives here, set in 05-00 Task 0.4).
From src/lib/supabase/service.ts: createServiceClient() — bypasses RLS; the ONLY cross-org read mechanism.

From 05-00: organizations has stripe_customer_id; subscriptions table exists (organization_id, plan_key, plan_seats, status, trial_end, current_period_end).
From 05-01:
  src/lib/db/subscriptions.ts: getSubscriptionForOrg, upsertSubscriptionFromStripe
  src/lib/stripe/entitlement.ts: getEntitlement(orgId) — this plan adds override support so it reads plan_overrides
  src/lib/stripe/usage.ts: getAiUsageThisMonth + PURPOSE_CAP_BUCKETS
  src/lib/stripe/plans.ts: PLANS

ai_usage table (existing): org_id, model, purpose, input_tokens, output_tokens, cost_pence, created_at — the per-tenant cost source.

Admin gate ordering (05-RESEARCH Security Domain — CRITICAL, exact):
  1. createClient() then getUser() — establish identity
  2. check user.app_metadata.super_admin === true — gate BEFORE any service-role call
  3. createServiceClient() — only after the gate passes
  Non-super-admin → redirect('/') (NOT 403 — do not reveal the route exists). NEVER add /admin to PUBLIC_PATHS.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 5.1: Super-admin guard + layout gate + overrides migration</name>
  <read_first>
    - src/lib/supabase/server.ts + src/lib/supabase/service.ts (createClient/getUser + createServiceClient — the gate-then-escalate boundary)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Pattern 4 admin gate; Security Domain — the exact 3-step ordering; Pitfall 8 — layout gate is the boundary, not middleware)
    - supabase/migrations/20260604120100_phase5_super_admin_flag.sql (05-00 — where super_admin is set)
    - src/lib/stripe/entitlement.ts (05-01 — to wire override reads in)
  </read_first>
  <action>
    Create src/lib/admin/guard.ts (server-only) `requireSuperAdmin(): Promise<{ user }>`: createClient() → getUser(); if no user, redirect('/sign-in'); read user.app_metadata?.super_admin; if !== true, redirect('/') (silent — do NOT 403, do NOT reveal /admin exists). Return the user only after the gate passes. This is the single chokepoint; every admin page/action calls it FIRST, before any createServiceClient().
    Create src/app/admin/layout.tsx (RSC): call requireSuperAdmin() at the top; render children only if it returns (it redirects otherwise). This is the security boundary (Pitfall 8). Add NO /admin entry to PUBLIC_PATHS (confirm it's absent — from 05-00 Task 0.2).
    Create supabase/migrations/20260604130000_phase5_admin_overrides.sql (append-only): a `plan_overrides` table — organization_id uuid PK references organizations(id) on delete cascade; trial_end_override timestamptz null; cap_multiplier numeric null (e.g. 1.5 = +50% caps) OR per-bucket override columns (choose the simplest shape that supports "extend a trial" + "bump a cap"); note text; updated_by uuid; updated_at timestamptz default now(). RLS: enable, NO authenticated policy (service-role only — overrides are admin-written, entitlement-read via service-role or a SECURITY DEFINER function). Add a small SECURITY DEFINER read function OR have the entitlement helper read it via service-role — pick the approach consistent with how getEntitlement is invoked (it runs server-side; reading plan_overrides via the same supabase client it already uses, with an RLS read policy scoped to current_organization_id() for the org's OWN override, is acceptable and lets a tenant's own entitlement reflect an override without service-role). Decide: give plan_overrides a SELECT policy `using (organization_id = current_organization_id())` so getEntitlement reads the caller's own override under RLS, while writes stay service-role-only (admin). Document the choice.
    Wire src/lib/stripe/entitlement.ts (05-01) to read plan_overrides for the org and apply trial_end_override (extends status 'trialing' window) + cap_multiplier (multiplies effective caps) when present. Keep it backward-compatible: no override row = current behaviour.
    Do NOT run the migration here — Task 5.3 is the [BLOCKING] push.
  </action>
  <verify>
    <automated>grep -q "super_admin" src/lib/admin/guard.ts && grep -q "redirect('/')" src/lib/admin/guard.ts && grep -q "requireSuperAdmin" src/app/admin/layout.tsx && grep -q "plan_overrides" supabase/migrations/20260604130000_phase5_admin_overrides.sql && ! grep -q "'/admin'" src/lib/supabase/middleware.ts && pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - source: requireSuperAdmin checks app_metadata.super_admin === true and redirect('/') (not 403) for non-admins
    - source: admin/layout.tsx calls requireSuperAdmin BEFORE rendering children
    - source: /admin is NOT in PUBLIC_PATHS
    - source: plan_overrides table is RLS-enabled; writes have no authenticated policy (service-role only); reads scoped to own org
    - source: entitlement.ts applies trial_end_override + cap_multiplier when a row exists, else unchanged
    - test-command: `pnpm typecheck` passes
  </acceptance_criteria>
  <done>The super-admin gate is the security boundary (layout calls requireSuperAdmin first), the overrides table exists with service-role-only writes, and entitlement honours overrides. Gate proven to run before any escalation.</done>
</task>

<task type="auto">
  <name>Task 5.2: Cross-org billing/AI-cost dashboard + per-org detail + override actions</name>
  <read_first>
    - src/lib/admin/guard.ts (requireSuperAdmin — call FIRST in every action/query)
    - "src/app/(app)/settings/usage/page.tsx" (the per-org ai_usage aggregation by purpose to generalise cross-org)
    - src/lib/stripe/usage.ts + src/lib/db/subscriptions.ts (05-01 — reuse aggregation + subscription reads)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Security Domain — service-role only AFTER the gate; no PII to Sentry)
  </read_first>
  <action>
    Create src/lib/admin/queries.ts (server-only): `getAllOrgsBillingOverview()` — calls requireSuperAdmin() FIRST, THEN createServiceClient(); returns per-org rows: org name, plan_key, status, trial_end, plan_seats, active member count, current-month AI cost (sum cost_pence from ai_usage) and usage-vs-cap headline per the cap buckets. `getOrgAdminDetail(orgId)` — gate first, then service-role: full subscription state + per-purpose AI usage/cost breakdown for the month + any plan_overrides. Both aggregate cross-org via service-role (the ONLY place outside the webhook/Inngest that does so). PII discipline: surface org names + aggregate numbers; never surface candidate-level PII; never log PII to Sentry (tags only).
    Create src/app/admin/page.tsx (RSC) — overview table from getAllOrgsBillingOverview: sortable list of tenants by AI cost (margin-outlier view per the pricing analysis's "alert on cost/tenant outliers"), each linking to /admin/[orgId]. Create src/app/admin/[orgId]/page.tsx — per-org detail from getOrgAdminDetail: subscription/billing block + AI-cost-by-purpose block + an override form.
    Create src/app/admin/actions.ts: `extendTrialAction(orgId, newTrialEnd)` and `setCapOverrideAction(orgId, capMultiplier | null)` (and/or per-bucket) — each calls requireSuperAdmin() FIRST, then createServiceClient() to UPSERT plan_overrides (set updated_by = the admin user id, note optional). These let the founder extend a trial / bump a cap with no deploy (D-13). Return a result; surface success/error via toast in the detail page form (no silent success — CLAUDE.md). revalidate the admin detail path.
    Keep the console lean (D-13): no impersonation, no audit log (descoped — D-14). Functional UI; design polish is a build-time pass.
  </action>
  <verify>
    <automated>grep -q "requireSuperAdmin" src/lib/admin/queries.ts && grep -q "createServiceClient" src/lib/admin/queries.ts && grep -q "requireSuperAdmin" src/app/admin/actions.ts && grep -qE "extendTrialAction|setCapOverrideAction" src/app/admin/actions.ts && pnpm typecheck && pnpm lint</automated>
  </verify>
  <acceptance_criteria>
    - source: every function in queries.ts + actions.ts calls requireSuperAdmin() BEFORE createServiceClient()
    - behavior: /admin lists all orgs with plan/status + current-month AI cost; per-org detail shows the per-purpose breakdown
    - behavior: extendTrialAction / setCapOverrideAction upsert plan_overrides and the change is reflected by getEntitlement (override applied)
    - source: no candidate-level PII surfaced or logged; service-role used ONLY in these gated paths (plus webhook/Inngest)
    - source: no impersonation / audit-log code added (descoped)
    - test-command: `pnpm typecheck && pnpm lint` pass
  </acceptance_criteria>
  <done>Super-admin can review per-tenant AI cost + billing cross-org and extend trials / bump caps without a deploy — all behind the gate, service-role only after it.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 5.3: [BLOCKING] Push admin-overrides migration + regenerate types + verify the gate</name>
  <what-built>
    The plan_overrides migration (20260604130000_phase5_admin_overrides.sql) is written. Per project memory, the Supabase push is manual and mandatory.
  </what-built>
  <how-to-verify>
    1. `pnpm exec supabase db push --linked` — applies the overrides migration. Complete any auth prompt.
    2. `pnpm db:types` — regenerate src/types/database.ts.
    3. `pnpm typecheck` — must pass against regenerated types.
    4. Confirm in Supabase: `select * from public.plan_overrides limit 1;` succeeds (empty OK).
    5. Security spot-check (the highest-severity item): with a NON-super-admin session, navigate to /admin and /admin/<someOrgId> — both MUST redirect to / (not render, not 403). With the super_admin session (founder), /admin renders the overview. Confirm `grep -rn "createServiceClient" src/lib/admin/` shows service-role is only reached inside functions that call requireSuperAdmin first.
  </how-to-verify>
  <resume-signal>Type "verified" once the migration is applied, types regenerate, typecheck passes, a non-admin is redirected away from /admin, and a super-admin sees the console — or describe the failure.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| authenticated user → /admin | Role-gated; only super_admin may enter |
| /admin → all orgs (service-role) | The ONLY cross-tenant read path in the app |
| super-admin → plan_overrides | Admin writes that change another org's entitlements |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-05-01 | Elevation of Privilege | /admin cross-org reads | mitigate | requireSuperAdmin() (app_metadata.super_admin === true) runs BEFORE any createServiceClient() in layout, every query, and every action — gate is the boundary (Pattern 4, Security Domain) |
| T-05-05-02 | Information Disclosure | /admin route enumeration | mitigate | Non-super-admin redirected to / (NOT 403); route existence not revealed; /admin never in PUBLIC_PATHS |
| T-05-05-03 | Information Disclosure | cross-org data to Sentry | mitigate | Only org names + aggregate numbers surfaced; no candidate PII; Sentry tags only |
| T-05-05-04 | Tampering | plan_overrides writes | mitigate | RLS: no authenticated write policy (service-role only via gated admin actions); reads scoped to own org |
| T-05-05-05 | Elevation of Privilege | override applied wrongly | mitigate | entitlement reads override under own-org RLS; cap_multiplier/trial extension bounded by admin intent; updated_by recorded for traceability |
</threat_model>

<verification>
- `pnpm typecheck` + `pnpm lint` pass; migration applied; types regenerated.
- Non-super-admin → /admin and /admin/[orgId] both redirect to / (manual, in Task 5.3).
- Super-admin sees the cross-org overview; extending a trial / bumping a cap is reflected by getEntitlement.
- `grep -rn "createServiceClient" src/lib/admin/ src/app/admin/` — every occurrence is downstream of a requireSuperAdmin() call.
</verification>

<success_criteria>
- Super-admin-only console shows per-tenant AI cost + billing and supports trial/cap overrides with no deploy; the cross-tenant read path is gated and unreachable from tenant routes (the highest-severity Phase 5 item, closed).
</success_criteria>

<output>
Create `.planning/phases/05-saas-shell/05-05-SUMMARY.md` when done.
</output>
