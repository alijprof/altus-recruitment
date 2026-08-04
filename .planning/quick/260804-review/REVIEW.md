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
re_reviewed: 2026-08-04T18:25:00Z
re_review_range: 7474f71..a34dd01
re_review_findings:
  fixed: 23
  accepted_residual: 2
  new_medium: 2
  new_low: 6
  new_info: 2
re_review_verdict: SHIP-CONFIRMED
v1_gate: closed (predicate corrected in a34dd01; prod returns 5 rows, both casualties in)
v2_gate: open (observe first cron run — no heal-select exception)
verdict: FIX-FIRST (superseded by re_review_verdict: SHIP)
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

---

# Re-review — 15 fix commits (`7474f71..0b51618`)

**Re-reviewed:** 2026-08-04T18:25:00Z
**Scope:** delta only, adversarial. 34 files, +1849 / −190.
**Verdict: SHIP** — conditional on two non-code verification gates (V1, V2 below).

All five blockers (C1, C2, C3, H1, H2) and both decision items (H3, H4) are
genuinely closed — I traced each failure scenario end to end rather than
taking the fix report's word for it. Two new MEDIUM findings and five new LOWs
came out of the delta; none blocks. The one-line M1 fix (RR-1) is worth taking
before merge because it is in the same file the fixer already touched.

## Gates re-run independently

| Gate | Result |
|------|--------|
| `tsc --noEmit` | clean |
| `eslint .` | 0 errors (24 warnings, all pre-existing, all `_`-prefixed test-double params) |
| `vitest run` | 490 passed / 28 todo / **0 failed** (was 448 — +42) |
| `next build` (dummy env) | completes; all routes emitted |

The build also proves the new root-level `@/` imports resolve —
`instrumentation-client.ts` and `sentry.server.config.ts` both now import
`@/lib/observability/sentry-scrub`, which typecheck alone would not have
caught if Turbopack's entry resolution differed. It does not.

---

## Blocking findings — verification

### C1 — heal step reachability: **CLOSED (mechanism)**, 2 caveats

Predicate moved from post-fetch into the selector. I checked it column-for-column
against `isProfileEffectivelyEmpty` rather than trusting the claim:

| Column | TS predicate | SQL filter | Agree? |
|---|---|---|---|
| `current_role_title` | null OR whitespace-only | `IS NULL` | SQL **stricter** |
| `current_company` | null OR whitespace-only | `IS NULL` | SQL **stricter** |
| `location` | null OR whitespace-only | `IS NULL` | SQL **stricter** |
| `seniority_level` | null OR whitespace-only | `IS NULL` | SQL **stricter** |
| `years_experience` | `!= null` | `IS NULL` | exact |
| `skills` | null OR `length 0` | `<@ '{}'` | exact — column is `text[] not null default '{}'` (`20260513152244:219`), so there is no NULL hole |
| `sector_tags` | null OR `length 0` | `<@ '{}'` | exact — same, `:218` |

The only drift is whitespace-only strings, and it runs in the **safe
direction**: SQL under-selects, so a drifted row never enters the window and
cannot recreate the starvation. `postFetchDrops` catches it at runtime if it
ever happens.

Drain confirmed: a healed candidate stops satisfying the join and leaves the
result set, and `ascending: true` drains oldest-first. `candidates!inner(id)`
is unambiguous — `candidate_cvs` has exactly one FK to `candidates`
(`candidate_id`, `20260513152244:246`).

**V1 (must verify before claiming the casualties are healed).** The SQL
requires **all five** scalar columns to be `IS NULL`. The brief describes the
two casualties only as "skills empty, work/edu empty, extracted_data
populated" — it does not establish the scalars. I cannot check: there is no
local Supabase for this project. Run this read-only, PII-free query first:

```sql
select cv.id, cv.parsing_status, cv.created_at,
       (cv.extracted_data is not null and cv.extracted_data <> '{}'::jsonb) as extracted_ok,
       c.current_role_title is null as role_null,
       c.current_company    is null as company_null,
       c.location           is null as location_null,
       c.seniority_level    is null as seniority_null,
       c.years_experience   is null as years_null,
       c.skills      <@ '{}'        as skills_empty,
       c.sector_tags <@ '{}'        as sectors_empty
from public.candidate_cvs cv
join public.candidates c on c.id = cv.candidate_id
where cv.candidate_id in ('62783324-4ec4-4d53-8405-cf913bfe7195',
                          '3bf8ffe0-d54f-4649-aa1e-0949adb73b2c')
order by cv.created_at;
```

All eight booleans must be true on at least one `parsing_status='complete'`
row per candidate. If any is false, C1 is still open **for those rows** and
they need a targeted fix, not a sweep.

**V2 (must smoke).** The heal query's PostgREST syntax is exercised by **no
test and no live execution**. `.neq('extracted_data', '{}')` on a `jsonb`
column and `.containedBy('candidates.skills', [])` on an *embedded* column
path are both forms with no precedent elsewhere in this codebase. If PostgREST
rejects any of them the step Sentry-captures and `return`s — which is C1's
exact outcome (heal never runs), just loudly. Confirm on the preview deploy
that the first cron run logs no `heal-unmerged-profiles-select` exception.

### C2 — write-only messages + doomed retry: **CLOSED**

Traced the full chain, not just the render branch:

1. `download-cv` now returns a discriminated result; a genuinely missing
   object writes `CV_UPLOAD_INCOMPLETE_MESSAGE` **before** the
   `NonRetriableError` fires (`parse-cv.ts:238-273`).
2. The in-body catch gained `preserveExistingMessage: true`, so it no longer
   clobbers that message.
3. `onFailure` already preserved. The honest message survives all three write
   points.
4. `FailedState`'s generic branch renders `{parseError ?? CV_PARSE_FAILED_MESSAGE}`
   — the hardcoded copy is gone.
5. New `isUploadIncomplete` branch withholds the retry button and points at
   the upload control; `retryParseAction` refuses the same state server-side,
   so a direct action call cannot destroy the message either.

Branch-order collision check (the thing that would silently break this): I
tested all six stored messages against all three sentinel substrings —
`'AI budget'`, `'no extractable text'`, `'never finished uploading'`. No
message matches a sentinel it shouldn't, so no message lands in the wrong
branch.

PII check on the new raw render: grepped every `parseError:` writer. All write
module constants or fixed literals; `parse-cv.ts:121` writes `markCvFailed`'s
`userMessage`, which is only ever a constant or a preserved prior constant.
The "PII-safe by construction" claim holds.

`CV_STUCK_MESSAGE` correctly **keeps** its retry button — parsing never
started there, so re-dispatch can genuinely succeed. That distinction is right.

### C3 — timed-out retry dead end: **CLOSED, and the test proves it**

`useRetryParse` takes `onSuccess`; `PendingState` clears `timedOut` and resets
`startedAt`, which is a dependency of the poll effect — so the effect re-runs
and installs a fresh interval with the budget restarted.

I checked the test actually asserts the re-arm rather than rubber-stamping it
(`tests/unit/app/candidates/cv-review-panel.test.tsx:135-166`). It:
- proves polling is **provably dead** post-timeout — `expect(refresh).toHaveBeenCalledTimes(refreshesAtTimeout)` after five further ticks;
- clicks retry, then asserts the timed-out alert is **gone**, the spinner is back, and the refresh count **increases**.

A second test asserts a **failed** retry does not clear the latch.

The reconciliation concern from the original finding is satisfied: the bug
existed *because* React preserves the instance, and the test operates on a
preserved instance. Re-arming within that instance is necessary and sufficient.
(`startedAt` can never collide with its previous value here — the reset happens
at least 5 minutes after mount.)

