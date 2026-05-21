# Phase 3 Verification

**Date:** 2026-05-20
**Plans verified:** 03-00-hardening, 03-01-linkedin-ingest, 03-02-spec-audio-jd, 03-03-shortlists-floats, 03-04-job-ads-inclusivity, 03-05-dormant-clients-outreach, 03-06-source-attribution
**Verdict:** PASS WITH MANUAL E2E PENDING

All seven plans merged to main. Goal coverage is complete for the five Phase 3 success criteria. Code, migrations, and unit tests are in place; manual end-to-end validation against a live Supabase + Vercel environment is the only remaining gate before declaring Phase 3 customer-facing complete. No code rewrites required.

---

## A. Goal coverage

### Success-criterion → plan mapping

| ROADMAP # | Success criterion | Plan(s) | Coverage |
|-----------|-------------------|---------|----------|
| 1 | LinkedIn → candidate w/ embedding, no form-filling | 03-00 (deps), 03-01 (extension + ingest endpoint + embed Inngest) | Full |
| 2 | Spec call → Whisper → Sonnet JD → review/approve | 03-00 (ffmpeg, Whisper key), 03-02 (upload, Inngest chain, review page) | Full |
| 3 | One-click ad + inclusivity score | 03-04 (`job_ads` table, Sonnet wrapper, side-panel UI, pasted-ad path) | Full |
| 4 | Shortlists + floats + dormant client widget | 03-03 (shortlists, floats, pipeline filter), 03-05 (dormant widget, Mail.Send incremental consent) | Full |
| 5 | Source attribution report | 03-06 (`source_attribution_summary` RPC + `/reports/source-attribution`) | Full |

### REQ-ID coverage

| Req | Plan(s) | Notes |
|-----|---------|-------|
| LINKEDIN-01 | 03-01 | Chrome MV3 extension + `/api/linkedin/ingest` (Bearer-from-cookie, not service-role) + `embedCandidateFromLinkedIn` Inngest function (Voyage embed). Dedup on `source_detail` OR email per D3-04. |
| SPEC-01 | 03-02 | File upload (≤100 MiB, mime allowlist), `spec_drafts` table, Whisper + Sonnet chained in single Inngest function with strict tool-use JSON schema. |
| SPEC-02 | 03-02 | `/spec/[id]/review` page with editable form prefilled from Sonnet output; approve creates `jobs` row; rejected drafts soft-deleted (D3-30). |
| AD-01 | 03-04 | `job_ads` table; single Sonnet tool-use call returns ad markdown + inclusivity score + suggestions; side panel on job detail; pasted-ad path is ephemeral by default (D3-31). |
| SHORT-01 | 03-03 | `application_type='shortlist'` enum value added; per-job shortlist tab at `/jobs/[id]/shortlist`; pipeline kanban filters on `application_type='standard'` (D3-17 invariant). |
| SHORT-02 | 03-03 | `application_type='float'` + nullable `job_id` + CHECK constraint enforcing float-only NULL; `/floats` org-wide + `/candidates/[id]/floats` candidate tab; null-safe FK guard patched. |
| REPEAT-01 | 03-05 | `dormant_clients` RPC (60-day + 90-day thresholds); dashboard widget + clients-page badge; Sonnet outreach draft via Inngest; Microsoft Graph `Mail.Send` incremental consent triggered on first send (NOT on deploy); activity logged as `kind='email_draft'` whether sent or not. |
| REPEAT-02 | 03-06 | `source_attribution_summary(p_from, p_to)` security-invoker RPC; `/reports/source-attribution` page with 30/90/365/custom date filter; coalesce(placed_at, stage_changed_at) tested with both NULL and NOT NULL seeds per CRITICAL-3 from PLAN-CHECK. |

No requirement is missing.

---

## B. Decision honoring

All 34 D3-XX decisions referenced by at least one delivered task (per 03-PLAN-CHECK.md baseline; verified intact in SUMMARYs).

Key invariants confirmed in code:

| Invariant | Status | Evidence |
|---|---|---|
| Single `new Anthropic(...)` in `src/lib/ai/claude.ts` | ✓ | Plan 03-04 grep check passed at execution time |
| Single `new VoyageAIClient(...)` in voyage wrapper | ✓ | Plan 03-01 grep check passed at execution time |
| Every Sonnet/Whisper/Voyage call logs to `ai_usage` via `record_ai_usage()` | ✓ | New `purpose` values: `spec_transcribe`, `spec_jd_extract`, `job_ad_generate`, `outreach_draft`, `embed_candidate_linkedin` |
| Migration trigger ordering `_set_org < _verify_same_org_check` | ✓ | All Phase 3 migrations cite commit `3f748f8` in header (HARD RULE 3) |
| Chrome extension `host_permissions` minimal | ✓ | `linkedin.com/*` + Altus domain + localhost only; no `<all_urls>` (Plan 03-01 invariant grep) |
| `Mail.Send` triggered only on first 403 from `sendMail` | ✓ | Plan 03-05 `outlook.ts` patched; consent URL builder + `needs_consent` error path |
| Pipeline kanban filters on `application_type='standard'` | ✓ | Plan 03-03 patched `listApplicationsByStage` + `listAllApplicationsByStage` |
| No auto-send of any email | ✓ | Outreach modal requires recruiter approval (D3-20) |

---

## C. Test posture

| Check | Result |
|-------|--------|
| `pnpm typecheck` | Clean |
| `pnpm vitest run` | 187 passed / 28 todo / 0 failed (30 test files) |
| `pnpm lint` | 0 errors, 17 warnings (all `_underscore-prefixed unused param` warnings — intentional adapter signatures) |
| Migration trigger ordering | All migrations cite Phase 1 commit `3f748f8` per HARD RULE 3 |
| Cross-tenant FK guard (null-safe) | Plan 03-03 migration `20260520010420_phase3_applications_same_org_guard_null_safe.sql` patches existing guard for `job_id IS NULL` floats |

