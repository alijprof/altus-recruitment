---
phase: quick-260605-gtj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/(app)/settings/billing/start-checkout-button.tsx
  - src/app/(app)/settings/billing/page.tsx
autonomous: true
requirements: [BILLING-SELF-SERVE]

must_haves:
  truths:
    - "An owner of an org with subscription status 'none' sees the three plans (Starter/Pro/Scale) with price and seat count on /settings/billing"
    - "Clicking 'Start 14-day trial' on a plan POSTs that plan's key to /api/stripe/checkout and redirects the browser to the returned Stripe checkout URL"
    - "A non-2xx response (or thrown fetch error) surfaces a sonner error toast and does NOT navigate; the button re-enables"
    - "The existing status != 'none' branch (ManageBillingButton) and the !stripeConfigured amber notice are unchanged"
  artifacts:
    - path: "src/app/(app)/settings/billing/start-checkout-button.tsx"
      provides: "Client button that starts a Stripe checkout session for a given planKey"
      contains: "use client"
    - path: "src/app/(app)/settings/billing/page.tsx"
      provides: "Plan-selection UI in the status 'none' branch"
      contains: "StartCheckoutButton"
  key_links:
    - from: "src/app/(app)/settings/billing/start-checkout-button.tsx"
      to: "/api/stripe/checkout"
      via: "fetch POST with { planKey } body"
      pattern: "fetch\\(['\"]/api/stripe/checkout"
    - from: "src/app/(app)/settings/billing/page.tsx"
      to: "src/app/(app)/settings/billing/start-checkout-button.tsx"
      via: "import + render per plan in status 'none' branch"
      pattern: "StartCheckoutButton"
---

<objective>
Make self-serve subscription reachable from the UI. POST /api/stripe/checkout is fully built and working, but nothing in the app calls it — an org with subscription status 'none' can only reach a "Choose a plan" link to /pricing, whose CTAs are ignored by the sign-up flow. This wires a self-serve checkout trigger directly into /settings/billing.

Purpose: Close Finding #1 from the 2026-06-05 production billing smoke — a new org cannot currently start a subscription anywhere in the product.
Output: A new `StartCheckoutButton` client component plus a plan-selection UI in the billing page's status-'none' branch.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md

<interfaces>
<!-- Extracted from the codebase. Use these directly — no exploration needed. -->

From src/lib/stripe/plans.ts:
```typescript
export const PLANS = {
  starter: { label: 'Starter', pricePence: 5900, seats: 3, aiCaps: {...} },
  pro:     { label: 'Pro',     pricePence: 8900, seats: 8, aiCaps: {...} },
  scale:   { label: 'Scale',   pricePence: 12900, seats: 99, aiCaps: {...} },
} as const
export type PlanKey = keyof typeof PLANS   // 'starter' | 'pro' | 'scale'
```

From src/app/api/stripe/checkout/route.ts (the endpoint to call):
```
POST /api/stripe/checkout
  body:   { planKey: 'starter' | 'pro' | 'scale' }   (defaults to 'pro' if omitted)
  200:    { url: string }                              (redirect target — Stripe checkout)
  4xx/5xx:{ error: string }                            (e.g. 401 Unauthorized, 403 owner-only,
                                                        503 Billing not configured)
  Owner-gated server-side; 14-day trial; org resolved from session (not client input).
```

From src/app/(app)/settings/billing/manage-billing-button.tsx (the client-component pattern to mirror):
```typescript
'use client'
// useState(false) loading; async handleClick:
//   setLoading(true); try { fetch; if(!res.ok) toast.error(data.error ?? '…'); return;
//   parse url; if url window.location.href = url; else toast.error(…) }
//   catch { Sentry.captureException(err, {tags:{layer:'billing',component:'…'}}); toast.error(…) }
//   finally { setLoading(false) }
// Renders <Button onClick={handleClick} disabled={loading} size="sm">…</Button>
```

