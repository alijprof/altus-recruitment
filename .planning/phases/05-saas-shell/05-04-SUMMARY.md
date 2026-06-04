---
phase: 05-saas-shell
plan: "04"
subsystem: marketing
tags: [marketing, public-pages, pricing, docs, status, plans-driven]
dependency_graph:
  requires: ["05-00"]
  provides: ["marketing-site", "docs", "status"]
  affects: ["sign-up flow (CTA links)"]
tech_stack:
  added: []
  patterns:
    - "(marketing) route group: layout with MarketingNav + footer, RSC pages"
    - "PLANS constant as single source of truth for pricing display"
    - "Typed content module (DocArticle[]) for /docs — no MDX"
    - "force-dynamic /status with graceful DB probe"
key_files:
  created:
    - src/app/(marketing)/layout.tsx
    - src/app/(marketing)/welcome/page.tsx
    - src/app/(marketing)/pricing/page.tsx
    - src/app/(marketing)/features/page.tsx
    - src/components/marketing/marketing-nav.tsx
    - src/components/marketing/pricing-table.tsx
    - src/app/docs/content.ts
    - src/app/docs/layout.tsx
    - src/app/docs/page.tsx
    - src/app/docs/[slug]/page.tsx
    - src/app/status/page.tsx
  modified: []
decisions:
  - "Landing at /welcome (not /): preserves / as authenticated dashboard per 05-00 decision"
  - "Typed content module for /docs over MDX: no new build dependency, simpler, static"
  - "DB probe uses anon key + organizations table count: lightweight, RLS-safe, exposes only up/down"
  - "PricingTable renders all three tiers from PLANS import; Pro highlighted with 'Recommended' badge"
  - "compact prop on PricingTable: landing page uses compact=true (CTA-only cards), /pricing uses full (AI caps + features)"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-04"
  tasks_completed: 2
  files_created: 11
---

# Phase 5 Plan 04: Marketing Site + Docs + Status Summary

Public marketing surface for Altus: landing at /welcome, pricing from PLANS, features page, in-app /docs (11 articles seeded from /help), and a simple /status page with graceful DB probe.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 4.1 | Marketing route group — landing, pricing, features + nav | 48a6c44 | 6 created |
| 4.2 | In-app /docs + simple /status page | d1d4412 | 5 created |

## What Was Built

### Task 4.1 — Marketing route group

- `(marketing)` route group with layout (sticky `MarketingNav` header + footer)
- `/welcome` landing page: hero section on brand midnight blue (#0A3D5C), value proposition grid (6 AI features), compact pricing preview, final CTA
- `/pricing` page: full `PricingTable` from PLANS, all-features checklist, FAQ (6 questions), CTA
- `/features` page: 5 sectioned feature groups (AI core, pipeline, clients, integrations, compliance), 18 feature cards total
- `MarketingNav`: sticky, responsive, all public nav links + sign-in/get-started CTAs
- `PricingTable`: PLANS-driven (import from `@/lib/stripe/plans`), Pro highlighted with "Recommended" badge + #0A3D5C border; pence→GBP via `Intl.NumberFormat 'en-GB'`; `compact` prop for landing embed; tier CTAs link to `/sign-up?plan=<key>`
- Middleware was NOT modified — /welcome, /pricing, /features already in PUBLIC_PATHS from 05-00

### Task 4.2 — /docs + /status

- `src/app/docs/content.ts`: 11 `DocArticle` entries (typed, no MDX); seeded from in-app /help page — getting-started, candidates, search, clients, jobs, spec-calls, pipeline, reports, settings, integrations, billing
- `docs/layout.tsx`: public layout, sidebar nav (all 11 articles), responsive (sidebar collapses on mobile)
- `docs/page.tsx`: article index grid with descriptions + chevron links
- `docs/[slug]/page.tsx`: article renderer, `generateStaticParams` (all 11 slugs prerender), `notFound()` for unknown slugs, inter-article nav footer
- `src/app/status/page.tsx`: `force-dynamic`; App (always Operational if page renders) + Database (count probe on organizations table via anon supabase client); graceful catch → Degraded; timestamp displayed; no crash on DB failure

## Pricing Source Confirmation

The `PricingTable` component imports `PLANS` and `PlanKey` directly from `@/lib/stripe/plans`. Prices are derived from `pricePence` (5900 → £59, 8900 → £89, 12900 → £129) via `Intl.NumberFormat`. Pro is highlighted via a "Recommended" badge and `borderColor: '#0A3D5C'`. No prices are hardcoded in the component.

## Middleware

No changes to `src/lib/supabase/middleware.ts`. Confirmed `/welcome`, `/pricing`, `/features`, `/docs`, `/status` are present in `PUBLIC_PATHS` from 05-00.

## Design Approach

The landing (/welcome) and pricing pages use the brand palette (Midnight #0A3D5C hero, Mint #5DCAA5 accents) from the brand constants. Visual hierarchy: full-bleed dark hero → light feature grid → muted pricing preview → dark CTA. The features page uses alternating white/slate-50 section backgrounds for scanability. All pages are RSC, static-renderable, responsive, accessible (semantic headings, aria labels, alt-text via aria-hidden on icons), and contain no Lorem ipsum — copy is grounded in the actual product capabilities but marked with `// COPY PLACEHOLDER` comments for the founder to refine.

## Deviations from Plan

None — plan executed exactly as written. Middleware was confirmed read-only. No new build dependencies added.

## Known Stubs

- **Marketing copy**: All copy in /welcome, /pricing, /features is marked `// COPY PLACEHOLDER`. The founder should review and replace with final brand voice before sharing with prospects. The content is substantive and product-accurate, not Lorem ipsum.
- **Status uptime history**: Noted in the page: "Historical uptime metrics are not yet available." Deferred per D-15.
- **Social proof strip on /welcome**: Placeholder "Trusted by UK recruitment agencies" — replace with real customer logos/quotes when available.

## Threat Surface Scan

No new threat surface beyond what was declared in the plan threat model:
- T-05-04-01 (DB probe): mitigated — count-only, anon key, RLS active, no row data exposed
- T-05-04-02 (marketing/docs content): mitigated — static copy, no tenant data, no PII
- T-05-04-03 (pricing CTA planKey): mitigated — planKey is a hint only; server-side PLAN_PRICE_IDS at checkout is authoritative
- T-05-04-04 (force-dynamic probe): accepted — lightweight per-request count

No migration written.

## Self-Check: PASSED

Files confirmed:
- src/app/(marketing)/layout.tsx ✓
- src/app/(marketing)/welcome/page.tsx ✓
- src/app/(marketing)/pricing/page.tsx ✓
- src/app/(marketing)/features/page.tsx ✓
- src/components/marketing/marketing-nav.tsx ✓
- src/components/marketing/pricing-table.tsx ✓
- src/app/docs/content.ts ✓
- src/app/docs/layout.tsx ✓
- src/app/docs/page.tsx ✓
- src/app/docs/[slug]/page.tsx ✓
- src/app/status/page.tsx ✓

Commits confirmed:
- 48a6c44 (Task 4.1) ✓
- d1d4412 (Task 4.2) ✓

typecheck: 0 errors ✓
lint: 0 errors, 17 pre-existing warnings ✓
