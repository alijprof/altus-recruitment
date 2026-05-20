---
phase: 03-linkedin-capture-spec-workflow-shortlists
reviewed: 2026-05-20T00:00:00Z
depth: standard
files_reviewed: 50
files_reviewed_list:
  - chrome-extension/manifest.json
  - chrome-extension/src/background/ingest.ts
  - chrome-extension/src/content/content-script-entry.ts
  - chrome-extension/src/content/scrape-profile.ts
  - chrome-extension/src/popup/popup.ts
  - chrome-extension/src/shared/scraped-profile-schema.ts
  - src/app/(app)/_dashboard/dormant-client-row.tsx
  - src/app/(app)/_dashboard/dormant-clients-widget.tsx
  - src/app/(app)/_dashboard/send-checkin-modal.tsx
  - src/app/(app)/candidates/[id]/floats/actions.ts
  - src/app/(app)/candidates/[id]/floats/float-form.tsx
  - src/app/(app)/candidates/[id]/floats/page.tsx
  - src/app/(app)/candidates/[id]/shortlist-actions.ts
  - src/app/(app)/clients/[id]/outreach-actions.ts
  - src/app/(app)/clients/dormant-badge.tsx
  - src/app/(app)/floats/page.tsx
  - src/app/(app)/jobs/[id]/ad-panel/actions.ts
  - src/app/(app)/jobs/[id]/ad-panel/ad-panel-trigger.tsx
  - src/app/(app)/jobs/[id]/ad-panel/ad-panel.tsx
  - src/app/(app)/jobs/[id]/ad-panel/saved-ads-list.tsx
  - src/app/(app)/jobs/[id]/shortlist/actions.ts
  - src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx
  - src/app/(app)/jobs/[id]/shortlist/page.tsx
  - src/app/(app)/jobs/[id]/shortlist/shortlist-list.tsx
  - src/app/(app)/reports/source-attribution/date-filter.tsx
  - src/app/(app)/reports/source-attribution/page.tsx
  - src/app/(app)/spec/[id]/review/actions.ts
  - src/app/(app)/spec/[id]/review/page.tsx
  - src/app/(app)/spec/[id]/review/spec-review-form.tsx
  - src/app/(app)/spec/new/actions.ts
  - src/app/(app)/spec/new/page.tsx
  - src/app/(app)/spec/new/spec-upload-form.tsx
  - src/app/api/inngest/route.ts
  - src/app/api/linkedin/_cors.ts
  - src/app/api/linkedin/ingest/route.ts
  - src/lib/ai/ad-generate.ts
  - src/lib/ai/ffmpeg.ts
  - src/lib/ai/inclusivity-lexicon.ts
  - src/lib/ai/jd-extract.ts
  - src/lib/ai/outreach-draft.ts
  - src/lib/ai/whisper.ts
  - src/lib/db/applications.ts
  - src/lib/db/candidates-linkedin.ts
  - src/lib/db/dormant-clients.ts
  - src/lib/db/job-ads.ts
  - src/lib/db/shortlists.ts
  - src/lib/db/source-attribution.ts
  - src/lib/db/spec-drafts.ts
  - src/lib/env.ts
  - src/lib/format.ts
  - src/lib/inngest/functions/create-job-from-spec.ts
  - src/lib/inngest/functions/draft-outreach-email.ts
  - src/lib/inngest/functions/embed-candidate-from-linkedin.ts
  - src/lib/inngest/functions/probe-ffmpeg.ts
  - src/lib/inngest/functions/spec-audio-retention-sweep.ts
  - src/lib/inngest/functions/spec-draft-cleanup-sweep.ts
  - src/lib/inngest/functions/transcribe-and-structure-spec.ts
  - src/lib/integrations/outlook.ts
  - src/lib/reports/source-attribution-range.ts
  - src/lib/validation/linkedin-ingest-schema.ts
  - supabase/migrations/20260520003437_phase3_spec_drafts.sql
  - supabase/migrations/20260520003438_phase3_spec_audio_bucket.sql
  - supabase/migrations/20260520010418_phase3_application_type_shortlist.sql
  - supabase/migrations/20260520010419_phase3_applications_nullable_job_id.sql
  - supabase/migrations/20260520010420_phase3_applications_same_org_guard_null_safe.sql
  - supabase/migrations/20260520020702_phase3_job_ads.sql
  - supabase/migrations/20260520023100_phase3_applications_placement_fields.sql
  - supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql
  - supabase/migrations/20260520031200_phase3_dormant_clients_rpc.sql
  - supabase/migrations/20260520031300_phase3_activity_kind_email_draft.sql