### H1 — embed sweep starvation: **CLOSED**

`NON_EMPTY_PROFILE_OR_FILTER` runs in the selector, ANDed with
`candidate_embedding IS NULL` (supabase-js emits `or=(...)` as a separate,
ANDed param — complement is correct). Empty profiles never enter the 256-row
window. The TS guard is retained but now **counted**, so drift surfaces as a
Sentry warning instead of silently re-creating the outage. Both sweeps gained
`created_at ascending`. Drift tests pin the clause count, the per-type
operators, and PostgREST-safe escaping.

### H2 — un-clearable dashboard alarm: **CLOSED**

14-day window **and** latest-`version`-only, with the count over distinct
candidates so it agrees with the names rendered beneath it. The widget already
unmounts at `total === 0`, which is now reachable: abandoned apply-form
failures age out, superseded failures drop out. Version resolution fails open.

### H3 — permanent daily false billing alert: **CLOSED**

One retry on the `'processed'` stamp (skipped for missing-column errors, which
are deterministic), 7-day upper bound so resolved-but-unstamped rows age out,
and severity now `warning` unless a stuck row appeared in the last 24h.
`.limit(500)` with a `truncated` flag. Two new tests cover the retry landing
and both attempts failing.

**SECURITY INVARIANT 4 unaffected** — the retry is on the *success* path only;
failed processing still returns 500 and is never stamped `'processed'`.

### H4 — shortlist spend: **CLOSED**

Grepped every call site of `enqueueApplicationMatchScore`: `jobs/[id]/actions.ts`
(add-to-job), `candidates/[id]/shortlist-actions.ts` (promote),
`floats/actions.ts` (permanent no-op). `addToShortlistAction` no longer imports
or calls it. **No shortlist-create path enqueues.**

---

## M-fixes — new-defect check

### M4 (`record_audit` view dedupe) — mechanically correct; one policy point

This was the highest-risk fix and it is well built:

- **`entity_type = 'search'` is explicitly excluded** — the search telemetry
  this whole batch exists to create is preserved. This was the specific risk
  raised, and it is handled (`:83`).
- Only `p_action = 'view'`; create / update / delete / **export** never reach
  the guard, so no discrete business event is ever swallowed.
- `actor_user_id is not distinct from auth.uid()` — correct NULL handling.
- Signature, `security definer`, `set search_path = public` and the org-context
  RAISE reproduced verbatim from `20260513152244:104-126`.
- **Privileges survive.** `create or replace` preserves them, and the file
  restates `revoke all from public` / `revoke execute from anon` /
  `grant execute to authenticated` — so the `20260804120100` anon revoke is not
  regressed despite this filename sorting after it. That is exactly the trap
  to avoid here, and it was avoided.
- Returns the existing row id rather than NULL, keeping `returns uuid` truthful.

**RR-6 (INFO — founder sign-off, not a defect).** The dedupe also covers
**candidate** detail views, because `getCandidate`'s inline audit goes through
the same `record_audit`. CLAUDE.md states "Every access to candidate data is
logged" as a foundational constraint. Assessed against it: hour-granularity
access logging is defensible and industry-normal, and the collapsed rows are
overwhelmingly `revalidatePath` re-renders and prefetches rather than human
views — so the log becomes *more* truthful about who accessed what, not less.
But this narrows a stated project constraint, and that belongs in a founder
decision rather than a migration comment. Note it is **clock-hour bucketed,
not a sliding window**: views at 10:59 and 11:01 both log, while 10:01 and
10:59 collapse.

M4 is FILE ONLY — until pushed, the phantom-view inflation continues. Correctly
disclosed, and there is no pre/post-migration code skew either way.

### M5 / M6 crash-window semantics — correct

M5's send-before-clear inverts the risk into the harmless direction: if the
UPDATE fails after a successful send, the row keeps its honest budget-capped
message and parse-cv overwrites the state itself. The old order left a
message-less `'pending'` spinner for ≥15 minutes. Per-**row** try/catch replaces
per-org, so one bad row no longer skips the org's backlog, and `checkCap`'s own
throw is caught separately.

