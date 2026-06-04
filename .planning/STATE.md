---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: launch-readiness
last_updated: "2026-06-04T17:43:41.119Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 18
  completed_plans: 13
  percent: 40
---

# Project State: Altus — AI-First Recruitment CRM

**Initialized:** 2026-05-17
**Last updated:** 2026-05-17

---

## Project Reference

**Core value:** A recruiter can find the right candidate for a job in seconds using natural language — backed by AI parsing of every CV, semantic search across the database, and Sonnet-generated match explanations.

**Current focus:** v1.0 launch — **all 3 launch blockers (B1 custom SMTP, B2 Vercel env, B3 auth templates) cleared & verified LIVE on 2026-06-02**, plus all M-tier hardening (M-3/4/5/6/8) shipped and verified (HTTP probes + live DB SQL + user click-through). Magic-link sign-in delivers branded from `noreply@altusmove.com`, `/jobs/new` creates jobs, and the buyer-value/audit migrations are live. The anchor agency can now onboard. Remaining = the **final UAT click-through** (03-UAT Tests 2 & 12 + the ~22 residual items from the 2026-05-24 run) — NOT new Phase 4 feature work. See [LAUNCH-READINESS.md](LAUNCH-READINESS.md).

**Milestone:** Get anchor customer using the app internally, then demo Phase 2 AI capabilities.

---

## Current Position

**Phases 1–3: COMPLETE.** All 15 success criteria verified end-to-end in code by the 2026-05-30 launch-readiness audit (multi-agent). Only LinkedIn one-click DOM capture is flagged fragile (documented PDF-pivot fallback).
**Phase 4 (Voice, Marketing & Reporting): NOT STARTED** — but REPORT-02 (buyer-value dashboards) already shipped via quick task 260524-cwd, and REMIND-01 (stale-candidate / dormant-client reminders) is partially shipped via dashboard widgets. REPORT-01 (NL→SQL), VOICE-01/02, MARKET-01/02/03 are genuinely unbuilt.
**Phase 5 (SaaS Shell): NOT STARTED.**

**Track:** v1.0 launch — anchor agency can go live. **0 launch blockers remain (all cleared & verified 2026-06-02).** Remaining is the final UAT click-through (see LAUNCH-READINESS.md).

```
Overall:  [============>        ] 3 of 5 phases complete (60%)
```

---

## Completed Work

> ⚠️ This file previously tracked Phase 1 as "Tasks 3–7 not started." That was **stale** — all of it shipped long ago. Corrected 2026-05-30. Full detail lives in the phase SUMMARYs and the Quick Tasks table below.

**Phase 1 — Internal ATS (COMPLETE).** Candidates + GDPR consent gate + audit log; CV upload → Haiku parse (Inngest) → review/accept panel; clients + nested contacts + combined activity timeline; jobs + applications + pipeline kanban with structured decline reasons (auto-logged); dashboard metrics/feeds/stale-alerts/follow-ups; org invitations. (Artifact note: only `01-03-clients-SUMMARY.md` was written; the other plan summaries were never backfilled — phase is functionally complete regardless.)

**Phase 2 — Search, Match & Intake (COMPLETE, 2026-05-19).** 5/5 plans: Voyage embeddings + RRF hybrid semantic search; Sonnet 0–100 match scoring with cached explanations; public apply form with 5 abuse layers; Outlook/M365 OAuth + delta-sync.

**Phase 3 — LinkedIn, Spec Workflow & Shortlists (COMPLETE, 2026-05-20).** 7/7 plans: LinkedIn ingest API + Voyage embed; spec audio → Whisper → Sonnet JD draft → approve → job; shortlists/floats; job ads + inclusivity rubric; dormant-client outreach; source attribution. (Open: LinkedIn one-click DOM capture is fragile — see LAUNCH-READINESS.md.)

---

## Performance Metrics

**Requirements mapped:** 53/53 v1 requirements
**Requirements complete:** 6 (FOUND-01..06)
**Requirements pending:** 47
**Phases defined:** 5
**Plans created:** 0

---

## Accumulated Context

### Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| 5-phase structure (coarse granularity) | Natural delivery boundaries matching strategic milestones: ATS → AI differentiation → competitive features → full workflow → SaaS |
| Phase 6 (Temp/Contract) deferred to v2 | Anchor customer is perm-heavy; temp adds timesheets, IR35, margin complexity — not needed for initial value delivery |
| Phase 1 success criteria reflect Tasks 3–7 only | Tasks 1–2 already merged; FOUND requirements already Complete |
| Inngest required before Task 4 | CV parsing is async >2s — must not block HTTP handlers per CLAUDE.md constraint |

### Active Tech Debt (from CONCERNS.md)

- `src/lib/ai/` directory missing — must be created in Task 4 before any Claude calls
- `src/lib/db/` directory missing — establish before Task 3 to avoid query sprawl
- Inngest not installed — required before Task 4 (CV parsing background jobs)
- `pnpm-workspace.yaml` has malformed boolean values — low-priority fix
- `src/proxy.ts` should be `src/middleware.ts` — verify middleware is active
- Open redirect in `/auth/callback` — fix `?next=` validation before production use
- Cross-tenant FK integrity gap (contacts→companies, jobs→companies, applications→candidates/jobs) — add trigger/check before Phase 2 goes live
- `@ts-nocheck` in `database.ts` — regenerate types cleanly after next schema change

### Known Blockers

None currently. Tasks 3–7 can proceed in order.

### Critical Invariants (never violate)

- Every Claude call must log to `ai_usage` via `record_ai_usage()` — non-negotiable for SaaS pricing
- Every candidate detail view must write to `audit_log` via `record_audit()` — GDPR compliance
- No RLS bypass — ever. Fix the policy, don't disable it.
- No synchronous AI calls in request handlers if latency may exceed 2s — use Inngest
- No auto-send of emails to candidates — always require recruiter approval
- `service_role` key only in Inngest background jobs, never in client-side code

---

## Session Continuity

**Status (2026-06-02 EOD):** v1.0 is **LIVE** at https://altus-recruitment.vercel.app. Launch blockers B1/B2/B3 done + verified. All M-tier fixes (M-3/4/5/6/8) shipped, deployed, and **verified live via an autonomous Playwright + Gmail browser smoke** (see [[autonomous-smoke-playwright-gmail]] memory): M-8 create, H-1 PII strip, M-3 Unattributed bucket, M-5 audit, M-4 Team UI, M-6b shortlist add, M-6c remove-audit-note, Tests 1/14/15, and a clean 15-page render smoke (0 console/page errors). **No bugs found.**

**Open for tomorrow:**

