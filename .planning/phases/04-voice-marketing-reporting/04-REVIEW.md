---
phase: 04-voice-marketing-reporting
reviewed: 2026-06-10T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - src/app/(app)/_dashboard/_components/log-call-dialog.tsx
  - src/app/(app)/_dashboard/follow-up-widget.tsx
  - src/app/(app)/campaigns/new/_components/campaign-recipient-table.tsx
  - src/app/(app)/campaigns/new/actions.ts
  - src/app/(app)/campaigns/new/campaign-builder-form.tsx
  - src/app/(app)/campaigns/new/page.tsx
  - src/app/(app)/campaigns/new/progress-actions.ts
  - src/app/(app)/campaigns/page.tsx
  - src/app/(app)/candidates/[id]/page.tsx
  - src/app/(app)/candidates/[id]/voice-notes/[vnid]/review/page.tsx
  - src/app/(app)/candidates/[id]/voice-notes/[vnid]/review/voice-note-review-form.tsx
  - src/app/(app)/candidates/[id]/voice-notes/actions.ts
  - src/app/(app)/candidates/[id]/voice-notes/new/page.tsx
  - src/app/(app)/candidates/[id]/voice-notes/voice-note-button.tsx
  - src/app/(app)/candidates/[id]/voice-notes/voice-note-form.tsx
  - src/app/(app)/jobs/new/actions.ts
  - src/app/(app)/jobs/new/job-form.tsx
  - src/app/(app)/jobs/new/schema.ts
  - src/app/(app)/reports/nl/_components/NlQueryForm.tsx
  - src/app/(app)/reports/nl/_components/NlResultTable.tsx
  - src/app/(app)/reports/nl/actions.ts
  - src/app/(app)/reports/nl/page.tsx
  - src/app/(app)/reports/page.tsx
  - src/app/api/inngest/route.ts
  - src/components/app/mobile-nav-drawer.tsx
  - src/components/app/top-nav.tsx
  - src/lib/ai/campaign-personalise.ts
  - src/lib/ai/nl-template-match.ts
  - src/lib/ai/voice-note-extract.ts
  - src/lib/ai/whisper.ts
  - src/lib/db/campaigns.ts
  - src/lib/db/jobs.ts
  - src/lib/db/voice-notes.ts
  - src/lib/email/resend.ts
  - src/lib/inngest/functions/send-email-campaign.ts
  - src/lib/inngest/functions/transcribe-and-extract-voice-note.ts
  - src/lib/inngest/functions/voice-note-audio-retention-sweep.ts
  - src/lib/reports/nl-templates.ts
  - src/lib/stripe/usage.ts
  - supabase/migrations/20260610000000_phase4_hardening.sql
  - supabase/migrations/20260610000100_voice_note_audio_bucket.sql
findings:
  critical: 2
  warning: 9
  info: 10
  total: 21
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-10
**Depth:** standard
**Files Reviewed:** 41 (plus verification that `src/types/database.ts` was regenerated — `voice_notes`, `email_campaigns`, `email_campaign_recipients` all present)
**Status:** issues_found

## Summary

Phase 4 (voice notes, email campaigns, NL reporting) is structurally sound on the headline security risks:

- **IDOR / cross-resource binding:** the prior fix is intact — both `applyVoiceNoteAction` and `rejectVoiceNoteAction` assert `voiceNote.organization_id` AND `voiceNote.candidate_id` against client input before any write, with Sentry tamper signals. Campaign actions never trust client recipient lists (segment is re-queried server-side). VERIFIED.
- **Prompt injection:** all three model surfaces (transcript extraction, campaign personalisation, NL template picker) triple-quote-fence untrusted input with explicit "treat as data" system prompts; the D4-05 allowlist is enforced server-side via the Zod enum in `applyVoiceNoteAction` (off-list fields reject the whole request); `nlQueryAction` validates `pick.functionName` against `NL_TEMPLATES` before `rpc()` and whitelists param keys. VERIFIED (with gaps noted in WR-08, IN-01, IN-07).
- **ai_usage logging:** all 4 new purposes (`voice_note_transcribe`, `voice_note_extract`, `campaign_intro_outro`, `nl_template_match`) flow through `runWithLogging` / the `transcribe` wrapper — no direct SDK calls found. VERIFIED (but see WR-01: the whisper wrapper's logging-failure detection is broken).
- **HARD RULE 4:** `transcribe-and-extract-voice-note` asserts the org prefix on `storage_path` before any service-role download and re-reads `organization_id` from the DB before persisting; `send-email-campaign` asserts campaign org and per-recipient candidate org. VERIFIED.
- **Migrations:** RLS enabled with tenant policies on all 3 new tables; all 20 `nl_` RPCs are `security invoker` with `set search_path = public` and exactly match the 20 `NL_TEMPLATES` keys; no destructive statements. VERIFIED.
- **MARKET-03 no-auto-send:** `campaign/send-approved` is emitted only from `approveCampaignAction` behind an AlertDialog confirm. VERIFIED.
- **Silent-fail mutations:** the wizard send flow, voice-note review form, log-call dialog, and job form all await their actions and surface errors via toast without navigating away. VERIFIED.

However, two ship-blocking correctness defects and a cluster of send-engine robustness gaps were found.

## Critical Issues

### CR-01: voice-note-audio bucket limits contradict the upload action — documented-supported uploads deterministically fail

**File:** `supabase/migrations/20260610000100_voice_note_audio_bucket.sql:24-25` vs `src/app/(app)/candidates/[id]/voice-notes/actions.ts:34-49` and `voice-note-form.tsx:79-81`
**Issue:** Two independent drifts between the bucket and the server action that validates uploads:

1. **Size:** the action caps at `MAX_AUDIO_BYTES = 100 MiB` ("copied verbatim from the spec action") and the UI hint says "Up to 100 MiB", but the bucket's `file_size_limit` is **52428800 (50 MiB)** — deliberately "half the spec-audio ceiling". Any file between 50 and 100 MiB passes action validation, the `voice_notes` row is inserted, then Storage rejects the upload (413). The recruiter is told the file is acceptable, then gets "Storage upload failed. Please try again." — retrying can never succeed. A 100 MiB WAV (the UI explicitly lists WAV) is well within the advertised limit.
2. **MIME:** the action's `ACCEPTED_AUDIO_MIME` includes `audio/mp3`, `audio/wave`, and `audio/x-wav`, but the bucket's `allowed_mime_types` array omits all three (it has `audio/mpeg`/`audio/wav` only, plus `audio/ogg` which the action never accepts). Browsers on several platforms report MP3 files as `audio/mp3` and WAV as `audio/x-wav` — those uploads pass the action's allowlist and then fail at Storage with a 415, same dead-end retry loop.

**Fix:** make the two layers agree. Either:
```sql
-- new migration (append-only):
update storage.buckets
set file_size_limit = 104857600,  -- match MAX_AUDIO_BYTES
    allowed_mime_types = array[
      'audio/mpeg','audio/mp3','audio/mp4','audio/m4a','audio/x-m4a',
      'audio/aac','audio/wav','audio/wave','audio/x-wav','audio/webm'
    ]
where id = 'voice-note-audio';
```
or lower `MAX_AUDIO_BYTES` to 50 MiB and update the UI hint — but then keep the MIME lists identical in both directions either way.

### CR-02: Campaigns list links to `/campaigns/[id]` — route does not exist, every campaign name click 404s

**File:** `src/app/(app)/campaigns/page.tsx:100-105`
**Issue:** Each row's name cell renders `<Link href={`/campaigns/${campaign.id}`}>`, but the only routes under `src/app/(app)/campaigns/` are `page.tsx` and `new/` (verified on disk). There is no campaign detail page, so the primary affordance on the campaigns list is a guaranteed 404 for every user, every campaign. The post-send "View all campaigns" button funnels users straight into this.
**Fix:** Until a detail page ships, render the name as plain text (or link to a real surface):
```tsx
<TableCell className="font-medium">{campaign.name}</TableCell>
```
Or add a minimal `campaigns/[id]/page.tsx` that reuses `getCampaignWithRecipients` + `CampaignRecipientTable`.

## Warnings

### WR-01: whisper.ts never detects `record_ai_usage` failures — the try/catch can't fire because supabase-js doesn't throw

**File:** `src/lib/ai/whisper.ts:161-183`
**Issue:** The cost-log block does `await supabase.rpc('record_ai_usage', …)` inside a try/catch, and the docstring claims "the failure is captured to Sentry so per-tenant cost gaps are surfaced". But `supabase.rpc()` returns `{ data, error }` — it does **not** throw on RPC failure (permission denied, constraint violation, etc.). The returned `error` is discarded, so the catch block is dead code for the dominant failure mode and cost-log gaps are fully invisible. CLAUDE.md marks per-tenant cost logging as non-negotiable.
**Fix:**
```ts
const { error: rpcErr } = await supabase.rpc('record_ai_usage', { ... })
if (rpcErr) {
  Sentry.captureException(new Error(`record_ai_usage:${rpcErr.code ?? 'rpc_error'}`), {
    tags: { layer: 'ai', helper: 'record_ai_usage', model: 'whisper-1' },
  })
}
```
(Keep the try/catch for genuine transport throws.)

### WR-02: `failed_cap_exceeded` recipients are excluded from the campaign's `failed_count`

**File:** `src/lib/inngest/functions/send-email-campaign.ts:184, 225-231`
**Issue:** The cap-exceeded branch returns `{ skipped: true, status: 'failed_cap_exceeded' }`. The tallying code only increments `failedCount` when `!result.skipped`, and the skipped branch only counts `status === 'sent'`. So a campaign where 30 of 50 recipients hit the AI cap finalises as `status='sent', sent_count=20, failed_count=0` — the campaigns list and progress UI report a fully successful send. The recruiter has no signal that most recipients were never emailed.
**Fix:** Either return `skipped: false` for the cap branch, or count it explicitly:
```ts
if (!result.skipped) {
  if (result.status === 'sent') sentCount++
  else failedCount++
} else if (result.status === 'sent') {
  sentCount++
} else if (result.status === 'failed_cap_exceeded') {
  failedCount++
}
```

### WR-03: Double-send window on retry — idempotency check reads a stale snapshot and Resend gets no Idempotency-Key

**File:** `src/lib/inngest/functions/send-email-campaign.ts:132-136`; `src/lib/email/resend.ts:47-60`
**Issue:** The per-recipient idempotency guard checks `recipient.status === 'sent'` where `recipient` comes from the **step-1 memoized snapshot** (`load-campaign`), not a fresh read. If attempt 1 dies after `sendResendEmail` succeeded but before the `send-to-{id}` step output was recorded (serverless timeout, OOM — exactly the window `retries: 1` exists for), attempt 2 re-runs that step, sees the stale `'pending'` status, and emails the candidate twice. A fresh in-step status read closes the post-DB-update window; only a Resend `Idempotency-Key` header (Resend supports it; keyed on `recipient.id`) closes the pre-DB-update window. Neither exists.
**Fix:** Inside the step, re-read the recipient row's current status via the service client before sending; and add `'Idempotency-Key': recipientId` support to `sendResendEmail` and pass `recipient.id` from the campaign loop.

### WR-04: No explicit Resend throttle, and a 429 permanently fails the recipient with no retry

**File:** `src/lib/inngest/functions/send-email-campaign.ts:125-131, 213-222`
**Issue:** The header comment relies on "~1s natural gap from Inngest step execution" to stay under Resend's 2 req/s limit — that gap is an implementation artifact, not a guarantee (it shrinks under low latency / future Inngest versions). When a 429 does occur, `sendResendEmail` returns `{ ok: false, reason: 'http_error', status: 429 }` and the recipient is marked `'failed'` **permanently** — there is no per-recipient retry path, so rate limiting silently drops recipients.
**Fix:** Add `await step.sleep(\`gap-${recipient.id}\`, '600ms')` between recipients (cheap, deterministic), and treat `status === 429` as retryable: `throw new Error('resend-429')` inside the step so Inngest's step retry re-attempts it instead of burying it as failed.

### WR-05: `getCampaignSegment` contradicts its own service-role contract — no `organizationId` parameter or filter

**File:** `src/lib/db/campaigns.ts:17-19, 41-58`
**Issue:** The module header states "Service-role callers (Inngest) MUST pass organizationId explicitly because current_organization_id() returns NULL under service-role" — but `getCampaignSegment` accepts no `organizationId` and applies no `.eq('organization_id', …)`. Today its only callers use the session client (RLS-safe), but the function is the documented entry point for segment queries; the first engineer (or AI) who calls it with `createServiceClient()` gets **every org's consented candidates** in one query — the worst-possible-bug class for this codebase. The doc comment actively invites that call pattern.
**Fix:** Add a required `organizationId: string` parameter and `.eq('organization_id', organizationId)` to the query (defence-in-depth index hint under RLS, hard requirement under service role), matching the comment's contract.

### WR-06: `submitVoiceNoteAction` accepts a cross-org `candidate_id` — FK validation bypasses RLS

**File:** `src/app/(app)/candidates/[id]/voice-notes/actions.ts:114-126`
**Issue:** The action inserts into `voice_notes` with the client-supplied `candidateId` after only UUID-format validation. The `candidates(id)` FK constraint is checked as table owner (RI triggers bypass RLS), so a malicious org-A user can create a voice note in org A referencing org B's candidate UUID. No cross-tenant data leaks (RLS blocks the eventual candidate read/write so apply degrades to a no-op update), but the pipeline happily spends Whisper + Sonnet money transcribing and extracting against a candidate the org can never act on, creates a dangling `activities.entity_id` if approved, and the migration has no composite `(organization_id, candidate_id)` guard like the `jobs_same_org_check` trigger that protects `jobs.company_id`.
**Fix:** Before the insert, resolve the candidate through the RLS-scoped client and fail closed:
```ts
const candidateCheck = await supabase
  .from('candidates').select('id').eq('id', candidateId).maybeSingle()
if (candidateCheck.error || !candidateCheck.data) {
  return { ok: false, error: 'Candidate not found.' }
}
```
(Or add a cross-tenant FK guard trigger for `voice_notes.candidate_id` in a follow-up migration, mirroring `jobs_same_org_check`.)

### WR-07: Review page does not assert the voice note belongs to the candidate in the URL

**File:** `src/app/(app)/candidates/[id]/voice-notes/[vnid]/review/page.tsx:16-24`
**Issue:** The page loads the voice note by `vnid` alone and renders it under whatever `candidateId` is in the URL. Within an org, `/candidates/X/voice-notes/Y/review` where Y belongs to candidate Z renders Z's transcript-derived proposal framed as X's review page — the recruiter sees "Proposed field changes" with no candidate name on the form, and the back-links point at X. The server actions correctly reject the mismatched apply (`voiceNote.candidate_id !== candidateId`), but the failure surfaces as a baffling "Voice note not found" toast after the recruiter has already read a proposal presented in the wrong candidate's context — a misinformation risk for candidate data, not just bad UX.
**Fix:** After loading, mirror the action's binding check:
```ts
if (voiceNote.candidate_id !== candidateId) notFound()
```

### WR-08: Proposal shape is only shallow-validated — model deviation throws an unhandled TypeError mid-apply

**File:** `src/app/(app)/candidates/[id]/voice-notes/actions.ts:310-324`; `src/lib/db/voice-notes.ts:155-157, 179-199`
**Issue:** The comment claims "treat the Json field as unknown and validate the shape we need", but the only validation is `Array.isArray(proposal.proposed_field_changes)`; the rest is `as any`. The Anthropic API does not strictly enforce `input_schema` on tool inputs, and `extractVoiceNoteUpdates` persists `toolUse.input` after only `??` defaults (no type checks). If `note_append` or a `proposed_value` arrives as a number/object, `proposal.note_append.trim()` / `change.proposed_value?.trim()` throws a raw TypeError (optional chaining only guards null/undefined) — the server action has no try/catch around `applyVoiceNoteFields`, so the recruiter gets a Next.js error digest instead of a handled failure. Same unvalidated cast pattern in `nl-template-match.ts:128` and `campaign-personalise.ts:135`.
**Fix:** Zod-parse the proposal once at the apply boundary (and ideally at persist time in the Inngest step):
```ts
const proposalSchema = z.object({
  proposed_field_changes: z.array(z.object({
    field: z.string(), current_value: z.string().nullable().catch(null),
    proposed_value: z.string(),
  })),
  note_append: z.string().nullable().catch(null),
  activity_kind: z.enum(['note', 'call', 'meeting']).catch('note'),
  activity_body: z.string().catch(''),
  action_items: z.array(z.string()).catch([]),
})
```

### WR-09: Campaign emails ship with no greeting or sign-off (the prompts promise the template handles them) and a non-one-click mailto unsubscribe

**File:** `src/lib/email/resend.ts:141-155`; `src/lib/ai/campaign-personalise.ts:38-48`; `src/lib/inngest/functions/send-email-campaign.ts:190-198`
**Issue:** Three mutually-inconsistent layers:
1. The Sonnet tool schema explicitly instructs: "Do NOT include greetings like 'Dear [name]' — the template handles that" and "Do NOT include sign-offs like 'Kind regards' — the template handles that." `assembleCampaignHtml` contains **neither** a greeting nor a signature block, so every campaign email opens cold and ends with no sender identity — unprofessional for the product's core persona and arguably non-compliant (marketing email should identify the sender).
2. The builder UI explainer promises "A one-click unsubscribe link is always included" but the send engine still uses the `mailto:` placeholder ("the 04-05 builder UI will wire the real per-candidate URL" — 04-05 shipped without doing so). A mailto draft is not one-click, and nothing processes those mailbox arrivals into `consent_basis` withdrawal, so an unsubscribed candidate stays in every future segment (PECR exposure).
3. No `List-Unsubscribe` header is set (Gmail/Yahoo bulk-sender requirements as of 2024 require one-click unsubscribe for bulk senders).
**Fix:** Add `Hi ${escapeHtml(firstName)},` and a recruiter signature block to `assembleCampaignHtml` (the candidate name is already fetched per-recipient); track the unsubscribe-URL gap as an explicit pre-launch blocker (real token URL + suppression write to `consent_basis`/a suppression table + `List-Unsubscribe` header), not a code comment.

## Info

### IN-01: `nlQueryAction` leaks raw internal error strings to the UI and can throw on a non-object `params`

**File:** `src/app/(app)/reports/nl/actions.ts:54-57, 70-74, 82-83`; `NlQueryForm.tsx:151`
**Issue:** `rpc-error: ${rpcError.message}` and `ai-error: ${msg}` are returned verbatim and rendered in the error alert — Postgres/SDK internals shown to end users. Separately, `key in pick.params` throws a TypeError if Sonnet returns `params` as a primitive (the `?? {}` in `matchNlTemplate` only guards null/undefined), and that throw happens outside the try/catch. Param **values** are also passed to the RPC untyped (harmless for injection — parameterised — but a junk date yields a leaked Postgres cast error rather than a friendly message).
**Fix:** Wrap steps 3-5 in try/catch; return a generic "Couldn't run that report" and log details to Sentry; guard `typeof pick.params === 'object' && pick.params !== null`; optionally regex-validate `date`/`int` param values against `template.params[key].type`.

### IN-02: `personalised_intro` / `personalised_outro` columns are never written

**File:** `supabase/migrations/20260610000000_phase4_hardening.sql:110-111`; `src/lib/db/campaigns.ts:157-182`
**Issue:** The recipients table has columns for the Sonnet-generated copy ("audit trail of what AI wrote"), but `updateRecipientStatus` never persists them — what was actually sent to each candidate is unrecoverable. Either store them on send or drop the columns in a follow-up migration.

### IN-03: Campaign size is silently capped by Inngest's step limit

**File:** `src/lib/inngest/functions/send-email-campaign.ts:130-132`
**Issue:** One `step.run` per recipient plus fixed steps means a campaign with ~1,000 recipients exceeds Inngest's per-run step limit and fails mid-send. `approveCampaignAction` puts no ceiling on segment size. Add a recipient-count guard (e.g. reject >500 with a clear message) until batching exists.

### IN-04: `specMinutes` cap bucket counts transcription calls, not minutes

**File:** `src/lib/stripe/usage.ts:32, 107-113`
**Issue:** `voice_note_transcribe` maps to `specMinutes` but `getAiUsageThisMonth` does `aggregate[bucket] += 1` per row — a 60-minute note and a 30-second note each consume "1". Pre-existing for `spec_transcribe`; Phase 4 doubles the traffic into the bucket. If the cap is genuinely minutes, sum `p_input_tokens / 60` for these purposes.

### IN-05: Upload path-write failure leaves the voice note stuck at `pending` forever

**File:** `src/app/(app)/candidates/[id]/voice-notes/actions.ts:158-168`
**Issue:** On `pathErr` the storage object is removed but the row's status stays `'pending'` (unlike the `uploadErr` branch, which marks `'failed'`). The review page shows "Processing your voice note…" indefinitely. Mark the row `'failed'` in this branch too.

### IN-06: whisper.ts docstring claims it throws on `durationSeconds <= 0` — it clamps to 1 instead

**File:** `src/lib/ai/whisper.ts:94-96, 156`
**Issue:** `Math.max(1, Math.round(verbose.duration ?? 0))` silently masks a missing/zero duration from the verbose_json response, so the documented malformed-probe guard never fires and cost falls back to the 1-second minimum. Align code or comment.

### IN-07: Extraction does not filter off-allowlist fields — one hallucinated field blocks the whole apply

**File:** `src/lib/ai/voice-note-extract.ts:134-139`; `voice-note-review-form.tsx:97-99`
**Issue:** The tool-schema enum is the only filter at extraction time (the API doesn't strictly enforce it). An off-list field lands in `structured_data`, the review form auto-checks all proposed fields, and the server Zod enum then rejects the entire request — the recruiter can't apply any change until they figure out which raw-named checkbox to untick. Filter `proposed_field_changes` against the allowlist when normalising the proposal.

### IN-08: Segment preview failure is silent in the builder

**File:** `src/app/(app)/campaigns/new/campaign-builder-form.tsx:201-207`
**Issue:** When `previewCampaignAction` fails, count and sample are cleared with no toast/alert — the recruiter sees neither a count nor an error and the Continue button just stays disabled. Surface the error.

### IN-09: Progress poller actions skip UUID validation on `campaignId`

**File:** `src/app/(app)/campaigns/new/progress-actions.ts:22-34, 54-70`
**Issue:** A malformed id reaches Postgres and round-trips as a generic error every 3 s. Harmless (RLS scopes the read) but inconsistent with every other action in the phase, which Zod-validates ids. Add `z.string().uuid()`.

### IN-10: Campaign sends can fall back to the feedback sender identity

**File:** `src/lib/email/resend.ts:21, 42`
**Issue:** `sendResendEmail` defaults to `Altus <feedback@updates.altus.app>` when `RESEND_FROM` is unset, and `send-email-campaign.ts` passes no `from` — candidate marketing email going out under a feedback address on an unverified-for-this-purpose domain (brand sender is altusmove.com). Pass an explicit campaigns `from`, or fail closed when `RESEND_FROM` is missing for campaign sends.

---

_Reviewed: 2026-06-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
