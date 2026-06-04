---
phase: 05-saas-shell
plan: 01
type: execute
wave: 1
depends_on: ["05-00"]
files_modified:
  - src/app/api/stripe/checkout/route.ts
  - src/app/api/stripe/portal/route.ts
  - src/app/api/stripe/webhook/route.ts
  - src/app/stripe/return/page.tsx
  - src/lib/db/subscriptions.ts
  - src/lib/stripe/entitlement.ts
  - src/lib/stripe/usage.ts
  - src/lib/email/billing-emails.ts
  - src/app/(app)/settings/billing/page.tsx
  - src/app/(app)/settings/team/actions.ts
  - src/lib/ai/claude.ts
  - src/lib/inngest/functions/precompute-matches-for-job.ts
  - src/components/app/cap-warning-banner.tsx
autonomous: true
requirements: [BILL-01]

must_haves:
  truths:
    - "A signed-in owner can start Stripe Checkout, capture a card, begin a 14-day trial, and return to a subscription that reads 'trialing'"
    - "Stripe webhooks sync subscription lifecycle (trial start, active, past_due, cancelled) into the local subscriptions table, idempotently"
    - "getEntitlement(orgId) resolves plan + seats + AI-usage-this-month from local DB without ever calling Stripe at request time"
    - "Inviting a teammate beyond the plan's seat allowance is blocked server-side with a clear upgrade message"
    - "When an org crosses 80% of any AI cap, an in-app banner shows + an email fires once; at 100%, match-scoring falls back to cached-only/queue and CV parsing queues (never blocks)"
    - "An owner can open the Stripe Customer Portal to upgrade/downgrade/cancel"
  artifacts:
    - path: "src/app/api/stripe/webhook/route.ts"
      provides: "Signature-verified, idempotent webhook handler"
      contains: "request.text()"
    - path: "src/lib/stripe/entitlement.ts"
      provides: "getEntitlement(orgId) — local-DB-only entitlement resolution"
      exports: ["getEntitlement"]
    - path: "src/lib/db/subscriptions.ts"
      provides: "subscriptions table read/upsert helpers"
      exports: ["getSubscriptionForOrg", "upsertSubscriptionFromStripe"]
    - path: "src/app/api/stripe/checkout/route.ts"
      provides: "Checkout session creation (card + 14-day trial)"
      contains: "trial_period_days"
  key_links:
    - from: "src/app/api/stripe/webhook/route.ts"
      to: "stripe_webhook_events"
      via: "idempotency insert before processing"
      pattern: "stripe_webhook_events"
    - from: "src/app/(app)/settings/team/actions.ts"
      to: "getEntitlement"
      via: "seat check before service-role escalation"
      pattern: "getEntitlement|activeSeats|planSeats"
    - from: "src/lib/ai/claude.ts"
      to: "entitlement cap check"
      via: "purpose-keyed cap enforcement in runWithLogging"
      pattern: "hardCap|aiCaps|cap"
---

<objective>
The complete Stripe billing vertical slice (BILL-01): self-serve card-upfront Checkout with a 14-day trial → signature-verified idempotent webhooks → local subscriptions table → entitlement helper → seat enforcement at invite + AI-usage soft/hard cap enforcement + overage, with the Customer Portal for self-serve plan management.

This is a thin-but-complete vertical slice: after it, a real owner can subscribe, get billed (test mode), have their plan limits enforced, and manage their plan — end to end.

Purpose: Turns Altus from a single-tenant internal tool into a billable SaaS where margin is protected by usage caps (the core economic guardrail from the pricing analysis).
Output: 3 Stripe route handlers, return page, subscriptions DB layer, entitlement + usage helpers, seat + cap enforcement edits, billing settings page, cap-warning banner + emails.
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
@docs/cost-and-pricing-analysis.md
@src/app/(app)/settings/team/actions.ts
@src/lib/ai/claude.ts
@src/lib/inngest/functions/precompute-matches-for-job.ts

<interfaces>
<!-- Contracts created in 05-00 (Wave 0) — implement against these. -->

From src/lib/stripe/client.ts (05-00):
  export const stripe: Stripe | null
  export function assertStripe(): Stripe  // throws "Stripe is not configured" when null