From src/app/(app)/settings/billing/page.tsx (the page to modify):
```typescript
// Server Component. Owner-only (redirect if role !== 'owner').
// stripeConfigured = !!stripe
// entitlement.status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'none'
// formatPenceGbp(pence) -> '£59.00' style GBP string (already defined in this file)
// Current Actions block (the only thing to change):
//   {stripeConfigured && entitlement.status !== 'none' ? <ManageBillingButton />
//     : <Link href="/pricing">Choose a plan</Link>}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create StartCheckoutButton client component</name>
  <files>src/app/(app)/settings/billing/start-checkout-button.tsx</files>
  <action>
Create a new `'use client'` component `StartCheckoutButton`, mirroring manage-billing-button.tsx exactly (same imports, same error-surfacing discipline, same Button usage).

Props interface `StartCheckoutButtonProps`:
- `planKey: PlanKey` (import `type { PlanKey }` from '@/lib/stripe/plans')
- `label?: string` (default to 'Start 14-day trial')
- `variant?: React.ComponentProps<typeof Button>['variant']` (optional pass-through; omit the prop on Button when undefined so the Button default applies)

Behaviour in `handleClick`:
- `setLoading(true)` inside a try/catch/finally.
- `const res = await fetch('/api/stripe/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planKey }) })`.
- Parse the body ONCE: `const data = (await res.json()) as { url?: string; error?: string }`. (Do NOT call `res.json()` twice — manage-billing-button.tsx parses it twice, which throws "body already read"; parse once here.)
- If `!res.ok`: `toast.error(data.error ?? 'Could not start checkout. Please try again.')` and `return` — do NOT navigate (CLAUDE.md: never navigate on failure).
- If `res.ok && data.url`: `window.location.href = data.url` (Stripe checkout is cross-origin — full-page navigation, same rationale as the portal button; do not use next/navigation router.push).
- Else (ok but no url): `toast.error('No checkout URL returned. Please try again.')`.
- `catch (err)`: `Sentry.captureException(err, { tags: { layer: 'billing', component: 'StartCheckoutButton' } })` then `toast.error('Could not start checkout. Please try again.')`.
- `finally`: `setLoading(false)`.

Render: `<Button onClick={handleClick} disabled={loading} size="sm" {...(variant ? { variant } : {})}>{loading ? 'Starting…' : label}</Button>`.

Conventions: no semicolons, single quotes, 2-space indent. Named export `StartCheckoutButton`. Reuse `Button` from '@/components/ui/button', `toast` from 'sonner', `useState` from 'react', `* as Sentry` from '@sentry/nextjs' — exactly as manage-billing-button.tsx imports them.
  </action>
  <verify>
    <automated>test -f "src/app/(app)/settings/billing/start-checkout-button.tsx" && grep -q "fetch('/api/stripe/checkout'" "src/app/(app)/settings/billing/start-checkout-button.tsx" && grep -q "window.location.href" "src/app/(app)/settings/billing/start-checkout-button.tsx"</automated>
  </verify>
  <done>File exists, exports StartCheckoutButton, POSTs { planKey } to /api/stripe/checkout, parses JSON once, redirects on success, toasts (no navigation) on failure, Sentry on throw.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Render plan selection in the billing page status-'none' branch</name>
  <files>src/app/(app)/settings/billing/page.tsx</files>
  <action>
Import the new component at the top alongside the existing ManageBillingButton import:
`import { StartCheckoutButton } from './start-checkout-button'`. PLANS and PlanKey are already imported (PLANS is imported; add `type PlanKey` to the existing `import { PLANS } from '@/lib/stripe/plans'` line — `import { PLANS, type PlanKey } from '@/lib/stripe/plans'`).

Modify ONLY the Actions block inside the plan-summary Card (currently the ternary that renders `<ManageBillingButton />` vs the `<Link href="/pricing">Choose a plan</Link>`). Replace the FALSE branch (status === 'none') so that:

- When `stripeConfigured && entitlement.status !== 'none'`: render `<ManageBillingButton />` — UNCHANGED, bit-for-bit.
- When `stripeConfigured && entitlement.status === 'none'`: render a plan-picker. Map over the plan keys in order `(['starter', 'pro', 'scale'] as const)`. For each key, read `const plan = PLANS[key]` and render a small bordered row/card (reuse existing Tailwind tokens — e.g. a `div` with `rounded-md border p-3` containing the plan name, `formatPenceGbp(plan.pricePence) + ' / seat / month'`, the seat count `Up to ${plan.seats} seats`, and a `<StartCheckoutButton planKey={key} label="Start 14-day trial" />`). Lay the three out responsively (e.g. `flex flex-col gap-3` or a `grid gap-3 sm:grid-cols-3`). Below the three plans, keep a secondary link: `<Link href="/pricing" className="text-muted-foreground hover:text-foreground text-sm">Compare all plans</Link>`.
- When `!stripeConfigured`: the existing amber "Billing not configured" notice at the top of the page already covers this — in the Actions block render nothing (or keep the current behaviour where the status-'none' fallthrough simply shows the picker only when `stripeConfigured`). Wrap the picker in `stripeConfigured &&` so an unconfigured env shows no checkout buttons.

Use `entitlement.status` (the existing variable) for the status check. Do NOT touch the AI-usage caps card, the seat-usage card, the trial-end line, the overage card, or any helper functions. Mark the 'pro' plan as recommended only if trivial (e.g. a small Badge) — optional, skip if it complicates the diff.

Conventions: no semicolons, single quotes, 2-space indent, server component (no 'use client' added to page.tsx — only the button is a client component). Match the existing Card/Link styling already in the file.
  </action>
  <verify>
    <automated>grep -q "StartCheckoutButton" "src/app/(app)/settings/billing/page.tsx" && grep -q "Compare all plans" "src/app/(app)/settings/billing/page.tsx" && pnpm typecheck && pnpm lint</automated>
  </verify>
  <done>Status-'none' branch renders all three plans with price + seats + a StartCheckoutButton each, plus a "Compare all plans" link to /pricing; ManageBillingButton branch and amber notice unchanged; `pnpm typecheck` and `pnpm lint` pass.</done>
</task>

</tasks>

<verification>
- `pnpm typecheck` passes (no `any`, PlanKey typed correctly on the button props and the map).
- `pnpm lint` passes (no semicolons, single quotes, sorted Tailwind classes).
- Manual (owner of a status-'none' org): /settings/billing shows three plans with price/seats and a "Start 14-day trial" button each; clicking POSTs the plan and lands on Stripe checkout (test mode). A forced failure (e.g. signed-out / non-owner) shows a toast and stays on the page.
- The status != 'none' path still shows "Manage billing"; an env with Stripe unconfigured still shows the amber notice and no checkout buttons.
</verification>

<success_criteria>
- A new org (subscription status 'none') can start a 14-day-trial subscription entirely from /settings/billing — no longer a dead-end "Choose a plan → /pricing" link.
- No schema changes, no new dependencies, no auth/RLS changes (owner gating already enforced server-side and by the page redirect).
- Committed to the current branch only. NOT pushed or deployed.
</success_criteria>

<output>
Create `.planning/quick/260605-gtj-billing-self-serve-checkout/260605-gtj-SUMMARY.md` when done.
</output>
