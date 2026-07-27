---
phase: quick-260605-x9l
plan: 01
subsystem: billing/access-gate
tags: [paywall, billing, entitlement, access-gate]
dependency_graph:
  requires: [getEntitlement, StartCheckoutButton, ManageBillingButton, SignOutButton]
  provides: [PaywallScreen, app-layout-gate]
  affects: [src/app/(app)/layout.tsx]
tech_stack:
  added: []
  patterns: [RSC-composed-client-buttons, fail-open-default, status-based-gate]
key_files:
  created:
    - src/components/app/paywall-screen.tsx
  modified:
    - src/app/(app)/layout.tsx
decisions:
  - Fail-open defaults (entitled=true, status='active') so billing blip never locks paying customers out
  - Return PaywallScreen in place rather than redirect — /settings/billing is under this layout; redirect would loop
  - Duplicate formatPenceGbp locally — the billing page treats it as module-private; import would expose it
metrics:
  duration: ~10 minutes
  completed: 2026-06-06
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase quick-260605-x9l Plan 01: Paywall Gate Summary

**One-liner:** Status-based card-first access gate — gated orgs (none/cancelled/past_due) see PaywallScreen with 3-plan trial cards (owner) or "ask your owner" message (non-owner); trialing/active orgs see the normal CRM.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create PaywallScreen server component | a0d510e | src/components/app/paywall-screen.tsx |
| 2 | Wire the gate into the app layout | a0d510e | src/app/(app)/layout.tsx |

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `pnpm typecheck` — PASSED (0 errors)
- `pnpm lint` — PASSED (0 errors; 18 pre-existing warnings in test files, none new)
- `grep -n "PaywallScreen" layout.tsx` — shows import (line 5) and gated return (line 58)
- `grep -c "getEntitlement(" layout.tsx` — returns 1 (single fetch, no duplicate)
- `entitled = true` and `entitlementStatus = 'active'` defaults confirmed present before try block

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. Gate is entirely server-side RSC (T-x9l-01 mitigated). Fail-open design is an explicit founder decision (T-x9l-02 accepted).

## Self-Check: PASSED

- `/Users/aj_mac/altus-recruitment/src/components/app/paywall-screen.tsx` — exists
- `/Users/aj_mac/altus-recruitment/src/app/(app)/layout.tsx` — modified
- Commit `a0d510e` — confirmed in git log
