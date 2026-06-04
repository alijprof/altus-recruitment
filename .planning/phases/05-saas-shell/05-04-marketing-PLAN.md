---
phase: 05-saas-shell
plan: 04
type: execute
wave: 1
depends_on: ["05-00"]
files_modified:
  - src/app/(marketing)/layout.tsx
  - src/app/(marketing)/welcome/page.tsx
  - src/app/(marketing)/pricing/page.tsx
  - src/app/(marketing)/features/page.tsx
  - src/app/docs/layout.tsx
  - src/app/docs/page.tsx
  - src/app/docs/[slug]/page.tsx
  - src/app/docs/content.ts
  - src/app/status/page.tsx
  - src/components/marketing/pricing-table.tsx
  - src/components/marketing/marketing-nav.tsx
autonomous: true
requirements: [MARKETING-01]

must_haves:
  truths:
    - "A logged-out visitor can read a marketing landing, a pricing page, and a features page without authenticating"
    - "GET /welcome, /pricing, /features, /docs, /status with no session returns HTTP 200 (not 307 to /sign-in)"
    - "The pricing page renders the three tiers (Pro highlighted as default) straight from the PLANS constant"
    - "A visitor can read in-app documentation under /docs"
    - "A visitor can see a simple status page reflecting whether the app + DB are reachable"
    - "The pricing CTA starts the signup/checkout flow for the chosen tier"
  artifacts:
    - path: "src/app/(marketing)/pricing/page.tsx"
      provides: "Public pricing page rendering all three tiers from PLANS"
      contains: "PLANS"
    - path: "src/app/status/page.tsx"
      provides: "Simple status page with a DB health probe"
      contains: "status"
    - path: "src/app/docs/[slug]/page.tsx"
      provides: "In-app documentation pages"
      exports: ["default"]
  key_links:
    - from: "src/app/(marketing)/pricing/page.tsx"
      to: "PLANS"
      via: "render tiers + price from the constant"
      pattern: "PLANS"
    - from: "src/components/marketing/pricing-table.tsx"
      to: "/sign-up"
      via: "tier CTA initiates signup/checkout"
      pattern: "/sign-up|planKey"
---

<objective>
The public marketing surface (MARKETING-01): a `(marketing)` route group (landing at `/welcome` + pricing + features), an in-app `/docs` documentation area, and a simple `/status` page — all in-app, no separate hosting (D-15). The pricing page renders the three tiers straight from the PLANS constant so prices never drift from billing.

This is a thin vertical slice: public pages a prospect can read, with the pricing CTA wired into the signup/checkout flow built in 05-01. The marketing landing route (`/welcome`) and all public-path allowlisting were PRE-DECIDED and applied in 05-00 (Wave 0) — this plan only creates the route/page files against those already-allowlisted paths and never touches middleware.

