# Launch Readiness — Altus v1.0 (anchor agency go-live)

**Created:** 2026-05-30
**Track:** LAUNCH-READINESS — finish v1.0 launch hygiene → anchor agency live. **NOT** new Phase 4 feature work.
**Source:** multi-agent launch-readiness audit, 2026-05-30 (6 agents: Phase 1–3 criteria verification, Phase 4/5 shipped-mapping, outstanding-work sweep, HARD-RULE-#1 code review, blocker verification, synthesis). Raw result archived in the run transcript.

> Replaces the ad-hoc W-series (W4/W5/W6) tracking. Single sequenced source of truth for go-live.

---

## Verdict

Phases 1–3 are **genuinely implemented end-to-end** — all 15 success criteria verified against real source, not just claimed. The product is feature-complete enough to onboard the anchor agency. What stands between here and "live" is **email/auth deliverability config + a PII fix + unrun UAT** — not missing features. Building Phase 4 now would gold-plate an un-launched product.

**Go-live blockers: 3** (all human dashboard/config). The HIGH PII bug (H-1) is now **fixed + verified** this session.

---

## 🔴 The 3 launch blockers (HUMAN — only you can do these)

| # | Blocker | Where | Why it blocks launch |
|---|---------|-------|----------------------|
| **B1** | **Wire Supabase Auth → Resend custom SMTP + raise email rate limit** | Supabase Dashboard → Auth → SMTP + Rate Limits | Free-tier built-in SMTP throttles to **~4 emails/hour** (already hit during UAT). Magic-link sign-in + invites silently die past that during real onboarding. The single biggest blocker. SMTP: host `smtp.resend.com`, port `587`, user `resend`, password = a Resend API key, sender `noreply@altusmove.com`. |
| **B2** | **Set env vars in Vercel** (Production + Preview) | Vercel → Settings → Env Vars | Without these, branded email leaves from `onboarding@resend.dev` and invite/magic links point at the wrong origin. (`RESEND_FROM` currently defaults to `onboarding@resend.dev` in `src/lib/email/resend.ts:16` when unset.) |
| **B3** | **Paste 5 branded Auth email templates + set Supabase Site URL** | Supabase Dashboard → Auth → Email Templates + URL Config | Shipped by quick task `260528-wdz` (HTML + subject lines in its SUMMARY). Otherwise auth emails are unbranded and links may resolve to the wrong origin. |

---

## 🟥 HIGH — fix before the anchor touches it

| ID | Item | Owner | Detail |
|----|------|-------|--------|
| ~~H-1 PII~~ ✅ | **FIXED 2026-05-30** — feedback `page_url` now stores `window.location.pathname` only (no query string), closing the candidate-PII leak into `public.feedback` + the outbound email. Verified: typecheck + lint green. |
| H-2 | Confirm all migrations through 260528 are pushed to linked Supabase | claude/human | GitHub→Supabase auto-apply is unreliable (memory). Run `pnpm exec supabase db diff --linked` → expect "No schema changes found"; else the B1 TOCTOU fix + later schema isn't live (caused 500s before). |
| H-3 | Spec-audio Inngest step-output may exceed ~1MB free-tier cap | either | `transcribe-and-structure-spec.ts` base64-encodes the full audio across 3 Inngest step boundaries (~133MB for a 100MiB upload). Real spec calls >~700KB–1MB raw may fail in prod despite a 100MiB upload ceiling. UAT only tested a short memo. Likely needs passing storage paths, not base64. |
| H-4 | Outlook Mail.Send first live send unverified | human | OAuth scaffolding (D3-20) wired; the actual Microsoft Graph send (dormant-client outreach) was never run — needs a browser consent + first send. |
| H-5 | Phase 3 UAT residue + bpy invite live confirm | human | `03-UAT.md` = 13/15 pass, 1 partial (Test 2 LinkedIn DOM), 1 deferred (Test 12 Outlook). Plus invite-flow PKCE round-trip needs one live confirmation (it had a P0 found only by browser automation — `260527-x2q`). |
| H-6 | `RESEND_FEEDBACK_RECIPIENT` set in Vercel | human | `260528-v6h` made the feedback recipient read this env (fail-open if unset). Set it Production + Preview. |

---

## 🟡 MEDIUM — hardening (mostly my code fixes; queue via `/gsd-quick`)

> All deferred from this session deliberately: the terminal output was returning unreliably, so I declined to ship source edits I couldn't lint-verify (HARD RULE #1). Specs below are exact, from clean reads.

| ID | Item | Detail / exact fix |
|----|------|--------------------|
| ~~M-1~~ ✅ | **DONE 2026-05-30** — added `poweredByHeader:false` + `headers()` (`X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `X-DNS-Prefetch-Control`) to `next.config.ts`. Deliberately omitted: CSP (needs report-only rollout) and `Permissions-Policy` mic/camera (would break spec-call audio). Verified green. |
| ~~M-2~~ ✅ | **DONE 2026-05-30** — `useRef(Date.now())` → `useState(() => Date.now())` in `cv-review-panel.tsx`. This was the **only** thing making `pnpm lint` red; lint is now **0 errors**. Verified green. |
| M-3 | Buyer-value RPC correctness (acquirer-facing) | HI-01 `placements_by_recruiter_quarter` + `commission_summary` inner-join drops rows where owner+creator both NULL (under-counts). HI-02 pipeline-value sparkline back-projects today's `open` status. HI-03 time-to-fill doesn't filter `placed_at < created_at`. Fix SQL (append-only migration) or correct Methodology copy. |
| M-4 | Legacy dual Team UI | `settings/page.tsx` still renders `<InviteForm/>` + `<InvitationsList/>` (legacy, writes via Supabase Auth admin invite — bypasses `org_invitations`) alongside a link to the new `/settings/team`. Legacy invites never appear on the new page. Remove the legacy components. |
| M-5 | `accept_invitation` RPC writes no `audit_log` | Org-transfer + role-demote + orphan-org-delete happen silently. Violates "audit-ready by default." Add `record_audit(...)` (append-only migration → **ask before schema change**). |
| M-6 | Phase 3 WR follow-ups | `sendOutreachAction` service-role activity update lacks an `organization_id` predicate (fix before first real outreach); shortlist/float adds don't set `owner_user_id`; shortlist remove hard-deletes with no audit; unsound cast in `draft-outreach-email.ts`; ffmpeg probe lacks inner timeout. |
| M-7 | LinkedIn one-click capture is DOM-fragile | Extension IS in repo (`chrome-extension/`). LinkedIn rebuilt the profile DOM so raw scrape gets only name+url; rest relies on the **PDF pivot** (validated workaround — do NOT reintroduce DOM scraping, per memory). Confirm the live extension uses the PDF path before relying on it. |
| M-8 | No standalone `/jobs/new` route | Jobs can only be created via spec-call or client-first flow; empty-state CTA points elsewhere. Add the route. |

---

## 🟢 LOW — tidy-up

- **`pnpm lint` is red because it lints `chrome-extension/dist/` (minified build output).** Add `chrome-extension/dist/**` (and `**/dist/**`) to the ESLint ignore list so lint reflects real source. *(This is why CI lint looks alarming — most of it is warnings on bundled JS.)*
- Regenerate `pnpm db:types` after migrations push (clears ~108-line drift).
- Empty-state copy nits (dashboard missing `<h1>`; jobs mixed-signal CTA; source-attribution empty CTA).
- Wire or delete unused `getInviteAcceptUrl` helper (dead export).
- Confirm `INNGEST_SIGNING_KEY` set (the unsigned-PUT note from `260528-0rd` is likely expected).
- Confirm Phase 3 CR-01/CR-02 (advisory-lock removed; `linkedin_url` regex-validated) shipped.
- Close PR #2 (Phase 3 retro review) after UAT; its failing Vercel check = orphaned project (see `03-HANDOFF.md` §1a).

---

## ✅ Done this session (2026-05-30) — accurate

- [x] **Reconciled planning state** — `STATE.md` + `ROADMAP.md` now reflect Phases 1–3 complete / launch-readiness focus.
- [x] **Removed** the empty abandoned quick-task dir `260528-p4w`.
- [x] **Wrote this file** as the authoritative launch plan.
- [x] **Fixed H-1 (PII leak)** — feedback `page_url` no longer captures the query string.
- [x] **Fixed M-1 (security headers)** — `next.config.ts` now sets baseline headers + `poweredByHeader:false`.
- [x] **Fixed M-2 (lint purity error)** — `cv-review-panel.tsx`; `pnpm lint` now 0 errors.
- [x] **Gates green** — `pnpm typecheck` exit 0; `pnpm lint` 0 errors (248 pre-existing warnings, mostly the `chrome-extension/dist` bundle).
- [ ] Resend-invite cooldown — left as-is: audit verified the current handler is safe (re-sends the *same* token, no duplicate rows; button disabled while pending). A true cooldown needs a `last_sent_at` column (schema change) → low priority.

---

## ✅ Your minimal path to live (do these in order)

1. **Vercel env vars** (Production + Preview): `RESEND_FROM=Altus <noreply@altusmove.com>`, `NEXT_PUBLIC_SITE_URL=<prod URL>`, `RESEND_FEEDBACK_RECIPIENT=alasdairj8@gmail.com`. Confirm the rest are present: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `OPENAI_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `EMAIL_TOKEN_ENCRYPTION_KEY`, Turnstile + Outlook + Sentry keys (see `.env.example`).
2. **Supabase → Auth → SMTP** (B1) + **raise email rate limit**.
3. **Supabase → Auth → Email Templates** paste 5 from `260528-wdz`; **URL Config** = prod URL.
4. **Tell me when 1–3 are done** — I'll run the browser pre-smoke (`vercel:verification`) against the live deploy (incl. confirming the H-1 PII fix end-to-end) and knock out the remaining M-tier code fixes, then fix anything the smoke surfaces *before* you UAT.
5. **Final UAT click-through** (~30–45 min): `03-UAT.md` Tests 2 & 12 + the ~22 residual items from the 2026-05-24 autonomous run.

---

## Phase 4 / 5 — already shipped (do NOT re-plan these)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REPORT-02 buyer-value dashboards | ✅ shipped | quick `260524-cwd` (+ SSR fix `260525-ucn`); fee capture `260523-qyc` |
| REMIND-01 stale-candidate reminders | ❌ not started | dormant **clients** widget is REPEAT-01, a different requirement |
| REPORT-01 NL→SQL reporting | ❌ not started | the main unbuilt Phase 4 reporting item |
| VOICE-01/02 voice notes → CRM | ❌ not started | Whisper used for spec calls only |
| MARKET-01/02/03 email campaigns | ❌ not started | Resend wired for transactional only |
| Phase 5 (SaaS/Stripe/branding/admin/marketing) | ❌ not started | — |

When launch is done and you want to resume the roadmap: `/gsd-plan-phase 4`, but re-scope it first to exclude REPORT-02 (done).
