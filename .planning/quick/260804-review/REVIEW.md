---
phase: quick/260804-review
reviewed: 2026-08-04T17:30:00Z
depth: deep
diff_base: f7f7b50
branch: quick/sc-review-fixes-260804
files_reviewed: 55
findings:
  critical: 3
  high: 4
  medium: 8
  low: 10
  total: 25
status: issues_found
verdict: FIX-FIRST
---

# Pre-UAT Code Review — `quick/sc-review-fixes-260804` vs `f7f7b50` (prod)

**Scope:** full diff of the two merged quick tasks (`260804-lfz` CV-pipeline
silent failures + `260804-lih` match scores / telemetry / webhook ledger).
55 files, +3417 / −591. Live production SaaS with real customer data.

**Verdict: FIX-FIRST.** Five findings block UAT (C1, C2, C3, H1, H2). Two more
(H3, H4) need a decision before the founder spends money exercising the flows.

The security posture is sound — I could not find a tenant-isolation hole, a
PII leak into the audit log, a Stripe idempotency regression, or a
data-destructive migration. The blocking findings are all in the *same class
the batch set out to fix*: remediation code that silently doesn't fire, and
honest failure copy that the UI throws away. That is the outcome the task
brief called "the worst outcome," so it is flagged accordingly rather than
softened.

---

## CRITICAL — blocks UAT

### C1: The reconciler's `heal-unmerged-profiles` step can never reach the two production casualties it was written to heal

**File:** `src/lib/inngest/functions/reconcile-cv-parses.ts:289-295`
**Class:** silent-fail remediation / starvation

```ts
.eq('parsing_status', 'complete')
.not('extracted_data', 'is', null)
.order('created_at', { ascending: false })   // NEWEST first
.limit(HEAL_ROW_CAP)                          // 25, global across all orgs
```

The step selects the **25 newest** `'complete'` CV rows across every tenant,
and rows that are skipped (`continue`) undergo **no state change**. So every
15 minutes it re-scans the identical newest-25 window forever; any unmerged
row that falls out of that window is permanently unreachable. The
`isProfileEffectivelyEmpty` guard is applied *after* selection, so healthy
rows consume the 25 slots.

The step's own comment (`:281-286`) names two specific casualties
(`62783324-…`, `3bf8ffe0-…`, Steele Charles org) and asserts they "self-heal
on the first run after deploy — a manual SQL backfill was ruled out." Those
rows date from before 2026-07-31. Across AJ + Altus Consultancy + Steele
Charles + SMOKE, 25 complete CVs newer than them is a low bar. The claimed
SF-2 remediation is, on the balance of probability, inert — and the founder
has been told the data is fixed.

**Failure scenario:** deploy → cron runs → 25 recent healthy CVs are scanned
and skipped → the two broken candidates still have empty profiles, are still
unsearchable, and nobody is told. Repeat every 15 minutes indefinitely.

**Repro:** insert 26 `candidate_cvs` rows with `parsing_status='complete'`
and `created_at` newer than a target broken row; run the cron; the target is
never read.

**Fix:** make skipped rows leave the window. Cheapest correct version — drive
the query from the candidate side (select CVs whose candidate has all seven
`ProfileCompletenessFields` null/empty) so the result set shrinks as rows
heal. Failing that, add a `heal_checked_at timestamptz` column to
`candidate_cvs` and `.is('heal_checked_at', null).order(… ascending: true)`.
A bare `ascending: true` flip is **not** sufficient on its own — it just
starves the *newest* rows instead.

---

### C2: Two of the four new honest failure messages are written to the DB and then discarded by the UI; one of them ships a retry button that provably cannot work

**Files:**
- `src/app/(app)/candidates/[id]/cv-review-panel.tsx:264-286` (generic `FailedState` branch)
- writers: `src/lib/inngest/functions/reconcile-cv-parses.ts:183` (`CV_UPLOAD_INCOMPLETE_MESSAGE`), `:190` (`CV_STUCK_MESSAGE`), `src/app/(public)/apply/[orgSlug]/actions.ts:566` (`CV_STUCK_MESSAGE`)

**Class:** honest-UI deliverable not landing / doomed affordance

`FailedState` branches on two substrings (`'AI budget'`, `'no extractable
text'`). The two *new* messages introduced by this batch contain neither, so
they fall through to the generic branch — which renders a **hardcoded**
string and never reads `parseError` at all:

```tsx
<AlertTitle>CV parsing failed.</AlertTitle>
<p className="text-xs font-normal">You can retry now or continue and parse later.</p>
<Button …>Try again</Button>
```

So `"The CV file never finished uploading. Please upload it again."` and
`"Parsing didn't start. You can retry now, or upload the CV again."` are
write-only. The recruiter sees the same generic copy they saw before this
batch.

Worse, for the reconciler's `fail-no-file` outcome there **is no storage
object**. The rendered "Try again" button fires `retryParseAction` →
`cv/uploaded` → `parse-cv` `download-cv` step throws `NonRetriableError`
(`parse-cv.ts:233`) → the in-body catch rewrites the row with the *generic*
`FAILED_USER_MESSAGE` (`:433-437`). The honest message is destroyed on the
first retry, and the recruiter is invited into a loop that cannot terminate
successfully.

**Repro:** submit the public apply form, abandon before the storage PUT
completes. 15 minutes later the reconciler marks the row `fail-no-file`. Open
the candidate → generic copy + a Try-again button → click it → still fails,
now with the reason permanently lost.

**Fix:**
1. Generic branch: render `{parseError ?? 'You can retry now or continue and parse later.'}`.
2. Add `isUploadIncomplete()` to `src/lib/cv/parse-messages.ts` keyed on a
   load-bearing substring of `CV_UPLOAD_INCOMPLETE_MESSAGE`, and give it a
   no-retry branch (same shape as the `unparseable` branch at `:242-259`)
   pointing at the re-upload control.

---

### C3: The new "taking longer than expected" retry is itself a dead end — the exact SF-5 failure mode in a new costume

**File:** `src/app/(app)/candidates/[id]/cv-review-panel.tsx:116-175`
**Class:** dead-end UI state

```ts
const [startedAt] = useState(() => Date.now())
const [timedOut, setTimedOut] = useState(false)
useEffect(() => { … setTimedOut(true) … }, [router, startedAt])
```

Once `timedOut` flips true the poll interval is cleared and the effect never
re-runs (`startedAt` is frozen by the lazy initialiser; `router` is stable).
`useRetryParse` (`:101-114`) fires the server action and shows a toast but
never resets `timedOut` or `startedAt`. `retryParseAction` does call
`revalidatePath` (`actions.ts:336`), but the re-rendered tree puts
`<PendingState>` back at the identical position with `parsing_status` still
`'pending'`, so React reuses the instance and **`timedOut` survives**.

Net effect: the user clicks "Try again", gets a success toast, and stares at
the same amber "This is taking longer than expected" alert forever, with no
polling. Only a full browser reload escapes. That is a dead-end spinner with
extra steps — the precise SF-5 finding this code closes.

**Repro:** upload a CV, leave the candidate page open 5 minutes with the
parse still pending, click "Try again". Observe: no state change, ever.

**Fix:** give `useRetryParse` an `onSuccess` callback; in `PendingState` pass
`() => { setTimedOut(false); setRetryNonce(n => n + 1) }` and key the poll
effect on `[router, retryNonce]` with `startedAt` recomputed per nonce.

---

## HIGH

### H1: `embed-batch` sweep starvation — skipped empty-profile rows permanently occupy the 256-row window, and can silently kill semantic search entirely

**File:** `src/lib/inngest/functions/embed-batch.ts:105-142`
**Class:** liveness regression introduced by this batch

```ts
.is('candidate_embedding', null)
.limit(PER_RUN_ROW_CAP)          // 256, no ORDER BY
…
.filter((p) => !isProfileEffectivelyEmpty(p.row))   // NEW, line 142
```

The new filter drops effectively-empty candidates **without marking them**.
They keep `candidate_embedding IS NULL`, so they remain in the selector and
are re-selected on every 10-minute run. There is no `ORDER BY`, so PostgREST
returns rows in heap order — effectively stable.

Once the population of effectively-empty candidates reaches 256, the sweep's
entire window is consumed by rows it will always discard, and **no candidate
is ever embedded again**. No error, no Sentry event, no UI signal. For a
product whose core value proposition is semantic search, that is a silent
total feature outage.