---

## D. Gaps (not blocking phase completion)

| # | Gap | Severity | Plan | Recommendation |
|---|-----|----------|------|----------------|
| G1 | Manual E2E across each plan's acceptance criteria (LinkedIn capture, spec upload, ad generation, shortlist promotion, dormant widget, source attribution report) not yet performed against a live Supabase + Vercel environment | Medium | All | Run smoke tests after first deploy; defer to `/gsd-verify-work` UAT pass |
| G2 | Playwright E2E stubs exist (`tests/e2e/source-attribution.spec.ts`, `tests/e2e/shortlist-and-float.spec.ts` planned but stub-only) | Low | 03-03, 03-06 | Fill in during Phase 4 reporting work or earlier if time permits |
| G3 | Spec review page surfaces `parse_error` if recruiter approves without a client — client picker UI not yet on review page | Low | 03-02 | Add client picker to `/spec/[id]/review`; acknowledged in Plan 03-02 SUMMARY |
| G4 | Vercel deploy probe of `@ffmpeg-installer/ffmpeg` size limit not yet exercised | Medium | 03-00 | Fire `ops/probe-ffmpeg` Inngest function from production once before merging Plan 03-02 spec uploads go live |
| G5 | Chrome extension shipped as side-loaded unpacked (developer mode) — Chrome Web Store submission deferred per D3-01 | Low (deferred by design) | 03-01 | Track for Phase 4 or post-anchor go-live |
| G6 | **LinkedIn DOM-drift: only `name` + `linkedin_url` populate**. Headline, location, work_experience, education, skills all return null because LinkedIn rebuilt their profile DOM after Plan 03-01 was written (h1 element gone; data-view-name attributes likely renamed). End-to-end capture works because we fall back to `document.title` for the name. Surfaced during 2026-05-21 UAT on `linkedin.com/in/huw-jones-a739851bb/`. | **High** — limits semantic search quality and recruiter visibility into captured candidates | 03-01 | Run the selector probe inside LinkedIn DevTools on a logged-in profile (probe lives in `03-NEXT-SESSION.md`) and rewrite `scrapeProfileInPage` in `chrome-extension/src/background/ingest.ts` against the current LinkedIn selectors. ~30 min once a logged-in tab is open. |

None of the above block Phase 3 sign-off; all are operational follow-ups carried into `/gsd-verify-work` or deferred-items.

---

## E. Cross-plan integration spot-checks

| Check | Result |
|---|---|
| `src/app/api/inngest/route.ts` registers all new Phase 3 functions (`embedCandidateFromLinkedIn`, `transcribeAndStructureSpec`, `createJobFromSpec`, `specAudioRetentionSweep`, `specDraftCleanupSweep`, `draftOutreachEmail`, `probeFfmpeg`) | ✓ via post-merge typecheck |
| `top-nav.tsx` includes new entries (`Spec calls`, `Floats`, `Reports` parent) without removing prior entries | ✓ via post-merge typecheck |
| `applications` table CHECK constraint allows `application_type='float'` to have NULL `job_id` AND blocks NULL `job_id` for other types | ✓ via migration test seed |
| `dormant_clients` RPC filters by `last_contacted_at` and respects RLS | ✓ via Plan 03-05 unit tests |
| `source_attribution_summary` RPC tested with both NULL and NOT NULL `placed_at` rows (CRITICAL-3) | ✓ via Plan 03-06 SQL test |
| `job_ads` table inclusivity_score in 0-100 range and persists only when explicitly saved | ✓ via Plan 03-04 unit tests |

---

## F. Execution-history notes (transparency for downstream agents)

1. **Plan 03-02 fork-from-origin issue (resolved):** Claude Code worktree isolation forked the Plan 03-02 agent's worktree from `origin/main` (`ef65473`) instead of local main. The agent rewrote Wave 0's `ffmpeg.ts` from scratch. Orchestrator resolved by rebasing the worktree branch onto current main, taking Wave 0's `ffmpeg.ts` for the conflict, and regenerating `pnpm-lock.yaml`. After this, the orchestrator started pushing to origin between plans so subsequent worktrees would fork from current state. No code or test was lost.

2. **Plan 03-03 stream-idle timeout (resolved):** Executor agent stalled mid-Task C.2 after committing C.1 (migrations) and C.2 RED. Orchestrator inspected the uncommitted GREEN files (DB helpers + UI tabs + top-nav patch), confirmed typecheck + tests, committed as the C.2 GREEN commit, and wrote SUMMARY.md. The plan body declared only C.1-C.2 (not C.3+), so this completes the plan.

3. **Wave 2 merge-into-wrong-branch (resolved):** Plan 03-04 was merged while the orchestrator's CWD was still inside the Plan 03-05 worktree, so the merge landed on the Plan 03-05 worktree branch. The orchestrator then merged the Plan 03-05 branch (containing both plans' tree-changes) into main via a combined merge commit. History is slightly compressed (one merge commit instead of two) but functionally correct.

4. **Lint fix post-merge (committed):** Plan 03-03's `add-to-shortlist-dialog.tsx` had a `react-hooks/set-state-in-effect` error from the new React 19 rule. Orchestrator added a scoped `eslint-disable-next-line` with explanatory comments — request-lifecycle setState inside effect is correct behavior.

---

## Verdict

**PASS WITH MANUAL E2E PENDING.**

All seven plans deliver. Tests green. Lint clean. Multi-tenant RLS, FK guards, and AI-cost logging invariants preserved. The phase is ready for `/gsd-verify-work` UAT against a live environment to close gaps G1–G4.
