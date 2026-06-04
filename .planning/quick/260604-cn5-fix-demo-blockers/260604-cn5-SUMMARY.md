---
quick_id: 260604-cn5
type: execute
mode: quick
title: Fix 20 demo-blocking issues before tonight's client demo
status: complete
completed: 2026-06-04
tasks_total: 10
tasks_complete: 10
commits: 10
migrations: 0
---

# Summary — Fix 20 Demo-Blocking Issues (260604-cn5)

All 10 tasks executed in order, one atomic commit per task (10 commits total).
`pnpm typecheck` passed after every task and at the end. `pnpm lint` reports
0 errors and 17 warnings — every warning is in a file NOT touched by this work
(chrome-extension background + unit test files); **no new errors or warnings on
any touched file**. Zero new DB migrations.

## Orchestrator verification addendum (post-execution)

- **Independent gate re-run** caught a test regression the executor's self-report
  missed: the Task 7 LinkedIn fix inlined `createServerClient()` in the route, which
  threw "URL and Key required" in the unit test (env + ssr client not mocked).
  **Fixed** by extracting a `createBearerClient(token)` helper into
  `src/lib/supabase/server.ts` (matches the codebase's single-source client-wiring
  convention) and mocking it in the test. No production behaviour change.
  Commit `cca8bc0`. Gates now fully green: typecheck ✓ · lint ✓ · **vitest 198 passed**.
- **Critical/Sensitive diffs personally reviewed** (Tasks 1, 2, 6, 7) — all correct
  and tenant-safe.
- **Adversarial regression review of the full 28-file diff** (3 lenses, every finding
  re-verified against the code): **0 critical / 0 high / 0 medium**, no regressions
  introduced. 2 LOW residual gaps (NOT caused by this diff), deferred past the demo:
  1. Legacy mixed-case `candidates.email` rows are not backfilled — write-boundary
     normalisation fixes all NEW data; seed data is already lowercase so a freshly-
     seeded demo DB is unaffected. Optional one-off backfill migration (needs sign-off).
  2. MSAL snapshot-diff closes the common cross-tenant RT window and fails safe; a
     narrow cross-concurrent-invocation interleaving remains — harden later via
     `home_account_id`-scoped RT selection.

## Followups before the demo
- Verify `RESEND_API_KEY` + `NEXT_PUBLIC_SITE_URL` are set in Vercel (Task 8 now warns
  instead of false-succeeding when unset).
