---
phase: quick/260804-review
fixed_at: 2026-08-04
review_path: .planning/quick/260804-review/REVIEW.md
branch: quick/sc-review-fixes-260804
findings_in_scope: 25
fixed: 23
accepted_residual: 2
status: all_in_scope_fixed
---

# Fix report — review `quick/sc-review-fixes-260804`

All 3 critical, 4 high and 8 medium findings fixed. 8 of 10 low/info fixed;
2 accepted as residual with rationale below.

14 commits, one per finding or tightly-related group. Two new migration
files were added (**FILE ONLY — not pushed, not applied**).

---

## Gate results

| Gate | Result |
|------|--------|
| `corepack pnpm typecheck` | PASS (0 errors) |
| `corepack pnpm lint` | PASS (0 errors, 24 warnings — all pre-existing, all unused `_`-prefixed test-double params) |
| `corepack pnpm exec vitest run` | PASS — 56 files passed, 4 skipped; **490 tests passed**, 28 todo, 0 failed (was 448 passed before this batch: +42) |
| Dummy-env `corepack pnpm build` | PASS (exit 0) |

---

## CRITICAL

### C1 — heal step could never reach the two production casualties
**Commit:** `0a81a48`
**Files:** `src/lib/inngest/functions/reconcile-cv-parses.ts`, `src/lib/ai/profile-completeness.ts`, `tests/unit/lib/ai/profile-completeness.test.ts`

The "needs heal" predicate moved from post-fetch into the SQL selector, exactly
as directed. The query now embeds `candidates!inner(id)` and filters every
column `isProfileEffectivelyEmpty` inspects (`current_role_title`,
`current_company`, `location`, `seniority_level`, `years_experience` IS NULL;
`skills`, `sector_tags` `<@ '{}'`), plus `extracted_data <> '{}'` so a blob that
could never populate anything cannot squat a slot. Ordering flipped to
`created_at ascending` and the 25-row cap kept — the window now drains
oldest-first, which is where the two July casualties sit.

**PostgREST expressed it cleanly, so no migration or view was needed** — the
fix is live the moment this deploys, with no dependency on a manual `db push`.

`isProfileEffectivelyEmpty` is retained as a post-fetch guard but is now
*counted*: a non-zero drop, or a merge that populates nothing inside the
completeness set (so the row would be re-selected), raises a Sentry
`warning` with counts only. `PROFILE_COMPLETENESS_SCALAR_COLUMNS` /
`_ARRAY_COLUMNS` / `_COLUMNS` are exported as the single source of truth for
which columns the SQL must name, with drift tests that fail if the predicate
and the lists diverge.

### C2 — write-only failure messages + a retry that could not work
**Commit:** `5f99e18` (also closes L4, L5)
**Files:** `src/lib/cv/parse-messages.ts`, `src/app/(app)/candidates/[id]/cv-review-panel.tsx`, `src/app/(app)/candidates/[id]/actions.ts`, `src/lib/inngest/functions/parse-cv.ts`, `tests/unit/lib/cv/parse-messages.test.ts`

- `FailedState` renders the stored `parseError`, falling back to the locked
  `CV_PARSE_FAILED_MESSAGE` literal only when it is NULL. This removes the
  hardcoded generic body copy from the fall-through branch, so
  `CV_UPLOAD_INCOMPLETE_MESSAGE` and `CV_STUCK_MESSAGE` finally reach the
  recruiter. PII-safe by construction: `parse_error` only ever holds one of
  the exported constants; `parse_error_detail` is still read by no UI.
- New `isUploadIncomplete()` keyed on the load-bearing substring
  `'never finished uploading'`, with a **no-retry** UI branch (same shape as
  the unparseable branch) pointing at the existing upload control, plus a
  server-side guard in `retryParseAction` so a direct action call cannot
  destroy the message either.