findings:
  critical: 2
  warning: 7
  info: 5
  total: 14
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 50
**Status:** issues_found

## Summary

Phase 3 ships a large surface — LinkedIn capture, spec audio pipeline, shortlists/floats, dormant outreach, job ads + inclusivity, source-attribution reports. Tenant-isolation discipline is generally strong: the team consistently uses RLS-aware clients for recruiter actions, applies `HARD RULE 4` tenant-boundary assertions before service-role writes, and uses ALPHABETICAL trigger ordering for the new `spec_drafts` and `job_ads` tables (correctly preserving the Phase 1 `_set_org` < `_verify_same_org_check` invariant from commit 3f748f8). AI-cost logging routes uniformly through `runWithLogging`/`record_ai_usage`, and Microsoft `Mail.Send` follows D3-20 incremental-consent semantics with no auto-send paths.

Two blocker-class issues found:

1. **The LinkedIn-ingest advisory lock is non-functional.** The route calls `supabase.rpc('pg_try_advisory_xact_lock', ...)`, but no migration exposes this Postgres builtin as a PostgREST RPC, and the request-level transaction model means the lock could not span the subsequent `upsertCandidateFromLinkedIn` write anyway. The error is swallowed silently, so the documented 429/Retry-After flow is unreachable and concurrent same-URL captures can race.
2. **`linkedin_url` is not validated as a LinkedIn URL.** Zod accepts any URL; a holder of a valid recruiter token can poison `candidates.source_detail` with arbitrary URLs, which then becomes the deduplication key for subsequent captures.

Notable but lower-severity issues include: a service-role activity update path in `sendOutreachAction` that omits `organization_id` from the WHERE clause (defence-in-depth gap), a base64-in-step-output pipeline that may overflow Inngest step storage limits for larger spec audio, a `then`-after-`maxRetries` resolve race in `runWithLogging` (unrelated to Phase 3 changes — flagged as observed during review), and the `addToShortlistAction` not setting `owner_user_id` so the planned "mine only" filter will never match.

## Critical Issues

### CR-01: LinkedIn-ingest advisory lock is non-functional; concurrent-capture protection silently disabled

**File:** `src/app/api/linkedin/ingest/route.ts:152-171, 246-254`

**Issue:**
The route calls `supabase.rpc('pg_try_advisory_xact_lock', { key1, key2 })` and treats `data === false` as "concurrent capture in flight → 429". This codepath does not work in production for three reasons:

1. **`pg_try_advisory_xact_lock` is not exposed via PostgREST.** It is a Postgres builtin living in `pg_catalog`. PostgREST's `.rpc(name, args)` only routes to functions in the exposed schemas (`public` by default). A `grep -rn "pg_try_advisory" supabase/migrations/` returns zero hits — no SECURITY DEFINER wrapper is defined. Every request will receive a 404 / "function does not exist" error from PostgREST.
2. **All errors are swallowed by the bare `catch {}` block (lines 168–171).** The comment says "non-fatal", but the practical effect is that the RPC fails on every call, the `data === false` branch is never reached, and the documented 429-with-retry-after response is unreachable code.
3. **Even if exposed, the lock could not span the upsert.** Each Supabase JS client call is an independent HTTPS/PostgREST request, and `pg_try_advisory_xact_lock` releases at the *end of the calling transaction*. The lock would be released as soon as the RPC POST returned, well before `upsertCandidateFromLinkedIn` executes (a separate transaction over a separate connection). The "xact_lock" semantic the comment relies on is wrong for this architecture.

Two concurrent captures of the same `linkedin_url` by the same recruiter therefore have no serialisation: both reads return null, both inserts proceed, and the second one wins or fails on whichever constraint trips first. The dedup path is correct under low contention, but the documented race-protection guarantee is absent.

**Fix:**
Pick one of:

(a) Drop the lock entirely and document the race as acceptable (the read-then-insert race is bounded by user click-rate; the worst case is one extra row that the next capture catches via `source_detail` dedup — though `candidates.source_detail` should then carry a unique index per `(organization_id, source_detail)` to convert the race into a deterministic 23505).

(b) Add a SECURITY DEFINER wrapper in a new migration AND collapse the lock + upsert into a single SQL function so they share a transaction:

```sql
-- supabase/migrations/<ts>_phase3_linkedin_capture_lock.sql
create or replace function public.linkedin_capture_try_lock(
  p_org uuid,
  p_url text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return pg_try_advisory_xact_lock(
    hashtextextended(p_org::text, 0)::bigint,
    hashtextextended(p_url,        0)::bigint
  );
end;
$$;

grant execute on function public.linkedin_capture_try_lock(uuid, text)
  to authenticated;
```

…and then have the entire dedup-or-upsert flow live inside one stored function that grabs the lock as its first statement (so the lock outlives the upsert within one PostgREST transaction).

Either way, REMOVE the silent `catch {}` and the unreachable 429 branch — silent failure of a documented "best-effort" lock is worse than no lock because the code reviewer can't tell whether protection exists.

---

### CR-02: `linkedin_url` not validated as LinkedIn; recruiter token can poison the dedup channel

**File:** `src/lib/validation/linkedin-ingest-schema.ts:37`, `chrome-extension/src/shared/scraped-profile-schema.ts:47`

**Issue:**
Both the client-side and server-side schemas validate `linkedin_url` only as `z.string().url().max(500)`. The `linkedin_url` value is then written verbatim into `candidates.source_detail` (`src/lib/db/candidates-linkedin.ts:209`) and used as the *primary deduplication key* on every subsequent capture (`getCandidateByLinkedInUrl` at line 36 does `.eq('source_detail', linkedinUrl)`).

Attack surface: an authenticated recruiter (or anything holding a valid Supabase token — a compromised recruiter session, a malicious internal user) can POST `{ linkedin_url: "https://evil.example.com/whatever", name: "Real Person", ... }`. This writes a candidate whose `source = 'linkedin'` and `source_detail = 'https://evil.example.com/whatever'`, which then:

1. Pollutes the source-attribution report (`/reports/source-attribution`) with bogus "LinkedIn" provenance.
2. Becomes a forever dedup key — a subsequent legitimate capture of `https://www.linkedin.com/in/real-person` won't match the corrupted row.
3. Is exfiltratable in CSV/export paths.

The popup *does* gate on `LINKEDIN_PROFILE_RE` before sending (`chrome-extension/src/popup/popup.ts:15`), but that's a client-side check on the active tab — anyone bypassing the popup (curl with a stolen token) bypasses this. The route's CORS allowlist for `chrome-extension://*` is a browser-side defence and does nothing against a server-side curl.

The Chrome extension popup's `LINKEDIN_PROFILE_RE = /^https:\/\/(www\.)?linkedin\.com\/in\//i` is the *correct* contract — mirror it on the server.

**Fix:**

Tighten the server-side schema to reject non-LinkedIn URLs:

```ts
// src/lib/validation/linkedin-ingest-schema.ts
const LINKEDIN_PROFILE_RE = /^https:\/\/(www\.)?linkedin\.com\/in\/[\w\-%.]+\/?(\?.*)?$/i

export const LinkedInIngestSchema = z.object({
  // ...
  linkedin_url: z
    .string()
    .url()
    .max(500)
    .regex(LINKEDIN_PROFILE_RE, 'must be a https://www.linkedin.com/in/<handle> URL'),
  // ...
})
```

Apply the same regex to `chrome-extension/src/shared/scraped-profile-schema.ts` so the boundary fails fast on the extension side too.

Additionally, normalise the URL before persisting (lowercase host, strip trailing slash, drop tracking query params) so that `https://linkedin.com/in/foo` and `https://www.linkedin.com/in/foo/?utm_source=x` dedup to the same row.

## Warnings

### WR-01: `sendOutreachAction` service-role update missing `organization_id` defence-in-depth

**File:** `src/app/(app)/clients/[id]/outreach-actions.ts:269-294`

