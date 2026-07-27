---
phase: 260605-x9l-paywall-gate
reviewed: 2026-06-06T00:00:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - src/app/(app)/layout.tsx
  - src/components/app/paywall-screen.tsx
  - src/lib/stripe/entitlement.ts
  - src/app/(app)/settings/billing/start-checkout-button.tsx
  - src/app/(app)/settings/billing/manage-billing-button.tsx
  - src/components/app/sign-out-button.tsx
  - src/types/billing.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Quick Task 260605-x9l: Paywall Gate — Code Review

**Reviewed:** 2026-06-06
**Depth:** deep (cross-file call chain tracing)
**Files Reviewed:** 7
**Status:** issues_found

## Summary

The gate architecture is sound. The three headline properties from the task brief are correctly implemented:

- **Fail-open** is correctly coded: `entitled` defaults to `true` and `entitlementStatus` defaults to `'active'`; the `catch` block leaves both unchanged, so a `getEntitlement` exception lets the user through.
- **No redirect loop**: the paywall renders in-place inside the `(app)` layout rather than redirecting to `/settings/billing`. Sign-out is always rendered regardless of `isOwner`. The `(public)` route group and `/admin` are outside this layout entirely.
- **Gate condition**: only `'trialing'` and `'active'` pass; `'past_due'`, `'cancelled'`, and `'none'` are all blocked.

One HIGH bug and three MEDIUM issues are documented below.

---

## Critical Issues

### CR-01: `'paused'` / `'incomplete'` / `'unpaid'` Stripe statuses map to `'none'` — paywall shows checkout buttons instead of a support message

**File:** `src/app/api/stripe/webhook/route.ts:313-325` (writes the DB status) and `src/components/app/paywall-screen.tsx:43-53` (renders based on status)

**Issue:**
`mapStripeStatus()` maps Stripe's `'unpaid'`, `'incomplete'`, `'incomplete_expired'`, and `'paused'` all to `'none'`. This means an existing paying customer whose subscription enters one of those states will appear to the paywall as if they never signed up — they will see the "Start your 14-day free trial" heading and three plan checkout cards rather than an "update payment method" prompt.

A concrete failure path:

1. Customer has an active subscription.
2. Stripe marks it `unpaid` (multiple failed invoices, or the customer's bank issues a hold).
3. Webhook fires `customer.subscription.updated` → `mapStripeStatus('unpaid')` → `'none'` written to DB.
4. On the customer's next page load: `getEntitlement` returns `status: 'none'`, `entitled = false`, paywall fires.
5. `PaywallScreen` receives `status === 'none'` and renders the three pricing cards + "Start 14-day trial" buttons.
6. The customer is a paying user, not a prospect. Showing them a trial-start CTA is confusing and potentially double-charges them if they click through (a second checkout creates a second subscription).

`'past_due'` is handled correctly by the paywall (shows ManageBillingButton). `'unpaid'` is the natural next step in Stripe's dunning chain after `past_due` — it should also render ManageBillingButton, not checkout cards.

**Fix:**

In `src/app/api/stripe/webhook/route.ts`, change the mapping:
```ts
unpaid: 'past_due',     // already there — correct
incomplete: 'past_due', // was 'none' — incomplete = payment failed at trial start; should show portal
incomplete_expired: 'cancelled', // subscription never activated; treat as cancelled, not none
paused: 'past_due',    // paused = Stripe-dunning pause; customer still has a subscription; show portal
```

And add a `'paused'` arm to the `PaywallScreen` `past_due` conditional (or treat `past_due` and `'paused'` identically):
```tsx
{isOwner && (status === 'past_due' || status === 'paused') && (
  <ManageBillingButton />
)}
```

Note: the `SubscriptionStatus` type in `src/types/billing.ts` does not include `'paused'` or `'incomplete'` — the mapping to our closed set is the right approach; the mapping values just need fixing.

---

## Warnings

### WR-01: `PaywallScreen` is a Server Component but imports two Client Components (`StartCheckoutButton`, `ManageBillingButton`) that import from `(app)/settings/billing/` — this creates a cross-route-group import

**File:** `src/components/app/paywall-screen.tsx:4-5`

**Issue:**
```ts
import { ManageBillingButton } from '@/app/(app)/settings/billing/manage-billing-button'
import { StartCheckoutButton } from '@/app/(app)/settings/billing/start-checkout-button'
```

Next.js App Router does not strictly forbid cross-route-group component imports, but this is the only place in the codebase where a shared component (`src/components/app/`) imports from a route-specific location (`src/app/(app)/settings/billing/`). The project's own CLAUDE.md convention is: "Co-locate components with routes when they're route-specific; lift to `/components/app/` when shared."

If these buttons are now consumed from two places (settings page + paywall), they should be lifted to `src/components/app/billing/` or `src/components/billing/`. The current arrangement means a developer reorganising the billing settings route would inadvertently break the paywall with no TypeScript error.

**Fix:** Move `start-checkout-button.tsx` and `manage-billing-button.tsx` to `src/components/app/billing/` (or a similar shared location) and update both import sites.

### WR-02: `PaywallScreen` `CardDescription` text says "cancel anytime before day 14" when status is `'past_due'` or `'cancelled'`

**File:** `src/components/app/paywall-screen.tsx:32-35`

**Issue:**
```tsx
<CardDescription>
  14 days free, then billed per seat per month — cancel anytime before day 14 and you
  won&apos;t be charged.
</CardDescription>
```

This description is always rendered regardless of `status`. When `status === 'past_due'` (a paying customer whose card failed) or `status === 'cancelled'` (a former subscriber), this copy is factually wrong — there is no "14-day free trial" available to them. They either need to update their card (past_due) or repurchase (cancelled, where the trial-start copy would need a different heading).

This is a correctness/compliance issue: telling a customer with a failed payment that they can "cancel before day 14 and won't be charged" is inaccurate and could create support disputes.

**Fix:**
```tsx
<CardDescription>
  {status === 'none'
    ? '14 days free, then billed per seat per month — cancel anytime before day 14 and you won\'t be charged.'
    : status === 'past_due'
      ? 'Update your payment method to restore access to your account.'
      : 'Reactivate your subscription to restore access.'}
</CardDescription>
```

### WR-03: `SignOutButton` swallows `signOut` errors silently — pending spinner stays on failure

**File:** `src/components/app/sign-out-button.tsx:13-18`

**Issue:**
```ts
async function onClick() {
  setPending(true)
  const supabase = createClient()
  await supabase.auth.signOut()
  router.replace('/sign-in')
  router.refresh()
}
```

`setPending(false)` is never called. On a network error (which is a realistic scenario since the user is on the paywall precisely because billing is in a degraded state), the button stays disabled forever ("Signing out…") and the user cannot retry. This is especially bad on the paywall screen because sign-out is the user's only escape route from a broken state.

The existing code predates this PR, but the paywall elevates its severity: previously a stuck sign-out was cosmetically annoying; on the paywall it is a trap.

**Fix:**
```ts
async function onClick() {
  setPending(true)
  try {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/sign-in')
    router.refresh()
  } catch {
    setPending(false)
    // Sign-out failed — user can retry
  }
}
```

---

## Info

### IN-01: `formatPenceGbp` is duplicated between `paywall-screen.tsx` and `settings/billing/page.tsx`

**File:** `src/components/app/paywall-screen.tsx:10-12`

**Issue:**
The comment acknowledges the duplication ("Duplicated intentionally: that file treats it as module-private"). If `billing/page.tsx` already has this as a module-private helper, the pragmatic fix is to export it from a shared `src/lib/stripe/format.ts` utility. As-is, a currency formatting change requires updating two files. The comment is honest but the duplication is avoidable without architectural cost.

**Fix:** Extract to `src/lib/stripe/format.ts` and export from both callers.

---

## Confirmation of task brief's five checks

| Check | Result |
|---|---|
| (1) `entitled` defaults to `true`; stays `true` if `getEntitlement` throws | PASS — `let entitled = true` at line 40; catch block does not reassign it |
| (2) Only `'trialing'`/`'active'` pass the gate | PASS — line 47: `entitlement.status === 'trialing' \|\| entitlement.status === 'active'` |
| (3) No redirect (no loop) | PASS — `PaywallScreen` returns JSX in-place; no `redirect()` call |
| (4) Non-owners get no checkout buttons but CAN sign out | PASS — checkout cards gated on `{isOwner && ...}`; `<SignOutButton />` is always rendered at line 78-81 |
| (5) `/admin` and `(public)` routes not affected | PASS — gate is in `(app)/layout.tsx` only; those route groups use separate layouts |

The one nuance on check (4): non-owners see the generic "ask your owner" message but there is no way for them to know who the owner is or how to contact them. This is a UX gap (not a security bug) and is out of scope for this review.

---

_Reviewed: 2026-06-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