- `CV_STUCK_MESSAGE` deliberately **keeps** its retry button — parsing simply
  never started there, and a re-dispatch can genuinely succeed.
- `parse-cv`'s `download-cv` step returns a discriminated result instead of
  throwing, so a genuinely missing storage object records
  `CV_UPLOAD_INCOMPLETE_MESSAGE` before the `NonRetriableError` fires; a
  transient Storage fault still falls through to the generic message, because
  a retry there *can* succeed.
- The in-body catch gained `preserveExistingMessage: true`, so the generic
  copy can no longer clobber an honest same-invocation message. Safe because
  `retryParseAction` resets the row to `pending` with a NULL `parse_error`
  before re-dispatch, so a stale message from a previous attempt can never be
  resurrected.

### C3 — timed-out retry was a dead end
**Commit:** `25ae44d`
**Files:** `src/app/(app)/candidates/[id]/cv-review-panel.tsx`, `tests/unit/app/candidates/cv-review-panel.test.tsx`

`useRetryParse` takes an `onSuccess` callback; `PendingState` clears
`timedOut` and resets `startedAt` from it. `startedAt` is a dependency of the
poll effect, so the new value tears down the (already-cleared) interval and
installs a fresh one with the 5-minute budget restarted. A **failed** retry
deliberately leaves the state alone.

**Verified, not assumed:** a new component test walks the transitions —
poll → cross the cap → assert polling is provably dead → retry → assert the
spinner and polling are back. The fix was then temporarily reverted and the
test confirmed to fail against the pre-fix component before restoring.

---

## HIGH

### H1 — embed-batch starvation
**Commit:** `0d11c99`
**Files:** `src/lib/inngest/functions/embed-batch.ts`, `src/lib/ai/profile-completeness.ts`, `tests/unit/lib/ai/profile-completeness.test.ts`

`NON_EMPTY_PROFILE_OR_FILTER` — the SQL complement of
`isProfileEffectivelyEmpty`, defined beside it — runs in the selector, so
effectively-empty rows never enter the 256-row window. Both sweeps gained
`created_at ascending`: a stuck row can then only block newer rows behind it,
never the whole sweep. The TS guard stays as defence in depth and is
**counted** — a non-zero post-fetch drop means the predicates drifted and
raises a Sentry `warning`, exactly as directed. Tests pin the filter's clause
set, per-column-type operators, and PostgREST-safe escaping.

### H2 — un-clearable dashboard alarm
**Commit:** `848efc2`
**Files:** `src/lib/db/dashboard.ts`, `tests/unit/lib/db/cv-parse-health.test.ts`

Failures bounded to a **14-day** window (per decision) AND to the candidate's
current `candidate_cvs` version, so a superseded failure drops out. The count
is over distinct candidates, which also makes it agree with the names listed
underneath. `stalePending` left as-is (inherently current). The widget already
unmounts at `total === 0`, which is now reachable. Version resolution fails
open — this widget must never crash or blank the dashboard.

### H3 — false daily Sentry error on the billing channel
**Commit:** `26d1c1f` (also closes L8)
**Files:** `src/lib/inngest/functions/stripe-reconcile.ts`, `src/app/api/stripe/webhook/route.ts`, `src/app/api/stripe/webhook/route.test.ts`

- The route retries the `'processed'` stamp **once** on a transient error
  (skipped for missing-column errors, which are deterministic and have their
  own pre-migration fallback).
- Sweep bounded to rows 1h–7d old, so resolved-but-unstamped rows age out.
- Alerts **only when rows exist** (already true) and now at `level: 'warning'`
  unless the problem is actively growing — escalating to `'error'` when a
  stuck row appeared in the last 24h, with `growing` as a tag and
  `new_in_last_24h` in the payload. That 24h-freshness check is the
  run-over-run signal, implemented without needing cross-run state.
- Count included in the message, tags and extra.
- Explicit `.limit(500)` with a `truncated` flag (L8).

