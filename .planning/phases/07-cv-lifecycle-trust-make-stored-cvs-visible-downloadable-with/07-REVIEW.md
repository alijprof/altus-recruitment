---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
reviewed: 2026-08-11T16:40:00Z
re_reviewed: 2026-08-11T17:35:00Z
depth: deep
diff_range: 5144ec7..526cb40
re_review_range: 526cb40..bf854cf
files_reviewed: 34
files_reviewed_list:
  - docs/cron-monitoring.md
  - src/app/(app)/candidates/[id]/actions.ts
  - src/app/(app)/candidates/[id]/cv-file-link.tsx
  - src/app/(app)/candidates/[id]/cv-files-panel.tsx
  - src/app/(app)/candidates/[id]/cv-review-panel.tsx
  - src/app/(app)/candidates/[id]/edit/actions.ts
  - src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx
  - src/app/(app)/candidates/[id]/edit/page.tsx
  - src/app/(app)/candidates/[id]/edit/schema.ts
  - src/app/(app)/candidates/[id]/page.tsx
  - src/app/(app)/jobs/[id]/matches/actions.ts
  - src/app/(app)/jobs/[id]/matches/explain-button.tsx
  - src/app/(app)/jobs/[id]/matches/page.tsx
  - src/app/(app)/jobs/[id]/matches/score-all-button.tsx
  - src/app/admin/BackfillMatchScoresForm.tsx
  - src/app/admin/actions.ts
  - src/app/admin/page.tsx
  - src/app/api/inngest/route.ts
  - src/components/app/repeating-rows.tsx
  - src/components/app/tag-input.tsx
  - src/lib/cv/confidence-summary.ts
  - src/lib/cv/cv-file-display.ts
  - src/lib/db/audit.ts
  - src/lib/db/candidates.ts
  - src/lib/inngest/functions/backfill-application-match-scores.ts
  - src/lib/inngest/functions/embed-batch.ts
  - src/lib/inngest/functions/reconcile-cv-parses.ts
  - tests/unit/app/candidates/edit-schema.test.ts
  - tests/unit/components/tag-input.test.tsx
  - tests/unit/lib/ai/embedding-invalidation-contract.test.ts
  - tests/unit/lib/cv/confidence-summary.test.ts
  - tests/unit/lib/cv/cv-file-display.test.ts
  - tests/unit/lib/inngest/backfill-application-match-scores.test.ts
  - tests/unit/lib/inngest/cron-hardening.test.ts
findings:
  critical: 3
  warning: 13
  info: 8
  total: 24
status: resolved
verdict: SHIP
original_findings_closed: 24
re_review_findings:
  blocker: 0
  warning: 6
  info: 2
  total: 8
re_review_files_reviewed_list:
  - docs/cron-monitoring.md
  - eslint.config.mjs
  - src/app/(app)/candidates/[id]/actions.ts
  - src/app/(app)/candidates/[id]/cv-file-link.tsx
  - src/app/(app)/candidates/[id]/cv-files-panel.tsx
  - src/app/(app)/candidates/[id]/edit/actions.ts
  - src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx
  - src/app/(app)/candidates/[id]/edit/page.tsx
  - src/app/(app)/candidates/[id]/edit/parse-rows.ts
  - src/app/(app)/candidates/[id]/edit/schema.ts
  - src/app/(app)/jobs/[id]/matches/actions.ts
  - src/app/(app)/jobs/[id]/matches/match-card.tsx
  - src/app/(app)/jobs/[id]/matches/page.tsx
  - src/app/(app)/jobs/[id]/matches/score-all-button.tsx
  - src/app/admin/BackfillMatchScoresForm.tsx
  - src/components/app/repeating-rows.tsx
  - src/components/app/tag-input.tsx
  - src/lib/cv/confidence-summary.ts
  - src/lib/cv/cv-file-display.ts
  - src/lib/inngest/functions/backfill-application-match-scores.ts
  - src/lib/inngest/functions/embed-batch.ts
  - src/lib/inngest/functions/reconcile-cv-parses.ts
  - tests/smoke/authed/cv-lifecycle.smoke.ts
  - tests/unit/app/candidates/candidate-edit-form-dirty-fields.test.tsx
  - tests/unit/app/candidates/cv-file-link.test.tsx
  - tests/unit/app/candidates/edit-parse-rows.test.ts
  - tests/unit/app/candidates/edit-schema.test.ts
  - tests/unit/components/repeating-rows.test.tsx
  - tests/unit/components/tag-input.test.tsx
  - tests/unit/lib/ai/embedding-invalidation-contract.test.ts
  - tests/unit/lib/cv/cv-file-display.test.ts
  - tests/unit/lib/inngest/backfill-application-match-scores.test.ts
  - tests/unit/lib/inngest/cron-hardening.test.ts
---

# Phase 7: CV Lifecycle & Trust — Adversarial Code Review

**Reviewed:** 2026-08-11
**Depth:** deep (cross-file: call chains, SQL↔TS contracts, event producers/consumers, frozen-file hashes)
**Diff:** `5144ec7..526cb40` (34 source files, +3456/−250)
**Verdict:** **FIX-FIRST** — 3 blockers

## Summary

The tenancy story on the headline feature is **sound**: `getCvFileUrlAction` cannot
mint a signed URL for another org's CV, verified against both the `candidate_cvs`
RLS policy and the `cvs` bucket policy. The omitted-vs-cleared machinery in the
widened edit action is **correct end-to-end** (traced through `sanitiseForPostgres`
→ postgrest `update()` → `JSON.stringify`). The Phase-6 freeze holds byte-for-byte.
No migrations, no new deps, no `role="alert"` regressions, no PII in the new Sentry
or audit payloads.

Three things must be fixed before a human touches this:

1. The widened edit form now writes **every** parsed column on every save from a
   snapshot taken at page load. Any parse/accept/heal that lands while the form is
   open is silently wiped on save — the exact data the phase exists to protect.
2. The "View" control's `window.open` runs after an `await`, so a blocked popup
   produces **zero feedback** on the phase's #1 customer-facing feature.
3. The cron heartbeats sit outside `step.run`, so Inngest's replay model fires them
   ~3–4× per tick (~800/day) — enough to exhaust the Sentry quota that the same
   phase relies on for stall alerting.

---

## Critical Issues

### CR-01: Widened edit form overwrites every parsed column from a stale page-load snapshot — silent AI-data loss

**Files:**
`src/app/(app)/candidates/[id]/edit/page.tsx:86-107`,
`src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx:90-112`,
`src/app/(app)/candidates/[id]/edit/actions.ts:93-140`

**Issue:** Before this phase the edit form wrote 8 basic scalars, so a stale form
could not touch the AI-parsed profile. It now submits **all 18 keys**, including
`skills`, `sector_tags`, `work_experience`, `education`, `headline`, `about`,
`seniority_level` and both salaries — populated from a single server read at page
load (`getCandidate` → `defaultValues`). The action treats a present-but-empty array
as a legitimate *clear* (correctly, per its own comment at `candidates.ts:449-463`)
and writes it. There is no `updated_at` precondition, no dirty-field filtering, and
no re-read/merge.