From src/lib/stripe/plans.ts (05-00):
  export const PLANS: { starter: {...}, pro: {...}, scale: {...} }  // pricePence, seats, aiCaps{matchScores,cvParses,searches,specMinutes,writingCalls}
  export type PlanKey = 'starter' | 'pro' | 'scale'
  export const PLAN_PRICE_IDS: Record<PlanKey, string>

From src/types/billing.ts (05-00):
  export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'none'
  export type AiCaps = { matchScores; cvParses; searches; specMinutes; writingCalls }
  export type AiUsageAggregate = { matchScores; cvParses; searches; specMinutes; writingCalls }
  export type EntitlementStatus = { planKey: PlanKey | 'none'; planSeats; activeSeats; status; aiCaps; aiUsageThisMonth; softCapBreached; hardCapBreached }

From src/lib/supabase/service.ts:
  export function createServiceClient()  // service-role, bypasses RLS

From src/lib/ai/claude.ts:
  export async function runWithLogging(args: { model; organizationId; userId?; purpose: string; request }): Promise<Anthropic.Message>
  // purpose values in use: cv_parse, match_score, search_query_embed, spec_transcribe, ad_generate, outreach_draft, dormant_outreach_draft, candidate_embed, job_embed, etc.

From src/app/(app)/settings/team/actions.ts:
  export async function inviteMemberAction(rawInput): Promise<ActionResult>
  // R8 ordering: 1.parse 2.getUser 3.RLS role check 4.reject non-owner 5.do work
  // Seat check goes at step 4.5 — AFTER owner check, BEFORE the org_invitations insert.

From src/lib/email/resend.ts:
  export async function sendResendEmail({ to, subject, html, text }): Promise<{ ok; reason?; status? }>
From src/lib/email/render.ts:
  export function renderTransactionalEmail(input: TransactionalEmail): string
  export function renderTransactionalEmailText(input: TransactionalEmail): string

ai_usage meter (existing table): columns org_id, model, purpose, input_tokens, output_tokens, cost_pence, created_at.
Aggregate current-month usage by `purpose` to compare against PLANS[planKey].aiCaps * planSeats. record_ai_usage RPC writes rows.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1.1: Subscriptions DB layer + entitlement + usage aggregation helpers</name>
  <read_first>
    - src/lib/db/organizations.ts (DbResult pattern + service-role boundary conventions)
    - src/lib/inngest/functions/precompute-matches-for-job.ts (getOrgMatchSpendThisMonth — the existing month-to-date ai_usage aggregation pattern to mirror)
    - "src/app/(app)/settings/usage/page.tsx" (the existing per-purpose ai_usage aggregation by `byPurpose` Map)
    - src/lib/stripe/plans.ts + src/types/billing.ts (05-00 contracts)
  </read_first>
  <behavior>
    - getSubscriptionForOrg(orgId) returns the org's subscription row or a 'none'-status default when no row exists
    - getEntitlement(orgId): planKey 'none' + status 'none' when no subscription → app treats as trial-not-started
    - getEntitlement aggregates current-calendar-month ai_usage grouped by purpose into AiUsageAggregate; maps purposes to cap buckets (cv_parse→cvParses, match_score→matchScores, search_query_embed→searches, spec_transcribe→specMinutes, {ad_generate,outreach_draft,dormant_outreach_draft,jd_extract}→writingCalls)
    - effective cap = PLANS[planKey].aiCaps[bucket] * planSeats (per-seat caps × seats); softCapBreached = any bucket usage ≥ 80% of its effective cap; hardCapBreached = any bucket usage ≥ 100%
    - For planKey 'none' (trialing-no-plan or pre-checkout), use Pro caps as the trial allowance (trial users get Pro-level access for 14 days)
  </behavior>
  <action>
    Create src/lib/db/subscriptions.ts (server-only) with: `getSubscriptionForOrg(supabase, orgId): Promise<DbResult<SubscriptionRow>>` (SELECT from subscriptions by organization_id; not_found → caller synthesises a 'none' default); `upsertSubscriptionFromStripe(serviceClient, { organizationId, stripeCustomerId, stripeSubscriptionId, planKey, planSeats, status, trialEnd, currentPeriodEnd })` (service-role UPSERT on organization_id — used by the webhook). Type SubscriptionRow from the regenerated database.ts; if not yet present cast at the boundary per the organizations.ts precedent.
    Create src/lib/stripe/usage.ts (server-only) with `getAiUsageThisMonth(supabase, orgId): Promise<AiUsageAggregate>` — aggregate ai_usage rows where created_at >= date_trunc('month', now()) grouped by purpose, mapped into the AiCaps buckets per the behavior block. Mirror the month-to-date pattern from precompute-matches-for-job. Specify the purpose→bucket map as an exported const PURPOSE_CAP_BUCKETS so cap enforcement (Task 1.4) reuses the exact same mapping.
    Create src/lib/stripe/entitlement.ts (server-only) with `getEntitlement(orgId, supabase?): Promise<EntitlementStatus>` — reads subscription + usage, computes activeSeats (count of public.users in the org), resolves effective caps (per-seat × planSeats), sets soft/hard cap flags. NEVER call Stripe here (Pitfall — entitlement reads local DB only). Add a unit test src/lib/stripe/entitlement.test.ts covering: no-subscription→Pro-trial caps; 79% usage→no soft cap; 80%→soft; 100%→hard; multi-bucket (only matchScores over).
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm test -- src/lib/stripe/entitlement.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - behavior: getEntitlement with usage at 80% of one cap returns softCapBreached:true, hardCapBreached:false
    - behavior: getEntitlement with usage at 100% returns hardCapBreached:true
    - behavior: getEntitlement for an org with no subscription row returns status:'none' and Pro-level trial caps (no crash)
    - source: getEntitlement / entitlement.ts contains NO import of '@/lib/stripe/client' and no `stripe.` call (local-DB-only)
    - source: PURPOSE_CAP_BUCKETS exported from usage.ts and reused by Task 1.4
    - test-command: `pnpm test -- src/lib/stripe/entitlement.test.ts` passes
  </acceptance_criteria>
  <done>Subscriptions DB helpers, usage aggregation, and entitlement resolver exist and are unit-tested. No Stripe calls in the entitlement path.</done>
