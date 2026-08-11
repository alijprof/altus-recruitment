---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Milestone complete — awaiting next milestone
last_updated: "2026-08-11T14:15:55.793Z"
progress:
  total_phases: 2
  completed_phases: 0
  total_plans: 18
  completed_plans: 10
  percent: 0
---

# Project State: Altus — AI-First Recruitment CRM

**Initialized:** 2026-05-17
**Last updated:** 2026-06-12

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-12 after v1.0 milestone)

**Core value:** A recruiter can find the right candidate for a job in seconds using natural language — backed by AI parsing of every CV, semantic search across the database, and Sonnet-generated match explanations.

**Current focus:** Planning next milestone (`/gsd-new-milestone`). v1.0 (5 phases, 31 plans) is live on altusrecruit.com and archived to `.planning/milestones/`.

---

## Current Position

**v1.0 SHIPPED 2026-06-12.** All 5 phases complete, verified, and live on production. Roadmap and requirements archived to `.planning/milestones/v1.0-ROADMAP.md` and `v1.0-REQUIREMENTS.md`. Git tag `v1.0`.

```
Overall:  [====================] 5 of 5 phases complete (100%)
```

Phase directories remain in `.planning/phases/` as raw execution history — run `/gsd-cleanup` to archive them retroactively.

## Pre-Launch Audit Remediation (2026-06-18)