- Run a browser pre-smoke on the 10 must-pass flows (HARD RULE #1) against a preview deploy.
- Merge `fix/demo-blockers-260604` to deploy.

## Per-task results

| Task | Commit | Summary | Files |
| ---- | ------ | ------- | ----- |
| 1 [CRITICAL] | `ecd7d1b` | Thread `organizationId` through `upsertMatchSummary` so service-role match inserts persist (NULL-org trigger raise was silently failing every score). | `src/lib/db/ai-summaries.ts`, `src/lib/inngest/functions/precompute-matches-for-job.ts`, `src/app/(app)/jobs/[id]/matches/actions.ts` |
| 2 [CRITICAL] | `c1ff247` | Coerce Postgres numeric/bigint strings to `Number()` in `getSourceAttribution` + all four buyer-value helpers (stops `.toFixed` crash + fee-revenue string-concat); surface buyer-value on the reports hub. | `src/lib/db/source-attribution.ts`, `src/lib/db/buyer-value.ts`, `src/app/(app)/reports/page.tsx` |
| 3 | `1fee339` | Filter `listApplicationsForCandidate` to `application_type='standard'` (no phantom float/shortlist cards); lowercase+trim email on create/update so dedup compares apples to apples. | `src/lib/db/applications.ts`, `src/lib/db/candidates.ts` |
| 4 | `5da880d` | Parse UK fees (`£7,500`→750000 pence, reject garbage); guard free-text currency `Intl.NumberFormat` RangeError; `router.refresh()` on add-candidate + shortlist promote/remove. | `src/components/app/placement-modal.tsx`, `src/app/(app)/jobs/[id]/job-detail-header.tsx`, `src/app/(app)/jobs/[id]/add-candidate-form.tsx`, `src/app/(app)/jobs/[id]/shortlist/shortlist-list.tsx` |
| 5 | `7cc0b3a` | Bump `companies.last_contacted_at` (org-scoped) on check-in send so the Dormant badge clears (UPDATE-flip never fired the AFTER-INSERT trigger); capture the previously-discarded flip-UPDATE error to Sentry name-only. | `src/app/(app)/clients/[id]/outreach-actions.ts` |
| 6 [SENSITIVE] | `5aa6119` | MSAL rotated-RT isolation via pre/post snapshot-diff (adopt the RT only when exactly one NEW secret appeared — never grab another user's pre-existing RT); first-connect persistence via explicit org param; 0-row UPDATE fallback now reports `persist_failed`; corrected the misleading "read-only" scope copy. | `src/lib/integrations/outlook.ts`, `src/lib/db/outlook-credentials.ts`, `src/app/api/outlook/callback/route.ts`, `src/app/(app)/settings/integrations/connect-outlook-card.tsx` |
| 7 [CRITICAL] | `45f9b54` | Add `/api/linkedin/ingest` to `PUBLIC_PATHS` (cookieless chrome-extension request was 307-redirected to /sign-in before the route ran); build a token-scoped `@supabase/ssr` client (`Authorization: Bearer <token>`, no-op cookies) so `getProfile` + `upsertCandidateFromLinkedIn` run under RLS as the bearer user — no service-role. | `src/lib/supabase/middleware.ts`, `src/app/api/linkedin/ingest/route.ts` |
| 8 | `75782dd` | Both invite actions return `emailDelivered: boolean`; the UI shows `toast.warning` when delivery failed instead of a false "Invitation sent/resent". No PII logged; optimistic row stands (the DB invite is real). | `src/app/(app)/settings/team/actions.ts`, `src/app/(app)/settings/team/team-invites.tsx` |
| 9 | `79ff50b` | spec→job now emits `job/embed` (the event the embed function + the two real job paths use) instead of the dead `jobs/jd-changed`; `tryRecreate` throws on a failed `subscription_id`/delta write BEFORE recording success, so a failed write is recorded as a failed renewal attempt (not silent "healthy"). | `src/lib/inngest/functions/create-job-from-spec.ts`, `src/lib/inngest/functions/refresh-outlook-subscription.ts` |
| 10 | `85644ea` | Built the client edit page + form (mirrors `clients/new/`, uses existing `updateClientAction`) so the list "Edit" link no longer 404s; `router.refresh()` on CV upload + Accept-all. | `src/app/(app)/clients/[id]/edit/page.tsx` (new), `src/app/(app)/clients/[id]/edit/edit-client-form.tsx` (new), `src/app/(app)/candidates/[id]/cv-upload.tsx`, `src/app/(app)/candidates/[id]/cv-review-panel.tsx` |

## Critical fixes — all three landed

- **Match scores persist** (Task 1): `upsertMatchSummary` now writes `organization_id` explicitly. Verified safe — the `same_org` guard only rejects a *differing* org; we pass the job's already-verified org.
- **Revenue reports** (Task 2): numerics coerced at the single DB-helper boundary; buyer-value card added to `/reports`.
- **LinkedIn capture** (Task 7): allowlisted + token-scoped under RLS.

## Deviations / fallbacks / notes

- **Task 1 — extra caller updated (in scope, not a deviation):** the plan named two
  call sites, but a third caller exists at
  `src/app/(app)/jobs/[id]/matches/actions.ts` (the synchronous "Explain" action).
  `organizationId` became a required field, so this caller had to pass it too. It
  already resolves its own org via `current_organization_id()` RPC, so passing it
  explicitly is safe and consistent. Committed with Task 1.
- **Task 6 — MSAL isolation approach:** implemented the plan's *preferred* pre/post
  snapshot-diff. Before the refresh we snapshot the set of existing RT secrets;
  after, the rotated RT is the secret that is NEW *and* not the plaintext input.
  Adopted only when **exactly one** new secret appeared; otherwise we fall back to
  re-encrypting the input RT (prior behaviour). Documented inline with the
  cross-tenant risk. `OUTLOOK_SCOPES`, the connect flow, and the encryption boundary
  are unchanged. No signature differed from the plan.
- **Task 10 Item 4 — built the page (NOT the fallback):** the recommended edit-page
  build path had no blockers — `getClient`, `clientFormSchema`, and
  `updateClientAction(companyId, rawInput)` (returns `{ ok }` / `fieldErrors` /
  `formError`, no redirect) all exist. Two new files created; the existing
  `client-table.tsx` Edit link (already pointing at `/clients/[id]/edit`) is left
  untouched and now resolves. The dead-link-removal fallback was NOT used.

## Verification status

- `pnpm typecheck` — **PASS** (ran after every task and at the end; exit 0).
- `pnpm lint` — **PASS for this work**: 0 errors, 17 warnings, all in untouched files
  (chrome-extension background + `tests/**`). No new findings on any touched file.
- `pnpm build` — not run (project-documented: fails locally on env validation; Vercel
  build is authoritative).

## Residual follow-ups (not blockers for the fix; flagged for the demo)

- **Env config before demo (operational, not code):** Team-invite delivery (Task 8)
  and the accept-invite link require `RESEND_API_KEY` and `NEXT_PUBLIC_SITE_URL` set
  in Vercel. The code now WARNS instead of falsely succeeding when they're missing —
  but confirm both are set so invites actually arrive.
- **Per project memory:** no migration was needed here, so no `supabase db push` is
  required for this batch.
- **CLAUDE.md HARD RULE #1 pipeline** (`/gsd-code-review` + browser pre-smoke against
  the deployed preview on the 10 must-pass flows) should be run by the orchestrator
  before the human UATs — this executor only ran typecheck + lint locally.

## Self-Check: PASSED

- New files exist: `src/app/(app)/clients/[id]/edit/page.tsx`,
  `src/app/(app)/clients/[id]/edit/edit-client-form.tsx` — both written and compiled
  (typecheck would have failed otherwise).
- All 10 commits present in `git log` (`ecd7d1b`, `c1ff247`, `1fee339`, `5da880d`,
  `7cc0b3a`, `5aa6119`, `45f9b54`, `75782dd`, `79ff50b`, `85644ea`).