1. **New domain** — buy it, then wire to Vercel (project `altus-recruitment`, ids in [[vercel-project-ids]]) + update `NEXT_PUBLIC_SITE_URL` (Vercel Prod+Preview) + Supabase Auth Site URL + Redirect URLs **together**, redeploy, verify.
2. **Delete the smoke test job** `"UAT smoke — safe to delete…"` (id `549a5feb-1638-4ebd-9577-fda044efab45`) in org AJ. (Also harmless: a "Removed from shortlist" note on Dave Bassett + 1 H-1 feedback row — leave or clean.)
3. **Residual 03-UAT** (need artifacts I can't supply): Tests 2/3 (LinkedIn extension), 4/5 (`.mp3` spec audio), 12 (Outlook OAuth+send). Tests 6/7/11/13 render clean — quick click-through.

**Resume:** drive whatever's automatable via the Playwright+Gmail smoke path (alasdairj8@gmail.com / org AJ).

---

## Quick Tasks Completed

| Quick ID | Description | Date | Commits | Summary |
|---|---|---|---|---|
| 260523-qyc | Placement-fee capture modal — prompt for fee/date/type on move-to-placed; persist via new applications columns; surface revenue in source-attribution | 2026-05-23 | e996e0d, ac4df51 | [SUMMARY](quick/260523-qyc-add-placement-fee-capture-modal-prompt-f/260523-qyc-SUMMARY.md) |
| 260523-ret | Mobile UX overhaul — hamburger drawer nav + condensed mobile header + table-to-card transformations on /candidates, /clients, /jobs, /floats | 2026-05-23 | af56ac4, b556468, 5060e4c | [SUMMARY](quick/260523-ret-mobile-ux-overhaul-phone-navigation-betw/260523-ret-SUMMARY.md) |
| 260523-sns | Wave 1 hygiene — backfilled Phase 2 plan summaries, marked Phase 2 complete in ROADMAP, regenerated database.ts (~108-line drift cleared), fixed two pre-existing lint errors, un-aged Aberdeen Renewables demo data | 2026-05-23 | b8fdb69, cb4f7df, 578c06a | [SUMMARY](quick/260523-sns-wave-1-hygiene-backfill-phase-2-plan-sum/260523-sns-SUMMARY.md) |
| 260523-tje | Ad-save UX polish — full saved-ad render + per-row Copy/View/Delete dropdown + View dialog rendering inclusivity suggestions on /jobs/[id] | 2026-05-23 | 7d28560, c469ffa | [SUMMARY](quick/260523-tje-ad-save-ux-polish-full-saved-ad-render-p/260523-tje-SUMMARY.md) |
| 260524-b6v | In-app feedback widget — floating MessageSquarePlus FAB on authenticated pages, shadcn Dialog with required Textarea (max 2000 chars), server action persists to new `feedback` table with RLS + `_set_org` trigger, best-effort Resend email to alasdairj8@gmail.com (fails open if RESEND_API_KEY unset) | 2026-05-24 | a9e105b, e06f9c8, 3eedd96 | [SUMMARY](quick/260524-b6v-in-app-feedback-widget-floating-button-d/260524-b6v-SUMMARY.md) |
| 260524-bpy | Org member invitation flow — `org_invitations` table + atomic `accept_invitation` RPC + Settings → Team page with InviteMemberDialog + per-row Revoke/Resend; `/accept-invite/[token]` route handler sets host-only invite cookie; `/auth/callback` short-circuits org-bootstrap when invite cookie present (fresh-org invariant preserved for non-invited sign-ups) | 2026-05-24 | 87f055f, bf4536c, 4d4a5db, 8ef2bac | [SUMMARY](quick/260524-bpy-org-member-invitation-flow-magic-link-to/260524-bpy-SUMMARY.md) |
| 260524-cjl | Empty-state polish across 8 index pages — extended EmptyState with optional secondaryCta prop; richer heading/body/primary+secondary CTAs on candidates, clients, jobs, pipeline, floats, spec, reports/source-attribution, dashboard. Bespoke empty divs on floats/spec collapsed onto shared EmptyState. `/jobs/new` route absent — flagged as Phase 4 follow-up. | 2026-05-24 | 5699230, 6e50a41 | [SUMMARY](quick/260524-cjl-empty-state-polish-across-8-index-pages/260524-cjl-SUMMARY.md) |
| 260524-cwd | Buyer-value dashboards (REPORT-02) at `/reports/buyer-value` — 5 acquirer-due-diligence metrics (placements per recruiter per quarter, time-to-fill, source ROI, pipeline value + sparkline, commission summary) via Recharts `^3.8.1`, 4 net-new security-invoker RPCs, URL-param date filter (preset 30/90/365 + custom, default 90), mobile-responsive shells, Methodology `<details>` appendix. Source ROI reuses existing `source_attribution_summary` RPC. | 2026-05-24 | d2eb202, f13fa5c, 5bfb6d0, c3156d8 | [SUMMARY](quick/260524-cwd-buyer-value-dashboards-report-02-rechart/260524-cwd-SUMMARY.md) |
| 260524-iav | Task 2 security blocker fixes (B1/B2/B3 from REVIEW.md) — (B1) `accept_invitation` RPC now takes `FOR UPDATE` on orphan org row before user-count, closing TOCTOU window that could silently obliterate concurrent sign-up orgs; (B2) sign-in `inviteMode` derived server-side from `altus_invite_token` cookie via `next/headers`, removing `?invite=1` URL spam vector that could create junk `auth.users` + `organizations` rows; (B3) `resolveOrigin()` precedence inverted to `NEXT_PUBLIC_SITE_URL → origin → x-forwarded-host`, defeating invite-link domain injection via untrusted `X-Forwarded-Host`. Append-only migration `20260524000300`. Operator must set `NEXT_PUBLIC_SITE_URL` in production. | 2026-05-24 | 3f34d41, 3ac51fc, c79d03a | [SUMMARY](quick/260524-iav-task-2-security-blocker-fixes-accept-inv/260524-iav-SUMMARY.md) |
| 260524-is2 | UX blocker fixes (T3 BL-01 + T4 BL-01 from REVIEWs) — (A) candidates empty state no longer ships dishonest "Or upload a CV to auto-extract" secondary CTA → `/candidates/new` (the form has no CV upload); replaced with single primary CTA + honest body copy explaining CV upload becomes available after the candidate exists. (B) Pipeline-value marquee headline now uses new `formatGbpRound` helper (`Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })`) — renders `£2,000,000` with separators instead of `£2000000.00`. `formatPence` left byte-identical so two-decimal call sites elsewhere are unaffected. | 2026-05-24 | 39b6b4f, 1e3f1e0 | [SUMMARY](quick/260524-is2-ux-blocker-fixes-candidates-empty-state-/260524-is2-SUMMARY.md) |
| 260525-ucn | Production build fix — Next.js 16 disallows `dynamic({ ssr: false })` in Server Components. Moved the three chart-wrapper dynamic imports out of `buyer-value/page.tsx` (RSC) into new Client Component `buyer-value/_components/charts-bundle.tsx`. Page imports `StackedBar` / `HorizontalBar` / `Sparkline` from the bundle; chart behaviour byte-identical. Lesson: `tsc --noEmit` doesn't catch the rule violation — only `pnpm build` does. The bug shipped in 260524-cwd because local typecheck passed; verify gates on chart-touching changes must include `pnpm build`. Discovered during UAT prep when 3 production deploys errored. | 2026-05-25 | 3948075 | [SUMMARY](quick/260525-ucn-fix-buyer-value-ssr-false-in-server-comp/260525-ucn-SUMMARY.md) |
| 260527-x2q | **P0 invite-flow fix** — added `/accept-invite` to `src/lib/supabase/middleware.ts` `PUBLIC_PATHS`. Original 260524-bpy shipped `/accept-invite/[token]/route.ts` as the public entry point for invite links, but never updated the middleware allowlist — so unauthenticated invitees (the common case) got intercepted and redirected to `/sign-in?next=...` BEFORE the route handler ran. Cookie was never set, `/auth/callback` found no cookie, fresh-org bootstrap fired, invitee landed in a brand-new org instead of the inviter's. Invitation flow completely broken for new users. **Discovered by pre-UAT browser-automation pipeline (HARD RULE #1 vindicated)** — all 4 prior code reviews + /security-review missed it because each looked at the route handler in isolation. | 2026-05-27 | 57d028c | [SUMMARY](quick/260527-x2q-p0-fix-add-accept-invite-to-middleware-p/260527-x2q-SUMMARY.md) |
| 260528-0rd | **P1 PWA/SEO fix** — extended `src/middleware.ts` matcher to exclude `/manifest.webmanifest`, `/icon`, `/apple-icon`, `/robots.txt`, `/sitemap.xml`, and `.ico` extension. Original matcher only excluded `_next/static`, `_next/image`, `favicon.ico`, and 6 image extensions — so the PWA manifest + Next.js metadata icon routes + SEO files all got intercepted by `updateSession()` and 307'd to `/sign-in`. Broke iOS/Android "Add to home screen" install (relevant given the 260523-ret mobile-first overhaul). **Discovered by pre-UAT Agent B (HTTP-level deep smoke)** — second HARD RULE #1 vindication in the same session. Deferred from this fix: H1 unsigned Inngest PUT (likely expected Inngest behaviour), H2/H3 security response headers (CSP, X-Frame-Options, Referrer-Policy, X-Content-Type-Options, poweredByHeader: false) — bundle into a single `next.config.ts` `headers()` block pre-customer-demo. | 2026-05-28 | 6eacc70 | [SUMMARY](quick/260528-0rd-p1-fix-extend-middleware-matcher-to-excl/260528-0rd-SUMMARY.md) |
| 260528-v6h | **W5 prep (UAT fix queue)** — feedback recipient now reads from `RESEND_FEEDBACK_RECIPIENT` env var instead of the hardcoded `aj@altus-consultancy.com` constant. Fail-open if unset (Sentry warning, DB row still canonical). Unblocks the impending `RESEND_FROM` swap from `onboarding@resend.dev` → `noreply@altusmove.com` (W5 launch-blocker; verified `altusmove.com` is fully verified in this Resend account during 2026-05-28 UAT session). Sister item W4 (Supabase Auth → Resend SMTP — kills the ~4/hour Supabase free-tier rate limit hit during the same session) is dashboard config, no code change. **Followup before next deploy:** set `RESEND_FEEDBACK_RECIPIENT` in Vercel (Production + Preview) and update `RESEND_FROM` to the verified altusmove.com sender. | 2026-05-28 | 16d6dbf | [SUMMARY](quick/260528-v6h-wire-feedback-recipient-to-env-var-w5-pr/260528-v6h-SUMMARY.md) |
| 260528-wdz | **W6: Altus Recruit branded transactional emails** — Ported the Altus Move email-template pattern (`src/lib/email/{escape,render}.ts`), adapted for the Altus Recruit brand (Midnight `#0A3D5C` header band + Mint `#5DCAA5` button + Cloud `#F4F6F8` footer; system font stack only per the handoff.md email-safety rule). New `renderTransactionalEmail` + `renderTransactionalEmailText` helpers do safe HTML-escape on every interpolated string and `sanitiseUrl`+escape on button hrefs. Logo SVG hosted at `/public/email/altus-recruit-logo.svg`, referenced via `NEXT_PUBLIC_SITE_URL`, with a Midnight-on-text wordmark fallback when the env is unset. Wired feedback action + invite/resend actions to send HTML+text; subject lines tightened. Shipped 5 paste-able Supabase Auth template HTML files (magic-link/recovery/confirmation/invite/change-email) + dashboard README with subject lines + Site URL setup note. Visual sanity confirmed via temp Node 24 render-to-`/tmp` script (deleted after check). `pnpm typecheck` PASS, `pnpm lint` PASS (only pre-existing `cv-review-panel.tsx:98` unrelated). `pnpm build` fails locally on env-var validation (Supabase/Anthropic required vars not in local env — pre-existing, project-documented); Vercel build unaffected because envs are set there. **Followup:** paste the 5 templates into Supabase Dashboard → Auth → Email Templates with the README's subject lines, and confirm Site URL is set to the deploy URL. | 2026-05-28 | 3fbd9de | [SUMMARY](quick/260528-wdz-altus-recruit-branded-transactional-emai/260528-wdz-SUMMARY.md) |
| 260603-fv0 | **In-app Help / cheat-sheet page** — new static RSC `/help` under `(app)` with ten feature sections (dashboard, candidates + AI CV parsing, semantic search, clients, jobs, spec→job, pipeline/shortlists/floats, reports, team & settings, integrations), each with a PII-safe `ScreenshotSlot` placeholder (role="img"+aria-label; no `next/image` until seed/demo captures exist — never tenant data). Help nav entry added to desktop `NAV_ITEMS` + mobile `SECONDARY_NAV`. `/help` added to the prod smoke inventory (anon auth-guard + authed render). gsd-code-review: 0 critical (2 in-scope fixes applied; 2 pre-existing left). lint + typecheck green. | 2026-06-03 | 556e0f8, f118674, 850f08e | [SUMMARY](quick/260603-fv0-build-in-app-help-cheat-sheet-page-help-/260603-fv0-SUMMARY.md) |
| 260603-gdz | **Onboarding UX** — (1) data-driven first-run welcome checklist on the dashboard (auto-ticks from real counts via new `getOnboardingCounts`; only the dismiss flag in localStorage, SSR-safe) + richer dashboard empty-state hero; (2) tighter empty states on candidates/clients/jobs + owner-only "Invite your team" card & role explainer on /settings; (3) optimistic invite UI — new `team-invites.tsx` consolidates the invite dialog + pending list into one `useOptimistic` store so send/resend/revoke reflect instantly, honouring the CLAUDE.md mutation rule (revert + toast.error on every failure, no silent false-success); replaced/deleted the 3 old invite button/dialog components. gsd-code-review: 0 critical, 3 warnings fixed (WR-01 optimistic-ghost dedupe, WR-03 duplicate settings card merged). lint+typecheck green; live browser pre-smoke green (no regression on populated org). **UAT note:** first-run checklist/empty-states + a live invite send need an empty/seed org to fully exercise. (Executor died on Task 3 via API socket error; orchestrator completed it + pipeline.) | 2026-06-03 | ae16b28, 696fbde, 25fe984, 43d0cc0 | [SUMMARY](quick/260603-gdz-onboarding-ux-first-run-welcome-checklis/260603-gdz-SUMMARY.md) |
| 260604-cn5 | **Pre-client final-sweep fixes** — fixed the 3 Critical + 17 High demo-blockers from the 2026-06-04 full code+UI review (`docs/final-review-2026-06-04.md`; 275-agent sweep, 8 domains × 5 lenses, every finding adversarially verified). Criticals: (1) auto match-scores now persist — threaded the job's verified `organization_id` through `upsertMatchSummary` so the service-role insert stops RAISE-ing on the NULL-org `set_organization_id` trigger; (2) revenue reports no longer crash / show garbage — coerce PostgREST numeric/bigint strings via `Number()` at the `getSourceAttribution` + 4 buyer-value DB-helper boundaries, and surfaced the buyer-value report on `/reports`; (3) LinkedIn capture works — added `/api/linkedin/ingest` to `PUBLIC_PATHS` + new `createBearerClient` token-scoped RLS client. Highs across candidates/clients/jobs/spec/settings: phantom float/shortlist rows filtered off candidate page, write-boundary email lowercasing for dedup, Dormant badge clears on check-in send (+flip-error surfaced), placement fee parses UK `£7,500` correctly, free-text-currency Intl guard, `router.refresh()` on add-candidate/shortlist/CV-upload/accept-all, MSAL rotated-RT snapshot-diff isolation, first-connect Outlook persistence via explicit org, accurate Outlook scope copy, team-invite `emailDelivered` warning instead of false-success, spec→job emits `job/embed`, sub-recreate throws on failed write, built the missing client edit page. **Zero migrations.** typecheck+lint+vitest (198) green; adversarial regression review of the 28-file diff: 0 critical/high/medium, 2 low residual (legacy mixed-case email backfill; MSAL cross-invocation hardening) deferred. **Followup before demo:** verify `RESEND_API_KEY` + `NEXT_PUBLIC_SITE_URL` in Vercel; run browser pre-smoke on the 10 must-pass flows; merge `fix/demo-blockers-260604`. | 2026-06-04 | ecd7d1b, c1ff247, 1fee339, 5da880d, 7cc0b3a, 5aa6119, 45f9b54, 75782dd, 79ff50b, 85644ea, cca8bc0 | [SUMMARY](quick/260604-cn5-fix-demo-blockers/260604-cn5-SUMMARY.md) |

---

## Session 2026-05-24 autonomous run

Goal: round off v1.0 for handover to anchor friend's recruitment agency. Four `/gsd-quick` tasks executed in strict order with worktree isolation, plan-check + verify gates, supabase db push + types regen out-of-band, and push-to-main after each.

| # | Task | Quick ID | Source commits | Docs / types commits | Verifier verdict |
|---|------|----------|----------------|----------------------|------------------|
| 1 | In-app feedback widget | 260524-b6v | a9e105b, e06f9c8 | 3eedd96, 36e51fd | human_needed (8/8 truths verified at code level; 9 UAT items remain) |
| 2 | Org member invitation flow | 260524-bpy | 87f055f, bf4536c, 4d4a5db | 8ef2bac, fd66db3 | human_needed (11/11 truths verified at code level; 6 runtime checks remain) |
| 3 | Empty-state polish across 8 index pages | 260524-cjl | 5699230, 6e50a41 | a7630f0 | human_needed (7/7 truths verified at code level; 2 browser checks remain) |
| 4 | Buyer-value dashboards (REPORT-02) | 260524-cwd | d2eb202, f13fa5c, 5bfb6d0 | c3156d8 | human_needed (12/12 truths verified at code level; 5 browser/runtime checks remain) |

### What ran successfully without intervention

- All four `/gsd-quick` invocations: planner → plan-checker (1 revision loop on 260524-bpy for orphan-org atomicity; passed on second iteration) → executor (worktree isolation) → worktree merge → migration push + types regen → verifier → STATE update → push to main.
- Three Supabase migrations pushed to linked DB: `20260524000000_feedback`, `20260524000100_org_invitations`, `20260524000200_buyer_value_rpcs`. All applied cleanly; types regenerated cleanly via `pnpm db:types` (each regen replaced the executor's hand-patched stub with canonical introspection output).
- `pnpm typecheck` passes after every task. `pnpm lint` clean on all touched files; one pre-existing error in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` ("Cannot call impure function during render") logged across deferred-items.md in 260524-b6v, 260524-cjl, 260524-cwd — noted but out of scope for every task in this run.

### Autonomous decisions worth user review

- **260524-bpy revision loop:** Plan-checker flagged Task 1 over-scope, missing null-email guard, and orphan-org cleanup TOCTOU. Decided autonomously to (a) fold cookie.ts + lookup.ts into Task 3, (b) add explicit null-email guard before any service-role work, (c) replace ad-hoc orphan cleanup with a single SECURITY DEFINER RPC `public.accept_invitation(p_token, p_user_id, p_user_email)` using SELECT...FOR UPDATE for atomicity. Granted EXECUTE only to `service_role`.
- **260524-b6v Resend `from` address:** Used `Altus <feedback@updates.altus.app>` as fallback `RESEND_FROM`. Anchor will need to verify `updates.altus.app` in the Resend dashboard before the bonus email fires (DB row writes succeed regardless). Same domain assumption applies to invitation emails in 260524-bpy.
- **260524-cwd dependency add:** Pinned `recharts ^3.8.1` per RESEARCH.md (React 19 peer support shipped in Recharts 3.x; 2.x required `pnpm.overrides`). Only net-new dep across the run.
- **260524-cwd sector bucket:** `jobs` table has no `industry` or `sector` column, so time-to-fill renders into a single `'Unspecified'` bucket with a Methodology caveat. Adding `jobs.sector` was explicitly out of scope per the orchestrator brief.
- **260524-cjl jobs CTA:** `/jobs/new` route does not exist on the schema. Wired the primary CTA to `/spec/new` (AI-first) and secondary to `/clients` instead; flagged the missing route as a Phase 4 follow-up in SUMMARY.md.

### Skipped / excluded

- **Task 5 (Outlook Mail.Send)** — explicitly excluded by orchestrator; needs user in a browser for OAuth consent. Still on the deferred backlog; the OAuth scaffolding from D3-20 is in place.

### Outstanding manual UAT

1. **260524-b6v** (9 items): visual FAB placement on each authenticated route; route-group negative test on `/sign-in`, `/sign-up`, `/apply/*`; empty-body inline error UX; success state + 1.5s auto-close; live DB row inspection; multi-tenant RLS isolation; fail-open with RESEND_API_KEY unset; real email delivery (requires Resend domain verification); server-side Zod rejection of 2001-char body.
2. **260524-bpy** (6 items): Resend email delivery; magic-link PKCE round-trip end-to-end; DB state inspection after acceptance; plain sign-up regression (fresh-org invariant); adversarial cookie tamper with Sentry breadcrumb visibility; /settings/team layout + non-owner redirect.
3. **260524-cjl** (2 items): visual + responsive layout of the 8 empty states; runtime CTA navigation.
4. **260524-cwd** (5 items): date-filter UI behaviour (preset + custom); Recharts hydration (zero console warnings); mobile 375px stack; cross-tenant RLS via two real org sessions; Methodology `<details>` toggle.

### Recommended next action

- Wire `RESEND_API_KEY` + verify the sending domain (`updates.altus.app`) in the Resend dashboard so 260524-b6v and 260524-bpy emails actually leave. Once that's done, click through the four UAT batches above (probably 30-40 mins total). After that, the v1.0 handover bundle is ready for the anchor friend's agency.
- Optional cleanup: fix the lingering `cv-review-panel.tsx:98` impure-function-during-render lint error (`React 19 react-hooks/set-state-in-effect` rule). Pattern fix is the same one used in `sign-in-form.tsx` during 260524-bpy (replace `useEffect` URL→state sync with adjust-state-during-render).
- Task 5 (Outlook Mail.Send end-to-end) when you're at a browser — D3-20 OAuth scaffolding already wired, just needs the live consent click + first send.

---

*State initialized: 2026-05-17*