</task>

<task type="auto">
  <name>Task 1.2: Stripe route handlers — checkout, webhook (idempotent), portal + return page</name>
  <read_first>
    - src/app/auth/callback/route.ts (route-handler pattern + Sentry tag discipline + service-role usage)
    - src/lib/supabase/service.ts (createServiceClient)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Pattern 1 checkout, Pattern 2 webhook, Pitfalls 1/2/4 — raw body + idempotency + webhook race)
    - src/lib/db/subscriptions.ts + src/lib/stripe/client.ts (created in Task 1.1 / 05-00)
  </read_first>
  <action>
    Create src/app/api/stripe/checkout/route.ts (POST). Authenticated: createClient() → getUser() → 401 if absent → load caller's org (id, name, stripe_customer_id) via RLS-scoped query on users+organizations. If no stripe_customer_id, `assertStripe().customers.create({ email: user.email, name: org.name, metadata: { organization_id } })` and persist customerId to organizations immediately (webhook may race — Pitfall 1). Create `stripe.checkout.sessions.create({ customer, mode:'subscription', payment_method_collection:'always', subscription_data:{ trial_period_days:14, metadata:{organization_id} }, line_items:[{ price: PLAN_PRICE_IDS[planKey], quantity:1 }], success_url: `${NEXT_PUBLIC_SITE_URL}/stripe/return?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${NEXT_PUBLIC_SITE_URL}/pricing`, metadata:{organization_id} })`. Return `{ url }`. planKey defaults to 'pro'; validate planKey ∈ PLANS with zod. If `stripe` is null, return a 503 `{ error: 'Billing not configured' }` (graceful — dev without keys).
    Create src/app/api/stripe/webhook/route.ts. `export const runtime = 'nodejs'`. `const body = await request.text()` BEFORE any parse (Pitfall 4). Read `stripe-signature` header. `assertStripe().webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET)`; on throw return 400 (do NOT leak detail). createServiceClient(). Idempotency (Pitfall 2): SELECT stripe_webhook_events by event.id; if exists return `{received:true}`; else INSERT { stripe_event_id, event_type } BEFORE processing. Handle: `checkout.session.completed` + `customer.subscription.created/updated` → derive planKey from the price ID (reverse-map PLAN_PRICE_IDS), planSeats from PLANS[planKey].seats, status, trial_end, current_period_end → upsertSubscriptionFromStripe; `customer.subscription.deleted` → status 'cancelled'; `invoice.payment_failed` → status 'past_due' + queue payment-failed email; `customer.subscription.trial_will_end` → queue trial-ending email. Return `{received:true}` (200) at the end so Stripe doesn't retry on success. If `stripe`/secret null, return 503. PII discipline: never log customer email to Sentry — org-id/event-type tags only.
    Create src/app/api/stripe/portal/route.ts (POST). Authenticated owner: load org.stripe_customer_id → `stripe.billingPortal.sessions.create({ customer, return_url: `${NEXT_PUBLIC_SITE_URL}/settings/billing` })` → return `{ url }`. 503 if stripe null; 400 if no customer id yet.
    Create src/app/stripe/return/page.tsx (RSC). Reads session_id, shows a "Setting up your account…" state; client subcomponent polls getSubscriptionForOrg (via a small server action or route) for up to ~5s for a non-'none' status (Pitfall 1 webhook race), then redirects to /. Keep it simple — a brief skeleton + redirect.
  </action>
  <verify>
    <automated>grep -q "export const runtime = 'nodejs'" src/app/api/stripe/webhook/route.ts && grep -q "await request.text()" src/app/api/stripe/webhook/route.ts && grep -q "stripe_webhook_events" src/app/api/stripe/webhook/route.ts && grep -q "trial_period_days" src/app/api/stripe/checkout/route.ts && grep -q "payment_method_collection" src/app/api/stripe/checkout/route.ts && pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - source: webhook handler calls `request.text()` and never `request.json()` before signature verify
    - source: webhook inserts into stripe_webhook_events and short-circuits on existing event (idempotency)
    - source: checkout sets payment_method_collection:'always' + trial_period_days:14
    - source: all three handlers return 503 (not crash) when `stripe` is null
    - behavior: webhook returns 400 on bad signature, 200 `{received:true}` on success/duplicate
    - source: no customer email passed to any Sentry capture in these files
    - test-command: `pnpm typecheck` passes
  </acceptance_criteria>
  <done>Checkout (card+trial), idempotent signature-verified webhook syncing all 5 lifecycle events, portal redirect, and a race-safe return page. All degrade gracefully without Stripe keys.</done>
