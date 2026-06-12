# Milestones

## v1.0 MVP — AI-First Recruitment CRM (Shipped: 2026-06-12)

**Phases completed:** 5 phases, 31 plans, 65 tasks
**Stats:** 432 commits over 30 days (2026-05-13 → 2026-06-12), ~65,500 LOC (TypeScript + SQL), 394 source files
**Live on:** altusrecruit.com (Vercel + Supabase), all 5 phases verified on production

**Key accomplishments:**

- **Full internal ATS** — candidates with GDPR consent capture and audit logging, AI CV parsing (Haiku via Inngest with review panel), clients/contacts, jobs, drag-and-drop kanban pipeline with structured decline reasons, and org dashboards with stale-application alerts.
- **AI search & matching** — Voyage `voyage-3` embeddings in `halfvec(1024)` with RRF hybrid semantic search, Sonnet 0–100 match scores with cached explanations and screening questions, public apply form with 5 abuse layers, and Outlook (Microsoft 365) inbound email capture.
- **AI-assisted job creation & capture** — LinkedIn capture (Chrome MV3 top-card scrape + Save-to-PDF pivot through the CV parser), spec call → Whisper → Sonnet structured JD with approval gate, inclusive job-ad generation with 0–100 inclusivity scoring, per-job shortlists/floats, dormant-client outreach, and source-attribution reporting.
- **Voice, marketing & reporting** — voice notes with per-field approval before any data changes, segmented email campaigns personalised per recipient via Sonnet + Resend (approval-gated, PECR one-click unsubscribe), stale-candidate reminders, NL→SQL reporting against a schema-aware allowlist, and buyer-value dashboards ready for acquirer due diligence.
- **SaaS shell** — self-serve signup with onboarding tour, sample data and CSV import; Stripe card-first billing (14-day trial via Checkout, idempotent webhooks, Customer Portal, seat limits + AI-usage soft/hard caps); per-org branding on public careers/apply pages; super-admin console; marketing/docs/status site; card-first paywall live with existing orgs grandfathered.
- **Hardened for launch** — multi-agent pre-launch audit (2026-06-05) closed 2 live security holes (role self-promotion, `record_ai_usage` anon-inject); 37 Phase-5 code-review findings fixed; billing and paywall flows smoke-tested live on production.

**Requirement adjustments during milestone:**

- **EMAIL-01** shipped as Outlook/Microsoft 365 OAuth (not Gmail as originally specced) — anchor customer is on Microsoft 365.
- **LINKEDIN-01** pivoted from full one-click DOM scrape to top-card capture + LinkedIn Save-to-PDF through the existing CV parser — full DOM scraping was structurally fragile.
- **ADMIN-01** impersonation + audit-log layer explicitly descoped to v2 (CONTEXT D-14); lean console (AI cost, billing state, plan/trial overrides) shipped.

Known deferred items at close: 23 (see STATE.md Deferred Items) — 21 are completed quick tasks missing summary files (bookkeeping only), 2 are UAT files already marked passed.

---
