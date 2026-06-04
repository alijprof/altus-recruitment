# Phase 5: SaaS Shell - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Make Altus ready for a **second (and Nth) paying customer who onboards themselves** — no manual hand-holding by the founder. Five requirements (ROADMAP.md / REQUIREMENTS.md):

- **SAAS-01** — Self-service signup creates a new organisation + onboarding (tour, sample data, candidate CSV import).
- **BILL-01** — Stripe subscription + billing portal; tiered per-seat plans; plan limits enforced.
- **BRAND-01** — Per-org branding (logo + colours) on the public careers/apply site.
- **ADMIN-01** — Lean super-admin operations tooling (per-tenant cost/billing dashboard + plan/trial overrides). **Impersonation explicitly descoped for v1** (see D-13 + Deferred).
- **MARKETING-01** — Public marketing site + documentation + status page (in-app).

This phase is NOT required for the anchor customer (they are hand-onboarded and can be invoiced directly). It exists to unlock self-serve customer #2+.

> **HARD EXTERNAL DEPENDENCY (founder action required):** Stripe billing needs the founder's **own Stripe account + API keys** (test + live), Products/Prices created, Customer Portal configured, and a webhook endpoint registered. **Build everything against Stripe TEST mode**; live keys are wired by the founder before go-live. Plan must isolate Stripe so the rest of the phase ships without live keys.
</domain>

<decisions>
## Implementation Decisions

### Signup & access (SAAS-01)
- **D-01:** **Open self-serve signup.** Anyone can sign up, create their org, and start using the product in minutes. (The app already bootstraps a fresh org for a non-invited signup via `/auth/callback`; this phase adds card capture + onboarding on top — it does NOT rebuild org creation.)
- **D-02:** Reuse existing abuse guards (email verification, the apply-form rate-limit / Turnstile patterns) on the public signup path. No open relay for spam orgs.

### Payment & trial (BILL-01)
- **D-03:** **Card required upfront at signup**, captured via **Stripe Checkout** (hosted — PCI-safe, no raw card handling in-app). A **14-day free trial runs on the captured card** and auto-converts to paid unless cancelled. (Chosen over no-card trial: higher intent, near-zero involuntary churn at trial end.)
- **D-04:** Self-serve plan management (upgrade / downgrade / cancel) via the **Stripe Customer Portal** (hosted). No bespoke billing UI in v1.
- **D-05:** Subscription lifecycle (trial start/end, payment success/fail, cancel, plan change) driven by **Stripe webhooks** → a local `subscriptions`/billing table is the source of truth the app reads for entitlements.

