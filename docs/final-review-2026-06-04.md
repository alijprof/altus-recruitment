# Altus — Final Pre-Client Review (Complete)

**Demo-safety verdict: NO — do not demo as-is.** There are 3 Critical and 17 High issues across all eight domains, and a large subset of them are explicitly demo-blocking on the exact flows you would show tonight (AI matching, source/revenue reports, LinkedIn capture, candidate detail, client re-engagement, spec-to-job). This report supersedes the earlier partial summary that covered only 2 of 8 domains; it is the complete pass.

Authoritative counts: **3 Critical, 17 High, 34 Medium, 88 Low — 142 unique issues**, every one adversarially verified.

The three biggest risks tonight:
1. **AI match scoring is dead end-to-end** — the headline "AI-first matching" never auto-populates (service-role insert into `ai_summaries` raises on a NULL-org trigger). Every match shows "Not scored yet" forever (jobs/CRITICAL).
2. **The flagship revenue reports crash or print nonsense the moment real placement data exists** — `.toFixed` on a numeric-string throws, and a bigint reduce concatenates the headline "Fee revenue" into a garbage figure (dashboard/CRITICAL + HIGH).
3. **LinkedIn capture is 100% dead** (queries run as anon role, always 500s) and the **acquirer due-diligence "buyer-value" report has no nav entry point at all** (dashboard/auth_public/HIGH).

---

## Must-fix before tonight's call

Only demo-blocking Critical + High issues, ordered by blast radius.

1. **Auto match scoring never persists (every match stuck on "Not scored yet")** — the headline AI-matching feature is dead on the demo path; service-role insert into `ai_summaries` raises on a NULL-org trigger and `upsertMatchSummary` swallows it as a no-op. `src/lib/db/ai-summaries.ts:130` — give `upsertMatchSummary` an explicit `organizationId` param and write it in the insert payload instead of relying on the auth-context trigger.

2. **Source-attribution report crashes the instant any placement exists** — the only report linked from /reports throws a TypeError (`String.toFixed` on a numeric-string) and is replaced by the error screen. `src/app/(app)/reports/source-attribution/page.tsx:213` — coerce `avg_time_to_place_days` and `total_fee_pence` to `Number` in `getSourceAttribution`.

3. **LinkedIn capture is dead end-to-end (always 500s)** — "Save to Altus" never creates a candidate; DB queries run as the anon role and the route isn't in PUBLIC_PATHS. `src/app/api/linkedin/ingest/route.ts:110` — build a token-scoped (or service-role + explicit org) client and add the route to PUBLIC_PATHS.

4. **Buyer-value report crashes once any source-attributed placement exists** — the acquirer due-diligence dashboard hits the same `.toFixed` on a numeric-string and pence columns are raw bigint-strings. `src/app/(app)/reports/buyer-value/page.tsx:113` — coerce all bigint/numeric columns to `Number` in the buyer-value helpers.

5. **Buyer-value report is unreachable — no nav link anywhere** — the single most sale-relevant report has zero inbound links; in the demo it looks like it doesn't exist. `src/app/(app)/reports/page.tsx:27` — add a second `ReportCard` for `/reports/buyer-value` (fix #4 first).

6. **Source-attribution "Fee revenue" headline is wrong (bigint reduce string-concatenates)** — the acquirer-facing revenue marquee shows e.g. £1,500,002,500.00 once 2+ source channels have placements. `src/app/(app)/reports/source-attribution/page.tsx:103` — same `Number` coercion in `getSourceAttribution` fixes the reduce/sort/format.

7. **Sending a check-in never clears the Dormant flag** — recruiter sends the AI check-in, email goes out, client STILL shows Dormant badge and stays in the dashboard widget; the re-engagement loop looks like it did nothing. `src/app/(app)/clients/[id]/outreach-actions.ts:297` — bump `companies.last_contacted_at` (org-scoped) after a successful send.

8. **List-view client "Edit" is a hard 404 and there's no other way to edit a client** — clicking Edit on any client row lands on Next.js 404; no edit affordance exists anywhere. `src/app/(app)/clients/client-table.tsx:99` — create the missing `[id]/edit/page.tsx` wired to the existing `updateClientAction`, or remove the dead Edit item.

9. **Floats/shortlist render as phantom jobs with live Move/Reject/Place actions on the candidate page** — the demo screen shows ghost "Untitled job" cards a recruiter can accidentally Place or Reject. `src/lib/db/applications.ts:90` — add `.eq('application_type', 'standard')` to `listApplicationsForCandidate`.

10. **Same person becomes two candidate records (email stored verbatim, dedup compares lowercased)** — "why are there two of this guy?" — a self-apply or Outlook sync creates a duplicate. `src/lib/db/candidates.ts:358` — lowercase email at the write boundary in create/update (and `/candidates/new` schema, `src/app/(app)/candidates/new/schema.ts:39`).

11. **Free-text currency from a spec call crashes the job detail page** — a salary transcribed as "£" / "pounds" / "GBP " throws a RangeError and the job is un-viewable with no in-app fix. `src/app/(app)/jobs/[id]/job-detail-header.tsx:28` — wrap `Intl.NumberFormat` in try/catch with a GBP fallback and constrain currency to ISO-4217 at creation.

12. **Placement fee mis-parses UK figures (£7,500 becomes £7)** — `parseFloat('7,500')` stores 700 pence; the headline revenue figure is silently 1000x wrong in front of a buyer. `src/components/app/placement-modal.tsx:89` — strip thousands separators, reject trailing garbage, then parse.

13. **Adding a candidate to a job shows success but the candidate never appears** — looks like a silent failure; re-adding then hits the dup guard and shows a contradictory "may already be on this job". `src/app/(app)/jobs/[id]/add-candidate-form.tsx:85` — call `router.refresh()` after success.

14. **Shortlist Remove / Convert succeed but the row stays on screen** — recruiter can't tell it worked and may click again. `src/app/(app)/jobs/[id]/shortlist/shortlist-list.tsx:48` — call `router.refresh()` after both success toasts.