</task>

<task type="auto">
  <name>Task 1.3: Seat enforcement at invite + billing settings page</name>
  <read_first>
    - "src/app/(app)/settings/team/actions.ts" (inviteMemberAction — the EXACT R8 ordering; seat check inserts at step 4.5)
    - "src/app/(app)/settings/page.tsx" + "src/app/(app)/settings/usage/page.tsx" (settings page conventions, owner-only gating)
    - src/lib/stripe/entitlement.ts (getEntitlement, created Task 1.1)
  </read_first>
  <action>
    Edit src/app/(app)/settings/team/actions.ts `inviteMemberAction`: after the owner-role check (step 4) and BEFORE the org_invitations insert (step 5), call `getEntitlement(me.organization_id, supabase)`. Compute prospective seat usage = activeSeats + pending-invitation count. If that would exceed `entitlement.planSeats` (when status is active/trialing/past_due — i.e. a real plan), return `{ ok:false, formError: 'You\'ve reached your plan\'s seat limit. Upgrade your plan to add more teammates.' }` BEFORE any DB write. When status is 'none' (no plan yet), allow invites up to the Pro trial seat allowance so the anchor/trial isn't blocked. Reuse the existing pending-invitation count or add a lightweight count query (RLS-scoped). Keep R8 ordering intact — no service-role escalation before the gate. Surface the error via the existing ActionResult formError path (the team UI already toasts formError — no silent false-success per CLAUDE.md).
    Create src/app/(app)/settings/billing/page.tsx (RSC, owner-only — mirror the owner gate used in /settings/team). Show: current plan (label + price), status (trialing/active/past_due/cancelled), trial end / next renewal date, seats used vs allowance, and current AI usage vs caps (read getEntitlement). Buttons: "Manage billing" (POSTs to /api/stripe/portal then redirects to the returned url — client component), and, when status 'none', "Choose a plan" linking to /pricing. When `stripe` is unconfigured (env.STRIPE_SECRET_KEY absent), show a "Billing not configured" notice instead of crashing. Add a "Billing" nav entry to the settings nav consistent with the existing /settings/usage entry.
  </action>
  <verify>
    <automated>grep -q "getEntitlement" "src/app/(app)/settings/team/actions.ts" && grep -q "seat" "src/app/(app)/settings/team/actions.ts" && grep -q "/api/stripe/portal" "src/app/(app)/settings/billing/page.tsx" && pnpm typecheck && pnpm lint</automated>
  </verify>
  <acceptance_criteria>
    - source: seat check in inviteMemberAction runs AFTER `me.role !== 'owner'` reject and BEFORE the `.from('org_invitations').insert` (R8 ordering preserved)
    - behavior: inviting beyond planSeats returns formError (no DB row created), surfaced as a toast (no silent success)
    - behavior: with status 'none' (trial/no plan), invites allowed up to Pro trial seats
    - source: billing page reads getEntitlement and POSTs to /api/stripe/portal for "Manage billing"
    - behavior: billing page renders a "Billing not configured" notice (not a crash) when Stripe env absent
    - test-command: `pnpm typecheck && pnpm lint` pass
  </acceptance_criteria>
  <done>Seat limit enforced at invite time without breaking R8 ordering; owner-facing billing page wired to entitlement + Customer Portal.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 1.4: AI-usage soft/hard cap enforcement + overage + cap-warning banner & email</name>
  <read_first>
    - src/lib/ai/claude.ts (runWithLogging — the central hook for every Claude call; purpose is passed per call)
    - src/lib/inngest/functions/precompute-matches-for-job.ts (the existing spend-ceiling bail pattern — mirror it for hard-cap fallback)
    - src/lib/stripe/usage.ts (PURPOSE_CAP_BUCKETS — reuse the exact mapping) + src/lib/stripe/entitlement.ts
    - src/lib/email/resend.ts + src/lib/email/render.ts (branded email send)
  </read_first>
  <behavior>
    - At <80% of a cap: AI call proceeds normally
    - At ≥80% and <100%: call proceeds, but soft-cap state is flagged so the banner shows and ONE email fires per cap-bucket per month (deduped)
    - At ≥100% (hard cap): match_score (on-demand) falls back to cached-only / overnight queue (do NOT make the fresh Sonnet call); cv_parse QUEUES (never blocks onboarding) rather than running synchronously; overage is recorded for billing (~£0.05/match-score, ~£0.04/CV parse over cap) instead of a hard stop
    - cap enforcement maps each call's `purpose` to its bucket via PURPOSE_CAP_BUCKETS
  </behavior>
  <action>
    Create src/lib/stripe/cap-enforcement.ts (server-only) with `checkCap(orgId, purpose): Promise<{ allow: boolean; mode: 'normal'|'soft'|'hard'; bucket: string }>` using getEntitlement + PURPOSE_CAP_BUCKETS. In src/lib/ai/claude.ts `runWithLogging`, BEFORE the Anthropic call, consult checkCap for the call's purpose+org. For hard-capped on-demand purposes (match_score), throw a typed `CapExceededError` (mode 'hard') that the match wrapper/precompute interprets as "use cached only / queue" — wire the precompute-matches-for-job function to treat CapExceededError the same as its existing spend-ceiling bail (Sentry warning, exit, recruiter still sees vector-only results). For cv_parse hard cap, the parse Inngest path should enqueue/defer rather than throw to the user (never block onboarding — D-08). For soft-cap (≥80%), allow the call but emit a `softCapBreached` signal: fire the cap-warning email once per bucket per month (dedupe via a marker row — reuse stripe_webhook_events-style idempotency OR a dedicated ai_cap_notifications check; keep it simple, e.g. a guard query against ai_usage-derived state or a small notifications table — choose the lightest approach and document it). Do NOT add `await` inside any Supabase subscriber callback (CLAUDE.md). Record overage: when over cap, still log the ai_usage row (it already logs) and rely on the existing cost_pence tracking; add a `metadata`/purpose marker or a derived overage query the admin console (05-05) can read — document the chosen mechanism.
    Create src/lib/email/billing-emails.ts with `sendCapWarningEmail`, `sendTrialEndingEmail`, `sendPaymentFailedEmail` (each builds a TransactionalEmail via renderTransactionalEmail/Text and sends via sendResendEmail; best-effort, fail-open, never throw into the caller — mirror the invite-email pattern). The webhook (Task 1.2) calls the trial-ending + payment-failed ones.
    Create src/components/app/cap-warning-banner.tsx — a client/server banner shown in the authenticated app shell when getEntitlement().softCapBreached (or hardCapBreached) is true, with copy + a link to /settings/billing. Wire it into the (app) layout or dashboard so it surfaces (read entitlement server-side in the layout; pass the boolean to the banner — no client-side Stripe).
    Add a unit test src/lib/stripe/cap-enforcement.test.ts: <80%→normal/allow; 80%→soft/allow; 100% match_score→hard/deny; 100% cv_parse→hard/queue.
  </action>
  <verify>
    <automated>grep -q "checkCap\|CapExceededError" src/lib/ai/claude.ts && grep -q "CapExceededError\|cap" src/lib/inngest/functions/precompute-matches-for-job.ts && pnpm typecheck && pnpm test -- src/lib/stripe/cap-enforcement.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - behavior: cap-enforcement returns mode 'normal' <80%, 'soft' at 80%, 'hard' at 100% (unit-tested)
    - behavior: at hard cap, match_score does NOT make a fresh Sonnet call (cached-only/queue); cv_parse queues, never throws to the user
    - source: claude.ts runWithLogging consults checkCap before the Anthropic call
    - source: precompute-matches-for-job handles CapExceededError like its existing spend-ceiling bail (no retries, Sentry warning, vector-only fallback)
    - source: no `await` of a Supabase call inside any onAuthStateChange/subscriber callback (CLAUDE.md)
    - behavior: cap-warning email fires at most once per bucket per month (deduped)
    - test-command: `pnpm test -- src/lib/stripe/cap-enforcement.test.ts` passes
  </acceptance_criteria>
  <done>Soft cap (banner + one email) and hard cap (match cached-only/queue, CV parse queues, overage recorded) enforced through the central claude.ts hook + precompute fallback. Banner surfaces in the app shell.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Stripe → /api/stripe/webhook | Untrusted POST; only HMAC signature proves authenticity |