M6's hour-bucketed dedup ids bound concurrent re-parses without becoming a
permanent lock, and `retryParseAction` deliberately sends **no** id so a
recruiter's manual retry can never be swallowed. That reasoning is right.

### New findings from the delta

**RR-1 (MEDIUM) — M1's dedup key turns transient skips into a 24-hour blind spot.**
`src/lib/inngest/enqueue-match-score.ts:40`
`id: score-match:${candidateId}:${jobId}` dedups for 24h. But several scorer
outcomes write **no summary**: `{skipped:'empty-profile'}`,
`{stopped:'cost-ceiling'}`, `{scored:false, reason:'cap-exceeded'|'inputs-unavailable'}`,
and — after M2 — an exhausted version-lookup retry. In each of those, any
further enqueue for the same pair within 24h is silently dropped.

Most reachable path: a candidate added to a job *before* their CV has parsed is
skipped as `empty-profile`; the reconciler heals the profile ~15 minutes later;
nothing re-scores, and re-adding won't either. M2 compounds it — a failing
version lookup burns the 3 retries and then locks the pair out for a day.

The in-code justification ("the cached summary would have satisfied it anyway")
holds only when a summary was actually written; on the skip paths none was.
Notably the same fixer bucketed the *reconciler's* dedup ids by hour and wrote,
correctly, that a bare row id "would permanently lock a row out" — that
reasoning wasn't carried across to this key.

**Fix (one line):** `id: \`score-match:${args.candidateId}:${args.jobId}:${Math.floor(Date.now() / 3_600_000)}\``
— keeps the double-click / fast-promote collapse M1 actually targets (those
happen within seconds) while capping the blind spot at an hour.
Non-blocking: the `/matches` Explain button writes through
`matches/actions.ts` → `upsertMatchSummary` directly, so a manual escape hatch
exists.

**RR-2 (MEDIUM) — C1's squatter mechanism survives in miniature, now loud.**
`src/lib/inngest/functions/reconcile-cv-parses.ts:439`
`if (!hasAnyUsableField(parsedSubset)) continue` still exits with **no state
change and no counter**, and a merge that populates only out-of-set fields
(email/phone) is counted (`noProgressRows`) but still not drained. Either way
the row is re-selected on every sweep and permanently occupies a slot; 25 such
rows re-block the step. `.neq('extracted_data','{}')` only excludes literally
empty blobs, not blobs with no *usable* fields. The counters make this loud
rather than silent — a genuine improvement over the original — but the
mechanism is the same one C1 described. Consider a `heal_checked_at` stamp so
un-healable rows leave the window.

**RR-3 (LOW) — the reconciler hardcodes the completeness filters; only
embed-batch derives them.**
`profile-completeness.ts:51-53` instructs "add it here AND to the two query
builders that consume these arrays", but the reconciler's heal step spells out
seven `.is(...)` / `.containedBy(...)` calls inline rather than consuming
`PROFILE_COMPLETENESS_*`. A new `ProfileCompletenessFields` key would fail the
drift tests for the constants and for `NON_EMPTY_PROFILE_OR_FILTER` (derived),
while the reconciler silently keeps the old filter set — reintroducing
RR-2-style squatting. Caught at runtime by `postFetchDrops`, not at build time.

**RR-4 (LOW) — M5 × C2 interaction race.**
M5 now sends the `cv/uploaded` event while the row is still `'failed'` with
`CV_BUDGET_CAPPED_MESSAGE`, and C2/L5 added `preserveExistingMessage: true` to
parse-cv's in-body catch. If parse-cv reached that catch before the subsequent
UPDATE landed, it would preserve the stale budget message; the UI would show
the budget branch and the reconciler's `ilike '%AI budget%'` would resume the
row again next sweep. The window is one DB round-trip versus Inngest dispatch →
HTTP → cold start → the `check-ai-budget` step, so it is very unlikely, and it
self-corrects on the following sweep. Worth a comment, not a code change.