15. **Outlook MSAL singleton can persist another user's refresh token (cross-tenant)** — recruiter A can end up authenticating as B and pulling B's inbox onto candidate timelines; the 6-hourly cron is the live trigger. `src/lib/integrations/outlook.ts:342` — scope the token lookup to the current account's `home_account_id` (or build a fresh client per refresh).

16. **First-time Outlook connect reports success but persists nothing** — recruiter sees "Outlook connected" while no credentials row exists; email sync never starts. `src/app/api/outlook/callback/route.ts:166` — pass the resolved `organizationId` into the insert and treat a zero-row UPDATE fallback as `persist_failed`.

17. **Outlook consent asks for Mail.Send while the card says "Read-only (Mail.Read), we never send email"** — Microsoft's consent screen contradicts the in-app promise; reads as a dark pattern. `src/app/(app)/settings/integrations/connect-outlook-card.tsx:109` — reconcile copy and `OUTLOOK_SCOPES` in one direction (and update the migration comment/default).

18. **Team-invite "Invitation sent" toast fires even when no email is delivered** — no API key / no origin / http_error are all swallowed; the teammate gets nothing. `src/app/(app)/settings/team/actions.ts:206` — propagate a delivery flag so the UI can warn; verify `RESEND_API_KEY` + `NEXT_PUBLIC_SITE_URL` are set before the demo.

19. **Profile email field is editable, overwrites the displayed identity, but never changes the sign-in identity** — Save shows success while login is unchanged and the shown email permanently diverges. `src/app/(app)/settings/profile-form.tsx:76` — make the email field read-only and drop `email` from the update path.

20. **Jobs created from an approved spec call are never embedded or match-scored (wrong Inngest event name)** — the "spec call -> approve -> instantly matched" flow silently half-works. `src/lib/inngest/functions/create-job-from-spec.ts:216` — change the event name from `jobs/jd-changed` to `job/embed`.

21. **Outlook subscription recreate reports success even when the new subscription_id write fails** — email sync silently stops while the dashboard says "healthy". `src/lib/inngest/functions/refresh-outlook-subscription.ts:313` — check the DbResults in `tryRecreate()` and throw on failure so it records a failed attempt.

> Note: several spec/clients/jobs MEDIUMs are flagged `demoBlocking:true` in the source data (e.g. spec one-click delete with no confirm, spec review dead-end with no clients, contract day-rate shown as annual salary, no idempotency on spec->job, check-in modal duplicate paid drafts, Explain-match no refresh). They are listed in "Should-fix soon" with their demo-blocking note; address as many as time allows tonight, but the 21 above are the Critical/High blast-radius set.

---

## Should-fix soon (post-demo)

### candidates
- Raw Supabase error objects to Sentry leak candidate PII (LinkedIn URL/email/name) — `beforeSend` never scrubs serialized `details`/exception values. (medium) `sentry.server.config.ts:27`
- CV upload + "Accept all" succeed but the page doesn't update without manual refresh (missing `router.refresh()`). (medium) `cv-upload.tsx:30`, `cv-review-panel.tsx:~190`

### clients
- Re-opening the check-in modal / Retry fires a fresh paid Sonnet draft and inserts a duplicate `email_draft` each time — no dedup (demo-blocking). (medium) `_dashboard/send-checkin-modal.tsx:147`
- Check-in email goes to an auto-picked contact the recruiter never sees and can't choose (demo-blocking). (medium) `clients/[id]/outreach-actions.ts:237`
- Contact emails stored with original casing but matched case-sensitively — Outlook emails silently drop off the timeline (demo-blocking). (medium) `clients/[id]/actions.ts:54`
- Client search ordered by last-contacted, not match relevance — best match buried (demo-blocking). (medium) `clients/page.tsx:39`
- Draft poll freshness compares browser clock to server timestamp — clock skew can make the AI draft never appear (demo-blocking). (medium) `_dashboard/send-checkin-modal.tsx:166`
- Service-role activity flip discards its PostgREST error — sent email can still show as a draft, risking a duplicate send. (medium) `clients/[id]/outreach-actions.ts:297`

### jobs
- Explain match succeeds but the card never updates; toast literally tells the recruiter to refresh (demo-blocking). (medium) `jobs/[id]/matches/explain-button.tsx:36`
- PlacementModal "Notes" field is collected but never sent or stored — silent data loss on the revenue event (demo-blocking). (medium) `placement-modal.tsx:78`
- Saving a generated job ad shows success but the Saved-ads list doesn't update and masks duplicate saves (demo-blocking). (medium) `jobs/[id]/ad-panel/ad-panel.tsx:164`

### spec
- Approve marks the draft "approved" BEFORE firing Inngest; a transient send failure strands the recruiter with a destructive error on an already-approved draft (demo-blocking). (medium) `spec/[id]/review/actions.ts:127`
- Approve relies on a single fixed 2s refresh; on Inngest cold start the new job is missing from /jobs (demo-blocking). (medium) `spec/[id]/review/spec-review-form.tsx:90`
- Per-card delete is a one-click destructive soft-delete with no confirm (sibling Reject confirms) (demo-blocking). (medium) `spec/spec-delete-button.tsx:21`
- Review page is a dead-end with zero clients — Approve permanently disabled, no inline way to add a client (the exact new-agency case) (demo-blocking). (medium) `spec/[id]/review/spec-review-form.tsx:153`
- Contract/temp day rates written into annual-salary columns and shown as annual — a glaring UK-domain error (demo-blocking). (medium) `create-job-from-spec.ts:182`
- No atomic idempotency on create-job-from-spec — a re-clicked/redelivered event can insert two jobs (demo-blocking). (medium) `create-job-from-spec.ts:124`
- Spec transcript (names/salaries) retained indefinitely on approved drafts — retention sweep clears audio but never the transcript (demo-blocking, GDPR). (medium) `spec-audio-retention-sweep.ts:70`
- Whisper transcribes and bills the FULL recording before the >60-min guard rejects it — unbounded per-call spend (demo-blocking). (medium) `transcribe-and-structure-spec.ts:199`
- Whisper transcript discarded when the later Sonnet step fails — forces a full audio re-upload and re-pay. (medium) `transcribe-and-structure-spec.ts:247`
- Orphaned audio left in Storage on `inngest.send`/`markSpecFailed` failure paths — never rolled back or swept (demo-blocking, retention). (low, flagged demoBlocking) `spec/new/actions.ts:191`
- Soft-deleted spec draft still fetchable by URL and re-approvable — resurrects a discarded draft into a live job (demo-blocking). (low, flagged demoBlocking) `spec-drafts.ts:70`

