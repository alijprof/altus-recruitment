---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: MVP — AI-First Recruitment CRM
status: Milestone complete — awaiting next milestone
last_updated: "2026-06-12T07:30:00.000Z"
last_activity: 2026-06-12 — Milestone v1.0 completed, archived, and tagged
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 31
  completed_plans: 31
  percent: 100
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

All 6 go-live blockers from `.planning/audits/PRE-LAUNCH-AUDIT-2026-06-18.md` fixed in code on `main` (local; not yet pushed). Every fix passed typecheck + lint + 286 unit tests. Two Opus code reviews run (fix #1 standalone; fixes #2–6 consolidated) — both clean (0 critical/high), 3 review warnings remediated in 0700a4a. **Remaining mandatory gate: ONE browser pre-smoke against a deployed preview** (needs a push/deploy — awaiting founder go-ahead).

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

### Still required before real paying customers (NOT code)
- **Browser pre-smoke** of the deployed preview (entitled-org happy path not locked out; marketing copy; /privacy + /terms reachable; apply form).
- **Blocker 3 residual:** /privacy is a TEMPLATE — needs a UK DP solicitor review + [placeholders] filled; DPA + ROPA are separate org deliverables.
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