256 is not a remote threshold: a name-only CSV import, a batch of abandoned
apply-form submissions, or the LinkedIn-PDF flow reaches it easily. Note
`isProfileEffectivelyEmpty` deliberately ignores `full_name`, `email`,
`phone` and notes — a recruiter's "add the name now, fill it in later"
record counts as empty.

**Repro:** insert 256 candidates with only `full_name`. Add a 257th with a
full profile. Run the sweep repeatedly — the 257th never gets an embedding.

**Fix:** move the exclusion into SQL so the rows leave the selector, or stamp
a sentinel (`embedded_at = now()` with a NULL embedding, plus a skip reason)
and add that to the `.is()` predicate. Add `.order('created_at', { ascending:
true })` as defence in depth. Same latent issue applies to the jobs sweep at
`:198` if a comparable guard is added later.

---

### H2: The new dashboard CV-health banner counts every historical failure forever and can never be cleared

**File:** `src/lib/db/dashboard.ts:552-580`; widget `src/app/(app)/_dashboard/cv-parse-health-widget.tsx:21-23`
**Class:** un-dismissable customer-facing alarm

`getCvParseHealth` counts **all** `candidate_cvs` rows with
`parsing_status='failed'`, with no time bound and no "latest version per
candidate" filter. `candidate_cvs` is versioned (`nextCVVersion`), so a CV
that failed and was then successfully re-uploaded still counts against the
org forever. The widget renders whenever `failed + stalePending > 0` and has
no dismiss affordance.

This compounds with the new reconciler, which now actively converts abandoned
apply-form uploads into `'failed'` rows (`CV_UPLOAD_INCOMPLETE_MESSAGE`).
Every applicant who starts the public form and closes the tab permanently
increments the live customer's home-screen alarm.

**Failure scenario:** the anchor customer opens the dashboard on day 1 of UAT
and sees a permanent amber "CV parsing needs attention — 4 failed" card
listing candidates whose CVs they already fixed. It never goes away.

**Fix:** restrict the `failed` count to the newest `candidate_cvs` row per
candidate AND to `created_at > now() - interval '30 days'`; exclude candidates
whose most recent CV parsed `'complete'`.

---

### H3: A single transient PostgREST blip creates a permanent daily false Sentry `error` on the billing alert channel

**Files:** `src/app/api/stripe/webhook/route.ts:271-302`; `src/lib/inngest/functions/stripe-reconcile.ts:280-330`
**Class:** alert fatigue on a safety-critical channel

If the final `'processed'` upsert fails with anything other than a
missing-column error, the route logs to Sentry and **returns 200** — correct
for Stripe (the work is done) but it leaves the row at `status='received'`
permanently. The daily reconcile sweep then reports it as
`stripe_webhook_events_stuck` at `level: 'error'` on *every* run, forever,
with no auto-resolution and no acknowledgement path.

The same applies to genuine `'error'` rows once Stripe stops retrying (~3
days): the alert repeats daily forever. The channel the founder must trust
for real billing incidents becomes noise.

**Fix:** retry the `'processed'` stamp once before giving up; and bound the
sweep to `created_at > now() - interval '7 days'` so resolved-but-unstamped
rows age out.

---

### H4: Every shortlist add now fires a billed Sonnet call whose result is never rendered — spend blast radius far exceeds the 7 applications this batch was scoped to

**Files:** `src/app/(app)/jobs/[id]/shortlist/actions.ts:104-110`; `src/lib/db/applications.ts:161-165`
**Class:** unbounded cost expansion

`addToShortlistAction` now enqueues a match score for every shortlist row. But
`listApplicationsForJob` filters `.eq('application_type', 'standard')`
(`applications.ts:165`) and the kanban excludes shortlists by the same D3-17
invariant — so **the score is paid for and never displayed** until the row is
promoted, at which point `convertShortlistToApplicationAction` fires a second
event.

