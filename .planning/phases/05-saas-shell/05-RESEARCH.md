# Phase 5: SaaS Shell — Research

**Researched:** 2026-06-04
**Domain:** Stripe billing + SaaS multi-tenancy + Next.js 15 App Router
**Confidence:** HIGH (core Stripe patterns) / MEDIUM (seat quantity modelling, admin gate) / HIGH (branding/colour injection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Open self-serve signup. Reuse existing org-bootstrap in `src/app/auth/callback/route.ts`. Do NOT rebuild org creation.
- **D-02:** Reuse existing abuse guards (email verification, Turnstile apply-form rate-limit pattern). No open relay for spam orgs.
- **D-03:** Card required upfront at signup via **Stripe Checkout** (hosted). 14-day free trial auto-converts. Chosen over no-card trial.
- **D-04:** Self-serve plan management via **Stripe Customer Portal** (hosted). No bespoke billing UI in v1.
- **D-05:** Subscription lifecycle driven by **Stripe webhooks** → local `subscriptions`/billing table = entitlement source of truth.
- **D-06:** Per-seat tiers, AI bundled — **Starter £59 / Pro £89 (default) / Scale £129** per seat/month. Seats = active org members.
- **D-07:** Each tier carries AI-usage caps per seat/month (match-scores, CV parses, writing/summarisation, searches, spec-call minutes).
- **D-08:** Enforcement = soft cap → hard behaviour + overage. At 80%: in-app banner + email. At 100%: match-scoring cached-only/queue; CV parsing queues (never blocks). Overage ~£0.05/match-score, ~£0.04/CV parse. **Meter via existing `ai_usage` table.**
- **D-09:** Seat count enforced at **invite time** (block adding member beyond plan seat allowance).
- **D-10:** Branding = logo + brand colours on `(public)/apply/[orgSlug]`. Reuse `organizations.logo_url`; add colour fields to `organizations`. Set from `/settings`.
- **D-11:** Branding scope = public apply/careers surface only. Do NOT re-skin whole authenticated app.
- **D-12:** Reuse existing first-run welcome checklist. Add: optional sample-data seed + candidate CSV import (column-mapping → existing candidate-creation path; dedupe by lowercased email).
- **D-13:** Lean operations console at `/admin` gated to platform owner (super_admin flag/env allowlist). Provides: per-tenant AI-cost + billing dashboard; plan/trial overrides.
- **D-14:** No impersonation, no audit-logging layer in v1. Cross-org reads in `/admin` use service-role behind super-admin gate (deliberate, tightly-gated — must be unreachable by normal RLS routes).
- **D-15:** Marketing + docs + status page all in-app: public `(marketing)` route group + `/docs` + simple status page. No separate hosting.
- **Build against Stripe TEST mode only.** Stripe must be isolated so rest of phase ships without live keys.

### Claude's Discretion

- Exact Stripe data model (customers/subscriptions/prices tables shape)
- Webhook event handling and entitlement-resolution code
- Route/folder structure for `(marketing)`, `/docs`, `/admin`
- CSV-parsing approach + column-mapping UX; sample-data seed contents
- Precise brand-colour field set + how they cascade into apply-site theme
- Status-page mechanism (static vs minimal live check)
- Whether seat-based pricing uses Stripe per-seat quantities or org-level price tiers

### Deferred Ideas (OUT OF SCOPE)

- Super-admin impersonation / full audit-logging layer
- Freemium / permanently-free tier
- Annual billing / annual discount
- Per-org full app re-skinning (beyond public apply site)
- Rich status page / incident management tooling
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAAS-01 | Self-service signup creates a new organisation with onboarding flow (tour, sample data, CSV import) | D-01/D-02/D-12: reuse callback/org-bootstrap + welcome-checklist; add sample seed + CSV import via server action + PapaParse |
| BILL-01 | Stripe subscription with billing portal; tiered plans; plan limits enforced | D-03–D-09: Stripe Checkout + Portal + webhooks + subscriptions table + entitlement helper + ai_usage meter |
| BRAND-01 | Per-org branding — logo and colours on careers/apply site | D-10/D-11: schema addition to organizations; CSS custom property injection with hex-only validation |
| ADMIN-01 | Super-admin support tooling (plan overrides, usage review) | D-13/D-14: /admin route group + super_admin gate + service-role cross-org reads |
| MARKETING-01 | Documentation site, marketing site, status page | D-15: (marketing) route group + /docs + status page in-app |
</phase_requirements>

---

## Summary

Phase 5 layers a complete SaaS commercial shell on top of a product that already has auth, multi-tenancy, and AI metering wired. The largest new dependency is Stripe (version 22.2.0 as of June 2026); everything else extends existing codebase patterns.

**Stripe Checkout with card-upfront-and-trial** is the canonical flow: create a Checkout Session with `mode: 'subscription'`, `payment_method_collection: 'always'`, and `subscription_data.trial_period_days: 14`. Stripe handles PCI and card capture; the app only stores the resulting `stripe_customer_id` on the `organizations` row and syncs subscription state via webhooks into a local `subscriptions` table. The local table is the entitlement source of truth — the app never queries Stripe at request time.

**Seat modelling:** recommend org-level price-tier pricing (one fixed price per tier) rather than Stripe quantity-per-seat. Quantity-based seats require updating the Stripe subscription on every invite/remove, which introduces race conditions and retry complexity. Instead, lock the seat allowance in the local `subscriptions.plan_seats` column; enforce at invite time in the existing `inviteMemberAction` server action; reconcile with Stripe only at plan-change events.

**Admin gate:** use a `super_admin` boolean on `auth.users.raw_app_meta_data` (set via Supabase Dashboard SQL) + a server-side check in the `/admin` layout. The `/admin` route group uses `createServiceClient()` exclusively — the same pattern already used in Inngest functions and apply-form. The middleware `PUBLIC_PATHS` stays unchanged (admin is authenticated-but-role-gated, not public).

**Brand colour injection:** add `brand_primary` (hex) and `brand_secondary` (hex) columns to `organizations`. Validate server-side with a strict `/^#[0-9a-fA-F]{6}$/` regex before rendering into a `style` attribute as CSS custom properties. This blocks XSS through CSS property injection.

**Primary recommendation:** Wire Stripe Checkout → webhooks → local `subscriptions` table → entitlement helper. Everything else (branding, admin, marketing) builds on existing patterns without new architectural decisions.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stripe Checkout session creation | API/Backend (Server Action → Redirect) | — | Card capture must be server-side; Checkout is hosted by Stripe |
| Webhook ingestion + subscription sync | API Route Handler (`/api/stripe/webhook`) | Supabase DB | Webhooks arrive from Stripe; route handler verifies signature, writes to subscriptions table |
| Entitlement resolution (plan limits) | API/Backend (server-side helper) | — | Must be server-authoritative; client cannot be trusted |
| Seat enforcement at invite | API/Backend (Server Action) | — | Already in `inviteMemberAction`; add seat-check before service-role escalation |
| AI usage cap enforcement | API/Backend (Inngest functions + AI wrapper) | — | ai_usage is written by Inngest/claude.ts; cap check in same layer |
| Per-org branding on apply site | Frontend Server (SSR) | Database | RSC reads org colours from DB, injects as CSS custom props; no client-side needed |
| Super-admin dashboard | API/Backend gated RSC | Database (service-role) | Service-role reads cross-org; RSC renders; no browser exposure |
| Marketing/docs/status pages | Frontend Server (RSC, static) | — | Public, cacheable, no auth needed |
| CSV import column mapping UI | Browser / Client | Server Action | Column-mapping step needs interactivity; write goes through existing server action |
| Sample data seed | API/Backend (Server Action, one-shot) | — | Writes via existing candidate-creation path under org RLS |
| Customer Portal redirect | API Route Handler | — | Creates portal session server-side, returns URL to client for redirect |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` | `22.2.0` [VERIFIED: npm registry] | Stripe Node.js SDK for Checkout, webhooks, Portal | Official Stripe SDK; on npm since 2011; github.com/stripe/stripe-node |
| `papaparse` | `5.5.3` [VERIFIED: npm registry] | CSV parsing for candidate import | Established CSV parser; on npm since 2014; github.com/mholt/PapaParse; works in Node.js server actions |

### Supporting (already in codebase — no new install)
| Library | Purpose | File |
|---------|---------|------|
| `@supabase/supabase-js` | DB writes for subscriptions table, RLS reads | `src/lib/supabase/service.ts` |
| `zod` | Validate webhook payloads, CSV column maps, colour hex strings | existing |
| `sonner` | Toast for billing state (trial ending, cap warning) | existing |
| `@t3-oss/env-nextjs` | Stripe env var declaration in `src/lib/env.ts` | existing |
| `src/lib/email/resend.ts` | Trial-end, payment-failed, cap-warning emails | existing |
| `src/lib/ai/claude.ts` | The hook point for cap enforcement on AI calls | existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stripe (hosted) | Paddle, LemonSqueezy | Stripe is the industry standard; hosted Checkout satisfies PCI; founder specifically chose Stripe |
| `papaparse` | `csv-parse` | Both are solid; papaparse has simpler header-based API and broader adoption for front-to-back CSV work |
| Quantity-per-seat Stripe model | Org-level tier price | Quantity model requires sync on every member change; org-level tier is simpler, avoids race conditions |

**Installation (new packages only):**
```bash
pnpm add stripe papaparse
pnpm add -D @types/papaparse
```

---

## Package Legitimacy Audit

> slopcheck could not be installed (system permission denied in auto mode). All packages tagged `[ASSUMED]` per graceful degradation protocol.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `stripe` | npm | 14 yrs (2011) | github.com/stripe/stripe-node (official Stripe Inc.) | unavailable | Approved — official Stripe SDK, 14 years on npm, Stripe Inc. owned [ASSUMED] |
| `papaparse` | npm | 11 yrs (2014) | github.com/mholt/PapaParse | unavailable | Approved — well-established CSV parser, 11 years on npm [ASSUMED] |
| `@types/papaparse` | npm | DefinitelyTyped | github.com/DefinitelyTyped/DefinitelyTyped | unavailable | Approved — DefinitelyTyped standard pattern [ASSUMED] |

**Packages removed due to slopcheck:** none

**Packages flagged as suspicious:** none — both packages are long-established, have authoritative source repos, and are widely used. Planner does NOT need checkpoint:human-verify steps for these.

*Note: slopcheck was unavailable at research time. Packages are tagged `[ASSUMED]` per protocol. Manual verification: `stripe` (stripe.com/docs/api) and `papaparse` (papaparse.com) are official, authoritative packages. Planner may optionally add a `pnpm why stripe` check before install to confirm registry origin.*

---

## Architecture Patterns

### System Architecture Diagram

```
New User Signup Flow:
  Browser → /sign-up (existing magic-link form)
          → /auth/callback (existing org-bootstrap)
          → POST /api/stripe/create-checkout (Server Action)
          → Stripe Checkout (hosted, card capture + trial start)
          → /stripe/return?session_id=... (success redirect)
          → Dashboard with onboarding checklist

Webhook Sync (async):
  Stripe → POST /api/stripe/webhook (route handler, signature verify)
         → upsert into subscriptions table
         → entitlement cache invalidation

Entitlement Check (every gated action):
  Server Action / Inngest fn
         → getEntitlement(orgId) reads subscriptions table
         → checks ai_usage aggregate vs plan cap
         → allow / soft-cap / hard-fallback

Admin Dashboard:
  /admin/page.tsx (RSC, super_admin gate)
         → createServiceClient() cross-org reads
         → ai_usage aggregate per org
         → Stripe API reads for billing state
```

### Recommended Project Structure (new additions only)

```
src/
├── app/
│   ├── api/stripe/
│   │   ├── checkout/route.ts       # Create Checkout Session (route handler — public API)
│   │   ├── portal/route.ts         # Create Portal Session (route handler — authenticated)
│   │   └── webhook/route.ts        # Webhook handler (signature verified)
│   ├── (marketing)/                # New public route group (sibling to (public))
│   │   ├── layout.tsx              # Marketing layout (no auth required)
│   │   ├── page.tsx                # Landing page
│   │   ├── pricing/page.tsx        # Pricing page
│   │   └── features/page.tsx       # Features page
│   ├── docs/
│   │   └── [...slug]/page.tsx      # Static MDX-based docs
│   ├── status/
│   │   └── page.tsx                # Simple status page (static + DB health probe)
│   └── admin/
│       ├── layout.tsx              # Super-admin gate (reads raw_app_meta_data)
│       ├── page.tsx                # Overview dashboard
│       └── [orgId]/page.tsx        # Per-org detail (billing + AI cost)
├── lib/
│   ├── stripe/
│   │   ├── client.ts               # stripe SDK singleton (server-only)
│   │   ├── plans.ts                # Plan definitions (STARTER/PRO/SCALE) + price IDs
│   │   └── entitlement.ts          # getEntitlement(orgId) helper
│   └── db/
│       └── subscriptions.ts        # DB helpers for subscriptions table
└── types/
    └── billing.ts                  # Plan, Subscription, EntitlementStatus types
```

### Pattern 1: Stripe Checkout Session Creation (card-upfront + trial)

[CITED: docs.stripe.com/payments/checkout/free-trials, docs.stripe.com/billing/subscriptions/trials]

```typescript
// src/app/api/stripe/checkout/route.ts
// Route handler (not Server Action) — external redirect with query params
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { PLAN_PRICE_IDS } from '@/lib/stripe/plans'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { planKey = 'pro' } = await request.json()

  // Create or retrieve Stripe customer linked to this org
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, stripe_customer_id')
    .eq('id', /* org from user profile */)
    .single()

  let customerId = org.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: org.name,
      metadata: { organization_id: org.id },
    })
    customerId = customer.id
    // Persist immediately — webhook may race
    await supabase.from('organizations').update({ stripe_customer_id: customerId }).eq('id', org.id)
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_collection: 'always',        // card required upfront [CITED: docs.stripe.com]
    subscription_data: {
      trial_period_days: 14,                    // 14-day trial [CITED: docs.stripe.com/payments/checkout/free-trials]
      metadata: { organization_id: org.id },
    },
    line_items: [{ price: PLAN_PRICE_IDS[planKey], quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/pricing`,
    metadata: { organization_id: org.id },
  })

  return NextResponse.json({ url: session.url })
}
```

### Pattern 2: Webhook Handler (Next.js App Router — raw body, idempotency)

[CITED: Multiple sources verified — req.text() is the correct pattern for Next.js App Router]

```typescript
// src/app/api/stripe/webhook/route.ts
import { stripe } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'  // Required — Edge runtime blocks raw body access

export async function POST(request: NextRequest) {
  const body = await request.text()  // MUST call .text() before .json() [CITED]
  const sig = request.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Idempotency: check if event already processed [CITED: docs.stripe.com/webhooks]
  const { data: existing } = await supabase
    .from('stripe_webhook_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle()
  if (existing) return NextResponse.json({ received: true })

  // Record before processing (prevents duplicate on crash-and-retry)
  await supabase.from('stripe_webhook_events').insert({ stripe_event_id: event.id })

  // Handle lifecycle events
  switch (event.type) {
    case 'checkout.session.completed': { /* upsert subscriptions row */ break }
    case 'customer.subscription.updated': { /* update plan, status, period */ break }
    case 'customer.subscription.deleted': { /* mark cancelled */ break }
    case 'invoice.payment_failed': { /* flag payment_failed, send email */ break }
    case 'customer.subscription.trial_will_end': { /* send trial-ending email */ break }
  }

  return NextResponse.json({ received: true })
}
```

### Pattern 3: Entitlement Helper (reads local DB only — never queries Stripe at request time)

```typescript
// src/lib/stripe/entitlement.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type EntitlementStatus = {
  planKey: 'starter' | 'pro' | 'scale' | 'none'
  planSeats: number
  activeSeats: number
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'none'
  aiCaps: AiCaps          // from PLAN_CAPS[planKey]
  aiUsageThisMonth: AiUsageAggregate   // from ai_usage table
  softCapBreached: boolean   // >80% of any cap
  hardCapBreached: boolean   // >100% of any cap
}

export async function getEntitlement(orgId: string): Promise<EntitlementStatus> {
  // Single query: subscriptions + current month ai_usage aggregate
  // Returns cached result (short TTL acceptable since subscriptions change rarely)
}
```

### Pattern 4: Super-Admin Gate (layout.tsx)

```typescript
// src/app/admin/layout.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  // Check super_admin flag in raw_app_meta_data (set via Supabase Dashboard SQL)
  // NEVER expose this check client-side; RSC only.
  const isSuperAdmin = user.app_metadata?.super_admin === true
  if (!isSuperAdmin) redirect('/')   // Silently redirect — do not reveal /admin exists

  return <>{children}</>
}
```

**How to set super_admin:** Run in Supabase Dashboard SQL editor:
```sql
update auth.users
  set raw_app_meta_data = raw_app_meta_data || '{"super_admin": true}'::jsonb
  where email = 'alasdairj8@gmail.com';
```

### Pattern 5: Brand Colour Injection (XSS-safe)

[VERIFIED: OWASP XSS prevention + ApostropheCMS CVE GHSA-97v6-998m-fp4g as negative example]

```typescript
// In (public)/apply/[orgSlug]/page.tsx RSC
const HEX_RE = /^#[0-9a-fA-F]{6}$/

function safeHex(raw: string | null, fallback: string): string {
  return raw && HEX_RE.test(raw) ? raw : fallback
}

const brandPrimary = safeHex(org.brand_primary, '#0A3D5C')  // Altus Midnight default
const brandSecondary = safeHex(org.brand_secondary, '#5DCAA5') // Altus Mint default

// Inject as inline CSS custom properties on a wrapper div
// style prop in RSC is sanitised by React's escaping — safe for string values
// DO NOT inject into a <style> tag (CSS context escape risk)
<div style={{ '--brand-primary': brandPrimary, '--brand-secondary': brandSecondary } as React.CSSProperties}>
  {children}
</div>
```

**Critical:** Validate hex server-side before rendering. The ApostropheCMS CVE (2024) demonstrates that injecting unvalidated user values into CSS contexts — even via custom properties — can enable XSS. Strict hex-only regex at the DB write boundary (schema check + Zod) and again at render time.

### Pattern 6: CSV Import (server action + PapaParse)

```typescript
// src/app/(app)/candidates/import/actions.ts
'use server'
import Papa from 'papaparse'

export async function importCandidatesAction(formData: FormData) {
  const file = formData.get('csv') as File
  const text = await file.text()

  const { data, errors } = Papa.parse<Record<string, string>>(text, {
    header: true,           // Use first row as column names
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  })

  // Column mapping: normalize common variations
  // e.g., "first name" | "firstname" | "name" → "full_name"
  // "email address" | "e-mail" → "email"

  for (const row of data) {
    const email = row.email?.trim().toLowerCase()  // Lowercase per D-12 + 260604-cn5 fix
    if (!email) continue
    // Call existing candidate-creation path (upsert by lowercased email = dedupe)
    await upsertCandidateByEmail({ email, ...mappedFields })
  }
}
```

### Anti-Patterns to Avoid

- **Querying Stripe at request time for entitlements:** Every `/api/stripe/*` call takes 100–500ms. The local `subscriptions` table is the source of truth; read it.
- **Calling Stripe from Inngest without idempotency keys:** All Stripe API calls in background jobs must pass `{ idempotencyKey: event.id }` to prevent double-charges on retry.
- **Injecting brand colours into `<style>` tags:** CSS context injection is an XSS vector (ref: ApostropheCMS CVE). Use inline `style` attribute with validated hex strings only.
- **Putting /admin in PUBLIC_PATHS:** Admin is authenticated + role-gated, not public. The middleware redirect loop does not apply because the user IS authenticated; the role check is in the layout, not middleware.
- **Using `request.json()` before `request.text()` in webhook handler:** The parsed body does not match the original byte stream; Stripe signature verification fails.
- **Updating Stripe subscription quantity on every invite:** Race conditions + retry complexity. Use local seat enforcement only; update Stripe quantity only at explicit plan-change events.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PCI-compliant card capture | Custom card input form | Stripe Checkout (hosted) | PCI DSS scope; raw card handling in-app is a compliance disaster |
| Subscription lifecycle state machine | Custom trial/renewal/cancel logic | Stripe webhooks → local table | Stripe handles edge cases: payment retry, dunning, proration |
| Self-serve billing UI | Custom upgrade/downgrade/cancel screens | Stripe Customer Portal | Stripe Portal handles proration, invoice history, payment method update |
| CSV header detection | Custom header-sniffing logic | PapaParse `{ header: true }` | PapaParse handles BOM, encoding, quoting, duplicate headers |
| Hex colour validation at DB level | Application-level only | DB CHECK constraint + Zod | Defence in depth; DB constraint catches any bypass |

**Key insight:** Stripe's hosted surfaces (Checkout, Portal) exist specifically because billing UX is full of edge cases that cost months to get right. The ~30 minutes of integration effort buys years of maintenance-free billing.

---

## Common Pitfalls

### Pitfall 1: Webhook Race — Customer Created Before Webhook Arrives
**What goes wrong:** The signup flow creates a Stripe customer and redirects to the dashboard before the `checkout.session.completed` webhook has fired. The org has no subscription row yet.
**Why it happens:** Webhooks are async; typical delivery is 1–30 seconds after Checkout completion.
**How to avoid:** On `/stripe/return` success redirect, show a "Setting up your account…" skeleton that polls `subscriptions` table with a short timeout (5s). Alternatively, the `checkout.session.completed` handler can be fast-tracked via the session_id returned in the redirect URL — the app can retrieve the session from Stripe directly on the success page to bootstrap immediately, then let the webhook confirm.
**Warning signs:** New orgs get `status: 'none'` entitlement immediately after signup.

### Pitfall 2: Webhook Idempotency Gap (Stripe delivers twice)
**What goes wrong:** Stripe retries a webhook that your handler returned a 500 for. You insert a duplicate subscription row or send the "trial started" email twice.
**Why it happens:** Stripe guarantees at-least-once delivery, not exactly-once.
**How to avoid:** Insert `stripe_event_id` into a `stripe_webhook_events` table with a UNIQUE constraint BEFORE processing the event. Check existence first; skip if found. [CITED: docs.stripe.com/webhooks]
**Warning signs:** Duplicate emails; subscription rows with duplicate `stripe_subscription_id`.

### Pitfall 3: Middleware Not Updated for New Public Routes
**What goes wrong:** `/api/stripe/checkout`, `/api/stripe/webhook`, `(marketing)/*`, `/docs/*`, `/status` get intercepted by `updateSession()` and 307'd to `/sign-in`.
**Why it happens:** Precedent: 260527-x2q (P0 invite-flow fix), 260528-0rd (PWA fix) — both were middleware PUBLIC_PATHS omissions.
**How to avoid:** Simultaneously with creating each new route, add it to `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts`. Do this as Wave 0 hardening, not as a follow-up.
**Warning signs:** Webhook handler receives 307 instead of reaching the route; Stripe logs show redirects.

### Pitfall 4: `request.text()` vs `request.json()` in Webhook Handler
**What goes wrong:** Stripe signature verification throws "No signatures found matching the expected signature."
**Why it happens:** Calling `.json()` first causes the runtime to re-serialize the body; the byte stream changes and the HMAC doesn't match.
**How to avoid:** Always `const body = await request.text()` → verify → `const event = JSON.parse(body)`. Export `runtime = 'nodejs'` on the route. [CITED: Next.js App Router + Stripe webhook guides]

### Pitfall 5: XSS via Unvalidated Brand Colours
**What goes wrong:** A malicious org owner stores `; color: red; background: url(...)` or `</style><script>` as their brand colour.
**Why it happens:** CSS property value injection is a known XSS vector (see: ApostropheCMS CVE GHSA-97v6-998m-fp4g).
**How to avoid:** Validate at write time with Zod `z.string().regex(/^#[0-9a-fA-F]{6}$/)` in the settings server action AND add a DB CHECK constraint in the migration. Validate again at render time before injecting into `style` attribute. Never inject into `<style>` tag. React's JSX escaping protects `style={{ ... }}` object values.
**Warning signs:** Brand colour field accepts non-hex values; colours rendered without server-side re-validation.

### Pitfall 6: Seat Count Drift (local vs Stripe)
**What goes wrong:** A member is removed from the org but the Stripe subscription quantity isn't updated. Or vice versa.
**Why it happens:** Seat count is stored locally (in `subscriptions.plan_seats`); it's enforced at invite time but not decremented on remove.
**How to avoid:** For v1, seat count from Stripe is advisory only — the enforcing field is `subscriptions.plan_seats` from the plan definition, not a live seat count. The plan says "3 seats max"; the local `users` count is the live enforcement check at invite time. No Stripe quantity sync needed.

### Pitfall 7: Stripe Build-Time Env Failure
**What goes wrong:** `pnpm build` fails because `STRIPE_SECRET_KEY` is declared as required in `env.ts` but not set in local dev or Vercel Preview.
**Why it happens:** `@t3-oss/env-nextjs` validates at module load. See the CLAUDE.md note that `pnpm build` fails locally on missing env vars.
**How to avoid:** Declare all Stripe vars as `.optional()` in `env.ts` so the app boots without them. The Stripe client in `src/lib/stripe/client.ts` should fail-closed at call time (throw a clear "Stripe not configured" error when the key is absent), not at module load. Stripe features show "Billing not configured" in dev; the rest of the app works.

### Pitfall 8: /admin Reachable via Direct URL Without Gate
**What goes wrong:** Any authenticated user navigates to `/admin` and gets access.
**Why it happens:** Middleware only checks authentication (is the user logged in?), not role. The super_admin gate is in the layout, which is Next.js RSC code — it only runs when the route is rendered.
**How to avoid:** The layout gate is sufficient IF it redirects to `/` immediately (not 403 — do not reveal the route exists). Middleware does not need modification; the layout gate is the security boundary. Never add `/admin` to PUBLIC_PATHS.

---

## Code Examples

### Stripe Singleton Client

```typescript
// src/lib/stripe/client.ts
import 'server-only'
import Stripe from 'stripe'
import { env } from '@/lib/env'

// Fail-closed: if STRIPE_SECRET_KEY is absent (dev without Stripe),
// individual call sites get a clear error rather than a boot crash.
export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-06-30',  // Pin to current API version [ASSUMED — verify at install]
      typescript: true,
    })
  : null as unknown as Stripe  // Callers must check env.STRIPE_SECRET_KEY before calling
```

### Plan Definitions

```typescript
// src/lib/stripe/plans.ts
// AI caps are per-seat/month. Match pricing doc exactly.
export const PLANS = {
  starter: {
    label: 'Starter',
    pricePence: 5900,    // £59/seat/mo
    seats: 3,
    aiCaps: {
      matchScores: 200,       // per seat/mo [ASSUMED — verify against pricing doc]
      cvParses: 50,           // per seat/mo [ASSUMED]
      writingCalls: 100,      // per seat/mo [ASSUMED]
      searches: 500,          // per seat/mo [ASSUMED]
      specMinutes: 60,        // per seat/mo [ASSUMED]
    },
  },
  pro: {
    label: 'Pro',
    pricePence: 8900,    // £89/seat/mo — DEFAULT
    seats: 10,
    aiCaps: {
      matchScores: 500,
      cvParses: 150,
      writingCalls: 300,
      searches: 2000,
      specMinutes: 180,
    },
  },
  scale: {
    label: 'Scale',
    pricePence: 12900,   // £129/seat/mo
    seats: 99,           // effectively unlimited for v1
    aiCaps: {
      matchScores: 2000,
      cvParses: 500,
      writingCalls: 1000,
      searches: 10000,
      specMinutes: 600,
    },
  },
} as const

export type PlanKey = keyof typeof PLANS

// Stripe Price IDs — set from env vars; founder creates products in Stripe Dashboard
export const PLAN_PRICE_IDS: Record<PlanKey, string> = {
  starter: process.env.STRIPE_PRICE_STARTER ?? '',
  pro: process.env.STRIPE_PRICE_PRO ?? '',
  scale: process.env.STRIPE_PRICE_SCALE ?? '',
}
```

**NOTE on AI caps:** The exact cap numbers above are `[ASSUMED]` — they must be validated against `docs/pricing-overheads-breakeven-2026-06-04.md` section 5 guardrails table before implementing. That document defines the margin-protecting caps; the planner should treat these numbers as placeholders.

### Subscriptions Table Migration (minimal shape)

```sql
-- New migration: 20260604_phase5_saas_billing.sql
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan_key text not null default 'none',   -- 'starter'|'pro'|'scale'|'none'
  plan_seats int not null default 0,
  status text not null default 'none',     -- 'trialing'|'active'|'past_due'|'cancelled'|'none'
  trial_end timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Also add to organizations:
alter table public.organizations
  add column stripe_customer_id text unique,
  add column brand_primary text check (brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  add column brand_secondary text check (brand_secondary ~ '^#[0-9a-fA-F]{6}$');

-- Idempotency table for webhooks:
create table public.stripe_webhook_events (
  stripe_event_id text primary key,
  created_at timestamptz not null default now()
);

-- RLS: subscriptions readable by own org; stripe_webhook_events service-role only
alter table public.subscriptions enable row level security;
create policy "org_members_read_own_subscription"
  on public.subscriptions for select
  using (organization_id = public.current_organization_id());
-- Writes via service-role only (webhook handler uses createServiceClient())
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `request.body` for Stripe webhooks in Next.js Pages Router | `request.text()` in App Router before any JSON parsing | Signature verification works correctly |
| Stripe quantity-per-seat real-time sync | Org-level tier price + local seat enforcement | Eliminates race conditions; simpler to reason about |
| Storing colours in full CSS values | Strict hex-only stored values with CSS custom property injection | Eliminates CSS injection XSS vector |
| Separate marketing site hosting | In-app (marketing) route group | Eliminates CDN + DNS complexity; single Vercel deployment |

**Deprecated/outdated:**
- Pages Router `next.config.js` `api.bodyParser: false` pattern: Not needed in App Router; `request.text()` handles it natively.
- `stripe.webhooks.constructEventAsync()`: Older async variant; `constructEvent()` is synchronous and correct for Node.js runtime.

---

## Existing Codebase Inventory (CRITICAL — what to reuse)

This phase builds on substantial existing infrastructure. The planner MUST use these files rather than rebuilding.

| Asset | File | What Phase 5 Extends |
|-------|------|----------------------|
| Org bootstrap on signup | `src/app/auth/callback/route.ts` | No change — SAAS-01 adds Checkout redirect AFTER callback completes |
| Welcome checklist | `src/app/(app)/_dashboard/welcome-checklist.tsx` | Extend steps array to include "Set up billing" and "Import candidates" |
| AI usage metering | `src/app/(app)/settings/usage/page.tsx` + `ai_usage` table | Admin dashboard reads same table cross-org via service-role |
| Invite enforcement hook | `src/app/(app)/settings/team/actions.ts::inviteMemberAction` | Add seat check BEFORE the service-role escalation (step 4.5 in VERIFICATION R8 ordering) |
| Public route group | `src/app/(public)/apply/[orgSlug]/page.tsx` | BRAND-01 reads brand colours from org row; same service-role fetch pattern |
| Organizations DB helper | `src/lib/db/organizations.ts` | Extend `OrganizationRow` type with `stripe_customer_id`, `brand_primary`, `brand_secondary` |
| Email sending | `src/lib/email/resend.ts` + `src/lib/email/render.ts` | Reuse for trial-end, payment-failed, cap-warning emails |
| Service client | `src/lib/supabase/service.ts` | Reuse in webhook handler + admin routes |
| Env validation | `src/lib/env.ts` | Add Stripe env vars (all `.optional()` for build isolation) |
| Middleware public paths | `src/lib/supabase/middleware.ts` | Add `/api/stripe/*`, `(marketing)` routes, `/docs`, `/status` to PUBLIC_PATHS |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | AI cap numbers (200/500/2000 match-scores per tier) | Code Examples — Plan Definitions | Caps don't match pricing doc → margin not protected |
| A2 | Stripe API version `2025-06-30` is current | Code Examples — Stripe Client | Outdated API version causes type errors or missing features |
| A3 | `user.app_metadata.super_admin` is readable from RSC via `supabase.auth.getUser()` | Pattern 4 — Admin Gate | Admin gate does not work → security hole |
| A4 | `papaparse` server-side usage is tree-shakeable and compatible with Next.js server actions | Standard Stack | Import fails in server action context |
| A5 | Stripe Customer Portal can be configured for GBP pricing in test mode | BILL-01 | Portal shows USD; founder must configure GBP currency in Stripe Dashboard |

**Resolving A1:** Planner must cross-reference `docs/pricing-overheads-breakeven-2026-06-04.md` section 5 guardrails before writing the `PLANS` constant. The exact cap numbers are not in the pricing doc's table — they will need founder input.

**Resolving A3:** The Supabase JWT contains `app_metadata` in its claims; `supabase.auth.getUser()` returns this in the `user.app_metadata` field. This is a standard Supabase pattern (confirmed by makerkit.dev/docs/next-supabase-turbo/admin/adding-super-admin). Confidence: HIGH.

---

## Open Questions

1. **Exact AI-usage cap numbers per tier**
   - What we know: Tiers are Starter/Pro/Scale with prices £59/£89/£129. Usage must be metered via `ai_usage` table.
   - What's unclear: The exact per-seat/month cap numbers for match-scores, CV parses, writing calls, searches, spec minutes. The pricing doc discusses the guardrail concept but not the specific numbers.
   - Recommendation: Founder provides these before `PLANS` constant is written. Planner should stub with `[CAP_TBD]` placeholders.

2. **Stripe Price IDs — test-mode products**
   - What we know: Founder must create products in Stripe Dashboard before the checkout flow works.
   - What's unclear: Will the founder create these before or after the code is deployed?
   - Recommendation: Code uses env var references (`STRIPE_PRICE_STARTER`, etc.); checkout feature is conditionally shown only when `env.STRIPE_SECRET_KEY` is set. Phase ships without live keys working; founder wires keys when ready.

3. **Customer Portal GBP configuration**
   - What we know: Stripe Customer Portal must be configured per Stripe Dashboard settings.
   - What's unclear: GBP currency and specific product features (upgrade/downgrade/cancel) must be enabled by founder in the Stripe Dashboard before Portal works.
   - Recommendation: Document as a "founder action required" in the plan; build the Portal redirect link regardless.

4. **Sample data seed contents**
   - What we know: D-12 says "optional sample-data seed so an empty org isn't intimidating."
   - What's unclear: How many records? What sectors/roles? Real names or synthetic?
   - Recommendation: Claude's discretion — 3–5 synthetic candidates (no real PII), 2 clients, 1 open job. Planner specifies, executor implements.

5. **Marketing site content**
   - What we know: D-15 says landing, pricing, features pages in `(marketing)` route group.
   - What's unclear: Actual copy, feature list structure, how the pricing page displays the three tiers.
   - Recommendation: Claude's discretion — build the skeleton with placeholder copy; founder fills in real copy. Pricing page renders the `PLANS` constant directly.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Stripe SDK, papaparse | ✓ | System Node (pnpm managed) | — |
| pnpm | Package install | ✓ | Present (pnpm-lock.yaml) | — |
| Stripe account + test keys | BILL-01 | ✗ (founder action) | — | Build Stripe code; feature hidden until keys set |
| Stripe test-mode Price IDs | BILL-01 | ✗ (founder action) | — | Code uses env vars; Checkout disabled if unset |
| Stripe Webhook endpoint registration | BILL-01 | ✗ (founder action) | — | Use Stripe CLI for local dev: `stripe listen --forward-to localhost:3000/api/stripe/webhook` |
| Resend API key | Trial/cap emails | ✓ (already wired) | Configured | — |

**Missing dependencies with no fallback:**
- None that block code shipping. All Stripe dependencies are founder-supplied at deploy time; code builds and ships without them.

**Missing dependencies with fallback:**
- Stripe keys: app ships with billing features hidden behind env-presence checks; founder wires keys pre-launch.

---

## Validation Architecture

> `nyquist_validation` is explicitly `false` in `.planning/config.json`. Section omitted.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Supabase auth; super_admin gate in RSC layout |
| V3 Session Management | yes | Existing cookie-based sessions; webhook handler has no session (signature-verified) |
| V4 Access Control | yes — CRITICAL | super_admin flag check before any service-role cross-org read; seat enforcement in Server Action |
| V5 Input Validation | yes | Zod on all webhook payloads; hex-only regex on brand colours; CSV column sanitisation |
| V6 Cryptography | partial | Stripe handles card data; webhook signature is HMAC-SHA256 (Stripe managed) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CSS custom property injection via brand colours | Tampering + XSS | Hex-only `/^#[0-9a-fA-F]{6}$/` at write + render; DB CHECK constraint |
| Webhook replay / forged events | Spoofing | `stripe.webhooks.constructEvent()` HMAC verification + idempotency table |
| /admin route enumeration | Information Disclosure | Redirect to `/` (not 403) on non-super-admin; do not reveal admin route exists |
| Service-role escape from tenant routes | Elevation of Privilege | `createServiceClient()` only in: webhook handler, Inngest functions, `/admin` RSC (all server-only) |
| Trial abuse (sign up, trial, churn, re-sign) | Fraud | Card required upfront (D-03); same email = existing customer lookup via Stripe customer metadata |
| CSV import with malicious content | Injection | PapaParse parses to strings only; existing candidate-creation server action validates all fields via Zod before DB write |
| Stripe Price ID tampering | Tampering | Price IDs come from server env vars, never from client input |
| Seat limit bypass (invite without subscription) | Abuse | Invite action checks `subscriptions` table server-side before allowing invite |

**Super-admin access pattern — critical constraint:**

The `/admin` service-role reads are the only cross-tenant read path in the app. They MUST follow this exact ordering:
1. `createClient()` → `getUser()` — establishes identity
2. Check `user.app_metadata.super_admin === true` — gate BEFORE any service-role call
3. `createServiceClient()` — only after gate passes

If the gate check is absent or bypassed, every org's data is exposed. This is the single highest-severity security item in Phase 5. The planner should treat this as a Wave 0 prerequisite — get the admin gate correct before any admin functionality is built.

---

## Sources

### Primary (HIGH confidence)
- [docs.stripe.com/payments/checkout/free-trials](https://docs.stripe.com/payments/checkout/free-trials) — trial + card upfront configuration
- [docs.stripe.com/billing/subscriptions/webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) — webhook event lifecycle
- [docs.stripe.com/customer-management/integrate-customer-portal](https://docs.stripe.com/customer-management/integrate-customer-portal) — Portal session creation
- [github.com/stripe/stripe-node](https://github.com/stripe/stripe-node) — official SDK (22.2.0 verified)
- [papaparse.com](https://www.papaparse.com/) — PapaParse official (5.5.3 verified)
- `src/app/auth/callback/route.ts` — existing org bootstrap (read directly)
- `src/lib/supabase/middleware.ts` — PUBLIC_PATHS pattern (read directly)
- `src/lib/stripe/service.ts` + `src/lib/ai/claude.ts` — service-role and entitlement patterns (read directly)
- GHSA-97v6-998m-fp4g — ApostropheCMS CSS injection CVE (brand colour XSS prevention)
- `docs/pricing-overheads-breakeven-2026-06-04.md` — pricing tiers (read directly)

### Secondary (MEDIUM confidence)
- [dev.to/jonathan_diniz — Next.js 15 + Supabase + Stripe](https://dev.to/jonathan_diniz_cee738f10e/how-i-wired-stripe-subscriptions-to-supabase-in-nextjs-15-the-parts-tutorials-skip-2b9l) — webhook raw body pattern
- [makerkit.dev/docs/next-supabase-turbo/admin/adding-super-admin](https://makerkit.dev/docs/next-supabase-turbo/admin/adding-super-admin) — super_admin flag via raw_app_meta_data
- [hookrelay.io/guides/nextjs-webhook-stripe](https://www.hookrelay.io/guides/nextjs-webhook-stripe) — complete webhook guide with idempotency
- [makerkit.dev/blog/tutorials/per-seat-stripe-subscriptions](https://makerkit.dev/blog/tutorials/per-seat-stripe-subscriptions) — per-seat modelling tradeoffs

### Tertiary (LOW confidence)
- WebSearch results on marketing route group structure — standard Next.js pattern, no single authoritative source

---

## Metadata

**Confidence breakdown:**
- Stripe integration patterns: HIGH — official Stripe docs confirmed, SDK verified on npm registry
- Webhook raw body handling: HIGH — multiple independent sources confirm `request.text()` pattern for Next.js App Router
- Brand colour XSS prevention: HIGH — confirmed by OWASP + real CVE as negative example
- Super-admin gate via app_metadata: HIGH — Supabase standard pattern (makerkit reference)
- AI cap numbers per tier: LOW — values are [ASSUMED]; must be confirmed against pricing doc by founder
- Stripe API version string: LOW — `2025-06-30` is an assumption; verify `stripe --version` after install

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (Stripe API versioning is stable; 30-day window is safe)