**Issue:**
The post-send activity flip uses `createServiceClient()` (RLS bypass) and reads/updates the latest `email_draft` row by `entity_id = clientId` only — no `organization_id` filter. The earlier contact lookup (line 221) is RLS-scoped to the caller's org, so by the time control reaches line 269 we know `clientId` belongs to the caller's org. However, defence in depth requires every service-role write to carry an explicit `organization_id` predicate (per the codebase's own pattern, mirrored in `transcribe-and-structure-spec.ts:147`, `255` and `embed-candidate-from-linkedin.ts:95`).

If the contact-lookup branch is ever refactored, or if the function is repurposed to a path that doesn't pre-validate clientId, the absent filter becomes a cross-tenant write vector.

**Fix:**

Thread the recruiter's `organization_id` (already resolved further down for the insert branch — lift it earlier) and add it to every read/update:

```ts
// resolve once at the top of the action
const { data: profile } = await supabase
  .from('users').select('organization_id').eq('id', user.id).maybeSingle()
if (!profile?.organization_id) return { ok: false, error: 'No organization.' }

// then:
const { data: existing } = await service
  .from('activities')
  .select('id, metadata')
  .eq('organization_id', profile.organization_id)   // <-- add
  .eq('entity_type', 'company')
  .eq('entity_id', clientId)
  .eq('kind', filterKind)
  ...

await service
  .from('activities')
  .update({ /* ... */ })
  .eq('id', existing.id)
  .eq('organization_id', profile.organization_id)   // <-- add
```

---

### WR-02: Spec-audio pipeline base64-encodes large buffers across Inngest step outputs

**File:** `src/lib/inngest/functions/transcribe-and-structure-spec.ts:152-175`

**Issue:**
The pipeline base64-encodes the full audio buffer at three step boundaries:
1. `download-audio` returns `Buffer.from(ab).toString('base64')` — for a 100 MiB upload (the action's documented ceiling), that's ~133 MB of base64 in the step output.
2. `ffmpeg-recompress` returns base64 of the compressed Opus output (~24-32 MB worst case).
3. `ffmpeg-probe-duration` reads compressed base64 again.

Inngest free-tier step outputs cap at ~1 MB; paid tiers cap higher but not unbounded. Any spec audio above ~700 KB-1 MB raw will fail the `download-audio` step in production. The recompress step's output is smaller but still likely above the cap for the bulk of real-world spec calls (5-20 minute recordings).

The `parse-cv.ts` pattern this mirrors works because PDF resumes are typically <500 KB. Audio is multiple orders of magnitude larger.

**Fix:**
Use one of:
1. Persist the recompressed audio back to Supabase Storage between steps and pass the storage path (a small string) through step outputs. Each step downloads its own input.
2. Combine `download-audio` + `ffmpeg-recompress` + `ffmpeg-probe-duration` + `whisper-transcribe` into a SINGLE `step.run('process-audio', ...)` so the buffer never crosses a step boundary. The trade-off is a longer-running step (less granular retry), but Whisper itself is ~5-30s and ffmpeg is fast — well within Inngest's per-step time cap.
3. Verify the actual Inngest tier limit and document an explicit MAX_AUDIO_BYTES that fits, then enforce it in `submitSpecCallAction` (currently 100 MiB — likely far too large).

This needs runtime validation before considering the spec workflow shippable end-to-end at the documented 60-minute / 100 MiB limit.

---

### WR-03: `addToShortlistAction` never sets `owner_user_id`, so the future "mine only" filter is dead

**File:** `src/app/(app)/jobs/[id]/shortlist/actions.ts:56-60`

**Issue:**
The shortlist insert payload omits `owner_user_id`, so the column defaults to NULL. The companion `listAllFloats` helper (`src/lib/db/shortlists.ts:139`) accepts an `ownerId` filter for "mine only" mode, and the comments in shortlist-actions.ts L25-27 + dormant-clients-widget L18-19 reference D3-29 ("org-wide visibility — `mine only` toggle is a UI hint"). If/when that UI toggle ships, it will return zero rows because every shortlist created via this action has `owner_user_id IS NULL`.

The same gap applies to `addFloatAction` (`src/app/(app)/candidates/[id]/floats/actions.ts:52-58`).

**Fix:**

```ts
const payload = {
  job_id: parsed.data.jobId,
  candidate_id: parsed.data.candidateId,
  application_type: 'shortlist' as Enums<'application_type'>,
  owner_user_id: userData.user.id,        // <-- add
} as unknown as TablesInsert<'applications'>
```

And the same for floats. The `created_by` column would also be a candidate for `userData.user.id` if the schema has one (verify against the Phase 1 schema).

---

### WR-04: `removeFromShortlistAction` hard-deletes without auditing

**File:** `src/app/(app)/jobs/[id]/shortlist/actions.ts:108-152`

**Issue:**
The action `.delete()`s the row outright with no `record_audit` call and no activity row. The "promote shortlist → standard" path *does* write an audit-via-activity entry (`convertShortlistToApplicationAction:97-122`); the analogous "the recruiter binned this person from the shortlist" event leaves zero forensic trace.

For a recruitment CRM where candidate-touching activity is regulated and auditable, every state mutation initiated by a recruiter on a candidate should leave an audit row. This is consistent with the CLAUDE.md non-negotiable: "Audit-ready by default. Every access to candidate data is logged."

**Fix:**

Either soft-delete (set a `deleted_at` and exclude in `listShortlistForJob`) OR insert an activity row with `kind='note'` (or a new `kind='shortlist_removed'`) before deleting:

```ts
const activity = {
  kind: 'note',
  body: 'Removed from shortlist',
  actor_user_id: userData.user.id,
  entity_type: 'application',
  entity_id: row.id,
  metadata: { candidate_id: row.candidate_id, job_id: row.job_id, from: 'shortlist' },
} as unknown as TablesInsert<'activities'>
await supabase.from('activities').insert(activity)
```

Note: if the delete actually fires the cross-tenant FK cascade, the activity row would orphan; the alternative is soft-delete.

---

### WR-05: `outreach-draft` Inngest function trusts `placements[0].jobs` shape without proper guard

**File:** `src/lib/inngest/functions/draft-outreach-email.ts:99-124`

**Issue:**
The PostgREST nested-select `applications(stage_changed_at, jobs!inner(title, company_id))` returns `jobs` as either an object or an array depending on the join cardinality and PostgREST version. The code defends against the array case (`Array.isArray(top.jobs) ? top.jobs[0] : top.jobs`) but the discriminating cast at line 104-108 is unsound:

```ts
const top = placements?.[0] as
  | { stage_changed_at: string; jobs: { title: string } | { title: string }[] | null }
  | undefined
```

If PostgREST returns a column shape that doesn't match (e.g. no rows, or a future Supabase release changes the shape), the unchecked cast silently degrades. `Number.isNaN(when.getTime())` later catches invalid date strings, but a fully missing `stage_changed_at` would throw at `new Date(undefined).toLocaleString`. Acceptable today, fragile for tomorrow.

**Fix:**

Replace the unsafe cast with a runtime narrow:

```ts
const top = placements?.[0]
if (top && typeof top.stage_changed_at === 'string') {
  const job = Array.isArray(top.jobs) ? top.jobs[0] : top.jobs
  if (job && typeof job.title === 'string') {
    // ...
  }
}
```

Same applies to `applications.ts` shapeCard — the joined-row types are aliased but not validated at runtime.

---

### WR-06: `recompressToOpus` never raises if ffmpeg never emits `end`

**File:** `src/lib/ai/ffmpeg.ts:62-96`

**Issue:**
The promise resolves only on the sink's `finish` event, which fires after `end()`. The function's only path to reject is the `error` event handler. If ffmpeg silently hangs (e.g. on a corrupt stream that produces no output but never errors), the promise never settles, the Inngest step hangs until Inngest's per-step timeout fires (which still allows up to several minutes of wasted compute).

**Fix:**

Add an explicit timeout race:

```ts
const TIMEOUT_MS = 60_000   // 60s for ≤60min audio is generous
return await Promise.race([
  new Promise<Buffer>((resolve, reject) => { /* existing body */ }),
  new Promise<Buffer>((_, reject) =>
    setTimeout(() => reject(new Error('ffmpeg recompress timed out')), TIMEOUT_MS),
  ),
])
```

Apply the same pattern to `probeDurationSeconds`.

---

### WR-07: `runWithLogging` retry loop allows `attempt <= 3` to throw a stale `lastError` on a 4xx after a successful retry

**File:** `src/lib/ai/claude.ts:60-124`

**Issue:**
This file is Phase 2 code but is in the change-set (touched by the Phase 3 wrappers `jd-extract.ts`, `outreach-draft.ts`, `ad-generate.ts`). Auditing it in scope:

The retry loop's structure is:
```ts
while (attempt <= 3) {
  try { return await ...; } catch (err) {
    lastError = err
    if (Anthropic.APIError) {
      if (429/529) { sleep; attempt++; continue }
      if (4xx)     { throw err }   // <- non-retriable
      if (5xx)     { sleep; attempt++; continue }
    }
    throw err                      // <- unknown error: rethrow
  }
}
throw lastError                    // <- only after attempt > 3
```

The fall-through at the bottom (`throw lastError`) only triggers after `attempt > 3` (i.e. 4 attempts exhausted). That's correct, but the loop guard `attempt <= 3` allows 4 attempts; the comment "We own the retry loop in runWithLogging" implies 3 retries total. Either fix the off-by-one, or rename to make 4-attempt semantics explicit. Low severity, but a 4th call to Anthropic at peak load translates to wasted spend on a tier-1 rate-limit hammer.

**Fix:**

Either change to `while (attempt < 3)` for a strict 3-attempt cap, or rename `attempt <= 3` semantics explicitly (`MAX_ATTEMPTS = 4` with an explanatory comment that this is initial + 3 retries).

## Info

### IN-01: `flattenScraped` swallows `name === null` into empty string, breaking validation feedback

**File:** `chrome-extension/src/background/ingest.ts:188`

`flattenExtracted(r.name) ?? ''` defaults a null name to `''`. The server-side schema then rejects with "name: too short" rather than the more accurate "no name extracted from page". Either pass `null` through (the server already returns 400 with the issue path) or surface a popup-side "couldn't read the name" hint before the POST so the recruiter knows to re-open the profile.

### IN-02: `confidenceFor('h2')` returns `'medium'` but `extractName` calls it for an h1 element

**File:** `chrome-extension/src/content/scrape-profile.ts:86-98`

The name extractor finds an `h1` but tags `strategy_used: 'h2'` (with a comment explaining it as "structurally similar"). This works but is confusing — a future maintainer reading the captured row will see `strategy_used='h2'` for a profile whose name came from `h1`. Either add an `h1` strategy or rename `h2` to `heading` for clarity.

### IN-03: Profile photo URL claim — verify in test that the scraper truly cannot leak `img` elements

**File:** `chrome-extension/src/content/scrape-profile.ts:18-19`

The header comment says "D3-03: NEVER capture profile-photo URL". The current extractors don't read `img.src`, but there's no regression test enforcing this; a future "extract location from the side card" change could pull `img` accidentally. Add a unit test that loads the fixture HTML, runs `scrapeLinkedInProfile`, and asserts the JSON output contains no `linkedin.com/profile-pic` or `media.licdn.com` substrings.

### IN-04: `formatPence(negative)` documented to pass-through but renders as `-42p` for negative under-£1, ambiguous

**File:** `src/lib/format.ts:15-18`

`p < 100` short-circuits to `${p}p`, so `formatPence(-50)` returns `-50p`. The doc-comment "Negative values are pass-through" is technically true but the format for negative < 1 is `-50p` which most UK readers will parse as "negative fifty pence" — acceptable but document explicitly that negatives appear in `-Np` form rather than `(£0.50)` or `-£0.50` so future devs don't normalise inconsistently.

### IN-05: `addFloatAction` activity-note uses `entity_type='application'` immediately after insert, but the trigger ordering of `activities` was never asserted in Phase 3

**File:** `src/app/(app)/candidates/[id]/floats/actions.ts:76-94`

The insert payload references `entity_id: data.id` (the freshly-inserted application). The `activities_verify_same_org_check` cross-tenant FK guard (Phase 1) walks `entity_type` → table → row to assert org match. If that guard does NOT short-circuit on `entity_type='application'` correctly under the Phase 3 nullable-job-id schema, the trigger would still pass (the application row exists with the same org). No bug observed; flagging for the verifier to confirm the activities-guard SQL was not silently broken by the `applications_job_id NULL` change. Smoke test: insert a float, then an activity referencing the float's id, and check the trigger doesn't raise on the now-nullable `job_id`.

---

_Reviewed: 2026-05-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
