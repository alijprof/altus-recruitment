---
phase: 260619-manual-access-admin
reviewed: 2026-06-19T00:00:00Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - src/app/admin/actions.ts
  - src/app/admin/[orgId]/ManualAccessForm.tsx
  - src/app/admin/[orgId]/page.tsx
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Manual Access (invoice-billed) Admin Control — Code Review Report

**Reviewed:** 2026-06-19
**Depth:** deep (cross-file: guard, service client, entitlement gate, subscriptions schema, checkout/webhook/billing UI)
**Files Reviewed:** 3 (`grantManualAccessAction` + `revokeManualAccessAction`, `ManualAccessForm.tsx`, `[orgId]/page.tsx`)
**Status:** issues_found (no blockers — 2 warnings, 3 info)

## Summary

The core security and correctness properties hold. The auth gate is correct
(`requireSuperAdmin()` runs FIRST, before `createServiceClient()`, in both new
actions — a crafted non-admin fetch is independently blocked via `app_metadata.
super_admin` re-validated by `getUser()`). The no-clobber guard is correct
(both actions read `stripe_subscription_id` and refuse before any write). The
write satisfies all `subscriptions` CHECK constraints (`status='active'`,
`plan_key ∈ {starter,pro,scale}`, `plan_seats int>0`), the `onConflict
'organization_id'` matches the table's `unique` key, and `updated_at` is
maintained by the `subscriptions_set_updated_at` trigger (omitting it from the
payload is correct). The entitlement chain was traced end-to-end:
`active` → entitled (no paywall), `cancelled` → not entitled (paywall) — both
the `(app)/layout.tsx` gate and `require-entitlement.ts` use the exact same
`{trialing, active}` set. No PII is logged (org_id + code-level tags only). No
candidate data is touched.

The two warnings are real cross-flow correctness gaps that can leave a customer
**stuck**, not broken-data — but for a non-coding founder operating this control
live, "the customer can't pay me / can't self-recover and I don't know why" is
exactly the class of issue this review exists to surface.

## Warnings

### WR-01: Revoked manual org is stranded — no UI path back to a paid card subscription

**File:** `src/app/admin/actions.ts:416-419` (revoke sets `status='cancelled'`) interacting with `src/app/(app)/settings/billing/page.tsx:190-220`

**Issue:** Revoke sets the subscription row to `status='cancelled'` (leaving the
row in place). The billing page only renders the **Start checkout / plan-picker
buttons when `entitlement.status === 'none'`** (page.tsx:192). For any
non-`none` status it renders `<ManageBillingButton />` (the Stripe customer
portal) instead (page.tsx:190). A revoked manual org is `cancelled`, which is
`!== 'none'`, so the billing page shows the **"Manage billing" portal button**
— but that org has **no Stripe subscription** to manage (manual access never
created one). The customer-portal route (`/api/stripe/portal`) also requires a
`stripe_customer_id`; a never-on-Stripe org won't have one and gets a 400.
Net effect: after revoke, the org sees the paywall (correct) but the billing
screen offers a portal button that dead-ends, and **no way to start a trial /
checkout**, because the picker only shows for `status==='none'`. The customer
is stuck and the founder has no in-app signal why.

This is the inverse of the documented "comp→paid self-serve deferred" gap and
is newly reachable now that revoke is one-click. The server checkout guard
(`checkout/route.ts:86`) *would* allow checkout for `cancelled` (it only blocks
`active|trialing|past_due`), so the only thing missing is the UI affordance.

**Fix:** Treat `cancelled` like `none` for checkout-button visibility on the
billing page (smallest correct change):
```tsx
// src/app/(app)/settings/billing/page.tsx
const canStartCheckout =
  entitlement.status === 'none' || entitlement.status === 'cancelled'
// ...
{stripeConfigured && !canStartCheckout ? (
  <ManageBillingButton />
) : stripeConfigured && canStartCheckout ? (
  /* plan picker + StartCheckoutButton */
) : null}
```
Alternatively, have `revokeManualAccessAction` reset the row to a neutral
non-entitled state the UI already handles (`status='none'`, `plan_key='none'`,
`plan_seats=0`) instead of `cancelled`, so the existing `=== 'none'` picker
branch fires. Either is acceptable; the billing-page change is lower blast
radius. Confirm with the founder which "after revoke" experience is intended.

### WR-02: Grant overwrites `subscriptions.stripe_customer_id` to NULL for a half-onboarded Stripe org (customer exists, subscription not yet)

**File:** `src/app/admin/actions.ts:322-355`

**Issue:** The no-clobber guard only checks `stripe_subscription_id`
(actions.ts:335). But the Stripe checkout flow creates a **customer first** and
persists it (to `organizations.stripe_customer_id`, and the webhook later writes
`subscriptions.stripe_customer_id`) **before** a subscription exists — there is a
real window where a row has `stripe_customer_id` set but `stripe_subscription_id`
still NULL (`status` would be `none`/`past_due`). In that window, grant passes
the guard and the upsert **nulls `stripe_customer_id`** (actions.ts:349). The
canonical customer mapping on `organizations.stripe_customer_id` is untouched
(checkout re-reads that, so re-subscribe still correlates) — which is why this is
a WARNING, not a blocker — but it does desync the two copies of the customer id
and, combined with the webhook upsert keying on `organization_id`, can produce a
confusing reconciliation state if a delayed `checkout.session.completed` webhook
then arrives for that customer.