Purpose: Gives the founder something to share with prospects (the front door to self-serve customer #2+) without standing up a separate CDN/DNS/marketing-site stack.
Output: marketing route group + pricing/features/landing, /docs, /status, a PLANS-driven pricing table, and marketing nav.
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
@src/lib/supabase/middleware.ts

<interfaces>
<!-- 05-00 added the marketing/docs/status paths (incl. /welcome) to PUBLIC_PATHS already. This plan does NOT edit middleware. -->

From src/lib/stripe/plans.ts (05-00):
  export const PLANS: { starter: { label; pricePence:5900; seats:3; aiCaps:{...} }, pro: { label; pricePence:8900; seats:8; aiCaps:{...} }, scale: { label; pricePence:12900; seats:99; aiCaps:{...} } }
  export type PlanKey = 'starter' | 'pro' | 'scale'
  // Pro is the default/highlighted tier.

From src/lib/supabase/middleware.ts (05-00 — DONE there, read-only here): PUBLIC_PATHS already includes /welcome, /pricing, /features, /docs, /status. The marketing landing route was DECIDED as `/welcome` in 05-00; this plan only creates the page files at those paths. DO NOT add anything to PUBLIC_PATHS in this plan.

From src/lib/supabase/server.ts: createClient() — usable in /status for a lightweight DB reachability probe (a trivial SELECT 1 / count query).

Existing public route group precedent: src/app/(public)/apply/[orgSlug]/ (a sibling public group with its own layout, no auth).
Brand: Midnight #0A3D5C, Mint #5DCAA5. Existing email/brand assets at /public/email/altus-recruit-logo.svg.
Pricing copy source: docs/cost-and-pricing-analysis.md (positioning: AI bundled, no add-on tier; Pro £89 founding price; §5 AI caps). Marketing copy is placeholder-quality — the founder fills real copy later.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 4.1: Marketing route group — landing (/welcome), pricing (PLANS-driven), features + nav</name>
  <read_first>
    - src/app/(public)/apply/[orgSlug]/page.tsx + the (public) layout (sibling public-group precedent: layout with no auth)
    - src/lib/supabase/middleware.ts (read-only — confirm /welcome, /pricing, /features are ALREADY in PUBLIC_PATHS from 05-00; do NOT edit this file)
    - src/lib/stripe/plans.ts (PLANS — the pricing source of truth)
    - docs/cost-and-pricing-analysis.md (§4 positioning + §5 tiers; Pro is the founding/default tier)
  </read_first>
  <action>
    Create the `(marketing)` route group with its own layout.tsx (no auth; a marketing-nav header + footer). Routing is ALREADY DECIDED by 05-00: the authenticated dashboard owns `/`; the marketing landing lives at `/welcome`, and `/welcome`, `/pricing`, `/features` are ALREADY in PUBLIC_PATHS. This task does NOT edit src/lib/supabase/middleware.ts — it only creates page files at the pre-allowlisted paths. (Do NOT remap `/` to marketing — that would break the authed dashboard and the existing logged-in redirect in middleware.) Link to `/welcome` from the sign-in/sign-up footers.
    Create src/components/marketing/marketing-nav.tsx (links: Features /features, Pricing /pricing, Docs /docs, Status /status, Sign in /sign-in, Get started /sign-up). Create src/components/marketing/pricing-table.tsx — renders the three tiers from PLANS: label, formatted GBP price/seat/mo (pricePence→£ using the existing GBP formatter convention, e.g. Intl.NumberFormat 'en-GB' currency GBP), seat allowance, the AI caps as bullet features (match-scores, CV parses, searches, spec-call minutes per seat/mo), and a CTA per tier. Highlight Pro as the recommended/default tier (badge + emphasis). Each CTA routes to /sign-up?plan=<planKey> (the signup→checkout flow from 05-01 reads the chosen plan; if signup doesn't yet thread the plan, the CTA can deep-link to /sign-up and the post-signup checkout defaults to Pro — keep the planKey in the query string regardless).
    Create the three pages: (marketing)/welcome/page.tsx (landing — headline + value props + a "Get started" CTA + an embedded pricing-table or a link to /pricing), (marketing)/pricing/page.tsx (renders <PricingTable/> + the founding-price framing), (marketing)/features/page.tsx (feature list — semantic search, AI CV parsing, match scoring, spec→JD, etc.). All RSC, static where possible, placeholder marketing copy clearly marked for the founder to replace. Keep them lightweight; a design polish pass on these customer-facing surfaces happens at build time.
  </action>
  <verify>
    <automated>grep -q "PLANS" src/components/marketing/pricing-table.tsx && grep -q "pricing-table\|PricingTable" "src/app/(marketing)/pricing/page.tsx" && grep -q "/welcome" src/lib/supabase/middleware.ts && pnpm typecheck && pnpm lint</automated>
  </verify>
  <acceptance_criteria>
    - behavior: /welcome, /pricing, /features render for a logged-OUT visitor (no redirect to /sign-in)
    - behavior: with no session, each of /welcome /pricing /features /docs /status returns HTTP 200 — verify e.g. `curl -s -o /dev/null -w "%{http_code}" <baseUrl>/welcome` (and the same for /pricing, /features, /docs, /status) returns 200, NOT 307. (Run against the dev server / preview deploy; logged-out = no auth cookie.)
    - source: pricing-table imports and iterates PLANS (no hardcoded prices); Pro visibly highlighted
    - source: this task does NOT modify src/lib/supabase/middleware.ts — `/welcome` + the other public paths are already allowlisted by 05-00 (the verify grep just confirms 05-00's entry is present)
    - behavior: each tier CTA links to /sign-up (with ?plan=<key>)
    - test-command: `pnpm typecheck && pnpm lint` pass
  </acceptance_criteria>
  <done>Marketing landing (/welcome)/pricing/features live as public pages against the paths 05-00 already allowlisted; pricing renders from PLANS with Pro highlighted; CTAs feed the signup/checkout flow. Middleware untouched by this plan.</done>
</task>

<task type="auto">
  <name>Task 4.2: In-app /docs documentation area + simple /status page</name>
  <read_first>
    - "src/app/(app)/help/page.tsx" (the existing in-app help/cheat-sheet — reuse its section structure/copy as the seed for /docs content; quick-task 260603-fv0)
    - src/lib/supabase/server.ts (createClient — for the /status DB probe)
    - src/lib/supabase/middleware.ts (read-only — confirm /docs + /status are in PUBLIC_PATHS from 05-00; do NOT edit)
  </read_first>
  <action>
    Create the /docs area: docs/content.ts exporting a typed array of doc sections/articles ({ slug, title, body | sections }) — seed from the existing /help page content (getting started, candidates + AI CV parsing, semantic search, clients, jobs, spec→job, pipeline/shortlists, reports, team & settings, integrations, billing). docs/layout.tsx (public layout + a sidebar nav listing the articles), docs/page.tsx (index linking each article), docs/[slug]/page.tsx (renders one article from content.ts; notFound() for unknown slugs; generateStaticParams from the content array so they prerender). Keep it static text (no MDX dependency needed — a typed content module is simpler and avoids a new build dependency per "don't hand-roll / favour simple"). PII-safe: docs use no tenant data and no real candidate screenshots (follow the /help ScreenshotSlot placeholder discipline if images are referenced).
    Create src/app/status/page.tsx — a simple status page (D-15: lightweight, no incident tooling). Server-render: probe app reachability (the page rendering itself proves the app is up) + a lightweight DB health check via createClient() running a trivial query (e.g. a count on a tiny table or `select 1`); show "Operational" / "Degraded" per component (App, Database). Keep it minimal — a green/amber indicator per component + a timestamp. Do NOT add a cron/uptime-history backend (deferred per D-15). Handle the probe failing gracefully (catch → show Degraded, don't crash the page). force-dynamic so the probe runs per request.
  </action>
  <verify>
    <automated>grep -qE "slug|title" src/app/docs/content.ts && grep -q "generateStaticParams" "src/app/docs/[slug]/page.tsx" && grep -qE "createClient|select|count" src/app/status/page.tsx && pnpm typecheck && pnpm lint</automated>
  </verify>
  <acceptance_criteria>
    - behavior: /docs index + at least one /docs/[slug] article render for a logged-OUT visitor
    - behavior: with no session, GET /docs and GET /status return HTTP 200 (not 307) — covered by the curl check in Task 4.1's criteria
    - source: docs content lives in a typed content module (no new MDX/build dependency added)
    - behavior: /status renders App + Database indicators; a failing DB probe shows Degraded (caught), not a crash
    - source: /docs and /status confirmed in PUBLIC_PATHS (from 05-00; this task does not edit middleware)
    - source: no tenant data / real PII in docs content
    - test-command: `pnpm typecheck && pnpm lint` pass
  </acceptance_criteria>
  <done>Public /docs (seeded from the existing help content) and a simple /status page with a graceful DB probe — both in-app, no extra hosting or dependencies.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| anonymous visitor → marketing/docs/status | Fully public, unauthenticated pages |
| /status → DB | A read-only reachability probe runs server-side |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-04-01 | Information Disclosure | /status DB probe | mitigate | Probe is a trivial existence/count query exposing only up/down — no tenant data, no row contents; runs under anon/RLS or a count on a non-sensitive table |
| T-05-04-02 | Information Disclosure | marketing/docs content | mitigate | Static placeholder copy only; no tenant data, no real candidate PII/screenshots (follow /help discipline) |
| T-05-04-03 | Spoofing | pricing CTA → plan | mitigate | planKey passed as a query hint only; the authoritative price is the server-side PLAN_PRICE_IDS at checkout (05-01) — client cannot set the price |
| T-05-04-04 | Denial of Service | /status force-dynamic probe | accept | Lightweight per-request query; low cost; acceptable for a single status page |
</threat_model>

<verification>
- `pnpm typecheck` + `pnpm lint` pass.
- Manual (logged out): /welcome, /pricing, /features, /docs, /docs/[slug], /status all render without a redirect to /sign-in; pricing shows three tiers with Pro highlighted and correct £ prices from PLANS.
- Automated (logged out): `curl -s -o /dev/null -w "%{http_code}"` against /welcome, /pricing, /features, /docs, /status each returns 200 (not 307).
- /status shows Operational normally and Degraded if the DB probe fails (no crash).
</verification>

<success_criteria>
- Public marketing (landing at /welcome / pricing / features), in-app docs, and a simple status page exist; pricing is PLANS-driven with Pro highlighted; CTAs feed signup/checkout. No separate hosting or new build dependency. Middleware allowlisting was owned by 05-00; this plan added no PUBLIC_PATHS edits.
</success_criteria>

<output>
Create `.planning/phases/05-saas-shell/05-04-SUMMARY.md` when done.
</output>
