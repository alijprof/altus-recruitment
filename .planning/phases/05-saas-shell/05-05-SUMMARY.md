---
phase: "05-saas-shell"
plan: "05"
subsystem: "admin"
tags: ["security", "super-admin", "cross-tenant", "billing", "overrides"]
dependency_graph:
  requires: ["05-00", "05-01"]
  provides: ["ADMIN-01"]
  affects: ["src/lib/stripe/entitlement.ts", "src/lib/supabase/service.ts"]
tech_stack:
  added: []
  patterns: ["gate-before-escalate", "service-role-post-gate", "cast-boundary-pre-push", "fail-closed redirect"]
key_files:
  created:
    - src/lib/admin/guard.ts
    - src/lib/admin/queries.ts
    - src/app/admin/layout.tsx
    - src/app/admin/page.tsx
    - src/app/admin/actions.ts
    - src/app/admin/[orgId]/page.tsx
    - src/app/admin/[orgId]/OverrideForm.tsx
    - supabase/migrations/20260604130000_phase5_admin_overrides.sql
  modified:
    - src/lib/stripe/entitlement.ts
decisions:
  - "plan_overrides RLS: SELECT policy scoped to own org (current_organization_id()) so entitlement reads own override under RLS; writes service-role only (no authenticated write policy) — avoids service-role requirement on the read path"
  - "cap_multiplier numeric column (not per-bucket overrides) for simplicity; a single multiplier applies uniformly across all AI cap dimensions"
  - "fail-open on plan_overrides reads pre-migration-push: getPlanOverride + overview queries catch errors and return null/empty rather than blocking entitlement or admin pages"
  - "redirect('/') not 403 on non-admin access — route existence not revealed (T-05-05-02 information disclosure mitigation)"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-04T21:32:26Z"
  tasks_completed: 2
  tasks_total: 3
  tasks_pending: 1
---

# Phase 5 Plan 05: Admin Console Summary

One-liner: Super-admin-gated /admin ops console with cross-org service-role queries, plan_overrides migration for trial extension + cap bumps, all behind a fail-closed gate (requireSuperAdmin → redirect('/') for non-admins, service-role only after gate passes).

## Status

Tasks 5.1 and 5.2 complete and committed. Task 5.3 is a [BLOCKING] human-action checkpoint — requires founder to push the migration and verify the gate manually.

## Completed Tasks

### Task 5.1: Super-admin guard + layout gate + overrides migration

- `src/lib/admin/guard.ts` — `requireSuperAdmin()`: createClient() → getUser() → checks `user.app_metadata.super_admin === true` → if not, `redirect('/')` (silent, not 403). Returns `{ id, email }` only after both gates pass.
- `src/app/admin/layout.tsx` — calls `requireSuperAdmin()` as the FIRST statement; children render only after gate returns.
- `supabase/migrations/20260604130000_phase5_admin_overrides.sql` — `plan_overrides` table with:
  - `organization_id uuid PK` referencing organizations(id) on delete cascade
  - `trial_end_override timestamptz` nullable
  - `cap_multiplier numeric CHECK (cap_multiplier > 0)` nullable
  - `note text`, `updated_by uuid`, `updated_at timestamptz`
  - RLS enabled; SELECT policy scoped to own org via `current_organization_id()`; no authenticated write policy (service-role only)
- `src/lib/stripe/entitlement.ts` — wired to read `plan_overrides` via `getPlanOverride()` (cast boundary; fail-open pre-push); applies `trial_end_override` (extends trialing window) + `cap_multiplier` (multiplies all AI cap buckets). Backward-compatible: no override row = unchanged behaviour.

Commit: `9d33b93`

### Task 5.2: Cross-org billing/AI-cost dashboard + per-org detail + override actions

- `src/lib/admin/queries.ts` — `getAllOrgsBillingOverview()` + `getOrgAdminDetail()`: both call `requireSuperAdmin()` BEFORE `createServiceClient()`. Cross-org reads via service-role: orgs + subscriptions + ai_usage + plan_overrides. PII-clean: org names + aggregate numbers only.
- `src/app/admin/page.tsx` — overview table sorted by monthly AI cost (margin-outlier view); per-org status badge, seats, cost, override indicator, detail link.
- `src/app/admin/[orgId]/page.tsx` — per-org subscription state + AI cost by purpose table + override form; `notFound()` on unknown orgId.
- `src/app/admin/[orgId]/OverrideForm.tsx` — client component; `extendTrialAction` + `setCapOverrideAction` called via `useTransition`; toast on success/error (no silent success).
- `src/app/admin/actions.ts` — `extendTrialAction(orgId, newTrialEnd)` + `setCapOverrideAction(orgId, capMultiplier, note?)`: each re-checks `requireSuperAdmin()` independently (defence in depth); validates input via Zod; upserts `plan_overrides` via service-role; `revalidatePath` admin paths; returns `AdminActionResult`.

Commit: `2f42911`

## Gate Ordering Trace (Security Invariant)

The gate ordering is enforced at every level:

### Layout (page render boundary)
```
src/app/admin/layout.tsx:
  1. await requireSuperAdmin()  ← GATE runs first
  2. return <children />        ← only rendered if gate passed
```