All 6 go-live blockers from `.planning/audits/PRE-LAUNCH-AUDIT-2026-06-18.md` fixed, reviewed, smoked, and **MERGED + DEPLOYED TO PRODUCTION 2026-06-18** (main 6cd138f; prod deploy `dpl_Fkq878eFDn8Qt…` READY on altusrecruit.com). Every fix passed typecheck + lint + 286 unit tests. Two Opus code reviews (fix #1 standalone; fixes #2–6 consolidated) — both clean (0 critical/high), 3 warnings remediated in 0700a4a. Preview + production smoke PASSED: build READY; altusrecruit.com/privacy = 200 unauthenticated with full GDPR notice + draft banner; /welcome = new "Start free trial" copy, 0 old "free/no card" claims. Authed flows (entitlement/erasure/campaign) covered by tests + reviews (preview 401-walled; entitlement inert for current grandfathered/trialing orgs).

### Quick Tasks Completed

| # | Blocker | Description | Commits | Code Review |
|---|---------|-------------|---------|-------------|
| 260618-sjo | 1+2 | Enforce entitlement at data/action layer (gate ~29 actions + LinkedIn route + checkCap status-deny + public-apply AI skip) | 58f07b5, b178f2a, 0a4e62e | ✅ clean (0 c/h/m, 3 info) |
| 260618-t9u | 4 | GDPR erasure: delete apply-form CVs + voice-note audio on candidate deletion | 068d481 | ✅ (WR-02 fixed) |
| 260618-mkt | 5 | Honest "14-day free trial" copy on marketing pages (drop "free / no card") | 527dc35 | ✅ clean |
| 260618-dpc | 6 | Per-tenant consent contact email (org owner, never careers@altus.co.uk) | a4a53eb | ✅ (WR-03 fixed) |
| 260618-cmp | rank 7 | Campaign double-send idempotency guard (sequential-resubmit dedupe) | b1119db | ✅ (WR-01 comment scoped honestly) |
| 260618-priv | 3 | Privacy-policy scaffold + /terms + PUBLIC_PATHS + apply/footer links | b0cd85a | ✅ clean |
| 260618-rev | — | Consolidated review remediation (WR-01/02/03) | 0700a4a | — |
| 260804-lfz | SC review SF-1/2/4/5/7 + SEC | CV-pipeline silent-failure cluster (honest errors, reconciler sweep, profile heal, contamination guards, failed-attempt telemetry) + browser Sentry resurrection + anon-RPC REVOKE migration (file-only) | 1cb386d, b8aeff1, e97dc2b, 9bb65c6 | verified 12/12 + full-branch review SHIP-CONFIRMED; LIVE on prod de60c30 (2026-08-04) |
| 260804-lih | SC review SF-3 + TEL + STRIPE | Match scores on all 4 application-create paths (idempotent, tenant-verified, 3 display surfaces) + search/view/export/attribution telemetry + Stripe webhook status ledger (non-dedupe invariant preserved) + Vercel Analytics | a55fb45, a5a07ac, 8b313c0 | verified 9/9 + full-branch review SHIP-CONFIRMED; LIVE on prod de60c30 (2026-08-04); smoked anon 32/32 + authed 9/9 |

### Still required before real paying customers (NOT code) — FOUNDER OWNS

- **Blocker 3 residual:** /privacy is a TEMPLATE (live + reachable) — needs a UK DP solicitor review + [placeholders] filled; DPA + ROPA are separate org deliverables.
- **Founder runbook:** Stripe TEST→LIVE keys + live webhook; rotate Stripe + Supabase keys (confirm-before-revoke); Resend custom SMTP for auth emails.
- **Optional fast-follow:** atomic campaign idempotency_key + partial unique index (the current guard covers sequential resubmits, not simultaneous).

## Open Items (carried into next milestone)

- Rotate Stripe & Supabase secret keys (revoke old keys only after replacements confirmed working).
- Custom SMTP via Resend for Supabase auth emails — free-tier SMTP throttles ~4/hour; blocker before customer #2 onboards.
- Comp→paid self-serve path for grandfathered orgs (deferred at paywall ship).
- ADMIN impersonation + audit layer (descoped from v1 per CONTEXT D-14).
- Voice notes investment frozen pending phone-usage signal (founder feedback 2026-06-11).

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-06-12. All 21 quick tasks below are **shipped work missing SUMMARY files** (bookkeeping gaps only — the features are merged and live); the 2 UAT files are already marked passed and were flagged by the audit conservatively.

| Category | Item | Status |
|----------|------|--------|
| quick_task | 260523-qyc-add-placement-fee-capture-modal-prompt-f | missing summary |
| quick_task | 260523-ret-mobile-ux-overhaul-phone-navigation-betw | missing summary |
| quick_task | 260523-sns-wave-1-hygiene-backfill-phase-2-plan-sum | missing summary |
| quick_task | 260523-tje-ad-save-ux-polish-full-saved-ad-render-p | missing summary |
| quick_task | 260524-b6v-in-app-feedback-widget-floating-button-d | missing summary |
| quick_task | 260524-bpy-org-member-invitation-flow-magic-link-to | missing summary |
| quick_task | 260524-cjl-empty-state-polish-across-8-index-pages | missing summary |
| quick_task | 260524-cwd-buyer-value-dashboards-report-02-rechart | missing summary |
| quick_task | 260524-iav-task-2-security-blocker-fixes-accept-inv | missing summary |
| quick_task | 260524-is2-ux-blocker-fixes-candidates-empty-state- | missing summary |
| quick_task | 260525-ucn-fix-buyer-value-ssr-false-in-server-comp | missing summary |
| quick_task | 260527-x2q-p0-fix-add-accept-invite-to-middleware-p | missing summary |
| quick_task | 260528-0rd-p1-fix-extend-middleware-matcher-to-excl | missing summary |
| quick_task | 260528-v6h-wire-feedback-recipient-to-env-var-w5-pr | missing summary |
| quick_task | 260528-wdz-altus-recruit-branded-transactional-emai | missing summary |
| quick_task | 260603-fv0-build-in-app-help-cheat-sheet-page-help- | missing summary |
| quick_task | 260603-gdz-onboarding-ux-first-run-welcome-checklis | missing summary |
| quick_task | 260604-cn5-fix-demo-blockers | missing summary |
| quick_task | 260605-gtj-billing-self-serve-checkout | missing summary |
| quick_task | 260605-x9l-paywall-gate | missing summary |
| quick_task | 260612-0f4-pecr-one-click-unsubscribe-persist-campa | missing summary |
| uat | Phase 03 03-UAT.md | passed (0 open scenarios) |
| uat | Phase 04 04-HUMAN-UAT.md | passed (0 open scenarios) |

---

*State refreshed at v1.0 milestone close. Full milestone history: .planning/MILESTONES.md*

## Accumulated Context

### Roadmap Evolution

- Phase 6 added (2026-08-09): CV Intake Battle-Test & Hardening — driven by customer feedback (12 parse failures in the 5-6 Aug 73-CV bulk upload; telemetry proves all failures are post-Claude write-stage)

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 06 P03 | 55min | 2 tasks | 22 files |
| Phase 06 P05 | 30min | 3 tasks | 5 files |
| Phase 07 P07 | 25min | 2 tasks | 4 files |
| Phase 07 P03 | 15min | 3 tasks | 5 files |
| Phase 07 P05 | 25min | 3 tasks | 4 files |

## Decisions

- [Phase 06]: 06-03: pinned Chromium PDF /CreationDate+/ModDate and jszip per-entry mtimes (incl. auto-created folders) to a fixed date so pnpm fixtures:regen is byte-for-byte idempotent
- [Phase 06]: 06-03: encrypted-PDF fixture uses deterministic pseudo-random O/U values instead of a real RC4/MD5 password derivation — empirically confirmed pdf.js throws PasswordException identically either way
- [Phase 06]: 06-03: unpdf/pdf.js can neuter the ArrayBuffer it is handed — every self-check now defensively copies bytes before extraction rather than passing a live view still needed elsewhere
- [Phase 06]: 06-05: resolved local Supabase creds via node_modules/.bin/supabase directly (pnpm not on bare PATH in this env)
- [Phase 06]: 06-05: C1/C2 (Unicode illegalities) target updateCandidateCVParse's extracted_data jsonb; C3/C4/C5 target markCandidateFieldsFromCV's typed candidates columns — matches which real Postgres column each verified-matrix row actually writes to
- [Phase 06]: 06-05: BAD-ENUM is the one test where result.ok===false is the PERMANENT expected outcome — proves DbResult.detail will carry the SQLSTATE + column once 06-06/06-07 land
- [Phase 07]: scoreAllMatchesAction reuses precompute's spend ceiling and AI cap guards rather than duplicating them; the action layer only adds a fail-fast RLS-scoped tenant check before spending an Inngest attempt
- [Phase 07]: 07-03: undefined-preserving null coercion (toNullableString/toNullableNumber) for the 10 new edit-schema scalar fields, not the existing eight's bare x||null — the unmodified edit form omits these keys until 07-04, and x||null would silently null out real candidate data on every save — data-safety on a live-prod system with real candidate rows
- [Phase 07]: 07-03: Record<keyof T, true> exhaustiveness assertion (not the plan-suggested satisfies-array) for the embedding-invalidation contract test's compile-time binding to CandidateEmbedFields — catches both field-added and field-removed drift at typecheck time; satisfies-array only catches removal
- [Phase 07]: 07-05: timeouts.start=5m / timeouts.finish=10m on embed-batch + reconcile-cv-parses — ~10x healthy runtime, bounds a wedged concurrency-1 run without falsely cancelling legitimate slow runs
- [Phase 07]: 07-05: regression test uses source inspection (node:fs + regex) rather than importing the Inngest function modules, since import pulls in @/lib/supabase/service, @/lib/env and the Sentry SDK requiring a populated server env the unit suite doesn't have
- [Phase 07]: 07-05: cron-monitoring runbook recommends a Sentry Metric Alert (Number of Events, "is below 1") keyed on each heartbeat message string, not the native Sentry Crons/check-in product — the existing heartbeats use plain Sentry.captureMessage not Sentry.captureCheckIn