**RR-5 (LOW) — H1's whitespace-only drift is tested-in.**
`profile-completeness.test.ts:43` asserts a whitespace-only `location` is
"empty" for TS, while the SQL uses `not.is.null` and counts it as present. Such
a row is selected, dropped post-fetch, keeps a NULL embedding forever, and is
re-selected every 10 minutes — H1 in miniature, now loud via `postFetchDrops`.
No writer plausibly produces whitespace-only values, so exposure is low.

**RR-7 (LOW) — H2's version map can truncate.**
`dashboard.ts:588-594` orders by `version` **desc globally across candidates**
with `limit 1000`. On truncation a candidate can be absent from the map, and
`maxVersionByCandidate.get(id) === r.version` is then false, so its row is
filtered out — under-reporting. Correct direction for an alarm, unreachable at
anchor scale, and documented in-code.

**RR-8 (INFO) — H3's 7-day ceiling means "no alert" no longer implies "no
problem"** for an event stuck longer than a week. Acceptable because the
subscription-level Stripe↔local reconciliation is the primary safety net, but
the founder should know the alert is now bounded.

**RR-9 (INFO) — M7 residual, now symmetric.** `event.exception.values[].value`
and `breadcrumb.message` remain unscrubbed on **both** SDKs. That was true
before and is unchanged; the finding was the *asymmetry*, and the two configs
are now identical by construction (one shared module).

Verified with no new defects: **M2** (hard stop, plain `Error` so Inngest's
retries handle the transient case), **M3** (`.limit(pairs.length * 3)` applied
per chunk against the total — over-provisioned, never under; newest-per-pair
preserved across chunks by the `out.has(key)` guard; 100-id chunking bounds URL
length), **M7** (shared `scrub`/`PII_KEYS`, `beforeBreadcrumb` strips
`url`/`from`/`to`, `stripQueryString` avoids `new URL()` which throws on
relative inputs), **M8** (`pg_proc` loop, no-ops when absent, `public` + `anon`
only, committed `20260804130000` untouched), **L1–L5, L7–L9**.

---

## Verified-CLEAN properties — regression spot-check

- **Stripe SECURITY INVARIANT 4**: short-circuit at `route.ts:191` is
  byte-identical (`seen.found && (seen.status === null || seen.status === 'processed')`).
  The `it.each(['received','error'])` invariant test and the PGRST204
  degradation test are unmodified and pass.
- **Tenancy re-verification**: both `organization_id` comparisons intact at
  `score-application-match.ts:150-153`; `precompute-matches-for-job.ts:116,212`
  untouched.
- **REVOKE exclusions**: `20260804120100` unmodified; `record_audit_anonymous`
  still deliberately excluded; M4 explicitly restates the anon revoke on
  `record_audit` so `create or replace` cannot regress it.
- **Append-only migrations**: no committed migration modified; both new files
  additive and idempotent.
- **No server-only module imports a browser client**: the two new leaf modules
  (`postgrest-errors.ts`, `sentry-scrub.ts`) are pure and correctly omit
  `server-only` — `sentry-scrub` is imported by the browser SDK config, and the
  production build confirms it bundles.

---

## Re-review verdict: **SHIP**

No code change blocks the merge. Both original residuals (L6, L10) remain
correctly accepted.

**Two must-do gates before the deploy is described as having healed production
data** — neither is a code change:

- **V1** — run the read-only query above and confirm both casualties satisfy
  all eight predicate columns. Until then, "the two casualties self-heal on the
  first cron run" is unproven, and that is the one claim the founder would act on.
- **V2** — on the preview deploy, confirm the first `reconcile-cv-parses` run
  logs no `heal-unmerged-profiles-select` exception. The heal query's PostgREST
  syntax has never been executed.