**SECURITY INVARIANT 4 untouched:** failed *processing* still returns 500 and
is never stamped `'processed'`. Two new tests cover the retry landing and both
attempts failing; the existing `it.each(['received','error'])` invariant test
and the PGRST204 degradation test still pass unchanged.

### H4 — shortlist scoring spend with no render surface
**Commit:** `72b94b9`
**Files:** `src/app/(app)/jobs/[id]/shortlist/actions.ts`, `src/app/(app)/candidates/[id]/shortlist-actions.ts`, `src/lib/inngest/enqueue-match-score.ts`, `src/lib/inngest/functions/score-application-match.ts`

Decision implemented as directed: **no enqueue on `application_type='shortlist'`
creates.** Scoring fires on promotion to standard, which already happened.
Everything else kept. Comments at the promote path, the helper and the Inngest
function corrected so "all four application-create paths" no longer misstates
where spend originates.

*Test expectations:* no existing test asserted the shortlist enqueue (verified
by grep across all `*.test.ts`/`*.test.tsx`), so nothing needed relaxing. New
assertions were added on the enqueue helper instead (see M1).

---

## MEDIUM

| ID | Commit | What changed |
|----|--------|--------------|
| **M1** | `f4c10a2` | `application/score-match` carries `id: score-match:<candidateId>:<jobId>`; Inngest dedups for 24h. Keyed on the **pair** (what the cached summary is keyed on), not the application row, so two rows for one pair collapse to one billed run. Two new tests pin same-pair collapse and different-pair separation. |
| **M2** | `f4c10a2` | Embedding-version lookup failure is a hard stop (throws inside `step.run`, so Inngest's retries handle the transient case) instead of substituting `0` — which poisoned the cache key and left an unreapable row. |
| **M3** | `c3dda99`, `8f8f660` | Explicit `.limit(pairs.length * 3)`; candidate ids chunked at 100 per round-trip so the global pipeline cannot build a 414-length URL. Newest-per-pair semantics unchanged. Tests cover both bounds. |
| **M4** | `2089ab1` | **New migration `20260804140000_record_audit_view_dedupe.sql` (FILE ONLY).** `record_audit` returns the existing row id instead of inserting when an identical (org, actor, entity_type, entity_id) `'view'` already exists in the current hour. Deliberately excludes `entity_type='search'` — collapsing those would destroy the search telemetry this batch added — and applies to `'view'` only, never create/update/delete/export. Uses the existing `audit_log_org_entity_idx`; signature, SECURITY DEFINER and `search_path` reproduced verbatim; privileges restated so the 20260804120100 anon revoke survives. |
| **M5** | `4b38424` | `resume-budget-capped` sends **first**, updates on success, with per-**row** try/catch (was per-org, which skipped the rest of the org's backlog). `parse_error_detail` now cleared alongside `parse_error`. `checkCap`'s own throw caught separately. |
| **M6** | `4b38424` | Both reconciler sends carry an hour-bucketed dedup id, bounding concurrent re-parses of one row without ever becoming a permanent lock. `retryParseAction` sends no id, so a recruiter's manual retry can never be swallowed. |
| **M7** | `4e038ed` | `scrub()` + `PII_KEYS` extracted to `src/lib/observability/sentry-scrub.ts` and imported by **both** SDK configs. Client also gained `beforeBreadcrumb` stripping query strings/fragments from breadcrumb URLs (keeping the path) and the same treatment for `event.request.url`. 7 new tests. |
| **M8** | `2089ab1` | **New migration `20260804140100_revoke_anon_execute_set_created_by.sql` (FILE ONLY).** Revokes `public` + `anon` EXECUTE on `set_created_by()` via the same `pg_proc` loop idiom, so it no-ops where the function doesn't exist. The committed `20260804130000` file is **untouched** (append-only rule). |

---

## LOW / INFO — fixed

| ID | Commit | What changed |
|----|--------|--------------|
| **L1** | `4b38424`, `5f99e18` | `CV_BUDGET_CAPPED_ILIKE_PATTERN` exported from `parse-messages.ts` and used by the reconciler, with a unit test asserting the copy still matches the pattern (and that no other failure message does). |
| **L2** | `4b38424` | Resume predicate aligned with `parse-cv`'s pre-flight — only skips on `mode === 'hard'`, so soft-capped (80–99%) orgs' rows resume. |
| **L3** | `f4c10a2` | `onFailure` reads the application id through optional chaining, so a payload without the nested event can no longer make the failure handler itself throw. |
| **L4** | `5f99e18` | Unreachable `?? CV_NO_TEXT_MESSAGE` removed — all branches now render one hoisted `message`. |
| **L5** | `5f99e18` | `markCvFailed` preserves the stored `parse_error_detail` whenever it preserves the message — both or neither. |
| **L7** | `2089ab1` | Job/client page comments corrected: they claimed to "mirror the candidates convention" while doing the opposite. Now states why the call site is right for `getJob`/`getClient` (unlike `getCandidate`, they're called from many contexts). |
| **L8** | `26d1c1f` | Explicit `.limit()` on the stuck-event sweep, with `truncated` in the payload. |
| **L9** | `ea99967` | `isMissingColumnError` extracted to `src/lib/db/postgrest-errors.ts`; the looser message-matching variant preserved as an opt-in `column` argument so the Stripe guards keep strict code-only behaviour. 6 new tests. |

---

## Accepted residual

**L6 — the floats enqueue is a documented permanent no-op.**
`addFloatAction` calls `enqueueApplicationMatchScore` with `job_id` hardcoded
`null`, which the helper no-ops on. The review's own wording is "harmless
forward-proofing"; the only real defect was the *documentation* claiming "all
four application-create paths", and that has been corrected in three places
(`enqueue-match-score.ts`, `score-application-match.ts`, and the promote path)
as part of H4. Removing the call would delete the wiring a future
float-with-job path needs, for no runtime benefit. **No code change; the
inaccurate claim it produced is fixed.**

**L10 — no cache invalidation from the Inngest side.**
`scoreApplicationMatch` writes `ai_summaries` but nothing revalidates
`/jobs/[id]` or `/pipeline`, so the badge appears on the next navigation. The
review itself classes this as "expected for an async job — flagged so the
browser pre-smoke refreshes before concluding the badge didn't appear."
Adding cross-request invalidation from a background worker would mean either
`revalidateTag` plumbing through the Inngest boundary or client-side polling
on two more surfaces — real scope against no correctness defect.
**Carried as a pre-smoke note: refresh the job/pipeline page before judging a
missing badge.**

---

## Notes for the founder

**Two migration FILES were added and NOT applied** (per hard rules). Both are
idempotent, additive, and safe to run in either order:

- `supabase/migrations/20260804140000_record_audit_view_dedupe.sql` (M4)
- `supabase/migrations/20260804140100_revoke_anon_execute_set_created_by.sql` (M8)

Neither is required for any code in this branch to work — the app behaves
identically before and after they land (M4 just files fewer audit rows once
applied; M8 is pure privilege hygiene). There is **no pre/post-migration skew
to tolerate** in application code, so the deploy order does not matter.

**C1 in particular needs no migration** — the heal fix is pure PostgREST and
takes effect on the first cron run after deploy.

**Review properties preserved.** None of the 21 verified-CLEAN properties were
weakened. Specifically re-checked: Stripe SECURITY INVARIANT 4 (failed
processing still 500s and is never stamped `'processed'` — its `it.each`
test passes untouched); the tenancy re-verification in both service-role
Inngest paths; the REVOKE migration's deliberate `record_audit_anonymous`
exclusion; and the pre/post-migration column tolerance, which is now
centralised rather than triplicated (L9) with its strict/loose behaviours
preserved exactly.