### Query functions (data fetch, defence in depth)
```
src/lib/admin/queries.ts — getAllOrgsBillingOverview():
  1. await requireSuperAdmin()    ← GATE first
  2. const serviceClient = createServiceClient()  ← only AFTER gate
  3. [cross-org reads...]

src/lib/admin/queries.ts — getOrgAdminDetail(orgId):
  1. await requireSuperAdmin()    ← GATE first
  2. const serviceClient = createServiceClient()  ← only AFTER gate
  3. [cross-org reads...]
```

### Server actions (mutation defence in depth — never trust layout alone)
```
src/app/admin/actions.ts — extendTrialAction():
  1. const admin = await requireSuperAdmin()   ← GATE first
  2. [zod validation]
  3. const serviceClient = createServiceClient()  ← only AFTER gate
  4. upsert plan_overrides

src/app/admin/actions.ts — setCapOverrideAction():
  1. const admin = await requireSuperAdmin()   ← GATE first
  2. [zod validation]
  3. const serviceClient = createServiceClient()  ← only AFTER gate
  4. upsert plan_overrides
```

### /admin is NOT in PUBLIC_PATHS
Confirmed: `src/lib/supabase/middleware.ts` explicitly documents this:
```
// IMPORTANT: `/admin` is NOT here. The admin area is authenticated +
// role-gated in the layout (05-05 Task 5.1). Adding it to PUBLIC_PATHS
// would create a cross-tenant read gate (Pitfall 8 from 05-RESEARCH).
```

## [BLOCKING] Migration Push Required (Task 5.3)

**Migration file:** `supabase/migrations/20260604130000_phase5_admin_overrides.sql`
**Status:** Written. NOT pushed. Founder must push manually.

**SQL validity confirmation:**
- Uses only standard Postgres syntax
- `CHECK (cap_multiplier > 0)` is inline on the column (NOT `ADD CONSTRAINT ... NOT VALID` which would be a syntax error on CREATE TABLE)
- `references auth.users(id) on delete set null` — valid FK syntax
- RLS enable + CREATE POLICY syntax verified
- No `NOT VALID` on column CHECK constraint (constraint is inline, not a named constraint add)

**Push command:**
```
pnpm exec supabase db push --linked
```

**Post-push required:**
```
pnpm db:types      # regenerate src/types/database.ts
pnpm typecheck     # must pass against regenerated types
```

**Pre-push behaviour:**
- `getEntitlement()` returns `null` from `getPlanOverride()` (fail-open catch on error) → no override applied, existing entitlement unchanged
- Admin overview/detail pages show no override data (overrides fetched via try/catch, fail-open)
- Override form submits hit `catch` block in actions → user sees toast error "migration may not be pushed yet"

## Deviations from Plan

### [Rule 2 - Missing critical functionality] Zod validation on admin actions
Zod input validation added to `extendTrialAction` and `setCapOverrideAction`. Not explicitly in the plan but required: server actions receiving user-supplied strings (dates, numbers) must validate before writing to DB, especially on a privileged write path. A malformed `cap_multiplier` could silently write NaN to the DB.

### [Clarification - no code change] Pre-push cast boundary pattern
All `plan_overrides` reads/writes use `as unknown as` cast boundaries (same established pattern as `organizations.ts` for pre-regen columns). This is the project standard for schema that has been migrated but not yet reflected in the generated `database.ts`. Documents explicitly that after Task 5.3 regeneration, casts may be removed.

## Known Stubs

None — the admin console is fully wired. The only conditional behaviour is the fail-open pre-push path for `plan_overrides` (documented above), which is intentional and clearly communicated to the operator via toast errors.

## Threat Flags

No new threat surface beyond what is in the plan's threat model. All T-05-05-* threats are mitigated as designed:

| Threat | Mitigation | Verified |
|--------|-----------|---------|
| T-05-05-01: Elevation of Privilege via /admin cross-org reads | requireSuperAdmin() runs in layout + every query + every action before any createServiceClient() call | Yes — gate ordering trace above |
| T-05-05-02: Route enumeration via 403 | Non-super-admin gets redirect('/') not 403 | Yes — guard.ts line 53: `redirect('/')` |
| T-05-05-03: Cross-org data to Sentry | Only org names + aggregate cost numbers; Sentry tags only (org_id, layer — no PII) | Yes — queries.ts Sentry.captureException calls reviewed |
| T-05-05-04: plan_overrides writes by authenticated role | RLS: no authenticated write policy; service-role only via gated actions | Yes — migration has no INSERT/UPDATE/DELETE policy for authenticated |
| T-05-05-05: Override applied wrongly | entitlement reads own org's override via own-org RLS; cap_multiplier > 0 CHECK | Yes — migration CHECK constraint + entitlement override application |

## Self-Check

Files created/committed:
- src/lib/admin/guard.ts — FOUND (commit 9d33b93)
- src/lib/admin/queries.ts — FOUND (commit 2f42911)
- src/app/admin/layout.tsx — FOUND (commit 9d33b93)
- src/app/admin/page.tsx — FOUND (commit 2f42911)
- src/app/admin/actions.ts — FOUND (commit 2f42911)
- src/app/admin/[orgId]/page.tsx — FOUND (commit 2f42911)
- src/app/admin/[orgId]/OverrideForm.tsx — FOUND (commit 2f42911)
- supabase/migrations/20260604130000_phase5_admin_overrides.sql — FOUND (commit 9d33b93)

`pnpm typecheck` — PASSED (0 errors)
`pnpm lint` — PASSED (0 errors; 17 pre-existing warnings in test files)

## Self-Check: PASSED
