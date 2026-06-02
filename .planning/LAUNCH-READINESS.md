# Launch Readiness — Altus v1.0 (anchor agency go-live)

**Created:** 2026-05-30
**Track:** LAUNCH-READINESS — finish v1.0 launch hygiene → anchor agency live. **NOT** new Phase 4 feature work.
**Source:** multi-agent launch-readiness audit, 2026-05-30 (6 agents: Phase 1–3 criteria verification, Phase 4/5 shipped-mapping, outstanding-work sweep, HARD-RULE-#1 code review, blocker verification, synthesis). Raw result archived in the run transcript.

> Replaces the ad-hoc W-series (W4/W5/W6) tracking. Single sequenced source of truth for go-live.

---

## Verdict

Phases 1–3 are **genuinely implemented end-to-end** — all 15 success criteria verified against real source, not just claimed. The product is feature-complete enough to onboard the anchor agency. What stands between here and "live" is **email/auth deliverability config + a PII fix + unrun UAT** — not missing features. Building Phase 4 now would gold-plate an un-launched product.

**Go-live blockers: 0 — ALL CLEARED & VERIFIED LIVE 2026-06-02.** B1 (custom SMTP), B2 (Vercel env), B3 (auth templates + Site URL) are all done; magic-link sign-in delivers branded from `noreply@altusmove.com`, the M-tier code fixes are all live-verified, and H-1 (PII) is fixed + DB-corroborated. The anchor agency can onboard. What remains is the **final UAT click-through** (not a blocker).

---

## ✅ The 3 launch blockers — ALL CLEARED & VERIFIED 2026-06-02

| # | Blocker | Status |
|---|---------|--------|
| **B1** | Supabase Auth → Resend custom SMTP + raised email rate limit | ✅ **DONE + VERIFIED** — magic-link sign-in email delivers, branded, from `noreply@altusmove.com`. User-confirmed live. The single biggest blocker is gone. |
| **B2** | Vercel env vars (Prod + Preview): `RESEND_FROM`, `NEXT_PUBLIC_SITE_URL`, `RESEND_FEEDBACK_RECIPIENT` | ✅ **DONE + VERIFIED** — feedback email delivered to the configured recipient from the branded sender; redeploy `fba2125` applied them. |
| **B3** | 5 branded Auth email templates + Supabase Site URL | ✅ **DONE + VERIFIED** — the magic-link email rendered branded with the correct origin. |

### Live-verification scorecard (2026-06-02)

| Item | How verified |
|------|--------------|
| M-1 security headers + `x-powered-by` removed | HTTP probe on `/sign-in` |
| M-8 `/jobs/new` route + create-a-job flow | HTTP probe (gated) + user created a job live |
| M-3 buyer-value RPC fixes (LEFT JOIN/Unattributed, negative-duration filter) | SQL against live DB (`pg_get_functiondef`) |
| M-5 `accept_invitation` audit + `record_audit_explicit` | SQL against live DB |
| H-1 feedback `page_url` PII | code+deploy + DB (`public.feedback` rows all query-string-free) |
| B1 magic-link delivery (custom SMTP) | user-confirmed branded email from correct sender |
| B2 app Resend path | feedback email delivered to recipient |
| B3 branded auth template | user-confirmed magic-link render |

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
| ~~M-3~~ ✅ | **DONE 2026-06-01** — migration `20260601000000_buyer_value_rpc_fixes.sql` (applied to linked DB). HI-01: `placements_by_recruiter_quarter` + `commission_summary_by_recruiter` now LEFT JOIN with a nil-UUID **Unattributed** bucket (no placement dropped). HI-03: `time_to_fill_by_sector` excludes placements dated before job creation. HI-02 (sparkline back-projection): no historical-status table to fix it properly, so the page Methodology copy is reworded to describe it honestly. Reviewed clean. |
| ~~M-4~~ ✅ | **DONE 2026-06-01** — deleted `invite-form.tsx` + `invitations-list.tsx`, removed the legacy Team `<Card>` from `settings/page.tsx`, and removed `inviteTeammateAction`/`inviteTeammateSchema`. `/settings/team` (org_invitations-backed, audited) is now the single Team entry point. Reviewed clean — no dangling refs. |
| ~~M-5~~ ✅ | **DONE 2026-06-01** — migration `20260601000100_accept_invitation_audit.sql` (applied). Added `record_audit_explicit(org, actor, …)` (service_role only) and `CREATE OR REPLACE accept_invitation` (FOR UPDATE lock preserved verbatim) with audit rows for the org transfer + role change, the invitation accept, and the orphan-org delete (logged before delete, against the inviting org). Reviewed clean. |
| ~~M-6~~ ✅ | **DONE 2026-06-01** — (a) `sendOutreachAction` resolves caller org up-front + scopes the service-role activity read/update with an `organization_id` predicate; (b) shortlist + float adds set `owner_user_id`; (c) shortlist remove logs a `note` to the candidate timeline before the hard delete (no schema change — chosen over a soft-delete column); (d) unsound cast removed in `draft-outreach-email.ts`; (e) ffmpeg probe gets a 30s `execFile` timeout. Reviewed clean. |
| M-7 | LinkedIn one-click capture is DOM-fragile | Extension IS in repo (`chrome-extension/`). LinkedIn rebuilt the profile DOM so raw scrape gets only name+url; rest relies on the **PDF pivot** (validated workaround — do NOT reintroduce DOM scraping, per memory). Confirm the live extension uses the PDF path before relying on it. *(Not a code fix — left for live confirmation.)* |
| ~~M-8~~ ✅ | **DONE 2026-06-01** — added `/jobs/new` (`page.tsx` + `job-form.tsx` + `actions.ts` + `schema.ts`) with a client picker, `listClientOptions` helper in `db/clients.ts`, and a "New job" header button + reworked empty-state CTAs on `/jobs`. Mirrors `clients/[id]/jobs/new`. **Needs inclusion in the post-B1–B3 browser pre-smoke** (new form — HARD RULE #1). |

---

## 🟢 LOW — tidy-up

- ~~ESLint lints `chrome-extension/dist/` (minified build output)~~ ✅ **done 2026-06-01** — added `**/dist/**` + `chrome-extension/dist/**` to the ESLint ignore list. `pnpm lint` now reports **0 errors, 17 warnings** (was 248); the 17 are intentional `_`-prefixed mock params in test files (could be silenced with `argsIgnorePattern: '^_'` if ever desired).
- ~~Regenerate `pnpm db:types` after migrations push~~ ✅ done 2026-06-01 (regenerated after the M-3/M-5 push; remote history in sync).
- ~~Empty-state copy nits~~ ✅ **non-issues 2026-06-01** — dashboard `<h1>` already present (`(app)/page.tsx:53`); source-attribution already has a CTA (`page.tsx:188`); jobs mixed-signal CTA resolved by M-8. Notes were stale.
- ~~Wire or delete unused `getInviteAcceptUrl` helper~~ ✅ **deleted 2026-06-01** — confirmed dead (no callers); removed from `lib/invitations/cookie.ts`.
- ~~Confirm Phase 3 CR-01/CR-02 shipped~~ ✅ **confirmed 2026-06-01** — CR-01 advisory-lock removed (replaced by the unique constraint in `20260520065652`; documented at `linkedin/ingest/route.ts:147`); CR-02 `linkedin_url` regex-validated (`linkedin-ingest-schema.ts:49`). *(Minor: the stale flow-comment at `route.ts:25` still mentions the old advisory lock — cosmetic, left as-is.)*
- Confirm `INNGEST_SIGNING_KEY` set in Vercel (the unsigned-PUT note from `260528-0rd` is likely expected). **← env/dashboard, yours.**
- Close PR #2 (Phase 3 retro review) after UAT; its failing Vercel check = orphaned project (see `03-HANDOFF.md` §1a). **← after UAT.**
- **M-7 finding (2026-06-01):** the extension source (`chrome-extension/src/content/scrape-profile.ts`) does the thin name+URL DOM scrape with **no PDF handling** — the "PDF pivot" is the separate Save-to-PDF → CV-upload → Haiku path, matching the documented design. M-7 stays a live/operational confirmation (not a code fix).

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

## ✅ Done 2026-06-01 — M-tier clear-down

- [x] **Committed** the orphaned 2026-05-30 work (H-1 PII, M-1 headers, M-2 lint + planning reconciliation) — 2 commits.
- [x] **M-3 / M-4 / M-5 / M-6 / M-8 all fixed** (see MEDIUM table). Two migrations applied to the linked DB via `supabase db push --linked`; `database.ts` regenerated; remote migration history back in sync.
- [x] **Gates green** — `pnpm typecheck` exit 0; `pnpm lint` 0 errors on every changed file.
- [x] **Adversarial code review** — 4-area multi-agent review + per-finding verification returned **0 confirmed issues**.
- [ ] **Browser pre-smoke of `/jobs/new`** — deferred to the post-B1–B3 `vercel:verification` pass (needs a live deploy; it's a new form).
- Remaining MEDIUM: only **M-7** (confirm the live LinkedIn extension uses the PDF path — not a code fix).

---

## ✅ Your minimal path to live (do these in order)

1. **Vercel env vars** (Production + Preview): `RESEND_FROM=Altus <noreply@altusmove.com>`, `NEXT_PUBLIC_SITE_URL=<prod URL>`, `RESEND_FEEDBACK_RECIPIENT=alasdairj8@gmail.com`. Confirm the rest are present: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `OPENAI_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `EMAIL_TOKEN_ENCRYPTION_KEY`, Turnstile + Outlook + Sentry keys (see `.env.example`).
2. **Supabase → Auth → SMTP** (B1) + **raise email rate limit**.
3. **Supabase → Auth → Email Templates** paste 5 from `260528-wdz`; **URL Config** = prod URL.
4. **Tell me when 1–3 are done** — the M-tier code fixes are already in (M-3/4/5/6/8). I'll run the browser pre-smoke (`vercel:verification`) against the live deploy — confirming the H-1 PII fix end-to-end **and the new `/jobs/new` form** — then fix anything the smoke surfaces *before* you UAT.
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
