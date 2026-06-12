# Retrospective: Altus — AI-First Recruitment CRM

A living document. One section per milestone, appended at each milestone close.

---

## Milestone: v1.0 — MVP — AI-First Recruitment CRM

**Shipped:** 2026-06-12
**Phases:** 5 | **Plans:** 31 | **Commits:** 432 over 30 days (2026-05-13 → 2026-06-12)

### What Was Built

Full AI-first recruitment CRM, live on altusrecruit.com: internal ATS (candidates/CVs/clients/jobs/pipeline with GDPR + audit logging), RRF hybrid semantic search + Sonnet match scoring, LinkedIn/spec-call capture and AI job ads, voice notes + approval-gated personalised email campaigns + NL→SQL reporting + buyer-value dashboards, and a SaaS shell (self-serve signup, Stripe card-first billing with paywall, per-org branding, super-admin console, marketing site).

### What Worked

- **Vertical MVP phases with wave-parallel plans** — each phase shipped an end-to-end user capability; zero-file-overlap waves let plans run in parallel without merge pain.
- **Multi-tenant RLS from day 1** — held through 5 phases; the pre-launch audit found no cross-tenant leaks.
- **Pre-UAT pipeline (code-review + browser pre-smoke)** — Phase 5's multi-agent review surfaced 37 findings (5 HIGH billing/auth) before the founder ever tested; founder UAT was residual-bugs-only.
- **Deterministic smoke auth** — minting sessions via Supabase Admin API (generateLink → verifyOtp → cookie encode) replaced the laggy Gmail magic-link relay and made authenticated prod smokes repeatable.
- **Inngest for everything AI** — no synchronous AI call ever blocked a handler; cost logging per tenant fed straight into AI caps and admin dashboards.

### What Was Inefficient

- **LinkedIn DOM scraping** — iterative selector tweaks kept shifting the failure mode before the strategic pivot to top-card + Save-to-PDF. Lesson became a standing rule: pivot early on brittleness.
- **Quick-task bookkeeping** — 21 quick tasks shipped without SUMMARY files, making the milestone-close audit noisy. Summaries should be written at merge time.
- **Requirement checkboxes never ticked phase-by-phase** — REQUIREMENTS.md drifted from reality (11/66 ticked despite everything shipping); the traceability table had to be reconciled at close.
- **Key rotation deferred** — Stripe & Supabase secrets flagged for rotation at Phase 5 smoke still open at close.

### Patterns Established

- Card-first paywall with grandfathered comp rows for existing orgs.
- Fail-closed optional env (app builds with zero Stripe keys; features gate themselves).
- Approval gates on every AI-initiated outbound or data mutation (campaigns, voice-note field changes, outreach drafts).
- Security-definer RPC write paths (`record_audit`, `record_ai_usage`) instead of direct client writes.
- Defence-in-depth on user-supplied styling (DB CHECK + Zod + render-time re-validation for brand colours).

### Key Lessons

- When selector/scraper fixes keep moving the failure, stop and pivot strategically rather than iterating.
- Never revoke an old key until the replacement is confirmed live (Altus Move outage 2026-06-06).
- Founder value ≠ feature coolness: voice notes shipped well but rated "not needed at the desk" — validate workflow fit before investing in polish.
- Supabase free-tier auth SMTP (~4 emails/hour) is a real onboarding blocker — wire custom SMTP before customer #2.

### Cost Observations

- Model mix: balanced profile (Sonnet default, Haiku for parsing volume, Opus only in multi-agent audits/reviews).
- Notable: ~$1 browser-automation pre-smokes repeatedly replaced 2–4 hour human UAT bug-hunts; multi-agent code review caught the highest-severity billing/auth bugs pre-UAT.

---

## Cross-Milestone Trends

| Metric | v1.0 |
|--------|------|
| Phases | 5 |
| Plans | 31 |
| Commits | 432 |
| Duration (days) | 30 |
| LOC (TS + SQL) | ~65,500 |
| Open items at close | 23 (all bookkeeping) |

(Trends become meaningful from v1.1 onward.)