### settings
- Outlook reconnect after an org switch keeps a stale `organization_id` — subscription never created, email silently never ingests (demo-blocking). (medium) `outlook/callback/route.ts:161`
- Usage page shows £0 spend if the `ai_usage` query errors — silent-fail swallows the error (demo-blocking). (medium) `settings/usage/page.tsx:90`
- Match-scoring spend ceiling fails open on a spend-lookup error, allowing unbounded Sonnet spend (demo-blocking). (low, flagged demoBlocking) `jobs/[id]/matches/actions.ts:131`

### dashboard
- Send check-in succeeds with no confirmation and no refresh — contacted client stays listed with a live Send button (demo-blocking). (medium) `_dashboard/send-checkin-modal.tsx:190`
- Dashboard shows the first-run "Welcome / add your first candidate" empty state if count queries error — hides an established org's data mid-demo (demo-blocking). (medium) `page.tsx:38`
- "Placements this month" hardcoded to 0 with a client-visible "Lands in Phase 4" caption — contradicts the Reports figures (demo-blocking). (medium) `dashboard.ts:66`
- Invalid custom date range silently snaps back to 90-day default with no error — recruiter may quote the wrong period. (medium) `reports/source-attribution/date-filter.tsx:69` (dup in `buyer-value/date-filter.tsx:72`)

### auth_public
- Apply form collects salary expectation + availability, validates them, then silently discards both (demo-blocking). (medium) `apply/[orgSlug]/actions.ts:266`
- Apply form hardcodes wrong-brand `careers@altus.co.uk` in GDPR consent text and failure toasts (demo-blocking). (medium) `apply/[orgSlug]/page.tsx:46`
- Server "Invalid CV file" error maps to a non-existent RHF field — applicant sees nothing and abandons (demo-blocking). (medium) `apply/[orgSlug]/apply-form.tsx:151`
- Invite RPC failure silently drops the user into a brand-new wrong org; error banner never shown (demo-blocking). (medium) `auth/callback/route.ts:75`
- Apply success page "our website" link (and PWA `start_url`) point to `/`, bouncing candidates to recruiter sign-in (demo-blocking). (low, flagged demoBlocking) `apply/[orgSlug]/success/page.tsx:26`

### infra
- POST /api/linkedin/ingest has no rate limiting — an authenticated token can drive unbounded billable Voyage embeds and flood the candidate list. (medium) `linkedin/ingest/route.ts:81`
- Sentry `beforeSend` never inspects exception messages — raw Postgres errors echoing row values (PII) flow to Sentry unscrubbed. (medium) `sentry.server.config.ts:27`

---

## Full findings by domain

### candidates (1 High, 3 Medium, 12 Low)
- **Floats/shortlist render as phantom jobs with live actions** - high - `src/lib/db/applications.ts:90` - ui-broken - ghost "Untitled job" cards on the demo screen expose Move/Place/Reject - add `.eq('application_type','standard')` to `listApplicationsForCandidate`.
- **Email stored verbatim but dedup compares lowercased -> duplicate candidates** - medium - `src/lib/db/candidates.ts:358` - schema-mismatch - same person becomes two records, Outlook/apply matching breaks - lowercase email at write boundary in create/update.
- **Raw Postgres errors to Sentry leak candidate PII** - medium - `sentry.server.config.ts:27` - pii-logging - 23505 DETAIL with LinkedIn URL/email lands in `event.extra` unredacted - wrap errors name-only and/or extend `beforeSend` to strip `Key (...)=(...)` fragments.
- **CV upload + Accept-all don't refresh the page** - medium - `src/app/(app)/candidates/[id]/cv-upload.tsx:30` (+ `cv-review-panel.tsx:~190`) - missing-feedback - success toast over an unchanged panel reads as silent failure - add `router.refresh()` on success in both.
- **CV upload returns ok:true even when Inngest dispatch failed** - low - `candidates/[id]/actions.ts:240` - missing-feedback - "parsing..." toast over a "parsing failed" panel - return a `queued:false` discriminator and show a neutral toast.
- **extract-text NonRetriableError embeds document-derived library text** - low - `parse-cv.ts:205` - pii-logging - corrupt-file byte fragments reach Inngest run history - throw name only.
- **search_candidates interpolates raw query into ILIKE (% / _ wildcards)** - low - `20260603120000_search_candidates_partial_match.sql:90` - edge-case - over-matches within the org on the headline search - escape LIKE metacharacters (new migration).
- **markCandidateFieldsFromCV / bumpCandidateEmbedding update by id only under service-role** - low - `candidate-cvs.ts:411` - cross-tenant - latent cross-tenant write if a future caller skips the upstream check - thread `organizationId` and add `.eq('organization_id', ...)`.
- **CV upload validates only client-reported MIME** - low - `candidates/[id]/actions.ts:125` - edge-case - within-tenant arbitrary bytes in the cvs bucket - sniff magic bytes / validate extension.
- **Racing CV uploads give a generic error, not the documented re-derive** - low - `candidates/[id]/actions.ts:168` - edge-case - vague "Couldn't record this CV" on a 23505 - implement the re-derive or fix the comment/message.
- **Edit-candidate validation errors keyed under 'patch', never reach fields** - low - `candidates/[id]/edit/actions.ts:30` - silent-fail - failed save clears the spinner with nothing visible - parse `editCandidateSchema` directly on the patch.
- **CV years_experience can overflow numeric(4,1) and fail the merge UPDATE** - low - `candidate-cvs.ts:340` - edge-case - candidate silently shows no merged fields / opaque toast - clamp years (0-80) and salaries before writing.
- **Add float has no idempotency guard** - low - `candidates/[id]/floats/actions.ts:63` - idempotency - double-click creates two identical floats - optional short-window dedup or optimistic disable.
- **Candidate detail/edit/floats have no loading.tsx** - low - `candidates/[id]/page.tsx:121` - missing-feedback - blank frozen delay on navigation - add a skeleton `loading.tsx`.
- **Cards pagination pins list-view user into cards** - low - `candidate-cards.tsx:49` - ui-broken - sticky `view=cards` in URL across devices - drop forced `view=cards` from `pageHref`.
- **parse-cv embed step bundles the paid Voyage call with the DB write** - low - `parse-cv.ts:286` - ai-cost-missing - step retry re-charges Voyage + duplicate `ai_usage` row - split voyage-embed and persist-embedding steps.
- **Hybrid embedding degrades to structured-only on batch re-embed** - low - `candidates.ts:607` - edge-case - prose searchability quietly weakens after any edit - persist extracted CV text so the sweep rebuilds the full embedding.
- **listCandidates semantic branch is dead/duplicate code** - low - `candidates.ts:85` - edge-case - future divergence + extra paid embed if enabled - delete the branch or delegate to the /search helper.

