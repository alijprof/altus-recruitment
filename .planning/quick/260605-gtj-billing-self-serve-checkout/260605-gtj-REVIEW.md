---
phase: 260605-gtj-billing-self-serve-checkout
reviewed: 2026-06-05T00:00:00Z
depth: quick
files_reviewed: 4
files_reviewed_list:
  - src/app/(app)/settings/billing/start-checkout-button.tsx
  - src/app/(app)/settings/billing/page.tsx
  - src/app/(app)/settings/billing/manage-billing-button.tsx
  - src/app/api/stripe/checkout/route.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Quick Task 260605-gtj: Code Review Report

**Reviewed:** 2026-06-05
**Depth:** quick (+ context reads of route, entitlement, plans, subscriptions)
**Files Reviewed:** 4
**Status:** issues_found

---

## Summary

Two commits add `StartCheckoutButton` (new client component) and rewire the
billing page's `status === 'none'` branch to show a 3-plan picker that calls
it, replacing the previous static `/pricing` link.

The new component itself is well-structured: single `res.json()` parse, `finally`-block
reset of `loading`, Sentry-captured catch, no navigation on failure. The overall
pattern is sound.

However, four MEDIUM/WARNING-level defects exist — none are data-loss risks but
two are user-facing correctness bugs (double-submit and active-sub bypass) that
will manifest in normal UAT. Two INFO items cover acknowledged companion bugs
and magic-number semantics.

---

## Critical Issues

None.

---

## Warnings

### WR-01: Confirmed double-read bug in `manage-billing-button.tsx` — `res.json()` called twice on error path

**File:** `src/app/(app)/settings/billing/manage-billing-button.tsx:22-28`

**Issue:** On non-OK responses the component calls `res.json()` at line 23 to get
`data.error`, then the `if (!res.ok) { … return }` path returns — but if
`res.ok` is truthy, execution falls through to a **second** `res.json()` call at
line 28. The `Response` body stream can only be consumed once; if for any reason
`!res.ok` is false but a prior partial read has already consumed the stream (or
in environments with strict body-read semantics), the second call throws
`"body already read"`. In practice the portal route always returns 2xx on
success so users never hit this on the happy path — but any 2xx-with-body error
response (e.g. a 200 with `{"error":"..."}`) would silently swallow the error.
The comment in `start-checkout-button.tsx` acknowledges this as a known bug in
the companion component, but it was not fixed in this task.

**This task introduced `StartCheckoutButton` as the correct pattern (parse once)
but left the broken pattern live in `ManageBillingButton` without a TODO or fix.**

**Fix:**

```ts
// manage-billing-button.tsx — merge into single parse
async function handleClick() {
  setLoading(true)
  try {
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const data = (await res.json()) as { url?: string; error?: string }  // parse ONCE
    if (!res.ok) {
      toast.error(data.error ?? 'Could not open billing portal. Please try again.')
      return
    }
    if (data.url) {
      window.location.href = data.url
    } else {
      toast.error('No portal URL returned. Please try again.')
    }
  } catch (err) {
    ...
  } finally {
    setLoading(false)
  }
}
```

---

### WR-02: No active-subscription guard in `POST /api/stripe/checkout` — org with `active`/`trialing` status can create a second checkout session

**File:** `src/app/api/stripe/checkout/route.ts:60-165`

**Issue:** The route validates auth and owner-role but never checks whether the
org already has a subscription row with `status` of `active` or `trialing`.
An owner can POST to `/api/stripe/checkout` directly (bypassing the UI guard at
`entitlement.status === 'none'`) and create a second Stripe Checkout session for
an org that already has a live subscription. This results in:

1. A second Stripe customer (if `stripe_customer_id` was not yet persisted, or
   if the row was written between requests).
2. A second subscription trial attached to the same org customer, creating a
   billing/webhook reconciliation mess.

The UI currently only renders `StartCheckoutButton` when `entitlement.status === 'none'`,
but server-side the route is unguarded. Defence in depth requires the server to
enforce this invariant independently of the UI.

**Fix:** After resolving the org row, fetch the subscription and reject if active:

```ts
// After orgDetails resolution, before creating the customer / session:
const existingSub = await getSubscriptionForOrg(supabase, organizationId)
if (existingSub.ok && (existingSub.data.status === 'active' || existingSub.data.status === 'trialing')) {
  return NextResponse.json(
    { error: 'Your organisation already has an active subscription. Use the billing portal to make changes.' },
    { status: 409 },
  )
}
```

---

### WR-03: `session.url` propagated as-is without null-safety check — silent "No checkout URL" toast on `payment` mode or future Stripe API change

**File:** `src/app/api/stripe/checkout/route.ts:167`

