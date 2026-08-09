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
**Plans:** 4/10 plans executed

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
- [ ] 06-04-PLAN.md — Layer 1: manifest-driven extraction suite + PII tripwire (wave 3)
- [x] 06-05-PLAN.md — Layer 2: real-Supabase write-path harness + the six RED tests (wave 3)
- [ ] 06-06-PLAN.md — Fix the write boundary: zod coercion + Postgres sanitiser + wiring (wave 4)
- [ ] 06-07-PLAN.md — Honest async failures: SQLSTATE detail, type-specific messages, no doomed retry (wave 5)
- [ ] 06-08-PLAN.md — Upload-time rejection: magic-byte sniff on both intake paths (wave 6)
- [ ] 06-09-PLAN.md — Verification gate: full green, code review, browser pre-smoke + layer-3 spot-check (wave 7)
- [ ] 06-10-PLAN.md — Customer closure: retry the 12, founder handoff, permanent runbook (wave 8)

---

*Roadmap created: 2026-05-17*
*Last updated: 2026-08-09 — Phase 6 planned (10 plans, 8 waves)*