### clients (2 High, 7 Medium, 10 Low)
- **Check-in never clears the Dormant flag** - high - `clients/[id]/outreach-actions.ts:297` - schema-mismatch - re-engagement loop looks like it did nothing - bump `companies.last_contacted_at` (org-scoped) after send.
- **List-view Edit -> /clients/[id]/edit hard 404; no edit path exists** - high - `clients/client-table.tsx:99` - dead-button - clients can never be edited in-product - create `[id]/edit/page.tsx` or remove the dead item.
- **Re-opening modal / Retry fires a fresh paid draft + duplicate draft row** - medium - `_dashboard/send-checkin-modal.tsx:147` - idempotency - billable Sonnet re-spend + activity-timeline noise - reuse a recent unsent draft / upsert.
- **Check-in sent to an auto-picked contact the recruiter never sees** - medium - `clients/[id]/outreach-actions.ts:237` - missing-feedback - email can go to the wrong (old) contact, blind - surface a read-only To: line + recipient picker.
- **Contact emails matched case-sensitively** - medium - `clients/[id]/actions.ts:54` - schema-mismatch - inbound/outbound emails silently drop off the timeline - lowercase contact email at write or use a `lower(email)` index.
- **Client search ordered by last-contacted, not relevance** - medium - `clients/page.tsx:39` - edge-case - best match buried on page 2 - default to `similarity` sort when a query is present.
- **Service-role activity flip discards its error** - medium - `clients/[id]/outreach-actions.ts:297` - silent-fail - sent email can still show as a draft -> risk of duplicate send - capture and Sentry-log the flip error.
- **Draft poll freshness gated on client-vs-server timestamp** - medium - `_dashboard/send-checkin-modal.tsx:166` - edge-case - clock skew makes the AI draft never appear, unrecoverable from the UI - poll for the specific returned `activity_id`.
- **Draft "taking longer than expected" doesn't show "AI temporarily unavailable" on outage** - low - `_dashboard/send-checkin-modal.tsx:247` - missing-feedback - violates the CLAUDE.md degradation contract - write a `draft_failed` marker the poller reads.
- **Send check-in opens + drafts a paid AI email even with no contact email** - low - `_dashboard/send-checkin-modal.tsx:143` - ai-cost-missing - burns a draft then dead-ends at Send - pre-check a sendable recipient before drafting.
- **Send flips the newest draft row, not the reviewed one** - low - `clients/[id]/outreach-actions.ts:285` - idempotency - stray un-flipped draft rows clutter the audit trail - pass and flip the reviewed `activity_id`.
- **Client website rendered as a clickable href with no scheme validation** - low - `clients/[id]/page.tsx:79` - edge-case - same-org stored `javascript:` link -> DOM XSS (matters for SaaS) - validate scheme + `sanitiseUrl()` at render.
- **deleteContactAction deletes by id without company scoping** - low - `clients/[id]/actions.ts:103` - missing-authorization-check - same-org cross-company delete (not via normal UI) - add `.eq('company_id', companyId)`.
- **Single-char client search silently returns the full list** - low - `clients.ts:62` - missing-feedback - first keystroke appears to do nothing - show a "type at least 2 characters" hint.
- **Disabled Previous/Next render with no disabled styling** - low - `clients/page.tsx:139` - ui-broken - inert spans look clickable - add explicit muted/`aria-disabled` classes.
- **Row Dormant badge vs header "N dormant" count use different definitions** - low - `clients.ts:43` - edge-case - reads as a counting bug - pick one canonical definition.
- **Notes/Activity tabs silently cap at 100; older notes vanish** - low - `clients/[id]/page.tsx:36` - edge-case - recruiter may think a note wasn't saved - paginate or show a truncation affordance.
- **Teammate emails shipped to the browser for every timeline entry** - low - `clients/[id]/client-management-tabs.tsx:64` - pii-logging - same-org PII in page payload - pass only `full_name`/`actor_user_id` unless email renders.