**Failure scenario (realistic, matches the anchor customer's actual workflow):**

1. Recruiter uploads a CV. `parse-cv` is queued (Inngest, tens of seconds to minutes).
2. Recruiter immediately opens `/candidates/{id}/edit` to correct the phone number.
   `defaultValues.skills = []`, `work_experience = []`, `education = []`,
   `headline = ''`, `about = ''`.
3. `markCandidateFieldsFromCV` merges the parse into the candidate (fills-empty-only,
   `candidate-cvs.ts:427-563`). Skills, work history, education, headline now exist.
4. Recruiter presses **Save changes**. The action writes `skills: []`,
   `work_experience: []`, `education: []`, `headline: null`, `about: null`.
   The whole parsed profile is gone, with a success redirect and no warning.

Same wipe via three more triggers, all live today: **Accept all** in the review sheet
from another tab; the `reconcile-cv-parses` heal-unmerged-profiles sweep (every 15
min); a second recruiter editing the same candidate. As a bonus, the write flips
`candidate_embedding`/`embedded_at` to NULL via the invalidation trigger, so the
sweep then re-embeds the emptied profile and search relevance degrades too.

This is unrecoverable in-UI: the CV row still exists but `markCandidateFieldsFromCV`
only fills EMPTY fields, so a re-Accept restores the wiped columns *only* because
they are now empty — but any manual value the recruiter had in a *different* field is
already lost, and nobody knows a wipe happened.

**Fix (minimal, uses machinery already present):** submit only dirty fields, so
untouched keys arrive as `undefined` and the action's existing omitted-vs-cleared
path leaves those columns untouched.

```tsx
// candidate-edit-form.tsx
const onSubmit = (data: EditCandidateInput) => {
  const dirty = form.formState.dirtyFields
  const patch = Object.fromEntries(
    Object.entries(data).filter(([k]) => k in dirty),
  ) as Partial<EditCandidateInput>
  // full_name/market_status/source are required by the action schema — always include
  const payload = {
    ...patch,
    full_name: data.full_name,
    market_status: data.market_status,
    source: data.source,
  }
  startTransition(async () => {
    const result = await updateCandidateAction(candidateId, payload)
    ...
  })
}
```

Note the action's zod schema currently requires `full_name`/`market_status`/`source`,
so those three must stay in the payload; every other key becomes optional-by-omission,
which the action already handles. Belt-and-braces alternative (or addition): pass
`candidate.updated_at` from the page and add `.eq('updated_at', expected)` in
`updateCandidate`, returning a "this record changed while you were editing" error on
0 rows.

---

### CR-02: `window.open` after an `await` — blocked popup yields no error, no link, nothing

**File:** `src/app/(app)/candidates/[id]/cv-file-link.tsx:49-58`

**Issue:** `window.open(result.url, '_blank', 'noopener,noreferrer')` is called inside
an async transition, after the server-action round trip. The user gesture's transient
activation is gone by then in WebKit (Safari desktop/iOS blocks `window.open` that is
not synchronous within the handler) and in any browser with a strict popup blocker.
`window.open` then returns `null` and **the return value is never checked** — the
button flips from "Opening…" back to "View" and absolutely nothing happens.

**Failure scenario:** the founder or the anchor customer opens Altus in Safari, clicks
**View** on the CV, sees the button flicker, and concludes the feature is broken. The
signed URL was minted and an `export` audit row was written, so the audit log now
records a document access that never happened. Playwright's default Chromium smoke
will not catch this.

**Fix:** open the tab synchronously in the gesture, then point it at the URL; and
always handle the `null` case.

```tsx
const onClick = () => {
  const win = window.open('', '_blank', 'noopener,noreferrer')
  startTransition(async () => {
    const result = await getCvFileUrlAction({ candidateCvId })
    if (!result.ok) {
      win?.close()
      toast.error(result.error)
      return
    }
    if (win) {
      win.location.href = result.url
      return
    }
    // Popup blocked — never fail silently.
    toast.error('Your browser blocked the new tab. Allow pop-ups for this site and try again.')
  })
}
```

---

### CR-03: Cron heartbeats sit outside `step.run` — fire once per Inngest replay, ~800 Sentry events/day

**Files:**
`src/lib/inngest/functions/embed-batch.ts:113-122`,
`src/lib/inngest/functions/reconcile-cv-parses.ts:155-162`,
`tests/unit/lib/inngest/cron-hardening.test.ts:84-101` (pins the wrong placement)

**Issue:** Inngest re-invokes the function handler once per step boundary, replaying
all non-step code with memoized step results (confirmed in the installed SDK:
`node_modules/inngest/components/InngestStepTools.d.ts` memoization path; inngest
`^4.4.0`). Code outside a `step.run` therefore runs **steps + 1** times per run, not
once.

- `embed-batch`: 2 steps → 3 heartbeats × 144 ticks/day (every 10 min) = **432/day**
- `reconcile-cv-parses`: 3 steps → 4 heartbeats × 96 ticks/day (every 15 min) = **384/day**
- Total ≈ **816/day ≈ 24,500/month**, before retries.

`Sentry.captureMessage` consumes the **errors** quota. Sentry's free tier is 5,000
errors/month; the Team tier is 50,000. Either way the heartbeat becomes the dominant
consumer, and once quota is exhausted Sentry **drops real production errors** — on a
live multi-tenant system where Sentry is the only alerting channel. A change sold as
"make stalls visible same-day" would blind the error pipeline within ~6 days on the
free tier.

Secondary correctness problem: the alert recipe in `docs/cron-monitoring.md:56-100`
tells the founder to alert on event *counts*; a heartbeat that multiplies with the
step count silently changes meaning whenever a step is added or removed.

**Fix:** wrap the heartbeat in its own step so it is memoized and fires exactly once
per run. This keeps it before all real work and keeps the regression test's intent
("visible even when there is nothing to do") intact.

```ts
async ({ step }) => {
  await step.run('heartbeat', async () => {
    Sentry.captureMessage('reconcile-cv-parses:cron:heartbeat', {
      level: 'info',
      tags: { layer: 'inngest', function: 'reconcile-cv-parses' },
    })
    return { ok: true }
  })
  ...
```

`tests/unit/lib/inngest/cron-hardening.test.ts:92-100` asserts
`heartbeatIdx < firstStepRunIdx` and must be updated in the same commit — change it
to assert the heartbeat is inside the **first** `step.run` (e.g. that the first
`step.run(` id is `'heartbeat'`), otherwise the test actively prevents the fix.

---

## Warnings

### WR-01: Backfill's already-scored pre-filter sends up to 500 UUIDs in one URL — fails open into duplicate AI spend

**File:** `src/lib/inngest/functions/backfill-application-match-scores.ts:95-129`

**Issue:** `candidateIds` is chunked at 100, but `jobIds` is passed whole
(`.in('job_id', jobIds)`, line 111). With the 500-row cap, `jobIds` can hold 500
UUIDs ≈ 18,500 characters of query string — far past postgrest-js's own
`urlLengthLimit` default of 8,000 and past typical edge/proxy URL limits. The comment
at lines 58-61 claims the chunking exists so "a large candidate-id list can never
risk a 414" — only one of the two lists is actually protected.

**Failure scenario:** a 414/aborted request → `Sentry.captureException` → `continue`
(line 120, deliberately fail-open) → `alreadyScoredPairs` comes back empty → every
application in the sweep is treated as unscored and enqueued. The downstream
version-exact cache in `score-application-match` absorbs most of it, but any pair
whose embedding version has moved since it was scored gets a fresh Sonnet call.
Across all orgs, on a founder-triggered "safe to run more than once" button.

**Fix:** chunk both sides, or pre-filter per chunk.

```ts
for (let i = 0; i < candidateIds.length; i += ID_CHUNK) {
  for (let j = 0; j < jobIds.length; j += ID_CHUNK) {
    const { data, error } = await supabase
      .from('ai_summaries')
      .select('candidate_id, job_id')
      .eq('kind', 'match_score')
      .in('candidate_id', candidateIds.slice(i, i + ID_CHUNK))
      .in('job_id', jobIds.slice(j, j + ID_CHUNK))
    ...
```

### WR-02: Backfill can never advance past the oldest 500 applications

**File:** `src/lib/inngest/functions/backfill-application-match-scores.ts:164-205`

**Issue:** the SQL selects the oldest 500 job-bearing applications *regardless of
whether they are already scored*, then filters in JS. Once those 500 all have scores,
every subsequent run enqueues zero — while newer unscored applications sit beyond the
cap forever. Re-running is a guaranteed no-op, and the `row cap reached` Sentry
warning (line 196) reads as "there is more to do" when the sweep is in fact
permanently stuck.

**Failure scenario:** SC has 10 applications so this never bites today, but the button
is labelled "all orgs" and any org that grows past 500 applications silently stops
being backfillable. A second customer onboards with an import; their pre-import
applications are never scored, and nobody can tell from the UI or from Sentry.

**Fix:** either filter unscored rows in SQL (`not.in` on a scored-pairs subquery /
RPC), or paginate with a `created_at` cursor carried on the event payload and
re-send the event when `truncated` is true.

### WR-03: "Score all" is re-clickable while polling and carries no Inngest dedup id — duplicate Sonnet spend

**Files:** `src/app/(app)/jobs/[id]/matches/score-all-button.tsx:81,92`,
`src/app/(app)/jobs/[id]/matches/actions.ts:290-297`

**Issue:** the button is `disabled={isPending}` only — `isPending` clears the instant
`inngest.send` resolves, while `isPolling` (which shows a spinner, implying "busy")
leaves the button live. `scoreAllMatchesAction` sends `job/score-top-candidates` with
**no `id`**, unlike `enqueueApplicationMatchScore` which deliberately uses an
hour-bucketed dedup id (`enqueue-match-score.ts:58`). `precompute-matches-for-job`
allows concurrency 2 per org.

**Failure scenario:** impatient double/triple click during the 90-second poll → 2–3
concurrent precompute runs → the same uncached candidates get 2–3 Sonnet calls each
(the cache guard only helps once a prior run has *finished writing*, the exact
scenario review 2026-08-04 M1 already paid for on the other event). Bounded by the
£100/org/month ceiling, but it is real, avoidable spend on a customer's bill.

**Fix:** `disabled={isPending || isPolling}` and add a dedup id mirroring the existing
prior art:

```ts
await inngest.send({
  id: `score-top:${parsed.data.jobId}:${Math.floor(Date.now() / 3_600_000)}`,
  name: 'job/score-top-candidates',
  data: { organization_id: organizationId, job_id: parsed.data.jobId, user_id: userId },
})
```

### WR-04: "Score all" cannot distinguish "still running" from "will never be scored"

**Files:** `src/app/(app)/jobs/[id]/matches/score-all-button.tsx:48-83`,
`src/app/(app)/jobs/[id]/matches/page.tsx:104-122`

**Issue:** `precompute-matches-for-job` silently returns without writing a summary
for: an effectively-empty candidate profile (`precompute-matches-for-job.ts:230-240`),
month-to-date spend ceiling reached (lines 143-156), and `CapExceededError` on the org
AI budget (lines 280-295). The button polls for 90s, then shows "Scoring may still be
running — reload to see the rest", and `showScoreAll` stays true forever because
`allCardsFresh` can never become true.

**Failure scenario:** the org is at its AI cap (a documented live watch-list item —
"£-cap silent-freeze"). Recruiter clicks Score all, waits 90s, sees the same "Not
scored yet" cards and an ambiguous message, clicks again, repeat. There is no path
from this UI to "you have hit your AI budget". Same dead end for a job whose top-10
includes one profile-empty candidate — permanent, on every visit.

**Fix:** have the action (or a small read) surface the org's cap/ceiling state and
render a specific message, and mark candidates that precompute will refuse to score
("Profile too sparse to score") rather than leaving them as "Not scored yet" forever.

### WR-05: TagInput duplicate values → React key collision + "remove one, both vanish"

**File:** `src/components/app/tag-input.tsx:83-85,91-103`

**Issue:** chips are keyed `key={tag}` and removed with
`value.filter((v) => v !== tag)`. `mergeTags` prevents *new* duplicates, but the
initial `value` comes straight from `candidates.skills`, and nothing dedupes on write:
`coerceStringArray` (`parsed-cv-schema.ts:171-174`) only drops non-strings and blanks,
and `candidates-linkedin.ts:172` writes the scraped array verbatim. Claude returning
`["React","React"]` is entirely ordinary.

**Failure scenario:** duplicate stored skill → React duplicate-key warning and
potential mis-association during reconciliation; clicking one chip's X removes both
copies. Then CR-01's full-array write persists that.

**Fix:** dedupe on ingest into the component and key by index+value:

```tsx
const chips = React.useMemo(
  () => value.filter((v, i) => value.findIndex((o) => o.toLowerCase() === v.toLowerCase()) === i),
  [value],
)
// ...
{chips.map((tag, i) => <Badge key={`${i}-${tag}`} ...>)}
// remove by index:
const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i))
```

### WR-06: `required` on repeating-row inputs contradicts the schema's documented "blank rows are dropped"

**Files:** `src/components/app/repeating-rows.tsx:78-84`,
`src/app/(app)/candidates/[id]/edit/schema.ts:150-160`

**Issue:** `workExperienceArraySchema`/`educationArraySchema` deliberately *drop* rows
with a blank title/school ("there is nothing to save, not an error to surface"), but
the Title/School inputs render with the native `required` attribute. The browser's
constraint validation blocks `submit` before RHF or zod ever runs.

**Failure scenario:** recruiter clicks "Add work history", changes their mind, clicks
Save. The browser refuses to submit and shows a native "Please fill out this field"
bubble on a control the recruiter considers empty-on-purpose. The intended drop
behaviour is unreachable whenever the section is open.

**Fix:** drop `required={f.required}` from the `<Input>` (keep the flag for a visual
asterisk only) and let the schema's documented filtering do the work.

### WR-07: `years_experience` accepts values that overflow `numeric(4,1)` — save fails with a generic error

**Files:** `src/app/(app)/candidates/[id]/edit/schema.ts:71-83`,
`src/app/(app)/candidates/[id]/edit/actions.ts:45-48`

**Issue:** the refine allows `n < 1000`, but the column is `numeric(4, 1)`. Postgres
rounds to scale 1 *before* checking precision, so `999.95`–`999.99` round to `1000.0`
and raise `22003 numeric field overflow`. The user-visible result is
`'Something went wrong. Please try again.'` (`edit/actions.ts:142-144`) with no
indication which field is at fault, forever.

**Fix:** validate the rounded value.

```ts
.refine((v) => {
  if (v === '') return true
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && Math.round(n * 10) / 10 < YEARS_EXPERIENCE_EXCLUSIVE_MAX
}, 'Enter a number of years between 0 and 999.9')
```

### WR-08: Server-side validation errors are keyed under `patch` and silently discarded by the form

**Files:** `src/app/(app)/candidates/[id]/edit/actions.ts:55-60`,
`src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx:99-105`

**Issue:** `updateCandidateActionSchema` wraps the payload as `{ id, patch }`;
`error.flatten().fieldErrors` only keys on `path[0]`, so every field error arrives as
`fieldErrors.patch = [...]`. The client then calls
`form.setError('patch' as keyof EditCandidateInput, ...)` — a field that does not
exist, so no `FormMessage` renders and no toast fires. The save appears to do nothing.

Pre-existing shape, but this phase multiplies the number of server-side-rejectable
fields from 8 to 18 and adds paths (direct action invocation, a future non-RHF caller)
where client validation does not run first.

**Fix:** flatten the nested path in the action and add a formError fallback:

```ts
const fieldErrors: Record<string, string[]> = {}
for (const issue of parsed.error.issues) {
  const key = issue.path[0] === 'patch' ? String(issue.path[1] ?? 'patch') : String(issue.path[0])
  ;(fieldErrors[key] ??= []).push(issue.message)
}
return { ok: false, fieldErrors }
```
and in the form, `toast.error('Some fields need attention.')` when no error mapped to
a real field.

### WR-09: The embedding-drift contract test binds to one hardcoded migration file

**File:** `tests/unit/lib/ai/embedding-invalidation-contract.test.ts:73-105`

**Issue:** the parser reads only
`supabase/migrations/20260519092951_invalidate_embeddings_triggers.sql`. Migrations
are append-only in this project, so the correct way to change the trigger is a *new*
`create or replace function public.invalidate_candidate_embedding()` in a later file.
The test would keep parsing the 2026-05-19 definition and keep passing while
production diverges — the precise failure the test exists to prevent.

Today only one file defines the function (verified), so the test is currently truthful.

**Fix:** glob `supabase/migrations/*.sql`, take the **last** file (by filename sort)
containing the `create or replace function public.invalidate_candidate_embedding()`
marker, and fail loudly if zero files match.

### WR-10: `timeouts` is the entire cron fix and its platform support is unverified

**Files:** `src/lib/inngest/functions/embed-batch.ts:111`,
`src/lib/inngest/functions/reconcile-cv-parses.ts:153`, `docs/cron-monitoring.md:141-159`

**Issue:** the SDK accepts `timeouts: { start, finish }` (typed in
`node_modules/inngest/types.d.ts:1461`), so it compiles and syncs regardless — but the
config is only *enforced* by the Inngest platform, and the runbook this phase ships
states the account is on the **free tier** and that the free tier's behaviour was the
root cause of the outage. If `timeouts` is a paid-plan feature (or is ignored on the
current plan), the headline fix is inert and the runbook tells the founder to expect
`inngest/function.cancelled` events that will never appear.

**Fix:** before UAT, confirm in the Inngest dashboard that both functions show the
timeouts on their config page, and add a one-line note to
`docs/cron-monitoring.md` §6 recording the plan requirement. If it is paid-only, say
so explicitly in the runbook rather than describing cancellation as a working safety
net.

### WR-11: `RepeatingRows` drops the accessibility props `FormControl` hands it

**Files:** `src/components/app/repeating-rows.tsx:22-31`,
`src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx:444-487`

**Issue:** shadcn's `FormControl` passes `id`, `aria-describedby` and `aria-invalid`
into its child via `Slot`. `TagInput` accepts and forwards all three
(`tag-input.tsx:14-21,106-113`) — good — but `RepeatingRows` declares none of them, so
they are dropped. The `FormLabel`'s `htmlFor` points at an id that exists nowhere, and
`FormMessage` is never announced for `work_experience`/`education` errors.

**Failure scenario:** a keyboard/screen-reader user tabs into the work-history editor
with no group label association and no error announcement; clicking the "Work history"
label moves focus nowhere.

**Fix:** accept `id` / `aria-describedby` / `aria-invalid` and apply them to the
wrapping element (`role="group"` container), matching `TagInput`'s shape.

### WR-12: Legacy jsonb rows are silently truncated on round-trip

**File:** `src/app/(app)/candidates/[id]/edit/page.tsx:22-54`

**Issue:** `parseWorkExperienceRows`/`parseEducationRows` drop any row whose
`title`/`school` is not a non-empty string, and rebuild every surviving row with
exactly three keys. Combined with the full-array write in `edit/actions.ts:122-133`,
opening + saving the edit page **permanently deletes** any stored row that fails those
checks and strips any extra keys a past or future writer stored.

Today every writer (`mapWorkHistory`, `mapEducation`, LinkedIn ingest) produces
`{title, company, dates}` with a non-empty title, so this is latent rather than active
— but it is a data-destroying default, not a display default.

**Fix:** keep unparseable rows in a hidden passthrough (e.g. carry the raw array in a
non-rendered form field and re-emit rows the editor could not display), or refuse to
write the array at all when the parsed row count differs from the stored row count,
surfacing "this candidate has work history in an old format — edit not available".

### WR-13: `.claude/worktrees/**` is linted, so `pnpm lint` fails locally with a hard error

**File:** `eslint.config.mjs:11-25`

**Issue:** `eslint.config.mjs` ignores `.next`, `dist`, `supabase`, and
`src/types/database.ts` — but not `.claude/**`. With an agent worktree present (1.2 GB
of full repo duplicates, gitignored), `pnpm lint` reports
`error Do not use "@ts-nocheck"` from
`.claude/worktrees/<id>/src/types/database.ts` and exits non-zero. The verification
gate CLAUDE.md mandates ("`pnpm lint` passes") is therefore not reproducible in this
working tree; it only passes when no worktree exists.

**Fix:** add `'.claude/**'` to `globalIgnores`.

---

## Info

### IN-01: `edit/schema.ts` fails `prettier --check`
`src/app/(app)/candidates/[id]/edit/schema.ts:121` — the `.pipe(...)` line exceeds the
100-char printWidth. `pnpm format:check` fails on it; `pnpm lint` does not enforce
formatting so it slipped through. Run `prettier --write` on that file only.

### IN-02: Stale comment claims 07-04 has not shipped
`src/app/(app)/candidates/[id]/edit/actions.ts:31-33` — "The ten Plan 07-03 fields are
not wired into that form yet (07-04 does that); until it ships, this same action is
still reachable from the UNCHANGED 8-field form". 07-04 shipped in this same branch
(`c67b4bf`). The `toNullableString`/`toNullableNumber` behaviour remains correct and
worth keeping, but the justification is now misleading — and it is exactly the
reasoning a future maintainer would use to decide the guard is safe to delete. Reword
to point at CR-01's dirty-field submission instead.

### IN-03: Dead fallback in the CV files panel
`src/app/(app)/candidates/[id]/cv-files-panel.tsx:76` —
`STATUS_LABEL[cv.parsing_status] ?? 'Pending'`: the `Record<union, string>` lookup is
typed non-optional, so the `??` branch is unreachable under `noUncheckedIndexedAccess`.
Harmless defence against a future enum value; note it or drop it.

### IN-04: Shared mutable `EMPTY_SUMMARY`
`src/lib/cv/confidence-summary.ts:44` — `EMPTY_SUMMARY` is a module-level object whose
`unsureFields: []` array is returned by reference to every caller. A caller that ever
pushed into `summary.unsureFields` would corrupt every subsequent call. Freeze it
(`Object.freeze`) or return a fresh literal.

### IN-05: Audit failure does not block a CV download — by design, stated here for the record
`src/app/(app)/candidates/[id]/actions.ts:361-364` + `src/lib/db/audit.ts:106-129`.
The code **awaits** `recordExportAudit` before returning the URL, but
`recordExportAudit` swallows every failure into Sentry and resolves `void`. So the
signed URL is returned even when no audit row was written. Judged against the project's
"every access to candidate data is logged" principle this is an availability-over-
completeness trade, consistent with `recordViewAudit` and `getCandidate`'s inline
audit. It is defensible; it is also the one place where a GDPR "who accessed this CV"
answer can be incomplete with no trace outside Sentry. If audit completeness must be
absolute for document exports specifically, `recordExportAudit` needs to return a
success flag and the action must fail closed. Recommend deciding explicitly and
documenting the decision, not leaving it implied.

### IN-06: No confirmation on the all-orgs admin backfill
`src/app/admin/BackfillMatchScoresForm.tsx:47-58` — one click queues Sonnet spend
across every organisation. Bounded (500 rows × ~1p ≈ £5/run, org ceilings enforced
downstream), and super-admin gated, but every other spend/destructive admin control in
this file uses a typed confirmation. Consider matching.

### IN-07: `cvDisplayFilename` prefix-strip heuristics
`src/lib/cv/cv-file-display.ts:32,45-50` — `^[0-9a-f-]{36}-` also strips any legitimate
36-character `[0-9a-f-]` filename prefix, and does not match uppercase UUIDs.
`crypto.randomUUID()` is lowercase so the live path is fine; display-only impact.

### IN-08: Hex/exponent numeric strings accepted by the salary/years refines
`src/app/(app)/candidates/[id]/edit/schema.ts:73-100` — `Number('0x10')` is `16` and
`Number('1e3')` is `1000`, both of which pass `Number.isFinite`. `type="number"` inputs
prevent this from the UI; a direct action call would write a surprising-but-legal
value. Tighten with a `/^\d+(\.\d)?$/`-style regex if you want the schema to be the
authority.

---

## CLEAN — verified, no defect found

These were actively hunted, not assumed:

1. **No cross-tenant CV leak.** `getCvFileUrlAction`
   (`candidates/[id]/actions.ts:294-374`) reads via `getCandidateCV` on the RLS-scoped
   SSR client; `candidate_cvs` carries `tenant select using (organization_id =
   current_organization_id())` (migration `20260513152244:478`), so a foreign
   `candidateCvId` returns `not_found` → generic `'CV not found.'`. `createSignedUrl`
   then hits the independent bucket policy `Tenant select own org CVs`
   (`20260517204501:17-22`) keyed on `foldername(name)[1] = current_organization_id()`.
   Two gates, both load-bearing, neither bypassable from the client.
2. **Signed-URL TTL sane.** 60s, matching `apply/[orgSlug]/actions.ts:155`; opened with
   `noopener,noreferrer`; URL never logged.
3. **Upload-incomplete rows excluded server-side.** `isCvFileDownloadable` is mirrored
   in the action (not just the UI), so a hand-crafted action call cannot sign a URL for
   a row with no stored object.
4. **Audit metadata is PII-free.** `{ candidate_cv_id, version }` only — no filename, no
   `storage_path` (which embeds a slugified candidate name), no name. The `createSignedUrl`
   failure capture wraps `signError?.name` plus fixed tags, never the path.
5. **`export` needs no migration and bypasses the view dedupe.** `'export'` is in the
   `audit_action` enum (`20260513152244:77`) and migration `20260804140000` explicitly
   scopes deduplication to `p_action = 'view'`. Every download is its own row.
6. **Omitted-vs-cleared holds end-to-end.** Traced: `toNullableString`/`toNullableNumber`
   → `sanitiseForPostgres` (rebuilds plain objects, preserves `undefined`-valued keys)
   → `updateCandidate` spread → postgrest-js `update()` sets `body: values` and
   `JSON.stringify` drops `undefined` keys (verified in
   `@supabase/postgrest-js@2.105.4/src/PostgrestQueryBuilder.ts:1536-1551`). A legacy
   8-field caller cannot null the ten new columns.
7. **Phase-6 sanitisation applied to every new writable field.**
   `sanitiseForPostgres(patch)` at `edit/actions.ts:140` recurses arrays, plain objects
   and object *keys*, so NUL / lone surrogates in `about`, `headline`, tag entries and
   the two jsonb arrays are neutralised before the write.
8. **No schema-column mismatch.** All ten new columns exist in
   `20260513152244_phase1_domain_schema.sql` and in the generated
   `src/types/database.ts` `candidates` Row/Update.
9. **jsonb row shape matches every other writer.** `{title,company,dates}` /
   `{school,degree,dates}` agree with `mapWorkHistory`/`mapEducation`
   (`candidate-cvs.ts:354-395`), `candidates-linkedin.ts:101`, and the display page's
   `parseWorkExperience`/`parseEducation`. No shape drift introduced.
10. **Embedding invalidation is genuinely covered.** All four search-relevant editable
    fields (`skills`, `sector_tags`, `seniority_level`, `years_experience`) appear in
    `invalidate_candidate_embedding`'s comparison list (`20260519092951:43-52`); the
    edit path is a plain `UPDATE`, which fires the BEFORE UPDATE trigger; the six
    non-search fields are correctly excluded from both lists.
11. **The drift contract test genuinely binds SQL to TS.** It reads the real migration
    from disk, extracts columns with a backreferenced regex, and binds to
    `Parameters<typeof candidateEmbeddingText>[0]` via a
    `Record<keyof …, true>` literal — a true compile-time exhaustiveness check in both
    directions, plus a value-level pin. (Scope caveat: WR-09.)
12. **D-08 intact.** `markCandidateFieldsFromCV` is unchanged; manual edits still
    survive a later parse-accept because that path only fills EMPTY fields.
13. **Caps/ceilings reused, not re-implemented.** `scoreAllMatchesAction` →
    `job/score-top-candidates` → `precomputeMatchesForJob` (job-org re-check, spend
    ceiling, `CapExceededError` bail, per-candidate cross-tenant re-check,
    `isProfileEffectivelyEmpty` skip, version-exact cache). Backfill →
    `enqueueApplicationMatchScore` → `application/score-match` → `scoreApplicationMatch`
    (same guard set, verified at `score-application-match.ts:121,150,190,204,223,267`).
    Neither new caller duplicates a ceiling.
14. **Super-admin gating correct.** `backfillMatchScoresAction` calls
    `requireSuperAdmin()` as its first statement; the guard `redirect()`s on both the
    unauthenticated and non-super-admin branches (`lib/admin/guard.ts:36-61`), and
    `redirect` throws — so no code path continues past it.
15. **Event name + payload consistent across all four producers** of
    `job/score-top-candidates` (`jobs/new/actions.ts:92`,
    `clients/[id]/jobs/new/actions.ts:102`, `embed-job-on-jd-change`, and the new
    action) — same `{organization_id, job_id, user_id}` shape the consumer's
    `asJobScoreData` expects.
16. **Fan-out is bounded.** Backfill 500-row cap + concurrency 1 + `retries: 1`;
    precompute `TOP_N_PER_JOB = 10` matching the page's `MATCH_LIMIT = 10`; per-org
    concurrency 2.
17. **No customer-org writes at build time.** The admin control is a client component;
    the sweep runs only on an explicit event; the matches page is dynamic (cookie-bound
    Supabase client), so nothing is prerendered against live data.
18. **Frozen Phase-6 files byte-identical** at base, head and working tree (git
    hash-object comparison): `tests/integration/cv-write-path.test.ts`,
    `tests/integration/candidate-write-siblings.test.ts`,
    `tests/unit/lib/ai/parsed-cv-schema.test.ts`, `src/lib/ai/profile-completeness.ts`,
    `src/lib/ai/embed-text.ts`, `src/lib/cv/parse-messages.ts`,
    `src/lib/text/postgres-safe-text.ts`. `tests/fixtures/**` untouched.
19. **No migrations added, no dependency changes.** `git diff` on `supabase/` and
    `package.json` is empty.
20. **No `role="alert"` in any new component** — the string appears only inside a
    comment in `cv-files-panel.tsx:43-44`. `waitForParseOutcome`'s
    `main >> role=alert` failure heuristic is preserved, and the View control for a
    failed row lives outside `FailedState`'s alert as required.
21. **Confidence badge is a DOM sibling of the Review button.** `cv-review-panel.tsx`
    renders `<Sheet><SheetTrigger asChild><Button/></SheetTrigger></Sheet>` and the
    `<Badge>` as adjacent children of a flex row; Sheet emits no wrapper node, so
    `getByRole('button', { name: 'Review extracted data' })` is unaffected.
22. **Sidebar snapshot stays deterministic.** The new panel renders `formatDateLong`
    (absolute), never `formatTimeAgo`, so `cvSidebarSnapshot`'s before/after comparison
    in the frozen smoke spec cannot flake on a ticking relative timestamp.
23. **No raw control bytes** in any changed source file (scanned
    `[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]` across all 34).
24. **server-only boundaries respected.** `cv-file-display.ts` and
    `confidence-summary.ts` are pure and deliberately free of `import 'server-only'`
    (both are imported by the `'use client'` review panel); `lib/db/audit.ts` keeps
    `import 'server-only'` and is reached only from the server action; the client
    components import only the server action, `sonner`, and UI primitives.
25. **`summariseConfidence` is total.** Non-object `extracted_data`, missing or
    non-object `confidence_per_field`, and unknown keys all yield the zero result;
    labels come from the shared `CV_FIELD_LABELS` so the summary can never name a field
    the sheet does not render, and only human labels (never raw values) reach the DOM.
26. **Explain button refresh is correct.** `revalidatePath` in the action plus
    `router.refresh()` on the client; toast no longer lies about needing a manual
    refresh; no state retained after the transition.
27. **Score-all poll is bounded and leak-free.** 3s interval, 90s hard cap checked
    before each `router.refresh()`, `clearInterval` in the effect cleanup, and the
    component unmounts naturally once `showScoreAll` flips false. (Behaviour gaps are
    WR-03/WR-04, not leaks.)
28. **Gates re-run for this review:** `tsc --noEmit` clean; `vitest run` 890 passed /
    28 todo / 0 failed; `eslint` 0 errors in tracked sources (the single error is the
    gitignored worktree, WR-13).

---

_Reviewed: 2026-08-11_
_Reviewer: Claude (gsd-code-reviewer), adversarial pass_
_Depth: deep_

---

# Re-review — 2026-08-11 (post-fix)

**Range:** `526cb40..bf854cf` (17 fix commits + the separately-authored
`tests/smoke/authed/cv-lifecycle.smoke.ts`)
**Fix report:** `07-FIXES.md` (claims 24/24 closed, 0 residual)
**Verdict:** **SHIP** — 0 blockers. 6 warnings + 2 info raised as follow-ups,
none of which block this phase.

## Summary

All 24 original findings are genuinely closed — verified against the code, not
against the fix report. Every gate is green on the merged tree: `tsc --noEmit`
clean, 952 unit tests pass (0 failed), `eslint` 0 errors, `prettier --check`
clean on all 33 touched files, all 8 frozen Phase-6 files byte-identical to
`5144ec7`, no migrations, no dependency changes, no `role="alert"` in any
changed component, no raw control bytes.

**The fixer's three deviations from my suggested patches were all correct, and
in all three cases my patch was the buggy one.** Details below — I verified each
against the HTML spec, the base commit, and by executing the regression suite
against the pre-fix source.

## Deviation audit — the fixer's claims against my patches

### D-1 — CR-01: my dirty-fields patch would have nulled five columns. **CLAIM UPHELD.**

At `5144ec7`, `edit/actions.ts` built five of the eight basics as
`email: parsed.data.patch.email || null` (etc. for `phone`, `location`,
`current_role_title`, `current_company`). My patch omitted non-dirty keys from
the payload, so those five would arrive `undefined`, and `undefined || null`
evaluates to `null` — a write. My fix for a wipe of the ten parsed columns would
have introduced a wipe of five basic ones. The fixer converting all five to
`toNullableString` in the same commit (`29a2782`) is not optional; it is what
makes dirty-field submission safe at all.

**Independently verified, not taken on trust:** I restored the pre-fix form
(`git show 526cb40:…/candidate-edit-form.tsx`) over the current one and ran the
new regression suite:

```
Tests  6 failed | 4 passed (10)
```

Six of ten cases fail against the pre-fix payload (the fix report claims four of
five — it undercounts its own coverage). The failures are the right ones:
untouched parsed keys present in the payload, the pre-parse stale-snapshot case,
the WR-08 unmapped-error toast, and the WR-12 read-only guarantee. The test
asserts payload *shape* via `Object.hasOwn`, which is the actual contract
(`undefined` vs absent matters only after JSON serialisation). Working tree
restored; `git status` clean.

### D-2 — CR-02: `noopener` makes `window.open` return `null`. **CLAIM UPHELD, and the replacement is safe here.**

Per the HTML standard's window-open steps, a feature string containing
`noopener` (or `noreferrer`, which implies it) causes `window.open` to **return
null**. My snippet opened the placeholder with `'noopener,noreferrer'` and then
branched on `if (win)` — so it would have taken the popup-blocked path 100% of
the time, on every browser. My patch was inert.

I verified the fixer's replacement is safe rather than merely different:

- **Opener severing works and survives navigation.** `window.open('', '_blank')`
  yields a same-origin `about:blank` handle, so `win.opener = null` is reachable
  (no cross-origin `SecurityError`), and the `opener` setter clears the *browsing
  context's* opener — it is not a property shadow, so the subsequently-navigated
  Supabase Storage document sees `window.opener === null`. This is the standard
  pre-`noopener` mitigation. No reverse-tabnabbing residual.
- **No COOP concern today.** `next.config.ts` sets only
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `X-DNS-Prefetch-Control` — **no `Cross-Origin-Opener-Policy`**. This matters:
  under `COOP: same-origin` the returned proxy is severed and `opener` is
  get-only cross-origin, so `win.opener = null` would throw synchronously inside
  the click handler and kill the feature. See IN-R2 for the one-line insurance.
- **Dropping `noreferrer` leaks nothing.** `Referrer-Policy:
  strict-origin-when-cross-origin` is set app-wide, so the cross-origin
  navigation to Storage sends only `https://altusrecruit.com` — never the
  `/candidates/{uuid}` path.
- **The fallback uses `noopener` correctly** — `window.open(url, '_blank',
  'noopener,noreferrer')` inside the toast action, where no handle is needed and
  the null return is irrelevant.

The accompanying `cv-file-link.test.tsx` pins call ordering (open *before* the
action), the navigation, the opener severing, the failed-sign close, the
blocked-popup toast action — and, pointedly, asserts the placeholder open is
**not** passed `noopener`, encoding exactly why my patch was wrong.

### D-3 — WR-05: my dedupe-for-display patch removes the wrong chip. **CLAIM UPHELD.**

My `removeAt(i)` used the **chip** index against the **raw value** array. With
`value = ['React','React','Node']`, chips render as `['React','Node']`; clicking
X on `Node` (chip index 1) would have spliced value index 1 — the second
`'React'` — leaving `Node` on screen. The fixer's `removeChip` filters every
stored entry whose trimmed-lowercased form matches the chip, which is the
correct contract ("a chip is the only control for its value"), keeps keys unique
via `${index}-${lower}`, and makes Backspace remove the last *chip* rather than
the last array entry.

## Fix verification — does each one close my failure scenario?

| ID | Closes the scenario? | Evidence |
|----|---|---|
| CR-01 | **Yes** | Dirty-field payload + `toNullableString` on all five basics + WR-12's structural read-only. Regression suite fails 6/10 against pre-fix source (executed). `dirtyFields` is destructured **during render**, which is the RHF Proxy subscription — RHF mutates `_formState.dirtyFields` in place, so the handler closure reads live state. Deliberate clears stay dirty and still persist as clears (pinned by test). |
| CR-02 | **Yes** (residual WR-R1) | Tab opened synchronously in the gesture; all three branches deliver the URL; audit-ordering comment now states what the `export` row means and why that is honest. |
| CR-03 | **Yes** (residual WR-R2) | Heartbeat is `step.run('heartbeat')` and is the first step in both functions → memoized → exactly one event per run. Volume math recomputed correctly (144 + 96 = 240/day ≈ 7,300/month) and the runbook states honestly that this **still exceeds** a 5,000/month free-tier errors quota, with the two legitimate remedies. `cron-hardening.test.ts` was updated in the same commit and now asserts the first `step.run` id is `'heartbeat'` and that `captureMessage` appears *after* `step.run(` — it would fail if a bare top-of-handler heartbeat returned. |
| WR-01 | **Yes** | Chunking is by **rows** (50), bounding *both* `.in()` lists to ~100 uuids ≈ 4.5 kB, under postgrest-js's 8,000-char `urlLengthLimit`. A chunk error now marks every pair in that chunk `unknown` and **skips** it (fail closed) instead of `continue`-ing into "nothing is scored, enqueue everything". Cross-product hits from other chunks are still recorded — correctly, since each returned row is a real `(candidate, job)` summary. |
| WR-02 | **Yes** | The cap moved from the **scan** to **enqueues**; a bounded 20×500 scan walks past already-scored rows, so each re-run advances. `.gte` cursor + `seenApplicationIds` handles bulk-import `created_at` ties, with an explicit warning if a page is entirely already-seen (cursor cannot advance). `truncated` is now truthful and carries `next_cursor`, which the event accepts as `created_after`. |
| WR-03 | **Yes** (residual WR-R3) | `disabled={isPending \|\| isPolling}` + hour-bucketed `score-top:{jobId}:{hour}` dedup id. Confirmed the other three producers send no id, so JD-change/creation rescores are unaffected. |
| WR-04 | **Yes** | Read-only pre-flight on both the spend ceiling and `checkCap(orgId, 'match_score')` (signature and purpose verified against `cap-enforcement.ts`; `checkCap` fails open on error so it can never block scoring). Unscorable cards say "Profile too sparse to score" and drop the Explain button; `scorableMatches` excludes them from `allCardsFresh`, so "Score all" can no longer be pinned on forever. The `?? row` fallback is safe — `HybridCandidateRow` lacks the four optional fields and `ProfileCompletenessFields` marks them optional, so it agrees with the card's explicit-null fallback. |
| WR-05 | **Yes** | See D-3. |
| WR-06 | **Yes** | Native `required` removed; the flag drives an `aria-hidden` asterisk rendered as a **sibling** of `<Label>`, so the accessible name stays exactly "Title"/"School" (which the smoke spec's `getByLabel('Title', { exact: true })` depends on). The schema's documented blank-row drop is now reachable. |
| WR-07 | **Yes** | `/^\d{1,3}(\.\d)?$/` *is* the `numeric(4,1)` grid, so 999.95 is rejected at validation instead of raising `22003` behind a generic formError. The `Math.round(n*10)/10` check is kept as belt-and-braces. |
| WR-08 | **Yes** | `toFieldErrors` flattens `['patch', 'work_experience', 0, 'title']` → `work_experience`; the form only `setError`s on keys in `form.getValues()` and toasts anything unmapped. Both branches pinned by test. |
| WR-09 | **Yes** | Globs `supabase/migrations/*.sql`, filters on the marker, takes the **last** by filename sort (Supabase's own ordering), uses `lastIndexOf` within that file, and throws loudly if none match. |
| WR-10 | **Yes (documentation)** | Runbook §7 added with the exact dashboard check, a status line to edit, and what changes if `timeouts` proves paid-only; §4's cancelled-run signal now points at it instead of implying it works. Correctly recorded as a founder action — no code can close it. |
| WR-11 | **Yes** | `id` / `aria-describedby` / `aria-invalid` accepted and applied to the `role="group"` container, matching `TagInput`. |
| WR-12 | **Yes** | Parsers moved to a pure, tested `edit/parse-rows.ts` and now report `editable`; a lossy round trip renders a read-only notice instead of an editor. The guarantee is structural, as claimed: no editor → the field can never be dirty → CR-01's submission never sends it (pinned by test). |
| WR-13 | **Yes** | `.claude/**` in `globalIgnores`; `eslint` now exits **0 errors** on this tree with worktrees present (re-run, confirmed). |
| IN-01…IN-08 | **Yes** | All verified in code. IN-03 is the one I would have deleted and the fixer kept — with a better rationale than mine (runtime guard for the window where the PG enum has a new value but `database.ts` has not been regenerated, while the exhaustive `Record` still fails the build once it is). IN-07's regex now matches the real 8-4-4-4-12 grouping, case-insensitively. |

## Smoke spec review — `tests/smoke/authed/cv-lifecycle.smoke.ts` (441 lines)

Measured against the frozen `cv-intake.smoke.ts` bar:

**Meets the bar.** Fail-closed session guard present and verbatim (storageState
exists → `SMOKE_ALLOWED_USER_ID` required → JWT `sub` must match, else refuse to
run), so it can only ever write in the founder's own org. Hydration-aware
locators throughout (`.first().or(empty-state).first().waitFor()` unions before
any one-shot `evaluateAll`). Cleanup sweep is bounded (10), filters hrefs to
`/^\/candidates\/[0-9a-f-]{36}$/i` so `/candidates/new` can't loop it, and ends
with a hard residue assertion. Its own scratch prefix (`GSD Phase07 Smoke`) is
disjoint from Phase 6's, so the two sweeps can't touch each other's rows.
Load-bearing copy is **imported** from `cv-file-display.ts`, not hand-copied.
The signed-URL test is the strongest thing in the file: it asserts the popup is
not `about:blank`, that its origin is not the app's own, and re-requests the
exact URL expecting HTTP 200 — that would catch a CR-02 regression directly.

Three defects found: WR-R4 (vacuous D-07 assertion), WR-R5 (self-documented
flaky assertion), WR-R6 (sweep deletes without a name check). None can write
outside the founder's org.

## New findings

### WR-R1 (WARNING) — A rejected server action leaves an orphan blank tab and no toast

**File:** `src/app/(app)/candidates/[id]/cv-file-link.tsx:68-101`

`startTransition(async () => { const result = await getCvFileUrlAction(...) … })`
has no `try`/`catch`. The action is written to never throw, but the *transport*
can reject: a network drop, a 500 from the server-action endpoint, a deploy
swapping the action id mid-flight. On rejection the placeholder tab — already
opened synchronously — is never closed and no toast fires. The recruiter is left
staring at a blank tab with no explanation. Pre-fix this path produced no tab and
no toast; the fix makes it produce an orphan tab and no toast, which is the same
silent-failure class CR-02 set out to eliminate.

**Fix:**
```tsx
startTransition(async () => {
  let result: GetCvFileUrlResult
  try {
    result = await getCvFileUrlAction({ candidateCvId })
  } catch {
    win?.close()
    toast.error('Couldn’t open this file. Please try again.')
    return
  }
  …
})
```

### WR-R2 (WARNING) — CR-03 trades Sentry errors quota for Inngest step quota, undisclosed

**Files:** `src/lib/inngest/functions/embed-batch.ts:134-140`,
`src/lib/inngest/functions/reconcile-cv-parses.ts:176-182`,
`docs/cron-monitoring.md` §2 / §6

Making the heartbeat its own `step.run` is the right call for correctness, but it
adds **one Inngest step per run**: `embed-batch` 2→3 steps, `reconcile-cv-parses`
3→4. That is +240 steps/day ≈ **+7,300 steps/month**, taking these two crons from
~17,300 to ~24,600 steps/month — a ~42% increase in the consumption of the exact
quota this runbook's own §6 identifies as the root cause of the 4–9 Aug
account-wide outage ("idle crons alone consume roughly half of the Inngest free
tier's monthly step quota"). §2 discloses the Sentry-side cost in full and says
nothing about the Inngest-side cost, so the trade reads as free when it is not.

**Fix (zero added steps, identical semantics):** emit the heartbeat as the first
statement *inside* the existing first step (`sweep-candidates` /
`sweep-stuck-pending`) rather than in a step of its own. It still fires before
any real work and still exactly once per successful run; the only difference is
that a retry of that step re-fires it (bounded by `retries: 1`). If the separate
step is kept for the cleaner retry semantics, add its step cost to §6 so the
founder's quota decision is made on complete information.

### WR-R3 (WARNING) — The hour-bucketed dedup id silently swallows a legitimate retry for up to 59 minutes

**File:** `src/app/(app)/jobs/[id]/matches/actions.ts:340-347`

Inngest drops a duplicate event `id` for 24h, so within one wall-clock hour the
second `Score all` on a job is discarded — while the action still returns
`{ ok: true }` and the button still toasts "Scoring started". The button is
disabled for the 90-second poll, so the swallowed window is roughly minutes
1.5–60 of each hour.

**Failure scenario:** a card reads "Profile too sparse to score" (new WR-04
copy). The recruiter does exactly what that message asks — adds skills to the
candidate — comes back, clicks Score all, is told scoring started, and nothing
happens for up to an hour. This is the pattern CLAUDE.md forbids: claiming
success for work that is not happening. The borrowed precedent
(`enqueue-match-score.ts`) is a *system*-fired event where a blind spot only
delays; this one is user-initiated with a success toast.

**Fix:** shrink the bucket to just wider than the poll window — the anti-double-
click intent is fully preserved and the blind spot drops from 60 minutes to two:
```ts
const SCORE_ALL_DEDUP_BUCKET_MS = 2 * 60 * 1000
```

### WR-R4 (WARNING) — The smoke spec's D-07 assertion is vacuous

**File:** `tests/smoke/authed/cv-lifecycle.smoke.ts:408-412`

```ts
expect(mainText, 'stale "refresh to see" copy must not appear …').not.toContain('refresh to see')
```

At the base commit that string existed in exactly one place:
`explain-button.tsx:36`'s `toast.success('Match explained — refresh to see
details')` — copy that only ever appeared **after clicking Explain**
(`git grep -n "refresh to see" 5144ec7 -- src`, confirmed). The spec deliberately
never clicks Explain, so this assertion would have passed identically against the
unfixed code. It proves nothing about D-07.

**Fix:** either click Explain on one card that needs it and assert the toast text
plus the in-place card upgrade (accepting ~1p of Sonnet spend, which is the only
way to actually exercise the fix), or relabel the line as a copy-scan and stop
presenting it as the D-07 regression guard.

### WR-R5 (WARNING) — A known-flaky assertion shipped as a hard expect on a prod smoke

**File:** `tests/smoke/authed/cv-lifecycle.smoke.ts:420-434`

The inline NOTE concedes it: "an org whose top-10 happen to be entirely fresh at
smoke time would fail this specific line". A prod smoke that can go red for a
legitimate state is a false-alarm generator, and under HARD RULE #1 a red smoke
blocks UAT.

**Fix:** derive the same freshness condition the page uses (a card with no score
badge ⇒ `Score all` must be visible), or `test.skip` when every visible card
already carries a score badge. Do not leave a documented-flaky hard assertion in
the suite that gates releases.

### WR-R6 (WARNING) — The cleanup sweep deletes the first search hit without checking the name

**File:** `tests/smoke/authed/cv-lifecycle.smoke.ts:180-200`

The sweep navigates to `/candidates?q=GSD Phase07 Smoke`, takes the first
`/candidates/<uuid>` link, and deletes it — **without asserting that candidate's
name carries the scratch prefix**. `/candidates` searches through
`search_candidates`, which matches with pg_trgm's `%` operator (a 0.3 similarity
threshold on `full_name` / `email` / `current_role_title`), so a false positive is
very unlikely — but the blast radius is the irreversible deletion of a real
candidate from a live customer org, ten times over, with the sweep's final
"no residue" assertion still passing.

This is inherited verbatim from the frozen `cv-intake.smoke.ts`, so the fixer did
not introduce it — but this phase doubles the number of specs carrying it, and
the browser pre-smoke is about to run against production.

**Fix (in the new spec only — Phase 6's is frozen):**
```ts
await page.goto(target)
const heading = await page.getByRole('heading', { level: 1 }).first().innerText()
if (!heading.startsWith(SCRATCH_NAME_PREFIX)) break // never delete a row we did not create
```

### IN-R1 (INFO) — Read-only sections are still validated from `defaultValues`

**Files:** `src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx:119-124`,
`edit/page.tsx:64-70`

When `workExperienceEditable === false` the editor is not rendered, but the key
still exists in `defaultValues`, so it stays in RHF's `_formValues` and is
validated by the resolver on every submit. A legacy row carrying a `dates` string
over 100 chars (or a title over 255) would fail validation for a field with no
rendered `FormMessage` — `handleSubmit` aborts, and the user sees Save do
nothing, with no message anywhere. Doubly latent today (needs a malformed row
*and* an over-length value), and it is the same silent-no-op class WR-08 closed.

**Fix:** omit the key from `defaultValues` entirely when the section is
read-only, so nothing about that column is validated or submitted.

### IN-R2 (INFO) — `win.opener = null` would throw if COOP is ever added

**File:** `src/app/(app)/candidates/[id]/cv-file-link.tsx:63-66`

Safe today because `next.config.ts` sets no `Cross-Origin-Opener-Policy` (checked).
Under `COOP: same-origin` the handle becomes a severed proxy where `opener` is
get-only cross-origin, and the assignment throws **synchronously inside the click
handler** — before `startTransition` — killing the View button outright with no
toast. `next.config.ts` already flags a CSP rollout as pending, so security
headers on this app are a live area.

**Fix:** `try { win.opener = null } catch { /* COOP already severed it */ }` —
one line, and the mitigation is redundant under COOP anyway.

## CLEAN checks re-verified on the merged tree

All 28 original CLEAN checks were re-run or re-reasoned; none regressed. Spot
evidence:

- **Frozen Phase-6 files byte-identical** at `5144ec7`, `bf854cf` and the working
  tree — `cv-write-path.test.ts`, `candidate-write-siblings.test.ts`,
  `parsed-cv-schema.test.ts`, `profile-completeness.ts`, `embed-text.ts`,
  `parse-messages.ts`, `postgres-safe-text.ts`, **and** `cv-intake.smoke.ts`
  (hash-compared). `tests/fixtures/**` untouched.
- **Tenancy on `getCvFileUrlAction` unchanged** — the fix range adds 19 lines to
  that function, all comments. The RLS-scoped `getCandidateCV` read and the
  Storage-policy second gate are byte-identical.
- **No migrations, no `package.json`/lockfile changes** (`git diff --stat` empty).
- **No `role="alert"`** on any code line of any changed `.tsx` (scanned). The new
  `AlertDialog` uses `role="alertdialog"`, portals outside `<main>`, and is on
  `/admin` — no interaction with the frozen `main >> role=alert` heuristic.
- **Confidence badge still a DOM sibling** — `cv-review-panel.tsx` is untouched
  by the fix range.
- **No raw control bytes** in any of the 33 changed files.
- **Super-admin gate intact** — `requireSuperAdmin()` remains the first statement
  of `backfillMatchScoresAction`; the new confirmation is client-side only and
  adds no bypass.
- **Gates:** `tsc --noEmit` clean · `vitest run` 952 passed / 28 todo / 0 failed
  (890 → 952, +62, zero regressions) · `eslint` 0 errors · `prettier --check` all
  33 touched files clean.

## Verdict

**SHIP.**

All 24 findings closed and verified; the three deviations were correct and better
than my patches. The 6 new warnings are follow-ups, not blockers — none is a data-
loss, security or tenancy issue. Two are worth doing before the production browser
pre-smoke runs: **WR-R6** (sweep deletes an unverified row in a live org) and
**WR-R5** (documented-flaky assertion that will produce a false red). **WR-R1**,
**WR-R3** and **IN-R2** are each a few lines and close residual silent-failure
paths on flows this phase owns. **WR-R2** is a disclosure gap the founder needs
before making the Inngest plan decision that §6 already asks of them.

---

_Re-reviewed: 2026-08-11_
_Reviewer: Claude (gsd-code-reviewer), adversarial pass 2_
_Range: 526cb40..bf854cf_

---

# Final ack — `d6dc6ac` (WR-R1..R6)

**Verdict: NOT CONFIRMED.** Four of six follow-ups are genuinely closed. **WR-R4
and WR-R5 are not implemented** although `d6dc6ac`'s message claims both.

## Per-item verification

| ID | Claimed | Actual |
|----|---------|--------|
| WR-R1 | try/catch + orphan-tab close | **CLOSED.** `cv-file-link.tsx:68-80` — `try/catch` around the await, `win?.close()`, toast. Rejection path no longer leaves a blank tab. |
| WR-R2 | heartbeat inside first real step | **CLOSED.** First statement of `sweep-candidates` / `sweep-stuck-pending`; dedicated steps deleted. Memoization intact → exactly one event per run, zero added Inngest steps. |
| WR-R3 | 60min → 2min bucket | **CLOSED.** `SCORE_ALL_DEDUP_BUCKET_MS = 2 * 60 * 1000`; wider than the 90 s poll, so worst-case swallow is <2 min. |
| WR-R4 | smoke clicks Explain, asserts "Match explained" | **NOT DONE.** No `Explain` click and no `Match explained` string anywhere in `cv-lifecycle.smoke.ts`. The vacuous `not.toContain('refresh to see')` at line 421-424 is unchanged. |
| WR-R5 | Score-all assertion tolerant of all-fresh | **NOT DONE.** Lines 432-444 are byte-identical to `bf854cf` — same hard `toBeVisible()` under the same NOTE conceding it fails on an all-fresh org. |
| WR-R6 | both sweeps verify the heading | **CLOSED, and the locator is correct.** |

**Evidence WR-R4/R5 did not land:** `git diff bf854cf..HEAD -- tests/smoke/authed/cv-lifecycle.smoke.ts` is 12 insertions / 0 deletions — exactly the WR-R6 guard. No other commit in the range touches the file.

## WR-R2 — the two things asked about

- **Memoization preserved.** The heartbeat is the first statement inside a
  `step.run` body. Inngest executes a step body once and memoizes the result, so
  the replay invocations do not re-enter it: exactly one event per successful
  run (a retry of that step re-fires, bounded by `retries: 1`). Zero added steps,
  which was the point.
- **A bare top-of-handler capture cannot satisfy the test — proven by mutation.**
  I moved the heartbeat back out to top-of-handler in `embed-batch.ts` and ran
  the suite: `1 failed | 5 passed`, failing on
  "emits its Sentry.captureMessage heartbeat INSIDE the first step.run". Source
  restored.
- **But the pin is weaker than before (new, minor).** Second mutation: heartbeat
  left inside `sweep-candidates` yet moved *after all its real work* →
  `6 passed`. The test now only proves the first `captureMessage` appears
  textually after the first `step.run(`; it can no longer distinguish
  "first statement" from "buried at the end", so the property the WR-R2 comment
  relies on ("a run that wedges later in this step has already heartbeat-ed") is
  unpinned. Tighten with a proximity check, e.g.
  `expect(code.slice(firstStepRunIdx, firstStepRunIdx + 300)).toContain('Sentry.captureMessage(')`.

## WR-R6 — the heading locator cannot false-positive

`page.locator('main h1, main h2').first()` resolves to the candidate name:
`<main>` in `(app)/layout.tsx:96` wraps only `{children}`, `TopNav` sits outside
it and contains **no** `h1`/`h2` at all, and on the detail page
`CandidateDetailHeader`'s `<h1>{candidate.full_name}</h1>` (page.tsx:209) precedes
every section `h2` (309+) in DOM order. If the header fails to render, the
`waitFor` times out and the sweep aborts — the safe direction. `includes()` rather
than `startsWith()` is fine and slightly more tolerant.

## Other new defects in `d6dc6ac` (all minor)

- **Orphaned comment blocks.** `embed-batch.ts:114-137` and
  `reconcile-cv-parses.ts:155-176` still carry the 24-line CR-03 block ending
  "**IT MUST BE THE FIRST step.run, NOT bare top-of-handler code**" — but the
  heartbeat it describes is no longer there, and its instruction now contradicts
  WR-R2. A maintainer following it would recreate the dedicated step this commit
  deleted. Same class as IN-02, which this phase already fixed once.
- **Runbook drift.** `docs/cron-monitoring.md:68-69` still says the heartbeats
  "had to be moved *inside* a step of their own". They are now inside the first
  *real* step. §2's volume table stays correct.
- **Freeze deviation (acceptable, but undisclosed).** `cv-intake.smoke.ts` — a
  Phase-6 spec the plan calls frozen, and which `07-FIXES.md`'s gate table
  asserted as "tests/smoke/** untouched" — gained the WR-R6 guard. The change is
  additive only, weakens no assertion, and prevents irreversible deletion of a
  real candidate, so I would keep it; it just needs stating rather than leaving
  the earlier gate claim standing.

## Gates re-run on `d6dc6ac`

`tsc --noEmit` clean · `vitest run` **952 passed / 0 failed** · three red-suite
files + `profile-completeness.ts` / `embed-text.ts` / `parse-messages.ts` /
`postgres-safe-text.ts` byte-identical to `5144ec7` · no migrations, no
dependency changes.

## To confirm

Implement WR-R4 and WR-R5 as described, or explicitly withdraw them and correct
`d6dc6ac`'s message — the current record claims smoke coverage that does not
exist, and the production pre-smoke is about to run with the known-flaky
assertion still in place. The four minor items above are optional cleanups.

---

_Final ack: 2026-08-11 · Range `bf854cf..d6dc6ac` · Reviewer: Claude (gsd-code-reviewer)_

---

# Final ack (2) — `39866f3`

**Verdict: SHIP-CONFIRMED.**

## WR-R4 — landed, and non-vacuous

`git diff bf854cf..39866f3 -- tests/smoke/authed/cv-lifecycle.smoke.ts` now shows
the Explain block (lines 442-455), not just the WR-R6 guard. Verified it can
actually fire rather than always taking the skip branch:

- `getByRole('button', { name: 'Explain match', exact: true })` — the real
  control renders `{isPending ? 'Scoring…' : 'Explain match'}` with an
  `aria-hidden` icon (`explain-button.tsx:60-62`), so the accessible name is
  exactly `Explain match`. Matches.
- `getByText('Match explained')` — the action toasts exactly
  `toast.success('Match explained')` (`explain-button.tsx:43`). Matches, and it
  is correctly **not** scoped to `main`, since sonner portals to a body-level
  region.
- 60 s budget covers the documented 3-6 s synchronous action; the skip branch
  logs rather than passing silently.

This assertion can now distinguish fixed from unfixed code, which the previous
`not.toContain('refresh to see')` grep could not.

## WR-R5 — landed

The hard `toBeVisible()` and the NOTE conceding its own flakiness are gone,
replaced by `count() > 0 → toBeEnabled()`, else a logged skip. The all-fresh
edge can no longer produce a false red on a release-gating smoke.

## Final-ack caveat — closed, proven by mutation

The pin now also asserts `code.slice(firstStepRunIdx, firstStepRunIdx + 300)`
contains `Sentry.captureMessage(` (comments are stripped first, so the window is
ample). Re-ran both mutations against `embed-batch.ts`:

| Mutation | Before | Now |
|---|---|---|
| heartbeat → bare top-of-handler | FAIL | **FAIL** (unchanged) |
| heartbeat → after the first step's real work | PASS (the gap) | **FAIL** — "the heartbeat must be the FIRST statement of the first step, not after its real work" |

Source restored after each; working tree clean.

## Housekeeping items — all done

Orphaned CR-03 comment blocks replaced in both cron files with an accurate
three-line pointer; `docs/cron-monitoring.md` §2 now says "the FIRST STATEMENT of
each cron's first real step" with the WR-R2 rationale; `07-FIXES.md` carries an
addendum that states the d6dc6ac overclaim and the `cv-intake.smoke.ts` WR-R6
deviation plainly.

## Gates re-run on `39866f3`

`tsc --noEmit` clean · `vitest run` **952 passed / 28 todo / 0 failed** · `eslint`
**0 errors** · `prettier --check` clean on every file touched since `bf854cf` ·
the seven frozen Phase-6 files byte-identical to `5144ec7` · no migrations, no
dependency changes, `tests/fixtures/**` untouched · no `role="alert"` on any code
line · no control bytes · the new `.gitignore` entries exclude no tracked file
(`git ls-files -i -c` empty).

## Non-blocking observations (no action required)

- `reconcile-cv-parses.ts` lost its `// Step A — sweep-stuck-pending` banner in
  the comment replacement while Step B (line 276) and Step C (line 390) keep
  theirs. Cosmetic only.
- The Explain click writes one real `ai_summaries` match_score row (~1p) for a
  real candidate/job pair in the founder's org, which the scratch-prefix sweep
  does not remove. Indistinguishable from ordinary product use, and disclosed in
  the spec's own comment — an acceptable trade for a non-vacuous D-07 guard.
- If the founder's org is at its AI cap when the smoke runs, the Explain
  assertion times out at 60 s with a D-07-flavoured message rather than naming
  the cap. Unlike WR-R5's all-fresh case (a healthy state), being capped is
  something the founder should see fail — so failing is the right behaviour, if
  not the clearest message.

---

_Final ack 2: 2026-08-11 · Range `d6dc6ac..39866f3` (smoke verified `bf854cf..39866f3`) · **SHIP-CONFIRMED** · Reviewer: Claude (gsd-code-reviewer)_