### Billing structure & plan limits (BILL-01)
- **D-06:** **Per-seat tiers, AI fully bundled** — **Starter £59 / Pro £89 (default) / Scale £129 per seat/month**, aligned to `docs/pricing-overheads-breakeven-2026-06-04.md` (which matches competitor norms — Firefish/Vincere are per-seat). Seats = active org members.
- **D-07:** Each tier carries **AI-usage caps** (match-scores, CV parses, writing/summarisation calls, searches, spec-call minutes — per seat/month) per the pricing doc's guardrail table. Caps are the margin protection.
- **D-08:** **Enforcement = soft cap → hard behaviour + overage** (NOT a hard wall): at 80% of cap, in-app banner + email; at 100%, on-demand match-scoring falls back to **cached-only / overnight queue** and CV parsing **queues** (never blocks onboarding). Overage pricing ~£0.05/extra match-score, ~£0.04/extra CV parse. **Meter via the existing `ai_usage` table** (org_id, model, tokens, purpose) — no new metering plumbing.
- **D-09:** Seat count enforced at **invite time** (block adding a member beyond the plan's seat allowance until they upgrade/add a seat).

### Per-org branding (BRAND-01)
- **D-10:** Branding = **logo + brand colours** applied to the **public apply/careers site** (`(public)/apply/[orgSlug]`). Reuse the existing **`organizations.logo_url`**; add a small set of brand-colour fields to `organizations`. Set from `/settings`. Org-scoped, RLS-safe.
- **D-11:** Scope is the public-facing apply/careers surface only (where a candidate sees the agency's brand). Do NOT re-skin the whole authenticated app per-org in v1.

### Onboarding (SAAS-01)
- **D-12:** Reuse the existing **first-run welcome checklist** (from quick-task 260603-gdz). Add: an **optional sample-data seed** (so an empty org isn't intimidating) and a **candidate CSV import** (column-mapping → the existing candidate-creation path; **dedupe by lowercased email** — the write-boundary lowercasing fix from 260604-cn5 makes this safe).

### Admin console — LEAN (ADMIN-01)
- **D-13:** Build the **lean operations console** at `/admin`, gated to the **platform owner (super-admin)** via an allowlist (super_admin flag / env allowlist — NOT a customer-visible feature). It provides: (a) **per-tenant AI-cost + billing/subscription dashboard** (reads `ai_usage` + Stripe billing state — this is the founder's margin-protection view); (b) **plan-limit + trial overrides** (extend a trial, bump a cap) without a code deploy.
- **D-14:** **No impersonation and no audit-logging layer in v1** — descoped deliberately (founder will support via screen-share at low customer counts; impersonation is cheap to add later). Cross-org reads in `/admin` use **service-role behind the super-admin gate** — a deliberate, tightly-gated cross-tenant read path that must be reachable ONLY by the super-admin (never via normal RLS-scoped routes).

### Marketing & docs (MARKETING-01)
- **D-15:** **All in-app, no separate hosting** (cost-conscious): a public `(marketing)` route group (landing / pricing / features), an in-app `/docs` documentation area, and a **simple status page** (lightweight/static or a thin uptime indicator — fancy incident tooling deferred).

### Claude's Discretion
- Exact Stripe data model (customers/subscriptions/prices tables), webhook event handling, and entitlement-resolution code.
- Route/folder structure for `(marketing)`, `/docs`, `/admin`.
- CSV-parsing approach + column-mapping UX; sample-data seed contents.
- Precise brand-colour field set + how they cascade into the apply-site theme.
- Status-page mechanism (static vs minimal live check).
- Whether seat-based pricing uses Stripe per-seat quantities or org-level price tiers (planner picks the cleanest Stripe modelling).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pricing / tiers / AI-usage caps (drives BILL-01)
- `docs/pricing-overheads-breakeven-2026-06-04.md` — tier prices (Starter £59 / Pro £89 / Scale £129), the AI-usage caps + soft/hard/overage guardrail model, and the per-tenant cost view rationale for ADMIN-01.
- `docs/cost-and-pricing-analysis.md` — detailed marginal-cost model + the `ai_usage`-as-meter guardrail design.

### Scope / requirements
- `.planning/ROADMAP.md` §"Phase 5: SaaS Shell" — phase goal + success criteria.
- `.planning/REQUIREMENTS.md` — SAAS-01, BILL-01, BRAND-01, ADMIN-01, MARKETING-01.

### Existing patterns to follow
- `CLAUDE.md` — mutation-error-surfacing rule, no-PII-to-Sentry, RLS-as-tenancy-authority, server-only must not import browser clients, no `await` in Supabase subscriber callbacks. All bind this phase (esp. Stripe webhooks + the cross-tenant /admin path).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Org bootstrap on signup:** `src/app/auth/callback/route.ts` already creates a fresh org for a non-invited signup (and short-circuits to join an existing org when an invite cookie is present). SAAS-01 adds card + onboarding around this, not a rebuild.
- **Welcome checklist:** `src/app/(app)/_dashboard/welcome-checklist.tsx` + `getOnboardingCounts` (quick-task 260603-gdz) — the onboarding spine to extend.
- **`organizations.logo_url`:** migration `20260518202000_organizations_logo_url.sql` already exists — BRAND-01 extends with colour fields.
- **AI cost metering:** the `ai_usage` table (org_id, model, input/output tokens, purpose) + `record_ai_usage()` + the `/settings/usage` page — the meter for BILL-01 caps and the data source for the ADMIN-01 cost dashboard. No new metering needed.
- **Invitations / team:** `src/app/(app)/settings/team/*` + `org_invitations` + `accept_invitation` RPC — the seat-enforcement hook (D-09) lives at invite time here.
- **Public route group:** `src/app/(public)/apply/[orgSlug]/*` — where BRAND-01 branding renders; `(marketing)` will be a sibling public group.
- **Email:** `src/lib/email/*` (Resend, branded templates) — reuse for trial-ending / payment-failed / cap-warning emails.

### Established Patterns
- **RLS is the tenancy authority** via `current_organization_id()`. The ADMIN-01 cross-org dashboard is the ONE deliberate exception — must use service-role behind a hard super-admin gate, never a normal RLS route.
- **Mutations are Server Actions; route handlers only for webhooks/public APIs.** Stripe webhooks = a route handler (`src/app/api/stripe/webhook`), signature-verified.
- **Migrations append-only;** new tables (subscriptions/billing, super_admin flag, brand colours) = new migrations, manual `supabase db push` (per memory).

### Integration Points
- **Stripe** (new dependency): Checkout (signup), Customer Portal (self-serve), webhooks (lifecycle), entitlement reads. Isolated behind test-mode keys.
- **Entitlement gate**: a server-side helper that resolves an org's plan + caps from the local subscription table and enforces seat/usage limits across the app.
- **`/admin`** (new): super-admin-gated, service-role cross-org reads.
- **`(marketing)` + `/docs`** (new public surfaces).
</code_context>

<specifics>
## Specific Ideas

- Tier prices and AI-usage caps must match `docs/pricing-overheads-breakeven-2026-06-04.md` exactly (Starter £59 / Pro £89 / Scale £129; Pro is the default/recommended tier).
- Pitch the anchor on Pro (£89/seat) as a "founding price" — not a Phase-5 build item, but the plan's copy/pricing page should make Pro the default highlighted tier.
- Keep it "a simple, straightforward platform" (founder's words) — favour hosted Stripe surfaces (Checkout + Portal) over bespoke billing UI, and the lean admin console over enterprise support tooling.
</specifics>

<deferred>
## Deferred Ideas

- **Super-admin impersonation ("log in as a customer") + full audit-logging layer** — descoped from v1 (D-14). Add when customer count makes screen-share support painful; the audit layer matters for enterprise/compliance trust later. Cheap to bolt on.
- **Freemium / permanently-free tier** — rejected in favour of card-upfront trial (D-03).
- **Annual billing / annual discount** — v2 billing nicety.
- **Per-org full app re-skinning** (beyond the public apply site) — out of BRAND-01 v1 scope (D-11).
- **Rich status page / incident management** — v1 ships a simple status indicator only (D-15).

*Discussion stayed within phase scope; no unrelated todos were folded.*

</deferred>

---

*Phase: 5-SaaS Shell*
*Context gathered: 2026-06-04*