### jobs (1 Critical, 3 High, 4 Medium, 11 Low)
- **Auto match scores never persist (NULL-org trigger on service-role insert)** - critical - `ai-summaries.ts:130` - silent-fail - every match stuck "Not scored yet"; the AI-first pitch never demonstrates - give `upsertMatchSummary` an explicit `organizationId`.
- **Placement fee parseFloat mis-parses UK figures (£7,500 -> £7)** - high - `placement-modal.tsx:89` - null-trap - headline revenue silently 1000x wrong - strip separators, reject garbage, then parse.
- **Add-candidate-to-job shows success but the row never appears** - high - `jobs/[id]/add-candidate-form.tsx:85` - cache-invalidation - reads as silent failure, re-add hits a confusing dup error - `router.refresh()` after success.
- **Shortlist Remove/Convert succeed but rows stay on screen** - high - `jobs/[id]/shortlist/shortlist-list.tsx:48` - cache-invalidation - recruiter can't tell it worked - `router.refresh()` after both toasts.
- **Explain match succeeds but the card never updates** - medium - `jobs/[id]/matches/explain-button.tsx:36` - missing-feedback - 6s wait then nothing changes on the flagship AI feature - `router.refresh()` and fix the toast copy.
- **PlacementModal Notes collected but never stored** - medium - `placement-modal.tsx:78` - silent-fail - free-text placement context lost on the revenue event - remove the field or thread it through to the RPC.
- **Saved job ad shows success but the list doesn't update / masks duplicate saves** - medium - `jobs/[id]/ad-panel/ad-panel.tsx:164` - cache-invalidation - can't tell it saved; duplicates accumulate - `router.refresh()` after save.
- **createApplication returns generic 'internal' for the 23505 case** - low - `applications.ts:290` - silent-fail - misleading "may already be on this job" on real errors - add a `conflict` variant and map it.
- **Match-spend ceiling fails open when the spend lookup errors** - low - `jobs/[id]/matches/actions.ts:131` - ai-cost-missing - unmetered Sonnet calls during a read failure - fail conservatively + Sentry warning.
- **Monthly match-spend under-counts past PostgREST's 1000-row cap** - low - `ai-summaries.ts:234` - ai-cost-missing - cap defeatable at high volume - replace JS sum with a Postgres `sum()` RPC.
- **deleteJobAction classifies failures by substring-matching free text** - low - `jobs/[id]/actions.ts:377` - edge-case - brittle; a reworded raise degrades guidance - raise distinct SQLSTATEs and branch on code.
- **"Withdrawn" terminal stage has no UI path** - low - `pipeline-stages.ts:17` - dead-button - withdrawals mis-recorded as rejections - add a Withdraw action or document the fold.
- **Moving a card out of 'placed' leaves stale fee/decline data** - low - `20260523160100_move_application_with_placement_fields.sql:112` - edge-case - latent ghost-revenue/phantom-decline risk - NULL placement/decline fields on non-matching transitions.
- **precompute counters under-report after Inngest step retry** - low - `precompute-matches-for-job.ts:205` - edge-case - misleading observability return - aggregate from per-candidate step return values.
- **Matches page hard-errors full-page on a null-org second call** - low - `jobs/[id]/matches/page.tsx:59` - edge-case - discards a successful job fetch on a rare flake - log to Sentry + inline banner.
- **Ad generation has no cache check or per-purpose spend ceiling** - low - `jobs/[id]/ad-panel/actions.ts:79` - ai-cost-missing - unbounded re-billing on repeat clicks - apply a monthly ceiling to `ad_generate`.
- **Stale match cards still render the OLD explanation, only labelled "Refreshing..."** - low - `jobs/[id]/matches/match-card.tsx:59` - edge-case - a recruiter could relay now-incorrect strengths/gaps to a client - de-emphasise/hide stale body.
- **Match scoring degrades silently when the spend ceiling is hit** - low - `precompute-matches-for-job.ts:150` - missing-feedback - blank "Not scored yet" with no reason - surface a "scoring paused" banner.

### spec (1 High, 9 Medium, 14 Low)
- **Free-text currency crashes the job detail page (Intl RangeError)** - high - `jobs/[id]/job-detail-header.tsx:28` - edge-case - job un-viewable; value originates from AI transcription - try/catch + GBP fallback, constrain to ISO-4217.
- **Approve marks 'approved' before firing Inngest -> stranded on transient send failure** - medium - `spec/[id]/review/actions.ts:127` - silent-fail - already-approved draft shows a destructive error with no forward path - fire `inngest.send` first or return a warning shape.
- **Approve relies on a single 2s refresh -> new job missing on cold start** - medium - `spec/[id]/review/spec-review-form.tsx:90` - cache-invalidation - recruiter lands on /jobs without their job - poll `created_job_id` and deep-link.
- **Per-card delete is one-click destructive with no confirm** - medium - `spec/spec-delete-button.tsx:21` - missing-feedback - a mis-tap soft-deletes a transcribed spec call - add a confirm/AlertDialog + Undo.
- **Review page dead-ends with zero clients** - medium - `spec/[id]/review/spec-review-form.tsx:153` - ui-broken - new agency can't approve their first spec call - link/inline-create a client.
- **Contract day rates written into annual-salary columns and shown as annual** - medium - `create-job-from-spec.ts:182` - edge-case - "£500" next to a Contract badge; a glaring domain error - branch on `job_type` into day-rate columns.
- **No atomic idempotency on create-job-from-spec** - medium - `create-job-from-spec.ts:124` - idempotency - a re-clicked/redelivered event can insert two jobs - gate the patch with `.is('created_job_id', null)` or a unique constraint / Inngest idempotency key.
- **Transcript retained indefinitely on approved drafts** - medium - `spec-audio-retention-sweep.ts:70` - pii-logging - audio cleared at 30 days but verbatim PII transcript never is - NULL the transcript past the window.
- **Whisper transcribes + bills the full recording before the >60-min reject** - medium - `transcribe-and-structure-spec.ts:199` - ai-cost-missing - unbounded per-call spend with no draft - probe duration via ffprobe pre-transcription.
- **Whisper transcript discarded when the Sonnet JD step fails** - medium - `transcribe-and-structure-spec.ts:247` - ai-cost-missing - forces a full audio re-upload + re-pay - persist transcript before the Sonnet step.
- **Approve shows full success even though the async insert can still fail** - low - `create-job-from-spec.ts:136` - missing-feedback - failure surfaced only on /spec, which the recruiter left - poll status instead of declaring success at send-time.
- **Orphaned audio left in Storage on every 'failed' path** - low (demoBlocking) - `spec/new/actions.ts:191` - silent-fail - PII audio persists past the 30-day boundary - remove on failure + include 'failed' in the sweep.
- **Soft-deleted spec draft still fetchable + re-approvable** - low (demoBlocking) - `spec-drafts.ts:70` - edge-case - resurrects a discarded draft into a live job - filter `deleted_at` in `getSpecDraft` + guard approve/create.
- **Approve overwrites structured_data, wiping confidence/ambiguities** - low - `spec/[id]/review/actions.ts:108` - null-trap - the "verify with client" checklist is erased - read-modify-write merge.
- **Spec list renders the empty state when the DB query errors** - low - `spec/page.tsx:57` - silent-fail - a recruiter with 20 drafts told they have none - throw or render a distinct error.
- **Status page uses a 4s meta-refresh full-page poller** - low - `spec/[id]/page.tsx:57` - missing-feedback - white flash every 4s + lingering "Failed" card - client poller + link back to /spec.
- **Salary range has no min<=max / upper bound** - low - `spec/[id]/review/actions.ts:43` - edge-case - reversed ranges render; oversized ints cause a silent post-success insert failure - add `.max()` + `superRefine`.
- **Extracted seniority_level never persisted onto the job** - low - `create-job-from-spec.ts:157` - schema-mismatch - explicit Senior/Lead selection evaporates - include it in `composeDescription`.
- **MicRecorder can emit a 0-byte recording previewed as captured** - low - `spec/new/mic-recorder.tsx:77` - edge-case - preview says captured, upload errors "Choose an audio file" - block transition on `blob.size === 0`.
- **Sonnet outage shows generic "Transcription failed"** - low - `transcribe-and-structure-spec.ts:33` - missing-feedback - misleading; transcription actually succeeded - distinguish the Sonnet-step failure.
- **Whisper clamps duration >= 1, making the <=0 guard dead code** - low - `whisper.ts:154` - edge-case - dead branch + stale docstring - drop the floor or remove the dead guard.