| client → checkout/portal | Authenticated; planKey/price must come from server env, not client |
| org → AI spend | Usage must be metered + capped server-side; client cannot bypass |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-01-01 | Spoofing | webhook handler | mitigate | stripe.webhooks.constructEvent HMAC verify on raw body; 400 on failure |
| T-05-01-02 | Tampering/Replay | webhook handler | mitigate | stripe_webhook_events idempotency insert BEFORE processing (at-least-once delivery safe) |
| T-05-01-03 | Tampering | checkout price selection | mitigate | Price IDs from server env (PLAN_PRICE_IDS); planKey validated against PLANS enum; never trust client price |
| T-05-01-04 | Elevation of Privilege | seat enforcement | mitigate | getEntitlement seat check before org_invitations insert; R8 ordering preserved |
| T-05-01-05 | Abuse (margin) | AI usage caps | mitigate | Per-seat caps enforced in claude.ts hook + precompute fallback; overage recorded |
| T-05-01-06 | Information Disclosure | webhook + emails | mitigate | No customer email/PII to Sentry; org-id/event-type tags only (CLAUDE.md) |
| T-05-01-07 | Fraud (trial abuse) | signup/checkout | accept | Card required upfront (D-03) raises intent; same-email = existing Stripe customer; deeper anti-fraud deferred |
</threat_model>

<verification>
- `pnpm typecheck`, `pnpm lint`, and the two new unit suites pass.
- Manual (test mode, founder keys): Checkout → trial subscription appears; `stripe trigger checkout.session.completed` (or `stripe listen`) syncs a subscriptions row; duplicate event is a no-op; invite beyond seats blocked; portal opens.
- With Stripe env absent: app builds, billing pages show "not configured", no crash.
</verification>

<success_criteria>
- Owner subscribes (card + 14-day trial), webhooks keep the local subscriptions table authoritative, entitlements resolve from local DB only.
- Seat limit enforced at invite; AI caps enforced (soft banner+email, hard cached-only/queue, overage recorded); Customer Portal manages plan changes.
</success_criteria>

<output>
Create `.planning/phases/05-saas-shell/05-01-SUMMARY.md` when done.
</output>
