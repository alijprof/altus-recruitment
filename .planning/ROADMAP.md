# Roadmap: Altus — AI-First Recruitment CRM

**Created:** 2026-05-17
**Granularity:** coarse
**Mode:** mvp (Vertical MVP — each phase delivers end-to-end user capability)

---

## Milestones

- ✅ **v1.0 MVP — AI-First Recruitment CRM** — Phases 1–5 (shipped 2026-06-12) — [archive](milestones/v1.0-ROADMAP.md)
- 📋 **v1.1 / v2.0** — not yet defined (run `/gsd-new-milestone`)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–5) — SHIPPED 2026-06-12</summary>

- [x] Phase 1: Internal ATS (6/6 plans) — completed 2026-05-18
- [x] Phase 2: Search, Match & Intake (5/5 plans) — completed 2026-05-19
- [x] Phase 3: LinkedIn, Spec Workflow & Shortlists (7/7 plans) — completed 2026-05-20
- [x] Phase 4: Voice, Marketing & Reporting (7/7 plans) — completed 2026-06-10
- [x] Phase 5: SaaS Shell (6/6 plans) — completed 2026-06-04

Full phase details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Internal ATS | v1.0 | 6/6 | Complete | 2026-05-18 |
| 2. Search, Match & Intake | v1.0 | 5/5 | Complete | 2026-05-19 |
| 3. LinkedIn, Spec Workflow & Shortlists | v1.0 | 7/7 | Complete | 2026-05-20 |
| 4. Voice, Marketing & Reporting | v1.0 | 7/7 | Complete | 2026-06-10 |
| 5. SaaS Shell | v1.0 | 6/6 | Complete | 2026-06-04 |

### Phase 6: CV Intake Battle-Test & Hardening — root-cause the 12 real-world parse failures from the customer's 5-6 Aug bulk upload (post-Claude write-stage), build a permanent multi-format fixture corpus + regression harness, fix every reproducible failure class, and guarantee every upload parses or fails immediately with an honest actionable message

**Goal:** Every CV upload either parses successfully or fails immediately with an honest, actionable message — no third outcome — proven by a permanent synthetic fixture corpus, a three-layer regression harness (extraction unit, real-Postgres write-path integration, live spot-check), and all 12 of the customer's failed 5-6 Aug uploads re-parsing to complete with populated profiles.
**Requirements**: [CVI-01, CVI-02, CVI-03, CVI-04, CVI-05, CVI-06, CVI-07, CVI-08, CVI-09]
**Depends on:** Phase 5
**Plans:** 10/10 plans executed — phase closed 2026-08-10 (06-CLOSURE.md)

Requirements:

- **CVI-01** — Per-file root-cause classification of the 12 production failures, from a read-only forensic replay (customer data never written; AI cost billed to the founder's org).
- **CVI-02** — Permanent PII-free fixture corpus (Tier 1 must-parse, Tier 2 fail-fast, hostile) with a committed generator and manifest.
- **CVI-03** — Layer 1: extraction regression tests over the whole corpus, manifest-driven.
- **CVI-04** — Layer 2: write-path integration tests against a real local Supabase, with a failing test for every reproduced failure class before any fix lands.
- **CVI-05** — Claude's output validated and coerced at the boundary (shape + range) so no model output can break a DB write.
- **CVI-06** — Postgres-illegal sequences sanitised at the DB write choke point (values AND object keys), preserving all legal content.
- **CVI-07** — Every failure records a PII-free technical root cause (SQLSTATE / PostgREST code + column) and shows an honest, type-specific message; no retry affordance on failures retrying cannot fix.
- **CVI-08** — Unsupported, corrupt and wrong-extension files rejected at upload on the recruiter path and at the earliest server-visible moment on the apply path, from raw bytes rather than the client-supplied mime.
- **CVI-09** — Acceptance and closure: full suite green, mandatory code-review + browser pre-smoke pipeline, and all 12 customer rows re-parsed to complete.

Plans:

- [x] 06-01-PLAN.md — Harness scaffolding, jszip dependency gate, Postgres-legality classifier (wave 1)
- [x] 06-02-PLAN.md — Read-only forensic replay of the 12 production failures (wave 2)
- [x] 06-03-PLAN.md — Fixture corpus: generator, Tier-1/Tier-2/hostile binaries, manifest (wave 2)
- [x] 06-04-PLAN.md — Layer 1: manifest-driven extraction suite + PII tripwire (wave 3)
- [x] 06-05-PLAN.md — Layer 2: real-Supabase write-path harness + the six RED tests (wave 3)
- [x] 06-06-PLAN.md — Fix the write boundary: zod coercion + Postgres sanitiser + wiring (wave 4)
- [x] 06-07-PLAN.md — Honest async failures: SQLSTATE detail, type-specific messages, no doomed retry (wave 5)
- [x] 06-08-PLAN.md — Upload-time rejection: magic-byte sniff on both intake paths (wave 6)
- [x] 06-09-PLAN.md — Verification gate: full green, code review, browser pre-smoke + layer-3 spot-check (wave 7)
- [x] 06-10-PLAN.md — Customer closure: retry the 12, founder handoff, permanent runbook (wave 8)

### Phase 7: CV Lifecycle & Trust — make stored CVs visible/downloadable with version history, proactively flag low-confidence parsed fields, full editing of AI-parsed fields with re-embed-on-change, match-score backfill + auto-freshness, and background-job hardening (cron timeouts + heartbeats)

**Goal:** The CV data the customer already trusts us with becomes visible, correctable and trustworthy — every stored CV file is viewable and downloadable with its version history and an audit trail, low-confidence parsed fields are flagged before the recruiter has to go looking, every AI-parsed field is editable in-app with correct embedding invalidation, every application carries a match score, and a wedged background job can no longer block the queue for days unnoticed.
**Requirements**: [CLT-01, CLT-02, CLT-03, CLT-04, CLT-05, CLT-06, CLT-07, CLT-08]
**Depends on:** Phase 6
**Plans:** 8/8 plans executed — executed + hotfixed 2026-08-11, prod-smoked (lifecycle 7/7); founder UAT pending

Requirements:

- **CLT-01** — Stored CV files are viewable and downloadable from the candidate page — on the Latest CV panel and on every version row, for single- and multi-CV candidates alike — with filename and upload date, and an honest disabled state where no stored object exists.
- **CLT-02** — Every CV file access writes an `export` audit row against the candidate, with PII-free metadata, before the signed URL reaches the browser.
- **CLT-03** — Low/medium-confidence parsed fields are surfaced proactively outside the review sheet: a count badge beside the Review button and a line naming the fields.
- **CLT-04** — Every AI-parsed candidate field is editable in-app (seniority, years, both salaries, headline, about, skills, sectors, work history, education), with Postgres-safe writes and embedding invalidation left to the DB trigger, guarded by a contract test.
- **CLT-05** — Applications predating auto-scoring are backfilled with match scores across all orgs — idempotent, tenant-verified and cap-guarded, reusing the existing scorer rather than duplicating its guards.
- **CLT-06** — Match-score freshness: the Explain action refreshes its own card instead of instructing a page reload, and a bulk `Score all` affordance exists on the matches page.
- **CLT-07** — Neither concurrency-1 cron can block the background queue indefinitely, and the liveness of both is observable same-day via Sentry heartbeats plus a documented monitor setup.
- **CLT-08** — Acceptance and closure: full autonomous gates, mechanical code review, and an authenticated browser pre-smoke — all green — before any founder UAT, with the Phase-6 frozen CV-intake suite still passing unchanged.

Plans:

- [x] 07-01-PLAN.md — CV file access: signed-URL action, export audit, CV files section (wave 1)
- [x] 07-02-PLAN.md — Proactive low-confidence flagging on the Latest CV panel (wave 2)
- [x] 07-03-PLAN.md — Parsed-field editing: schema, action, and the embedding-invalidation contract test (wave 1)
- [x] 07-04-PLAN.md — Parsed-field editing: tag input, repeating-row editors, expanded edit form (wave 2)
- [x] 07-05-PLAN.md — Cron hardening: function timeouts, Sentry heartbeats, monitoring runbook (wave 1)
- [x] 07-06-PLAN.md — Match-score backfill sweep + super-admin trigger (wave 1)
- [x] 07-07-PLAN.md — Match freshness: self-refreshing Explain + `Score all` (wave 1)
- [x] 07-08-PLAN.md — Acceptance gate: full gates, code review, authed browser pre-smoke (wave 3) (gates + review + prod smoke complete; Task 4 founder UAT open)

**Design note:** This phase needs NO migration — `export` already exists in the
`audit_action` enum (migration 20260513152244:77), and the
`invalidate_candidate_embedding` trigger (20260519092951) already watches
exactly the eight columns `candidateEmbeddingText` consumes, so the newly
editable search-relevant fields invalidate correctly with zero app-side code
and the newly editable non-search fields correctly do not.

### Phase 8: Branded CV — on-demand agency-branded, contact-stripped PDF CV from parsed data, org branding (colours + uploaded logo) on one standard template, stored in candidate documents with View/Download

**Goal:** A recruiter can produce a client-ready, agency-branded PDF of any parsed candidate in one click — filled from the candidate's current (edited) parsed data, styled with the org's colours and uploaded logo on one clean standard template, with direct contact details stripped — and the branded copy lives in the candidate's documents with the same View/Download affordances and export audit trail as stored CVs.
**Requirements**: [BCV-01, BCV-02, BCV-03, BCV-04, BCV-05, BCV-06, BCV-07]
**Depends on:** Phase 7
**Plans:** 0 plans

Requirements:

- **BCV-01** — On-demand generation only: a "Generate branded CV" action on the candidate page builds the PDF from the candidate's CURRENT parsed/edited data at click time. Never auto-on-parse (edited data would go stale).
- **BCV-02** — One standard template, tenant-branded: org `brand_primary`/`brand_secondary` + logo applied to a clean professional recruitment layout (identity header, headline/about, skills, work history, education). Same layout for every tenant.
- **BCV-03** — Contact details stripped on the branded copy: candidate email, phone, and address never render; name stays. The original CV is untouched.
- **BCV-04** — Real logo upload in Settings→Branding (file → Supabase Storage), replacing the URL-only field; template renders a graceful branded header when no logo exists.
- **BCV-05** — The branded PDF is stored as a candidate document alongside the original CVs, clearly marked as the branded copy, with View/Download via the Phase-7 route-handler surface and an export audit row on every access.
- **BCV-06** — Regeneration is safe and idempotent: regenerating supersedes the prior branded copy cleanly (no orphaned files, no duplicate rows).
- **BCV-07** — Acceptance and closure: full autonomous gates, mechanical code review, and an authenticated browser pre-smoke — all green — before founder UAT; zero AI spend in the generation path (deterministic template fill).

Plans:

- [ ] TBD (run /gsd:plan-phase 8 to break down)

---

*Roadmap created: 2026-05-17*
*Last updated: 2026-08-12 — Phases 6-7 executed; Phase 7 awaiting founder UAT*