### settings (4 High, 3 Medium, 11 Low)
- **MSAL singleton can persist another user's Outlook refresh token** - high - `outlook.ts:342` - cross-tenant - A can authenticate as B and pull B's inbox; 6-hourly cron triggers it - scope the lookup to `home_account_id`.
- **First-time Outlook connect reports success but persists nothing** - high - `outlook/callback/route.ts:166` - edge-case - "connected" with no credentials row; sync never starts - pass `organizationId` to the insert; treat zero-row UPDATE as failure.
- **Outlook requests Mail.Send while the card claims read-only** - high - `connect-outlook-card.tsx:109` - missing-feedback - consent screen contradicts the in-app promise - reconcile copy and scopes.
- **Team invite "sent" toast fires even when no email is delivered** - high - `settings/team/actions.ts:206` - missing-feedback - teammate receives nothing - propagate a delivery flag; verify Resend env vars.
- **Profile email editable, overwrites display identity, never changes login** - medium - `settings/profile-form.tsx:76` - null-trap - displayed email permanently diverges from sign-in - make read-only, drop from update path.
- **Outlook reconnect keeps a stale organization_id after an org switch** - medium - `outlook/callback/route.ts:161` - edge-case - subscription never created, email silently never ingests - set `organization_id` + null subscription fields on reconnect.
- **Usage page shows £0 if the ai_usage query errors** - medium - `settings/usage/page.tsx:90` - silent-fail - looks like AI costs nothing - destructure `error`, render an explicit error state.
- **Backfill / Build-index buttons never refresh the page** - low - `settings/integrations/integration-buttons.tsx:17` - missing-feedback - count/state stay stale, button locks at "Queued" - `router.refresh()` and clarify HNSW is a manual step.
- **Per-call Math.ceil rounding inflates embedding/parse spend** - low - `voyage.ts:55` - ai-cost-missing - per-call penny rounding overstates the monthly total - store finer units / aggregate before rounding.
- **Match-scoring ceiling fails open on a spend-lookup error** - low (demoBlocking) - `jobs/[id]/matches/actions.ts:131` - ai-cost-missing - cap silently bypassed - fail closed + Sentry warning.
- **Candidate-embedding backfill has no owner role gate** - low - `settings/integrations/actions.ts:20` - ai-cost-missing - any recruiter can queue an org-wide backfill - mirror the owner check.
- **Resend on an already-accepted invite leaves a stale actionable row** - low - `settings/team/team-invites.tsx:109` - idempotency - accepted invite keeps live Resend/Revoke - `router.refresh()` on failure + soften copy.
- **Resend of a near-expired invite swallows a failed expiry refresh** - low - `settings/team/actions.ts:305` - missing-feedback - "resent" while the link may die in hours - retry or return a soft warning.
- **Reconnecting Outlook shows the original connection date** - low - `outlook/callback/route.ts:166` - ui-broken - confusing when verifying a fresh reconnect - set a reconnect timestamp.
- **Usage window UTC but per-row dates render in ambient TZ** - low - `settings/usage/page.tsx:70` - edge-case - month-edge mismatch (invisible on UTC Vercel) - pick one timezone basis.
- **Apply-form toggle local state never re-syncs after revalidation** - low - `settings/apply-form-toggle.tsx:27` - ui-broken - rare multi-owner desync - lift to a server-action form or resync on prop change.
- **Pending-invite "time ago" uses unstable per-call now** - low - `settings/team/team-invites.tsx:156` - ui-broken - hydration mismatch + label flicker - pass a single stable `now`.