**Recommended before merge (optional, one line):** RR-1 — hour-bucket the
match-score dedup id.

**Carry into the browser pre-smoke:** L10 (refresh the job/pipeline page before
judging a missing badge) and the RR-1 blind spot (a candidate added to a job
before their CV parses will not get a badge — expected, not a bug).

---

_Re-reviewed: 2026-08-04_
_Reviewer: Claude (gsd-code-reviewer), depth=deep, adversarial delta pass_
_Range: 7474f71..0b51618 (15 commits)_

---

## Re-review addendum — `a34dd01` (V1 fix + RR-1)

**Checked:** 2026-08-04T18:35:00Z · targeted pass over `0b51618..a34dd01` only.
**Result: SHIP-CONFIRMED.** No new defect. One stale comment block (RR-10, doc-only).

V1 did its job: the C1 predicate mirrored `isProfileEffectivelyEmpty` (all five
scalars null), and prod showed 62783324 has `location` set and 3bf8ffe0 has
role + company set — **both casualties were excluded**. The gate caught a fix
that would have shipped looking correct and healed nothing.

### 1. New defects in the edited regions — none found

**`.filter('candidates.work_experience', 'eq', '[]')` — I do NOT know this to
be invalid, and have positive reason to think it is fine.**
- The dotted-path form is the *documented* supabase-js v2 pattern for filtering
  an embedded resource (`.select('…, cities!inner(name)').filter('cities.name',
  'eq', 'Bali')`). `.filter()` is the generic escape hatch and passes the column
  through exactly as `.is()` / `.containedBy()` do on the adjacent lines.
- The value `[]` is not PostgREST-reserved. The reserved set for filter values
  is `,` `.` `:` `(` `)` `"` plus the `{}` array-literal form; `[` and `]` pass
  through and are cast to the column type, giving `work_experience = '[]'::jsonb`.
- Semantics verified: `work_experience` and `education` are
  `jsonb not null default '[]'::jsonb` (`20260522094604:26-27`), so `eq.[]` is
  the complete "empty" test with no NULL hole — the in-code claim is accurate.

**The load-bearing safety claim holds.** The looser predicate now selects
candidates with populated scalars, so "D-08's fill-empty-only merge makes this
safe by construction" had to be true rather than asserted. Verified in
`markCandidateFieldsFromCV`: scalars write only when
`candidateValue == null || candidateValue === ''`; arrays only when
`Array.isArray(candidateValue) && candidateValue.length === 0`;
`work_experience`/`education` guarded identically. A candidate's existing
`location` / `current_role_title` / `current_company` **cannot** be overwritten
by the heal. This is the property that makes healing 62783324 and 3bf8ffe0 safe.

**Embedded-shape check:** `candidate_cvs.candidate_id → candidates.id` is
many-to-one, so PostgREST returns `candidates` as a single object, matching the
widened `UnmergedProfileRow`. Even if it did not, `(undefined ?? []).length === 0`
and `isEmptyJsonbArray(undefined)` both yield `true`, so the guard would
degrade to always-proceed — and the merge is idempotent and fill-empty-only.
Fail-safe either way.

**Drift direction unchanged and still safe:** TS `isEmptyJsonbArray` treats SQL
NULL and JSON `null` as empty; SQL `eq.[]` does not. SQL ⊆ TS, so the selector
under-selects and `postFetchDrops` cannot fire from this direction. Cannot
recreate starvation.

**RR-1 applied correctly** — `score-match:<cand>:<job>:<hourBucket>`, mirroring
the reconciler's requeue ids; test updated to compute the same bucket.

### 2. Removing the `getCandidateForEmbedding` fetch — nothing lost