A shortlist is by definition a large working set ("the recruiter's internal
working set of candidates for a job, pre-submission"). Previously scoring was
bounded to the top-10 vector matches per job. Now it is unbounded per
shortlist-add. The only ceilings are `MAX_MONTHLY_MATCH_SPEND_PENCE`
(default £100/org/month, `env.ts:83`) and the existing AI caps.

**Repro:** shortlist 40 candidates against one job → 40 Sonnet calls, zero
visible badges.

**Fix (decision required before UAT, since UAT spends real money):** either
render the badge on the shortlist surface, or score on promote only. Either
way add an Inngest dedup `id` (see M1).

---

## MEDIUM

### M1: No dedup key on `application/score-match` — fast-follow and double-click double-spend
**File:** `src/lib/inngest/enqueue-match-score.ts:34-43`
The cache guard at `score-application-match.ts:171-182` only helps once a
prior run has finished *writing*. Shortlist → promote within seconds, or a
double-clicked "Add to job", yields two concurrent runs that both miss the
cache and both pay Sonnet; the loser takes a 23505.
**Fix:** `id: \`score-match:${candidateId}:${jobId}\`` on the send — Inngest
dedups for 24h.

### M2: Embedding-version fallback to `0` poisons the cache key
**File:** `src/lib/inngest/functions/score-application-match.ts:147-148`
`candVersionResult.ok ? candVersionResult.data : 0` — a transient read failure
writes a summary keyed on version `0`. The next run reads the real version,
misses, and pays again; the `0`-keyed row is never reaped by
`deleteStaleMatchSummaries`.
**Fix:** treat a failed version lookup as a hard skip, not a substitution.

### M3: `listLatestMatchScoresForPairs` has no `.limit()` and relies on a two-way `.in()` cross-product
**File:** `src/lib/db/ai-summaries.ts:222-232`
For `listAllApplicationsByStage` (global pipeline) `candidateIds × jobIds` can
be hundreds × dozens. Rows come back `created_at desc` with no bound, so any
server-side `db-max-rows` silently truncates and badges vanish for the oldest
pairs with no error. The `.in()` lists also go into the URL query string —
a few hundred UUIDs risks a 414.
**Fix:** add an explicit `.limit(pairs.length * 3)`, or an RPC taking pair tuples.

### M4: Phantom `view` audit rows on every `revalidatePath`
**Files:** `src/app/(app)/jobs/[id]/page.tsx:36`, `src/app/(app)/clients/[id]/page.tsx:33`
The audit write lives in the RSC render body. Every server action that calls
`revalidatePath('/jobs/${id}')` (add candidate, move stage, decline, place,
add job ad) re-renders the page and files another `view` row; route prefetch
does the same. The audit log is the compliance artifact — inflating it with
non-views makes "who accessed this record" unanswerable.
**Fix:** dedupe by (actor, entity, hour) inside `recordViewAudit`, or move
the write to an explicit client-side beacon.

### M5: `resume-budget-capped` clears the failure state before confirming the re-enqueue lands
**File:** `src/lib/inngest/functions/reconcile-cv-parses.ts:246-263`
Row is set `'pending'` and `parse_error` nulled, *then* `inngest.send`. If the
send throws, the org-level catch (`:264`) swallows it and skips the org's
remaining rows; row 1 sits `'pending'` with no message — a spinner instead of
a clear failure for at least 15 more minutes. `parse_error_detail` is also
never cleared, leaving a stale technical cause on a now-pending row.
**Fix:** send first, update on success; per-row try/catch, not per-org.

### M6: `sweep-stuck-pending` can start a second parse concurrently with a slow in-flight one
**File:** `src/lib/inngest/functions/reconcile-cv-parses.ts:167-178`
Requeue fires `cv/uploaded` with no dedup `id` and no status transition. A
large PDF plus Anthropic 429 backoff (`claude.ts` waits up to 60s × 4
attempts) can exceed the 15-minute grace, producing two concurrent Haiku
parses and two `markCandidateFieldsFromCV` merges on the same row.
**Fix:** dedup `id` on the send, or write a requeue marker so a second
requeue is visible and bounded.

### M7: Client-side Sentry `beforeSend` is materially weaker than the server's
**File:** `instrumentation-client.ts:26-30`
Only `request.cookies` and `user.email` are deleted;
`sentry.server.config.ts:27-33` additionally runs a recursive `scrub()` over
`extra` and `contexts` against `PII_KEYS`. Client components *do* capture raw
error objects (`settings/billing/manage-billing-button.tsx:39`,
`start-checkout-button.tsx`), and browser breadcrumbs record fetch URLs —
`/candidates?q=<recruiter search terms>` is exactly what CLAUDE.md forbids
sending. The in-file justification ("the client SDK never sends our own
extra/contexts payloads") is not accurate.
**Fix:** port `scrub()` into the client `beforeSend`; add a `beforeBreadcrumb`
that strips query strings from navigation/fetch breadcrumbs.

### M8: `set_created_by` inherits Supabase's default `anon` EXECUTE grant, re-opening the hygiene gap its sibling migration closes
**File:** `supabase/migrations/20260804130000_set_created_by_trigger.sql:35-44`
No `revoke ... from anon`, and the filename sorts *after*
`20260804120100_revoke_anon_execute_security_definer.sql`, so the sweep never
sees it. It is a trigger function (direct invocation errors), so
exploitability is nil — but the audit item being closed was precisely "new
public functions get an automatic anon grant."
**Fix:** append `revoke all on function public.set_created_by() from public, anon;`.

---

## LOW / INFO

- **L1** `reconcile-cv-parses.ts:221` — auto-resume matches budget-capped rows via `.ilike('parse_error','%AI budget%')`, a substring match against recruiter-facing copy. `parse-messages.ts:18` documents the substring as load-bearing but nothing enforces it; a copy edit silently disables the auto-resume the UI promises. Add a unit test asserting `CV_BUDGET_CAPPED_MESSAGE` matches the reconciler's pattern.
- **L2** `reconcile-cv-parses.ts:240-244` — skips an org when `checkCap` returns `allow:false` regardless of mode, but `parse-cv.ts:215` only blocks on `mode === 'hard'`. A soft-capped (80–99%) org's rows are never resumed even though a fresh parse would run fine. Align the predicate.
- **L3** `score-application-match.ts:84,92` — `asScoreMatchData(event.data.event.data)` then `.application_id`; if Inngest ever hands `onFailure` an event without nested data the failure handler itself throws. Use optional chaining.
- **L4** `cv-review-panel.tsx:256` — `{parseError ?? CV_NO_TEXT_MESSAGE}` is unreachable: the branch requires `isUnparseableSource(parseError)` to be true, which requires a non-null string.
- **L5** `parse-cv.ts:158-165` — `onFailure` overwrites `parse_error_detail` with `${error.name}: ${status}` unconditionally, destroying the more useful in-body detail (`extract-text yielded 0 chars for mime …`) even when `preserveExistingMessage` correctly preserves the user-facing message. Preserve both or neither.
- **L6** `floats/actions.ts:88-94` — the enqueue is a documented permanent no-op (`job_id` hardcoded `null` at `:60`). Harmless forward-proofing, but "all four application-create paths" is really three.
- **L7** `jobs/[id]/page.tsx:36`, `clients/[id]/page.tsx:33` — comments claim to "mirror the candidates convention", but the candidates convention audits *inside* `getCandidate` (`candidates.ts:286-303`). The comment describes the opposite of the established pattern.
- **L8** `stripe-reconcile.ts:293-297` — stuck-event sweep has no `.limit()`; `stuckEventsCount` silently caps at whatever PostgREST returns.
- **L9** `isMissingColumnError` is duplicated verbatim in `webhook/route.ts:95-99` and `stripe-reconcile.ts:20-24`, with a looser variant in `candidate-cvs.ts:150-153` that additionally substring-matches `error.message`. Three copies of a load-bearing pre-migration guard will drift.
- **L10** No cache invalidation from the Inngest side: `scoreApplicationMatch` writes `ai_summaries` but nothing revalidates `/jobs/[id]` or `/pipeline`, so the badge appears only on the next navigation. Expected for an async job — flagged so the browser pre-smoke refreshes before concluding "the badge didn't appear."

---

## Checks run that came back CLEAN

1. **Stripe signature verification untouched.** `runtime='nodejs'`, `await request.text()` before any parse, `constructEvent`, 400 with no detail leak. Zero diff to invariants 1–3.
2. **SECURITY INVARIANT 4 holds — a failed event is never deduped away.** Short-circuit is `seen.found && (status === null || status === 'processed')`; `'received'` and `'error'` fall through and re-drive. Covered by a new `it.each(['received','error'])` test. The up-front stamp uses `ignoreDuplicates: true` (DO NOTHING) so a concurrent `'processed'` row is never downgraded. The migration's `default 'processed'` backfill is truthful — pre-existing rows were only ever written on success.
3. **Pre/post-migration column tolerance verified in both directions.** `readLedgerSeenStatus` falls back to the legacy `stripe_event_id`-only select on PGRST204/42703 and treats any row as `'processed'` (the exact old contract). All three ledger writes, the reconcile sweep, and `updateCandidateCVParse` are guarded. `tsc --noEmit` passes against the **un-regenerated** `src/types/database.ts` — the two narrow boundary casts (`asStripeWebhookEventsClient`, the `Record<string, unknown>` patch) keep the typecheck honest rather than papering over it.
4. **Migrations are append-only and idempotent.** No committed migration modified (only 4 new files under `supabase/migrations/`). All re-runnable: `add column if not exists` ×4, `drop constraint if exists` before `add constraint`, `create index if not exists`, `create or replace function`, `drop trigger if exists` before `create trigger`, `pg_proc`-driven REVOKE loop. Zero DROP/DELETE/UPDATE of data.
5. **REVOKE migration tolerates missing functions and leaves the right grants alone.** The `for … in select p.oid from pg_proc` loop iterates zero times for `rls_auto_enable` (which does not exist). `record_audit_anonymous` is correctly excluded (already anon-less per `20260519092947`). `from anon` only — `authenticated` and `service_role` untouched. The only anon-role query in the codebase (`src/app/status/page.tsx` probing `organizations`) hits policies declared `to authenticated`, so it never evaluates `current_organization_id()` as anon.
6. **`set_created_by` FK safety confirmed.** `public.users.id` is `primary key references auth.users(id)` (`20260513151021:24`), so `auth.uid()` is always a valid `created_by`. All five target tables carry `created_by uuid references public.users(id) on delete set null`. Service-role paths (Inngest, apply form) get `auth.uid() = NULL` → `coalesce` → NULL, i.e. today's behaviour. No FK-violation outage.
7. **Trigger ordering safe against the documented outage class.** `<table>_set_created_by` sorts before `<table>_set_org` and `<table>_verify_same_org_check` ("set_c" < "set_o" < "verify_s"). Confirmed neither `set_organization_id()` nor the same-org guards read `created_by`, so firing first is inert.
8. **Multi-tenancy on both new service-role Inngest paths.** `score-application-match.ts:135-140` re-checks **both** parents' `organization_id` against the untrusted event payload before any read or spend, throwing `NonRetriableError` on mismatch — same shape as the proven `precompute-matches-for-job.ts:212-224`. `reconcile-cv-parses.ts` never crosses a boundary: it re-enqueues each row with that row's own `organization_id`, groups cap checks per-org, and the heal step only touches the candidate the CV row already points at.
9. **Every new user-facing read path is RLS-scoped.** `listLatestMatchScoresForPairs`, `getCvParseHealth`, and all four `recordSearchAudit`/`recordViewAudit` sites take the SSR client from `@/lib/supabase/server`. The single service-client audit (`recordServiceAudit`) sits behind `requireSuperAdmin()` and deliberately files against the **exported** org, not the admin's — which is the correct fix for a real prior bug.
10. **No server-only module imports a browser client.** `src/lib/db/audit.ts` has `import 'server-only'` and pulls only Sentry + a type. `enqueue-match-score.ts` pulls only `@/lib/inngest/client` + Sentry. `parse-messages.ts` and `profile-completeness.ts` deliberately omit `server-only` because `cv-review-panel.tsx` (`'use client'`) imports the former — verified neither has a server-only transitive dependency.
11. **No async work inside a Supabase subscriber callback.** Grepped the full diff for `onAuthStateChange`, `.channel(`, `.on(` — zero occurrences in any changed file.
12. **Inngest wiring correct.** `reconcileCvParses` and `scoreApplicationMatch` both registered (`api/inngest/route.ts:59,65`). Sender `'application/score-match'` (`enqueue-match-score.ts:35`) matches the handler trigger (`score-application-match.ts:80`). Reconciler senders use `'cv/uploaded'`, matching `parse-cv`'s existing trigger. Concurrency keys sane: reconciler `{limit:1}` (global cron, mirrors `embed-batch`), scorer `{limit:2, key:'event.data.organization_id'}` (mirrors `precompute-matches-for-job`).
13. **No SF-1-class `onFailure` message clobber in the new code.** `scoreApplicationMatch.onFailure` performs no DB write, so it cannot overwrite honest state. `parseCVOnUpload.onFailure` now passes `preserveExistingMessage: true`; I traced all four row states it can observe (`complete`, `failed`+message, `failed`+empty, `pending`) and it preserves only the case it should.
14. **`_failed` telemetry cannot break cost accounting or caps.** `ai_usage.purpose` is plain `text` with no CHECK/enum (`20260513152244:375`), so suffixed purposes insert cleanly. `PURPOSE_CAP_BUCKETS` has no entry for them and `aggregateUsage` skips unknown purposes (`usage.ts:91-92`). `getOrgMatchSpendThisMonth` filters `purpose='match_score'` exactly. Rows carry `cost_pence: 0`, so the £3000 global backstop (sum over all purposes) is unmoved. `record_ai_usage` is service-role-only and every `_failed` writer uses `createServiceClient()`.
15. **`_failed` rows are logged once per invocation, not once per retry.** `claude.ts`'s new outer `try` wraps the whole `while` loop; `continue` branches never reach it and the success path `return`s from inside. `CapExceededError` is thrown from the pre-flight block **outside** that try, so a cap decision correctly produces no `_failed` row. `voyage.ts:164-184` and `whisper.ts:188-214` wrap only the SDK call, not the pre-call validation, so a validation throw is correctly not counted.
16. **No `_failed` string, and no `parse_error_detail`, reaches an end user.** `formatPurposeLabel` (`settings/usage/page.tsx:57-62`) is applied at **both** render sites. Every other surface rendering AI usage (`/settings/billing`, `/admin`) renders bucket labels from `PURPOSE_CAP_BUCKETS`, not raw purposes. Grep confirms no UI reads `parse_error_detail`.
17. **No PII in new audit metadata or Sentry payloads.** `recordSearchAudit` carries `{mode, semantic_ok, result_count, surface}` only — traced all four call sites (`search/page.tsx:120,213,222`, `candidates/page.tsx:85`); none passes `q`. New Inngest Sentry tags carry ids, error names and HTTP statuses only; raw errors go through `formatErrorForSentry`. `parse_error_detail` values are char counts, mime types and error names.
18. **`23505`-as-benign is correct and tested.** `upsertMatchSummary` maps it to `'duplicate'` without a Sentry capture (mirroring `createApplication`); `score-application-match.ts:265-272` treats it as a non-fault. Three unit tests cover 23505 / non-23505 / success.
19. **`enqueueApplicationMatchScore` genuinely never throws** — null/empty-id guard, try/catch around `inngest.send`, Sentry capture with `err.name` only, four unit tests including the reject case. It is `await`ed (not fire-and-forget) at all call sites, so a serverless freeze cannot drop it.
20. **`record_audit` contract matches.** `p_action` is the `public.audit_action` enum `('view','create','update','delete','export')` — both `'view'` and `'export'` are valid values, so neither new audit call silently fails on a cast. `entity_type` is plain text; `entity_id uuid not null` has no FK, so `NIL_UUID` for searches is safe.
21. **Gates pass on the merged branch:** `tsc --noEmit` clean; `eslint .` 0 errors (24 pre-existing warnings, all in test files); `vitest run` — 448 passed, 28 todo, 0 failed, 51 files.

---

## Verdict

**FIX-FIRST.**

**Blocking (must be fixed before the founder touches this):**
- **C1** — heal step is inert; the claimed production data remediation does not run
- **C2** — two new honest messages discarded by the UI; `fail-no-file` ships a retry button that cannot succeed
- **C3** — timed-out retry is a dead end; SF-5 not actually closed
- **H1** — embed sweep starvation can silently kill semantic search entirely
- **H2** — un-dismissable amber alarm lands on the live customer's dashboard

**Decide before UAT (UAT itself spends money here):**
- **H4** — shortlist-add now bills a Sonnet call per candidate with nothing rendered

**Fix soon, does not block:** H3, M1–M8.

**Not blocking, and worth saying plainly:** the security work in this batch is
good. The anon-RPC REVOKE migration is careful and correctly scoped, the
Stripe idempotency contract survives the ledger change with real test
coverage, the two service-role Inngest paths re-verify tenancy against the
untrusted payload, and the search telemetry deliberately never records the
raw query. The problems are all in remediation code that doesn't actually
remediate — which is why the verdict is FIX-FIRST rather than SHIP.

---

_Reviewed: 2026-08-04_
_Reviewer: Claude (gsd-code-reviewer), depth=deep, adversarial_
_Base: f7f7b50 (origin/main = prod) → HEAD 7474f71_