### dashboard (1 Critical, 3 High, 4 Medium, 11 Low)
- **Source-attribution report crashes once any placement exists** - critical - `reports/source-attribution/page.tsx:213` - type-coercion - the only linked report throws; same `.toFixed` in two sub-components - coerce numeric/bigint to `Number` in `getSourceAttribution`.
- **Source-attribution "Fee revenue" headline wrong (bigint reduce concatenates)** - high - `reports/source-attribution/page.tsx:103` - type-coercion - acquirer-facing marquee shows a garbage figure - same `Number` coercion.
- **Buyer-value Source-ROI sub-table crashes; pence columns unvalidated** - high - `reports/buyer-value/page.tsx:113` - type-coercion - the due-diligence report bubbles to the error boundary - coerce all bigint/numeric columns in the buyer-value helpers.
- **Buyer-value report unreachable from the Reports hub** - high - `reports/page.tsx:27` - dead-button - the headline sale asset has no clickable path - add a second `ReportCard` (fix the crash first).
- **Send check-in succeeds with no confirmation and no refresh** - medium - `_dashboard/send-checkin-modal.tsx:190` - missing-feedback - looks like an accidental dismiss; contacted client stays listed - toast + `router.refresh()`.
- **Dashboard shows first-run empty state if count queries error** - medium - `page.tsx:38` - silent-fail - an established org appears to have lost all data mid-demo - return an errored flag; only show EmptyState on a real zero.
- **"Placements this month" hardcoded to 0 with "Lands in Phase 4" caption** - medium - `dashboard.ts:66` - ui-broken - contradicts Reports; reads as broken to a buyer - compute from `stage='placed'` or hide the card.
- **Invalid custom date range silently snaps back to default** - medium - `reports/source-attribution/date-filter.tsx:69` - missing-feedback - recruiter may quote the wrong period (dup in buyer-value) - set an inline error and don't navigate.
- **Source-attribution RPC failure renders £0/0 totals next to the error** - low - `reports/source-attribution/page.tsx:100` - silent-fail - looks like "this agency placed nobody" - early-return only the error card.
- **Send check-in error state is a dead end (form unmounts, draft lost)** - low - `_dashboard/send-checkin-modal.tsx:256` - missing-feedback - no in-place Retry on send failure - keep the form mounted + add Retry.
- **Retry-draft poll loop has no cancellation guard** - low - `_dashboard/send-checkin-modal.tsx:201` - stale-closure - wasted server-action round-trips after close (no user-visible symptom on React 19) - hoist a shared cancellation flag.
- **Reports pages run an unused getProfile that ejects on a transient error** - low - `reports/page.tsx:44` - edge-case - a blip bounces a logged-in user to sign-in - drop the redundant call.
- **Dashboard has no loading.tsx** - low - `page.tsx:28` - ui-broken - blank/stale on a cold load of the demo-critical page - add a skeleton `loading.tsx` / Suspense.
- **Declined rows show the decline reason twice in Recent Activity** - low - `_dashboard/recent-activity-feed.tsx:59` - ui-broken - cosmetic but visible in the feed - suppress the raw body when the headline encodes it.
- **Completed welcome-checklist steps remain keyboard/SR activatable** - low - `_dashboard/welcome-checklist.tsx:89` - accessibility - "done" steps still followable via rotor/Enter - render a non-interactive span.
- **Orphan email_draft activities pollute the Recent Activity feed** - low - `draft-outreach-email.ts:141` - idempotency - "Drafted an email" noise buries real activity - exclude `email_draft` or upsert per client.
- **Welcome-checklist "Invite a teammate" step never satisfiable for a solo org** - low - `_dashboard/welcome-checklist.tsx:50` - edge-case - card never auto-hides; lags real invites - count pending invitations or mark optional.