**Issue:** `session.url` is `string | null` in the Stripe API type. The route
returns `{ url: session.url }` without a null check. On the current subscription
mode with `payment_method_collection: 'always'` Stripe always populates the URL,
so this does not fail today. But:

- If `mode` or `payment_method_collection` is ever changed,
  `session.url` may be null.
- The client (`StartCheckoutButton:45`) handles the `!data.url` case with a
  toast, so the failure is non-crashing — but the user sees a silent "No
  checkout URL returned" with no actionable message, and no Sentry event is
  captured on the server side.

**Fix:** Assert the URL on the server and fail loudly:

```ts
if (!session.url) {
  Sentry.captureMessage('stripe_checkout: session.url is null', {
    level: 'error',
    tags: { layer: 'stripe', handler: 'checkout', planKey },
  })
  return NextResponse.json(
    { error: 'Checkout session created but no redirect URL returned. Contact support.' },
    { status: 500 },
  )
}
return NextResponse.json({ url: session.url })
```

---

### WR-04: `planSeats` used as divisor in progress bar without zero-guard — `NaN` rendered if `planSeats` is 0

**File:** `src/app/(app)/settings/billing/page.tsx:181`

**Issue:** `entitlement.planSeats` is divided directly:

```tsx
value={Math.min(100, Math.round((entitlement.activeSeats / entitlement.planSeats) * 100))}
```

`getEntitlement` returns `planSeats: PLANS.pro.seats` (= 8) on the `none` path
and guards against `sub.plan_seats <= 0` on the subscription path. In practice
this is always >0. However, if a migration or manual DB patch writes
`plan_seats = 0`, the division produces `NaN`, `Math.round(NaN)` is `NaN`, and
the `<Progress value={NaN}>` renders an empty/broken bar with no visible error —
silently broken UI.

**Fix:** Add a zero-guard inline or in `getEntitlement`:

```tsx
value={Math.min(
  100,
  entitlement.planSeats > 0
    ? Math.round((entitlement.activeSeats / entitlement.planSeats) * 100)
    : 0,
)}
```

---

## Info

### IN-01: `plan.seats === 99` magic number — hardcoded sentinel leaks plan internals into the UI

**File:** `src/app/(app)/settings/billing/page.tsx:205`

**Issue:**

```tsx
Up to {plan.seats === 99 ? 'unlimited' : plan.seats} seats
```

The sentinel value `99` is a private implementation detail of `PLANS` (the Scale
plan uses `seats: 99` to mean "unlimited"). This comparison will silently break
if the sentinel is ever changed to e.g. `999` or a `null` field. The plans
constant already lives in `src/lib/stripe/plans.ts` and should expose the
presentation concern there.

**Fix:** Add an `unlimited` flag or export a display helper from `plans.ts`:

```ts
// plans.ts
export const UNLIMITED_SEATS_SENTINEL = 99
// or: add `unlimitedSeats: boolean` to each plan object
```

Then in the page:
```tsx
Up to {plan.seats >= UNLIMITED_SEATS_SENTINEL ? 'unlimited' : plan.seats} seats
```

---

### IN-02: `as const` cast on plan-key array is redundant given explicit `: PlanKey` annotation

**File:** `src/app/(app)/settings/billing/page.tsx:195`

**Issue:**

```tsx
{(['starter', 'pro', 'scale'] as const).map((key: PlanKey) => {
```

The `as const` cast and the `: PlanKey` annotation are doing redundant work.
If `PlanKey = 'starter' | 'pro' | 'scale'`, the annotation alone satisfies
TypeScript. The `as const` is harmless but inconsistent with the rest of the
codebase's style.

**Fix:** Either remove `as const` or remove `: PlanKey`, whichever reads more clearly:

```tsx
{(['starter', 'pro', 'scale'] as PlanKey[]).map((key) => {
```

---

## Addressed-but-Acknowledged Items (not findings)

- **`manage-billing-button.tsx` double-read**: Correctly identified in the
  `StartCheckoutButton` file comment but not fixed. Elevated to WR-01 above.
- **`loading` state on early `return`**: `finally` block at line 55 correctly
  resets `loading` regardless of which `return` path is taken. No bug here.
- **Owner-gating**: Both the UI (`profile.data.role !== 'owner'` redirect at
  `page.tsx:95`) and the API route (`orgResult.data.role !== 'owner'` check at
  `route.ts:72`) enforce owner-only. Defence in depth is present. Confirmed
  sound.
- **PII discipline**: Sentry tags use `organization_id` (a UUID), never user
  email or org name. Confirmed compliant with CLAUDE.md rule.

---

_Reviewed: 2026-06-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick (extended — all referenced modules read)_