Its result fed **only** the `isProfileEffectivelyEmpty` post-fetch guard.
`markCandidateFieldsFromCV` takes `candidateId` + `parsed` and performs its own
read to decide which columns are empty, so the merge path never consumed that
row. The three heal-signal columns it now needs come from the `!inner` join in
the same round-trip. Net: one fewer query per row (25 per sweep).

The only thing dropped is the `if (!candidateResult.ok) continue` vanished-row
guard, which `candidates!inner` already makes near-dead (the join proves the
candidate existed at select time, and candidate deletes cascade to
`candidate_cvs`). A delete racing the merge now surfaces as a
`heal-unmerged-profile` Sentry capture instead of a silent skip — marginally
noisier for a benign race, not wrong.

### 3. Two-predicates-now-distinct — no test breaks, one stale comment

- No test asserts the two predicates match. `profile-completeness.test.ts`
  covers `isProfileEffectivelyEmpty`, the `PROFILE_COMPLETENESS_*` drift guard,
  and `NON_EMPTY_PROFILE_OR_FILTER` — none references the reconciler. Confirmed
  by re-running the suite: **490 passed / 0 failed**.
- The contamination guard is genuinely untouched at its sites:
  `parse-cv.ts:386`, `embed-batch.ts:175`, `precompute-matches-for-job.ts:233`,
  `match-card.tsx:65` (+ `score-application-match.ts:190`). The reconciler is
  cleanly out of that set.
- `profile-completeness.ts:13-15`'s list of contamination sites never included
  the reconciler, so it is still accurate.

**RR-10 (LOW, doc-only) — stale guidance in `src/lib/ai/profile-completeness.ts:43-54`.**
That block still says "**Both sweeps** now express the same predicate in their
SQL selector" and "add it here AND to **the two query builders** that consume
these arrays … (both call sites keep the TS predicate as a post-fetch guard)".
After `a34dd01` there is exactly **one** consumer (`embed-batch.ts:130`); the
reconciler now uses `HEAL_SIGNAL_COLUMNS` and its own SQL. This matters more
than a typo: V1 failed *because* the heal step was designed to mirror this
predicate, and the comment still instructs the next developer to restore that
mirror. Reword to name embed-batch as the sole consumer and state explicitly
that the reconciler's heal signal is deliberately different (merge-applied vs
profile-contaminated).

### Gates re-run independently

`tsc --noEmit` clean · `vitest run` **490 passed / 28 todo / 0 failed** ·
`eslint .` **0 errors** (24 pre-existing test-double warnings).

### Verification gates — status

- **V1 — CLOSED.** Predicate corrected; prod read-only run returns exactly 5
  rows platform-wide, both casualties included, oldest-first, well under the
  25-row cap. First cron run heals everything in one pass.
- **V2 — still open, now a 30-second observation.** If the prod run of the
  corrected predicate went through PostgREST, V2 is already satisfied; if it
  was raw SQL, the semantics are proven but the PostgREST spelling is not.
  Either way: on the preview/prod deploy, confirm the first
  `reconcile-cv-parses` run logs **no** `heal-unmerged-profiles-select`
  exception, and that the 5 rows drop to 0 on the following sweep.

### Residual re-rating

**RR-2 (MEDIUM) — aperture widened, keep watching.** The looser predicate
enlarges the population of rows that can be selected but never drained: a
candidate whose CV parsed but yielded no skills / work history / education
merges "successfully", populates nothing in `HEAL_SIGNAL_COLUMNS`, and is
re-selected every sweep. It is counted (`noProgressRows`) and Sentry-warned, so
it is loud rather than silent, and prod shows only 5 eligible rows today — but
the `heal selector/guard mismatch` warning is now the signal that this is
accumulating. If `noProgressRows` is persistently non-zero after deploy, add a
`heal_checked_at` stamp so un-healable rows leave the window.

All other residuals (RR-3/4/5/7, RR-8/9, L6, L10) unchanged.

---

_Addendum: 2026-08-04 · range `0b51618..a34dd01` · verdict **SHIP-CONFIRMED**_