**Fix:** Tighten the guard to also refuse when a Stripe customer is already
attached, and do not null `stripe_customer_id` on grant — leave whatever is
there untouched so the two copies never diverge:
```ts
const { data: existing } = await serviceClient
  .from('subscriptions')
  .select('stripe_subscription_id, stripe_customer_id, status')
  .eq('organization_id', orgId)
  .maybeSingle()

if (existing?.stripe_subscription_id || existing?.stripe_customer_id) {
  return { ok: false, error: 'This org has Stripe billing attached — manage it in Stripe, not here.' }
}
// ...and drop `stripe_customer_id: null` from the upsert payload (let it stay null on insert via column default).
```
Minimum acceptable fix is just adding `stripe_customer_id` to the refusal guard;
removing the explicit `null` write is the belt-and-braces half.

## Info

### IN-01: Comp→paid self-serve is blocked while manual access is active (known/accepted, but undocumented at the action)

**File:** `src/app/admin/actions.ts:342-355` interacting with `src/app/api/stripe/checkout/route.ts:86`

**Issue:** A manually-granted org is `status='active'`, which is in the
checkout double-subscribe block list (`['active','trialing','past_due']`), so
the org **cannot** self-serve onto a card until a super-admin revokes manual
access first. This matches the documented "ship as-is" decision, so it is not a
defect — but it is an operational gotcha the founder will hit ("I gave them
access, now they can't add a card"). Worth a one-line comment on
`grantManualAccessAction` noting the org must be revoked before it can self-serve
to Stripe, so future-you doesn't treat it as a bug.

**Fix:** Add a comment at the grant action documenting the revoke-before-checkout
ordering. No code change required.

### IN-02: Revoke leaves stale `plan_key` / `plan_seats` on the cancelled row

**File:** `src/app/admin/actions.ts:416-419`

**Issue:** Revoke only flips `status='cancelled'` and leaves `plan_key`,
`plan_seats`, and the nulled stripe fields as-is. Entitlement only reads
`status`, so this is functionally harmless, and keeping the last plan/seats can
be useful as a record of what was granted. Noted only so it is a deliberate
choice rather than an oversight. (If WR-01 is fixed by resetting to `none`, this
becomes moot.)

**Fix:** None required; optionally clear `plan_seats`→0 if you prefer a clean
revoked row.

### IN-03: Client `seats` validation cap (max 500) is enforced only server-side, not in the form

**File:** `src/app/admin/[orgId]/ManualAccessForm.tsx:59-64`

**Issue:** The form validates `seats >= 1` but has no upper bound; the Input has
`min="1"` but no `max`. The server schema correctly caps at `.max(500)`
(actions.ts:304), so an out-of-range value is rejected server-side and surfaced
via toast (the form never crashes — `result.ok` handling is correct on both
paths). This is purely a nicer-UX nit: a value >500 round-trips and returns the
raw zod error string ("Invalid input: ...") rather than a friendly message.

**Fix:** Add `max="500"` to the seats `<Input>` and mirror the bound in
`handleGrant`'s client check for a friendlier message. Optional.

## Verified clean (explicit confirmations requested)

1. **AUTH GATE** — `requireSuperAdmin()` is the first statement in both
   `grantManualAccessAction` (actions.ts:313) and `revokeManualAccessAction`
   (actions.ts:385), before `createServiceClient()`. The guard re-validates
   `app_metadata.super_admin === true` via `getUser()` (server-validated, not a
   forgeable client JWT) and silently `redirect('/')` for non-admins. A direct
   crafted invocation by a non-admin is blocked. CONFIRMED.
2. **NO STRIPE CLOBBER** — grant reads `stripe_subscription_id` and returns an
   error with no write when set (actions.ts:335-340); revoke does likewise
   (actions.ts:409-411). No path overwrites a live paying org's
   `stripe_subscription_id`. CONFIRMED (see WR-02 for the narrower
   customer-id-only edge, which does not touch a live subscription).
3. **WRITE CORRECTNESS** — upsert sets `status='active'`, `plan_key` (zod enum
   {starter,pro,scale}), `plan_seats` (zod int>0, ≤500), and NULLs
   stripe_customer_id / stripe_subscription_id / trial_end / current_period_end;
   `onConflict 'organization_id'` matches the table's `unique` constraint
   (migration 20260604120000 line 47). All values satisfy the `status` and
   `plan_key` CHECK constraints (lines 51-56). `updated_at` is maintained by the
   `subscriptions_set_updated_at` trigger. Entitlement gate treats the resulting
   `active` row as entitled (`(app)/layout.tsx` + `require-entitlement.ts`, both
   `{trialing, active}`). Revoke's `status='cancelled'` is applied only to a
   manual (non-stripe) `active` row (guard at actions.ts:406-414). CONFIRMED.
4. **INPUT VALIDATION / IDOR** — `orgId` is `z.string().uuid()`; `planKey` is
   `z.enum(MANUAL_PLAN_KEYS)`; `seats` is `z.number().int().positive().max(500)`.
   Actions operate only on the passed `orgId` (legitimate cross-tenant for a
   super-admin). No other injection vector. CONFIRMED.
5. **CALLER-CRASH SAFETY** — form's `result.ok ? toast.success : toast.error`
   handling matches `AdminActionResult`; both handlers wrap the action in
   try/catch with a fallback toast; the form never crashes on error.
   `hasStripeSubscription` branch renders the "manage in Stripe" copy and hides
   the form. `isManualActive = status==='active' && !hasStripeSubscription` is
   correct. CONFIRMED.
6. **TENANCY / PII** — Sentry calls carry only `{ layer, action, org_id }` tags;
   no candidate data, names, or emails. No candidate tables touched. CONFIRMED.
7. **HALF-ENTITLED STATE** — the only stranded-state risks found are WR-01
   (revoked org has no UI path to re-subscribe) and the WR-02 customer-id desync.
   Neither leaves the org in a *security*-broken or data-corrupt state; the
   entitlement gate itself is internally consistent in all status transitions.

---

_Reviewed: 2026-06-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