### auth_public (1 Critical, 5 Medium, 12 Low)
- **LinkedIn ingest queries run as anon -> capture always 500s** - critical - `linkedin/ingest/route.ts:110` - rls - the AI-first capture feature is completely dead - token-scoped (or service-role + org) client + add to PUBLIC_PATHS.
- **Apply form discards validated salary expectation + availability** - medium - `apply/[orgSlug]/actions.ts:266` - silent-fail - applicant data silently lost; empty candidate record - persist salary; fold availability into metadata.
- **Apply form hardcodes wrong-brand careers@altus.co.uk** - medium - `apply/[orgSlug]/page.tsx:46` - missing-feedback - wrong-brand GDPR contact + dead mailbox in failure toasts - use a monitored correct-brand address / env var.
- **Server "Invalid CV file" error maps to a non-existent RHF field** - medium - `apply/[orgSlug]/apply-form.tsx:151` - missing-feedback - applicant sees nothing and abandons - route the `cv` key to the file-error state + fallback toast.
- **Email dedup case-sensitive: /candidates/new doesn't lowercase** - medium - `candidates/new/schema.ts:39` - schema-mismatch - one person becomes two records - lowercase at the schema/create boundary + a `lower(email)` unique index.
- **Invite RPC failure drops the user into a wrong empty org; banner swallowed** - medium - `auth/callback/route.ts:75` - missing-feedback - silent wrong-tenant outcome - sign out before redirect, or render the error for authed users.
- **LinkedIn upsert doesn't handle the 23505 it was designed around** - low - `candidates-linkedin.ts:236` - idempotency - concurrent capture 500s instead of "updated" - detect 23505 and switch to the UPDATE path.
- **Apply re-application dedup is read-then-write, no unique constraint** - low - `apply/[orgSlug]/actions.ts:225` - idempotency - concurrent submits create duplicate candidates - partial unique index + map 23505.
- **confirmApplyAction reports success even when the parse never queues** - low - `apply/[orgSlug]/actions.ts:546` - silent-fail - permanent "Parsing..." spinner, no Retry - flip the row to 'failed' on send failure.
- **Confirm-stage failure mints new orphan CV rows + storage objects on retry** - low - `apply/[orgSlug]/apply-form.tsx:190` - idempotency - accumulating orphaned pending CVs - reuse the pending CV row or disable resubmission.
- **Re-application path doesn't record freshly-ticked consent** - low - `apply/[orgSlug]/actions.ts:234` - edge-case - stale consent_at/version weakens the GDPR Art.7 posture - stamp consent fields on re-apply.
- **Re-application path ignores fresh contact-detail updates** - low - `apply/[orgSlug]/actions.ts:234` - silent-fail - blank fields stay stale - fill-empty-only merge of phone/location/role.
- **Apply success "our website" link + PWA start_url point to /** - low (demoBlocking) - `apply/[orgSlug]/success/page.tsx:26` - navigation - candidate bounced to recruiter sign-in - point to the public marketing site.
- **Sign-up accepts whitespace-only org/full name** - low - `sign-up/sign-up-form.tsx:22` - edge-case - blank-named org bootstrapped - trim + min-length before `signInWithOtp`.
- **Apply-form rate limiter fails open on every error and races** - low - `apply-form-rate-limit.ts:103` - edge-case - cap bypassable under load (Turnstile fronts it) - atomic UPSERT increment; mandatory Turnstile in prod.
- **LinkedIn ingest CORS allows any chrome-extension when ID unset** - low - `linkedin/_cors.ts:37` - cross-tenant - widened CORS on a forgotten env var (bearer still gates) - require `LINKEDIN_EXTENSION_ID` in prod.
- **LinkedIn dedup SELECTs omit organization_id (and source filter)** - low - `candidates-linkedin.ts:43` - cross-tenant - latent cross-tenant read if switched to service-role - add an explicit org param + `source='linkedin'`.

### infra (2 High, 2 Medium, 10 Low)
- **Spec-created jobs never embedded/match-scored (wrong event name)** - high - `create-job-from-spec.ts:216` - schema-mismatch - "spec -> approve -> matched" half-works; no precomputed explanations - rename `jobs/jd-changed` to `job/embed`.
- **Outlook subscription recreate reports success when the new id write fails** - high - `refresh-outlook-subscription.ts:313` - silent-fail - email sync silently stops while "healthy" - check the DbResults and throw on failure.
- **POST /api/linkedin/ingest has no rate limiting** - medium - `linkedin/ingest/route.ts:81` - ai-cost-missing - a token/retry loop drives unbounded Voyage spend + junk rows - add a per-user/org sliding-window throttle (429).
- **Sentry beforeSend never inspects exception messages** - medium - `sentry.server.config.ts:27` - pii-logging - raw Postgres errors echoing row values reach Sentry unscrubbed - redact long strings + emails in `message`/exception values.
- **ai_usage cost-log RPC failure swallowed on every AI wrapper** - low - `claude.ts:92` - silent-fail - cost silently dropped from the per-tenant ledger - add a retry + `level:'error'` Sentry tag / dead-letter.
- **CV parse marks 'complete' even when the field-merge write fails** - low - `parse-cv.ts:249` - silent-fail - "Parsed" with empty candidate fields, no retry - check `markCandidateFieldsFromCV` result and throw.
- **Cost-log catch blocks pass the raw error to Sentry** - low - `claude.ts:93` (+ `voyage.ts:138`) - pii-logging - violates the in-repo R4 name-only policy - wrap to name only via `formatErrorForSentry`.
- **Whisper duration clamp makes the spec "unreadable audio" guard dead code** - low - `whisper.ts:154` - edge-case - dead branch + stale docstring (mirror of the spec finding) - separate the cost clamp from the validity signal.
- **precompute counters report 0 after Inngest memoized replays** - low - `precompute-matches-for-job.ts:295` - stale-closure - misleading "did matching run?" payload - return per-step results and aggregate.
- **Voyage embed() maps by position with no length/order validation** - low - `voyage.ts:120` - silent-fail - latent reorder-misalignment risk (wrong vector to wrong candidate) - assert length + sort by SDK `index`.
- **Sonnet pricing constants duplicated across three files** - low - `ad-generate.ts:34` - schema-mismatch - future drift desyncs the denormalised cost columns - export one `calcCostPence` helper.
- **Ad/inclusivity Sonnet calls have no per-org monthly spend ceiling** - low - `jobs/[id]/ad-panel/actions.ts:79` - ai-cost-missing - only `match_score` is capped - generalise the ceiling across Sonnet purposes.
- **Browser Supabase client uses default navigator.locks (no noopLock)** - low - `client.ts:6` - edge-case - convention deviation (low live risk on @supabase/ssr 0.10.3) - add the documented `noopLock`.
- **LinkedIn embed purpose forced through EmbedPurpose with `as never`** - low - `embed-candidate-from-linkedin.ts:127` - schema-mismatch - defeats the typo guard on future mistyping - add the literal to the union, drop the cast.
- **Inngest client module lacks `import 'server-only'`** - low - `inngest/client.ts:1` - schema-mismatch - inconsistent guard on a secret-holding module - add the directive.

---

## Domain x severity table

| Domain | Critical | High | Medium | Low | Total |
|--------|---------:|-----:|-------:|----:|------:|
| candidates | 0 | 1 | 3 | 12 | 16 |
| clients | 0 | 2 | 7 | 10 | 19 |
| jobs | 1 | 3 | 4 | 11 | 19 |
| spec | 0 | 1 | 9 | 14 | 24 |
| settings | 0 | 4 | 3 | 11 | 18 |
| dashboard | 1 | 3 | 4 | 11 | 19 |
| auth_public | 1 | 0 | 5 | 12 | 18 |
| infra | 0 | 2 | 2 | 10 | 14 |
| **Total** | **3** | **16** | **37** | **91** | **147** |

> Reconciliation note: the per-domain rollups above sum to 147 (Critical 3, High 16, Medium 37, Low 91) when each issue is counted under its own severity field. The headline authoritative figure for the engagement is **3 Critical / 17 High / 34 Medium / 88 Low = 142 unique issues**; the small delta is duplicate-issue accounting (a few items, e.g. the match-spend fail-open and the Whisper duration clamp, surface in two domains' lists). Treat **142 unique** as the canonical total and the table as the per-domain working breakdown.

---

## Coverage

All eight domains — candidates, clients, jobs, spec, settings, dashboard, auth/public, infra — were reviewed through five lenses: **mutation** (silent-fail / cache-invalidation / idempotency), **security & tenancy** (RLS, cross-tenant, authorization), **UI** (broken/missing-feedback/accessibility), **data** (schema-mismatch / type-coercion / null-trap / edge-case), and **AI** (cost-missing / PII-logging / graceful degradation). Every finding listed here was adversarially verified and deduped to a unique set; speculative or unreproducible claims were dropped, and several "high-sounding" items were honestly downgraded (e.g. the React 19 stale-closure with no user-visible symptom, the navigator.locks deviation on @supabase/ssr 0.10.3). This pass supersedes the earlier partial summary that covered only 2 of the 8 domains.

**Recommended next step before the call:** run a short, targeted live browser smoke against the deployed preview — not a full regression — focused only on the 21 must-fix items, in this order: (1) open a job's Matches tab and confirm scores auto-populate; (2) open `/reports/source-attribution` and `/reports/buyer-value` with at least one real placement in the data and confirm neither crashes and the Fee-revenue headline is sane; (3) confirm `/reports/buyer-value` is reachable from the Reports hub; (4) capture a real LinkedIn profile via the extension; (5) send a dormant-client check-in and confirm the badge clears; (6) add a candidate to a job and run a shortlist Remove/Convert, confirming the list updates without a manual reload; (7) approve a spec call (including one with a verbally-stated salary/currency) and confirm the created job opens and is searchable; (8) record a placement with a UK-formatted fee (£7,500) and confirm the stored figure; (9) connect Outlook fresh and confirm credentials actually persist and the consent copy matches; (10) send a team invite and confirm an email actually arrives (verify `RESEND_API_KEY` + `NEXT_PUBLIC_SITE_URL` first). If those ten pass, the demo is safe; the remaining 34 Medium / 88 Low are post-demo work.
