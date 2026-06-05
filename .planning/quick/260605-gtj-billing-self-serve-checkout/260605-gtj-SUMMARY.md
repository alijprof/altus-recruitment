---
phase: quick-260605-gtj
plan: 01
subsystem: billing
tags: [stripe, checkout, self-serve, billing, client-component]
dependency_graph:
  requires: [src/lib/stripe/plans.ts, src/app/api/stripe/checkout/route.ts]
  provides: [self-serve subscription entry point on /settings/billing]
  affects: [src/app/(app)/settings/billing/page.tsx]
tech_stack:
  added: []
  patterns: [RSC + client component split, fetch POST + window.location.href cross-origin redirect]
key_files:
  created:
    - src/app/(app)/settings/billing/start-checkout-button.tsx
  modified:
    - src/app/(app)/settings/billing/page.tsx
decisions:
  - "Parse res.json() once in StartCheckoutButton (unlike manage-billing-button which calls it twice on non-ok paths — a body-already-read bug documented in the plan)"
  - "Use window.location.href for Stripe Checkout redirect (same rationale as portal button: cross-origin, router.push unreliable for external origins)"
  - "Render null when !stripeConfigured in the status-none branch — the amber notice at page top already informs the user; no duplicate messaging needed"
  - "seats: 99 displayed as 'unlimited' to avoid surfacing an internal sentinel value to users"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-05T11:11:32Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase quick-260605-gtj Plan 01: Billing Self-Serve Checkout Summary

**One-liner:** Self-serve 14-day-trial checkout wired into /settings/billing via a plan-picker grid and new StartCheckoutButton client component that POSTs { planKey } to the existing /api/stripe/checkout endpoint.

## What was built

### Task 1: StartCheckoutButton client component
New `src/app/(app)/settings/billing/start-checkout-button.tsx` — a `'use client'` component mirroring `manage-billing-button.tsx` with three key differences from the existing portal button:
- Sends `{ planKey }` in the POST body to `/api/stripe/checkout`
- Parses `res.json()` **once** before branching on `res.ok` (the portal button calls `res.json()` twice which would throw "body already read" on the error path)
- Accepts `planKey`, optional `label` (default `'Start 14-day trial'`), and optional `variant` props

### Task 2: Plan-selection UI in billing page
Modified the Actions block in `src/app/(app)/settings/billing/page.tsx`:
- **`status !== 'none'` branch:** `<ManageBillingButton />` — unchanged
- **`status === 'none'` + `stripeConfigured` branch:** Three-column responsive grid of plan cards (Starter/Pro/Scale), each showing price, seat count, and a `<StartCheckoutButton>`. Secondary "Compare all plans" link to `/pricing` below the grid.
- **`!stripeConfigured`:** renders `null` in the actions block — the amber notice at the top of the page already covers this state.

## Commits

| Hash | Message |
|------|---------|
| `8efa99d` | feat(260605-gtj-01): add StartCheckoutButton client component |
| `d927884` | feat(260605-gtj-02): render plan-picker in billing page status-none branch |

## Verification

- `pnpm typecheck`: PASS (0 errors)
- `pnpm lint`: PASS (0 errors; 18 pre-existing warnings in unrelated files)
- File verification: `start-checkout-button.tsx` exists, contains `fetch('/api/stripe/checkout'` and `window.location.href`
- Page verification: `page.tsx` contains `StartCheckoutButton` and `Compare all plans`

## Deviations from Plan

None — plan executed exactly as written. The `seats: 99` → `'unlimited'` display is consistent with the `/pricing` page's existing treatment of the Scale plan.

## Known Stubs

None. The checkout button calls a fully implemented endpoint (`/api/stripe/checkout`) and redirects to a live Stripe checkout session. No data is hardcoded or mocked.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. The `StartCheckoutButton` calls the existing `/api/stripe/checkout` route which already enforces owner-only gating server-side.

## Self-Check: PASSED

- `src/app/(app)/settings/billing/start-checkout-button.tsx` — FOUND
- `src/app/(app)/settings/billing/page.tsx` — modified and committed
- Commit `8efa99d` — FOUND
- Commit `d927884` — FOUND
