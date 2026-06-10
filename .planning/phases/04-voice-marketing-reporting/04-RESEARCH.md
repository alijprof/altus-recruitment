# Phase 4: Voice, Marketing & Reporting — Research

**Researched:** 2026-06-10
**Domain:** Voice notes (Whisper + Sonnet), email campaigns (Resend), NL reporting (Postgres RPC templates), buyer dashboards (Recharts)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D4-01 (locked):** Phase 4 ships four sequential MVP slices in this order:
  1. Voice notes (VOICE-01, VOICE-02)
  2. Email campaigns (MARKET-01, MARKET-02, MARKET-03)
  3. Reminders (REMIND-01)
  4. NL reporting + buyer dashboards (REPORT-01, REPORT-02)

- **D4-02 (locked):** Voice capture is MediaRecorder primary + file upload fallback — reuse `src/app/(app)/spec/new/mic-recorder.tsx`. Phone-first ergonomic.

- **D4-07 (locked):** Personalisation depth is hybrid — Sonnet writes 2-3 personalised sentences per recipient (intro + outro) drawing on CV + last activity; middle of email is recruiter-authored template body.

- **D4-08 (locked):** Safety model is a predefined query template library (~20 hand-curated templates). Sonnet picks the right template and fills parameters — it never writes raw SQL. Templates are parameterised Postgres functions (`security invoker`).

- **D4-09:** Every Sonnet/Whisper/Voyage call writes `ai_usage` with new `purpose` values: `voice_note_transcribe`, `voice_note_extract`, `campaign_intro_outro`, `nl_template_match`. Non-negotiable.

- **D4-10:** Long-running AI runs in Inngest. Voice-note transcribe + extract is a single Inngest function (mirrors `create-job-from-spec.ts`). Campaign send is Inngest with per-recipient fan-out + Resend. NL template match is fast enough for synchronous server action.

### Claude's Discretion

- Inngest function naming + step structure
- Voice note button placement on `/candidates/[id]`
- Campaign builder UX shape
- Reminder widget styling
- **Chart library choice** — D3-23 deferred this; researcher evaluates Recharts vs visx vs chart-less SVG tables (see Standard Stack section)
- Template library SQL function organisation (one migration vs grouped)
- Read-only Postgres role provisioning (or security-invoker functions)

### Deferred Ideas (OUT OF SCOPE)

- Free-form SQL gen for NL reporting
- Voice notes attached to jobs/applications/contacts
- Campaign A/B testing + reply tracking
- Voice note real-time transcription (streaming Whisper)
- Audio attachments on non-voice activities
- Buyer-value PDF export of dashboards

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VOICE-01 | User can dictate a voice note; Sonnet extracts key points, stage update recommendation, action items, candidate field updates | Voice note pipeline pattern (§Architecture Patterns), field allowlist from D4-05, Inngest function shape |
| VOICE-02 | Recruiter approves changes before any candidate fields update | Per-field approval UX (D4-04), spec-review-form pattern, `voice_notes` table schema |
| MARKET-01 | User can build segmented email campaigns by `market_status` and send via Resend | Campaign builder with segment filters, Inngest fan-out, Resend REST API (no SDK needed) |
| MARKET-02 | Campaign emails personalised per recipient with Sonnet drawing on CV + recent activity | `campaign_intro_outro` Sonnet call, hybrid template approach (D4-07), ai_usage cap interaction |
| MARKET-03 | Campaigns require explicit user approval before send (no auto-send) | Campaign approval step, send-checkin-modal approval pattern |
| REMIND-01 | Automated reminders for stale candidates (30+ days no contact, prioritised by market_status) | Gap analysis: widget exists, needs 30-day threshold + urgency ordering (see §Gap Analysis) |
| REPORT-01 | User can ask NL reporting questions; SQL validated against template allowlist | D4-08 template library, Sonnet template-picker pattern, ~20 RPC functions |
| REPORT-02 | Buyer-value dashboards (REPORT-02 already shipped via 260524-cwd) | Gap analysis: 5 of 7 ROADMAP metrics shipped; sector column missing for time-to-fill split |

</phase_requirements>

---

## Summary

Phase 4 delivers four distinct capabilities onto a codebase that already has strong AI infrastructure: the `transcribe-and-structure-spec` Inngest pattern, the Sonnet `runWithLogging` wrapper with `ai_usage` cap enforcement, the Resend fetch-based email helper, and the Recharts buyer-value dashboard page.

The most important research finding is what is already shipped and what the gap is:

**REPORT-02 (buyer-value dashboards)** is largely complete via quick task `260524-cwd`. The page at `/reports/buyer-value` renders 5 metrics (placements per recruiter per quarter, time-to-fill, source ROI, pipeline value + sparkline, commission summary) using Recharts `^3.8.1` via `StackedBar`, `HorizontalBar`, `Sparkline` components. The sector-split on time-to-fill returns a single `'Unspecified'` bucket because `jobs` has no `sector` column — this is documented in the Methodology panel. The ROADMAP success criterion says "time-to-fill by sector" — the planner must decide whether to add a `sector` column to `jobs` in Phase 4's hardening wave or leave the single-bucket acknowledged limitation in place.

**REMIND-01** is partially shipped. `getFollowUpCandidates` in `src/lib/db/dashboard.ts` already queries candidates with `last_contacted_at < 30 days` ordered by `hot → actively_looking → passively_looking`. The `FollowUpWidget` renders them. The gap to the ROADMAP success criterion ("automated reminders surface in the dashboard, recruiter acts from notification without context-switching") is: the widget currently surfaces candidates needing follow-up but has no quick-action button (e.g. "Log a call" or "Record a voice note") that lets the recruiter act from the same widget without navigating away. The planner should treat this as a ~1-task enhancement of an existing widget, not a new build.

The remaining three slices (voice notes, campaigns, NL reporting) are genuinely unbuilt and require new Inngest functions, DB tables, and UI routes.

**Primary recommendation:** Structure plans around the four sequential slices from D4-01. The hardening wave (Wave 0) should add the `voice_notes` table, `email_campaigns` + `email_campaign_recipients` tables, NL template RPC functions (grouped in one migration), and `voice-note-audio` storage bucket. Then slices proceed slice-by-slice: voice → campaigns → reminders → NL reporting.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Voice note capture (MediaRecorder) | Browser (Client Component) | — | MediaRecorder API is browser-only; mic-recorder.tsx already handles this |
| Voice note upload + storage | API (Server Action) | Supabase Storage | Mirrors spec upload pattern; signed URL + Storage write |
| Voice note transcription + extraction | Background (Inngest) | Claude API / OpenAI Whisper | >2s latency — must not block HTTP handler per CLAUDE.md |
| Voice note approval UX | Browser (Client Component) | API (Server Action) | Per-field checkboxes need interactivity; mutation applies approved fields |
| Campaign builder + segment preview | Frontend + API (RSC + Server Action) | Database (RPC) | Segment preview = DB count query; builder UI = client interactivity |
| Campaign send fan-out (Sonnet per-recipient + Resend) | Background (Inngest) | Claude API + Resend REST | Per-recipient Sonnet calls + Resend sends; total time >> 2s for 100 recipients |
| Reminder widgets (stale candidates + dormant clients) | Frontend Server (RSC) | Database (query) | Static server render, refreshes on page load; quick-action CTA links to candidate page |
| NL template match (Sonnet picks template + fills params) | API (Server Action sync) | Claude API | Sonnet template-picker ~1s — within the 2s rule per D4-10 |
| NL template execution (RPC) | Database | — | security invoker RPCs, all read-only aggregations |
| Buyer-value dashboards | Frontend (RSC + Client charts) | Database (RPCs) | Already shipped; charts are dynamic({ ssr: false }) Client Components per 260525-ucn |

---

## Standard Stack

### Core (all already in package.json and production)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `inngest` | `^4.4.0` [VERIFIED: npm registry] | Background job queue for voice note pipeline + campaign fan-out | Project-standard for all >2s AI operations; `transcribe-and-structure-spec` is the canonical template |
| `recharts` | `^3.8.1` [VERIFIED: npm registry] | Chart rendering for buyer-value dashboards | Already shipped in `260524-cwd`; React 19 compatible; `StackedBar`, `HorizontalBar`, `Sparkline` components exist at `src/components/charts/` |
| `@anthropic-ai/sdk` | `~0.96.0` [VERIFIED: npm registry] | Sonnet calls via `runWithLogging` wrapper | Project-standard; `src/lib/ai/claude.ts` wrapper with `ai_usage` logging and cap enforcement |
| `openai` | `^6.38.0` [VERIFIED: npm registry] | Whisper transcription via `src/lib/ai/whisper.ts` | Project-standard; same wrapper as spec transcription |

### Supporting (fetch-based, no new SDK needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Resend (fetch-based) | REST API | Transactional + campaign email send | `src/lib/email/resend.ts` wrapper already exists; no `resend` SDK in package.json — use the existing fetch wrapper, extend it with a batch endpoint method |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing `recharts@^3.8.1` | visx or chart.js | Recharts is already installed and used in the shipped buyer-value page; switching would require rewriting existing chart components for no net gain at anchor-customer scale |
| Resend fetch wrapper (extend) | `resend` SDK `^6.12.4` | SDK is 6.12.4 on npm and well-maintained, but the project's fetch wrapper already handles auth, error normalisation, and fail-open correctly. Adding the SDK for campaigns adds a dependency for marginal ergonomic gain. Extend the fetch wrapper with a `batchSendEmails` method instead. |
| `security invoker` RPCs for NL templates | Dedicated read-only Postgres role | Security invoker is simpler to provision (no role management), enforces tenant isolation automatically via existing RLS, and matches the established `dormant_clients` + buyer-value RPC pattern. A read-only role is pure overhead for a template library. |

**Installation:** No new packages required. All dependencies are already in package.json and installed.

---

## Package Legitimacy Audit

> No new external packages are being added in this phase. All dependencies (inngest, recharts, @anthropic-ai/sdk, openai) are already installed and in production.

| Package | Registry | Disposition |
|---------|----------|-------------|
| `inngest@^4.4.0` | npm | Approved — already in production use |
| `recharts@^3.8.1` | npm | Approved — already in production use |
| `@anthropic-ai/sdk@~0.96.0` | npm | Approved — already in production use |
| `openai@^6.38.0` | npm | Approved — already in production use |

**Packages removed due to slopcheck verdict:** none
**Packages flagged as suspicious:** none

---

## Gap Analysis (what is already shipped vs what the ROADMAP success criteria still require)

### REPORT-02: Buyer-Value Dashboards

**Status:** Largely COMPLETE via `260524-cwd` (2026-05-24).

**What exists at `/reports/buyer-value`:**
- Placements per recruiter per quarter (stacked bar via `StackedBar` + `placements_by_recruiter_quarter` RPC)
- Time-to-fill — single `'Unspecified'` sector bucket (no `jobs.sector` column exists)
- Source ROI (reuses `source_attribution_summary` RPC from Phase 3)
- Pipeline value + sparkline (`pipeline_value_sparkline` RPC)
- Commission summary (`commission_summary_by_recruiter` RPC)
- Date filter (preset 30/90/365 + custom, URL-param-driven)
- Mobile-responsive cards + Methodology `<details>` appendix

**What the ROADMAP success criterion still says:** "time-to-fill by sector." The current implementation returns a single `'Unspecified'` bucket. This is a schema gap (`jobs` has no `sector` column), not a reporting gap.

**Planner decision required:** Either (a) add `jobs.sector` column in Wave 0 of Phase 4 hardening and update the `time_to_fill_by_sector` RPC to use it, or (b) accept the single-bucket limitation as known and document it. Option (a) enables the success criterion literally; option (b) is already in production and documented. Recommend option (a) — it is a single column + small RPC update, and the anchor customer needs sector visibility for due-diligence reporting.

**Remaining gap tasks:**
1. (Optional but recommended) Add `sector` column to `jobs`, update `time_to_fill_by_sector` RPC, update job creation/edit forms.
2. The page is not gated by the Phase 5 paywall — it is under the `(app)` layout which already has the paywall gate. No additional gating needed.

### REMIND-01: Automated Reminders

**Status:** PARTIALLY SHIPPED.

**What exists:**
- `getFollowUpCandidates` query in `src/lib/db/dashboard.ts`: fetches candidates with `last_contacted_at < 30 days` where `market_status in ('hot','actively_looking','passively_looking')`, ordered by priority (hot first)
- `FollowUpWidget` at `src/app/(app)/_dashboard/follow-up-widget.tsx`: renders rows with name, days-since-contact, market-status badge
- `dormant_clients` RPC + `DormantClientsWidget` with `SendCheckinModal`: dormant client side is complete

**What the ROADMAP success criterion requires:** "Automated reminders surface in the dashboard for stale candidates AND dormant clients — recruiter acts from the notification without context-switching."

**Gap:** The widget shows stale candidates but clicking a row navigates to `/candidates/[id]`, requiring context-switching. The success criterion says "acts from the notification without context-switching." The minimum viable fix is adding a quick-action CTA to the widget row: a "Log call" button that opens a lightweight inline modal (or a voice note trigger once Slice 1 is done). This is a ~1-task enhancement.

---

## Architecture Patterns

### System Architecture Diagram

```
Recruiter (browser / PWA)
        │
        ├── [Slice 1: Voice Notes]
        │     │ tap "Voice note" on /candidates/[id]
        │     ↓
        │   MicRecorder.tsx (MediaRecorder)
        │     │ stop → File blob
        │     ↓
        │   submitVoiceNoteAction (Server Action)
        │     │ validate mime/size → Storage upload to voice-note-audio/{org}/{user}/{id}.webm
        │     │ INSERT voice_notes row (status='pending')
        │     │ inngest.send('voice-note/uploaded')
        │     ↓
        │   Inngest: transcribe-and-extract-voice-note
        │     │ step: mark-transcribing → Whisper → transcript
        │     │ step: sonnet-extract → structured proposal (field diffs + note body)
        │     │ step: persist-proposal → voice_notes.structured_data, status='ready_for_review'
        │     ↓
        │   /candidates/[id]/voice-notes/[vnid]/review (Client Component)
        │     │ per-field checkboxes, default=all-checked
        │     ↓
        │   applyVoiceNoteAction (Server Action)
        │     │ UPDATE candidates (only approved fields from D4-05 allowlist)
        │     │ INSERT activities (kind='note' or 'call' depending on Sonnet decision)
        │     │ UPDATE voice_notes.status='applied', applied_at=now()
        │
        ├── [Slice 2: Email Campaigns]
        │     │ /campaigns/new → segment builder (market_status filter)
        │     ↓
        │   previewCampaignAction (Server Action)
        │     │ query candidates matching segment → count + sample
        │     ↓
        │   approveCampaignAction (Server Action, MARKET-03 gate)
        │     │ INSERT email_campaigns row (status='approved')
        │     │ inngest.send('campaign/send-approved')
        │     ↓
        │   Inngest: send-email-campaign
        │     │ step: load-recipients → INSERT email_campaign_recipients rows
        │     │ step: per-recipient fan-out (step.run per recipient):
        │     │         Sonnet: campaign_intro_outro (draws on candidate CV + activities)
        │     │         Resend: POST /emails (intro + template_body + outro)
        │     │         UPDATE recipient row (status='sent'/'failed')
        │
        ├── [Slice 3: Reminders (widget enhancement)]
        │     │ Dashboard FollowUpWidget: add "Log call" quick-action CTA
        │     │ (No new DB tables; extends existing widget + getFollowUpCandidates)
        │
        └── [Slice 4: NL Reporting + REPORT-02 gap fix]
              │ /reports/nl → text input
              ↓
            nlQueryAction (Server Action, sync ~1s)
              │ Sonnet: pick template from ~20 + fill params
              │ supabase.rpc(templateFnName, params) — security invoker
              │ return { question, matchedTemplate, rows }
              ↓
            NL result page (RSC render of rows)
```

### Recommended Project Structure (new files only)

```
src/
├── app/(app)/
│   ├── candidates/[id]/
│   │   └── voice-notes/
│   │       ├── voice-note-button.tsx      # "Voice note" CTA on candidate detail
│   │       ├── voice-note-form.tsx        # Upload form wrapper (reuses MicRecorder)
│   │       └── [vnid]/
│   │           └── review/
│   │               ├── page.tsx           # Server Component: fetch voice_notes row
│   │               └── voice-note-review-form.tsx  # Per-field approval (D4-04)
│   ├── campaigns/
│   │   ├── page.tsx                       # Campaigns list
│   │   └── new/
│   │       ├── page.tsx                   # Campaign builder
│   │       └── campaign-builder-form.tsx  # Segment selector + template body
│   └── reports/
│       └── nl/
│           └── page.tsx                   # NL query input + results
├── lib/
│   ├── ai/
│   │   ├── voice-note-extract.ts          # Sonnet extraction tool (mirrors jd-extract.ts)
│   │   ├── campaign-personalise.ts        # Sonnet intro/outro per recipient
│   │   └── nl-template-match.ts           # Sonnet template picker
│   ├── db/
│   │   ├── voice-notes.ts                 # DB helpers for voice_notes table
│   │   └── campaigns.ts                   # DB helpers for email_campaigns table
│   └── inngest/functions/
│       ├── transcribe-and-extract-voice-note.ts   # Slice 1 Inngest function
│       └── send-email-campaign.ts                  # Slice 2 Inngest function
supabase/migrations/
│   ├── 20260610000000_phase4_hardening.sql   # voice_notes table, email_campaigns, email_campaign_recipients, jobs.sector, NL template RPCs
│   └── 20260610000100_voice_note_audio_bucket.sql
```

### Pattern 1: Voice Note Inngest Function (mirrors transcribe-and-structure-spec.ts)

**What:** Single Inngest function `transcribe-and-extract-voice-note` triggered by `voice-note/uploaded` event. Steps: mark-transcribing → process-audio (download + recompress + Whisper) → sonnet-extract → persist-proposal.

**When to use:** All voice note background processing

**Example:**
```typescript
// Source: mirrors src/lib/inngest/functions/transcribe-and-structure-spec.ts
export const transcribeAndExtractVoiceNote = inngest.createFunction(
  {
    id: 'transcribe-and-extract-voice-note',
    triggers: [{ event: 'voice-note/uploaded' }],
    concurrency: { limit: 3, key: 'event.data.user_id' }, // same per-user cap as spec
    retries: 2,
    onFailure: async ({ event, error }) => { /* mark voice_notes.status='failed' */ },
  },
  async ({ event, step }) => {
    const { organization_id, voice_note_id, storage_path, user_id, candidate_id } = asEventData(event.data)
    // HARD RULE 4: storage_path must start with `${organization_id}/`
    if (!storage_path.startsWith(`${organization_id}/`)) throw new NonRetriableError('cross-tenant-storage-path')
    // Steps mirror transcribe-and-structure-spec exactly
    await step.run('mark-transcribing', ...)
    const { transcriptText, whisperCostPence } = await step.run('process-audio', ...)
    const proposal = await step.run('sonnet-extract', ...)
    await step.run('persist-proposal', ...)
  }
)
```

### Pattern 2: Sonnet Voice Note Extraction Tool (mirrors jd-extract.ts)

**What:** Tool-use call with strict JSON schema. Sonnet returns structured proposal: array of `{ field, current_value, proposed_value }` for each allowed field, plus `note_body` for the activity, plus `activity_kind` ('note' | 'call' | 'meeting').

**When to use:** The `sonnet-extract` step inside the voice note Inngest function.

**Example:**
```typescript
// Source: mirrors src/lib/ai/jd-extract.ts pattern
const voiceNoteExtractTool: Anthropic.Tool = {
  name: 'extract_voice_note_updates',
  description: 'Extract CRM field updates and a meeting summary from a recruiter voice note transcript. Only propose changes to fields in the allowed list. Do NOT invent values not mentioned in the transcript.',
  input_schema: {
    type: 'object',
    properties: {
      // D4-05 allowlist only — planner must enforce exactly these fields
      proposed_field_changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: ['current_role_title', 'current_company', 'market_status', 'seniority_level'] },
            proposed_value: { type: 'string' },
          },
          required: ['field', 'proposed_value'],
        },
      },
      note_append: {
        type: ['string', 'null'],
        description: 'Text to APPEND to the candidate notes field. null if nothing relevant.',
      },
      activity_kind: { type: 'string', enum: ['note', 'call', 'meeting'] },
      activity_body: { type: 'string', description: 'Summary of the meeting/call for the activity log.' },
      action_items: { type: 'array', items: { type: 'string' } },
    },
    required: ['proposed_field_changes', 'activity_kind', 'activity_body', 'action_items'],
  },
}
```

### Pattern 3: Campaign Fan-Out (Inngest + Resend)

**What:** Inngest function triggered by `campaign/send-approved`. Loads recipients, loops per-recipient in `step.run`, calls Sonnet for intro/outro, then Resend for send. Idempotent via per-recipient `email_campaign_recipients.status` column.

**Key constraint:** Resend rate limit is 2 API requests/second. A campaign of 100 recipients means 100 Resend calls. Inngest's step throttling + concurrency cap handles this gracefully — the function runs steps in sequence, not all-at-once. Do NOT use a parallel fan-out across all recipients simultaneously; loop sequentially or in small batches of 10-20.

```typescript
// Source: pattern derived from draft-outreach-email.ts + Resend batch API docs
export const sendEmailCampaign = inngest.createFunction(
  {
    id: 'send-email-campaign',
    triggers: [{ event: 'campaign/send-approved' }],
    concurrency: { limit: 2, key: 'event.data.organization_id' }, // only 2 campaigns in flight per org
    retries: 1, // campaigns are expensive; limit retries to avoid double-send
  },
  async ({ event, step }) => {
    const recipients = await step.run('load-recipients', ...)
    // Sequential per-recipient: avoids overwhelming Resend rate limit
    for (const r of recipients) {
      await step.run(`send-to-${r.id}`, async () => {
        // Idempotency: skip if already sent
        if (r.status === 'sent') return { skipped: true }
        // Sonnet: generate personalised intro/outro (~0.2p per call)
        const personalised = await draftCampaignIntroOutro(r, campaignTemplate, ...)
        // Resend: POST to /emails (using existing fetch wrapper)
        const result = await sendResendEmail({ to: r.email, subject, html: assemble(personalised, templateBody) })
        // Update recipient row regardless of result
        await updateRecipientStatus(r.id, result.ok ? 'sent' : 'failed')
      })
    }
  }
)
```

### Pattern 4: NL Template Library (security invoker RPCs)

**What:** ~20 Postgres functions in `security invoker` mode, parameterised, returning aggregated rows. Sonnet picks the function name + fills params in a synchronous server action. Pattern mirrors `dormant_clients` + buyer-value RPCs exactly.

**Organisation:** Group all NL template RPCs into a single migration (not one per template). This is cleaner for code review and avoids 20 migration files. Each function has a `comment on function` with its natural-language trigger phrase for the template-matcher prompt.

```sql
-- Source: mirrors supabase/migrations/20260520031200_phase3_dormant_clients_rpc.sql
create or replace function public.nl_placements_by_sector(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (sector text, placements_count int, total_fee_pence bigint)
language sql stable security invoker set search_path = public
as $$ select ... $$;
grant execute on function public.nl_placements_by_sector(date, date) to authenticated;
comment on function public.nl_placements_by_sector(date, date) is
  'NL trigger: "placements by sector", "how many placements by industry", "sector breakdown"';
```

**Template registry approach:** Build a `NL_TEMPLATES` constant in TypeScript (not a DB table) that maps function names to their natural-language descriptions. This is the allowlist Sonnet sees in its prompt. Sonnet is given the list of templates + param types and returns `{ functionName, params }`.

### Pattern 5: Per-Field Approval UX (mirrors spec-review-form.tsx)

**What:** Client Component showing each proposed field change as a checkbox row (default: checked). "Apply N changes" button calls `applyVoiceNoteAction` with the list of approved fields only.

**Key difference from spec review:** Voice note proposals are structured as `{ field: 'market_status', from: 'passive', to: 'active' }` rows — the UI shows the before/after clearly. The `notes` field is append-only (D4-05), so it shows "append: ..." not a before/after diff.

### Anti-Patterns to Avoid

- **Calling Sonnet synchronously from the voice note upload action:** Transcript + extraction takes 5-15s. Must be in Inngest per D4-10 and CLAUDE.md.
- **Auto-sending campaign emails without the approval step:** MARKET-03 and CLAUDE.md § "no auto-send" are absolute. The Inngest function only fires AFTER `approveCampaignAction` sets `email_campaigns.status='approved'`.
- **Using `security definer` for NL template RPCs:** Must be `security invoker` — the function must run as the calling user so existing RLS on `applications`, `jobs`, `candidates` enforces tenancy automatically. Using `security definer` would allow cross-tenant data leakage.
- **Passing raw campaign template body through Sonnet:** Sonnet only writes the 2-3 personalised sentences (intro/outro). The recruiter-authored middle body is interpolated server-side without passing through the model — prevents template injection from appearing in Sonnet's output.
- **Using `dynamic({ ssr: false })` from a Server Component:** Lesson from `260525-ucn`. Chart-wrapper dynamic imports MUST live in a Client Component (`charts-bundle.tsx` pattern). `pnpm build` (not `tsc`) catches this — include `pnpm build` in the autonomous gate for any chart-touching plan.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio recording in browser | Custom WebRTC/MediaRecorder wrapper | Reuse `MicRecorder` (`src/app/(app)/spec/new/mic-recorder.tsx`) | Already handles webm/opus, m4a, 60-min cap, denied/unsupported states, re-record |
| Audio compression + transcription | Custom ffmpeg pipeline | Reuse `recompressToOpus` + `transcribe` from `src/lib/ai/ffmpeg.ts` + `src/lib/ai/whisper.ts` | These are already battle-tested in the spec-call pipeline with all edge cases handled |
| Sonnet structured extraction | Free-form text parsing | Anthropic tool-use with strict JSON schema (pattern from `jd-extract.ts`) | Tool-use guarantees valid JSON + exact field types; free-form parsing fails on unexpected Sonnet phrasing |
| Campaign email send | Manual fetch-loop | Inngest + existing `sendResendEmail` wrapper | Inngest handles retry, idempotency, and rate-limit throttling; Resend is already wired |
| NL reporting safety | SQL allowlist + regex validation | security invoker parameterised RPCs | SQL allowlist with regex is impossible to get right; parameterised RPCs are injection-proof by construction |
| AI usage tracking | Custom cost calculation | `runWithLogging` in `src/lib/ai/claude.ts` (already handles `record_ai_usage`) | Any direct Anthropic call that bypasses `runWithLogging` misses cap enforcement and ai_usage logging |
| Voice note audio retention sweep | New bespoke cron | Mirror `spec-audio-retention-sweep.ts` (cron `TZ=Europe/London 0 3 * * *`, service client, NULL `audio_storage_path` for idempotency) | The Phase 3 spec-audio sweep is the canonical retention pattern; the voice-note sweep is a near-verbatim copy targeting the `voice_notes` table + `voice-note-audio` bucket |

**Key insight:** This phase is almost entirely about composing existing infrastructure in new ways. The voice note pipeline is ~80% copy-paste from the spec-call pipeline with different DB tables and Sonnet prompts. The campaign send is a generalisation of `draft-outreach-email.ts`. The audio retention sweep is a near-verbatim copy of `spec-audio-retention-sweep.ts`. Don't re-architect what already works.

---

## Phase 4 + Phase 5 Interaction (AI Usage Cap)

Phase 5 (SaaS Shell) shipped AFTER the CONTEXT.md was written. Phase 4 features interact with the Phase 5 billing/paywall in these ways:

**1. Campaign personalisation multiplies ai_usage rows.** A 100-recipient campaign = 100 `campaign_intro_outro` Sonnet calls. At ~0.2p each that is ~20p per campaign. The `PURPOSE_CAP_BUCKETS` in `src/lib/stripe/usage.ts` currently maps: `ad_generate`, `outreach_draft`, `dormant_outreach_draft`, `jd_extract` → `writingCalls`. The planner MUST add these Phase 4 purposes to `PURPOSE_CAP_BUCKETS`:

```typescript
// Add to src/lib/stripe/usage.ts PURPOSE_CAP_BUCKETS:
voice_note_transcribe: 'specMinutes',  // billed per audio minute like spec transcription
voice_note_extract: 'writingCalls',    // Sonnet call per note
campaign_intro_outro: 'writingCalls',  // Sonnet call per recipient — can be large
nl_template_match: 'writingCalls',     // Sonnet call per NL query
```

**2. `checkCap` in `runWithLogging` will throw `CapExceededError` for hard-capped orgs.** The Inngest campaign function must handle `CapExceededError` gracefully — mark the recipient as `failed_cap_exceeded` rather than crashing the whole campaign.

**3. Voice note Whisper calls contribute to `specMinutes`.** The PLANS cap is already defined for `specMinutes` (Starter: 30 min/month, Pro: 120, Scale: 360). Voice notes add to this cap alongside spec-call transcriptions. This is acceptable — both are Whisper minutes.

**4. The paywall gate is already in `(app)/layout.tsx`.** All Phase 4 routes under `(app)` are automatically behind the paywall. No additional gating needed at the route level.

---

## Common Pitfalls

### Pitfall 1: Inngest step output size with audio buffers

**What goes wrong:** Storing a base64-encoded audio file as a step output blows past Inngest's ~1MB step-output cap, causing silent step failures or truncation.
**Why it happens:** The same issue was already hit in Phase 3 (`transcribe-and-structure-spec.ts` comment: "WR-02 fix: collapse download → recompress → probe → transcribe into a single Inngest step").
**How to avoid:** Replicate the exact same pattern from `transcribeAndStructureSpec` — collapse download + recompress + Whisper into one `step.run('process-audio', ...)` that returns only `{ transcriptText, durationSeconds, whisperCostPence }`. Never return the audio buffer from a step.
**Warning signs:** Inngest run shows `process-audio` as completed but subsequent steps receive empty/undefined data.

### Pitfall 2: Recharts `dynamic({ ssr: false })` in Server Components

**What goes wrong:** Build fails at `pnpm build` (not `tsc`) with "You're importing a component that needs `next/dynamic`. This module can only be used in a Client Component."
**Why it happens:** Exactly this happened in `260525-ucn` — the buyer-value page was an RSC and the chart imports used `dynamic({ ssr: false })`.
**How to avoid:** Any new Recharts chart components must be wrapped in a dedicated Client Component (like `charts-bundle.tsx`). The plan must specify: "chart components go in a `_components/charts-bundle.tsx` Client Component; the page RSC imports from there."
**Warning signs:** Local `pnpm typecheck` passes but `pnpm build` fails with the dynamic error.

### Pitfall 3: Voice note approval applying the wrong fields

**What goes wrong:** The approval server action receives a list of "approved field names" from the client, performs `UPDATE candidates SET [field] = [value]` for each, but a malicious or malformed payload names a field outside the D4-05 allowlist (e.g. `email`, `gdpr_consent_basis`).
**Why it happens:** Client-side checkbox state can be tampered.
**How to avoid:** The `applyVoiceNoteAction` server action MUST validate that every field name in the approved list is a member of the D4-05 allowlist (`['current_role_title', 'current_company', 'market_status', 'seniority_level', 'notes']`) using a Zod enum schema. Reject any request containing a field not on the list with a `NonRetriableError`-equivalent 400 response.
**Warning signs:** TypeScript `strict` won't catch this — it requires runtime validation.

### Pitfall 4: Campaign recipients receiving personalised emails from the wrong org's data

**What goes wrong:** The Inngest function loads candidate CV and activity data without asserting `organization_id` — a forged campaign event payload can cause cross-tenant data reads in the Sonnet personalisation call.
**Why it happens:** The service-role client bypasses RLS. This is the same HARD RULE 4 risk from `transcribe-and-structure-spec.ts`.
**How to avoid:** In `send-email-campaign`, assert that every candidate loaded for personalisation has `organization_id === event.data.organization_id` before passing their data to Sonnet. Pattern: `if (candidate.organization_id !== organization_id) throw new NonRetriableError('cross-tenant-candidate')`.
**Warning signs:** Multi-tenant test shows one org's campaign using another org's candidate data in personalised emails.

### Pitfall 5: NL template Sonnet call returning a function name not in the allowlist

**What goes wrong:** Sonnet returns `{ functionName: 'arbitrary_function', params: {} }` — if the server action calls `supabase.rpc(functionName, params)` directly, an attacker who can craft a natural-language question might call arbitrary Postgres functions.
**Why it happens:** LLM outputs can be manipulated via prompt injection in the natural-language question.
**How to avoid:** After Sonnet returns the template name, validate it against the `NL_TEMPLATES` constant (the same allowlist shown to Sonnet in the prompt) using `if (!NL_TEMPLATES[functionName]) throw new Error('invalid-template')`. This is a whitelist check, not a Postgres-level control — belt-and-braces alongside `security invoker`.
**Warning signs:** A NL query like "call pg_read_file('/etc/passwd')" should return a 400, not execute.

### Pitfall 6: UK PECR compliance on candidate email campaigns

**What goes wrong:** Sending marketing emails to candidates (individuals) without a proper consent record triggers ICO enforcement.
**Why it happens:** UK PECR treats individuals differently from corporate subscribers. B2B cold outreach to corporate emails (limited companies) is permitted under legitimate interest with clear opt-out. But individual candidates (especially sole traders) require prior consent. Recruitment agencies' existing candidate databases often have consent captured at registration.
**How to avoid:** The campaign builder MUST only allow sending to candidates who have an active GDPR consent record in the `candidates` table (i.e. `gdpr_consent_basis` is populated and `gdpr_consent_withdrawn_at` is null). The segment query should include `WHERE gdpr_consent_basis IS NOT NULL AND gdpr_consent_withdrawn_at IS NULL`. Include a visible unsubscribe link in every campaign email (Resend header + footer).
**Warning signs:** Campaigns filter only by `market_status` and ignore consent status.

---

## Code Examples

### Voice note DB schema (new table)

```sql
-- Source: derived from D4-06 and spec_drafts pattern in 20260520000000_phase3_spec_drafts.sql
create table public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  candidate_id uuid not null references public.candidates(id),
  created_by uuid not null references public.users(id),
  audio_storage_path text,             -- nulled after 30-day retention sweep
  audio_mime_type text,
  audio_duration_seconds int,
  transcript text,
  structured_data jsonb,               -- VoiceNoteProposal shape
  status text not null default 'pending'
    check (status in ('pending','transcribing','ready_for_review','applied','rejected','failed')),
  applied_at timestamptz,
  parse_error text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: organization_id = current_organization_id()
-- Retention: 30-day sweep on audio_storage_path (mirrors spec-audio-retention-sweep.ts)
```

### Email campaigns DB schema (new tables)

```sql
-- Source: derived from existing applications/activities pattern
create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  created_by uuid not null references public.users(id),
  name text not null,
  subject_template text not null,
  body_template text not null,             -- recruiter-authored middle section
  segment_market_statuses text[] not null, -- ['hot','actively_looking'] etc
  status text not null default 'draft'
    check (status in ('draft','approved','sending','sent','failed')),
  approved_at timestamptz,
  sent_at timestamptz,
  recipient_count int,
  sent_count int default 0,
  failed_count int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  campaign_id uuid not null references public.email_campaigns(id),
  candidate_id uuid not null references public.candidates(id),
  email text not null,
  personalised_intro text,               -- Sonnet-generated
  personalised_outro text,               -- Sonnet-generated
  resend_email_id text,                  -- Resend message ID for tracking
  status text not null default 'pending'
    check (status in ('pending','sent','failed','failed_cap_exceeded')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
```

### NL template Sonnet server action (synchronous, D4-10 approved)

```typescript
// Source: derived from D4-08 + D4-10; mirrors runWithLogging pattern from claude.ts
'use server'

import { runWithLogging } from '@/lib/ai/claude'
import { NL_TEMPLATES } from '@/lib/reports/nl-templates'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/db/profiles'

export async function nlQueryAction(question: string) {
  const supabase = createClient()
  const profile = await getProfile(supabase)
  if (!profile) return { ok: false as const, error: 'unauthenticated' }

  // Sonnet: pick template + fill params (~1s, within 2s rule)
  const match = await runWithLogging({
    model: 'claude-sonnet-4-6',
    organizationId: profile.organization_id,
    userId: profile.id,
    purpose: 'nl_template_match',
    request: {
      max_tokens: 256,
      tools: [NL_TEMPLATE_PICKER_TOOL],
      messages: [{ role: 'user', content: buildNlPrompt(question, NL_TEMPLATES) }],
    },
  })

  const pick = extractToolInput<NlTemplatePick>(match, 'pick_nl_template')
  // SECURITY: validate function name against allowlist
  if (!NL_TEMPLATES[pick.functionName]) return { ok: false as const, error: 'no-matching-template' }

  // Execute the RPC (security invoker — RLS enforces tenancy)
  const { data, error } = await supabase.rpc(pick.functionName as never, pick.params)
  if (error) return { ok: false as const, error: error.message }

  return { ok: true as const, question, matchedTemplate: NL_TEMPLATES[pick.functionName].label, rows: data }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Recharts 2.x (required `pnpm.overrides` for React 19) | Recharts 3.x (native React 19 support) | Recharts 3.0 release | No overrides needed; already pinned to `^3.8.1` in this project |
| Raw SQL generation for NL reporting | Security invoker parameterised RPC templates | D4-08 design decision | Eliminates SQL injection attack surface; trades coverage for safety |
| Whisper streaming transcription | Batch transcription (upload → transcribe) | D4-deferred | Simpler for 30-second notes; real-time deferred per CONTEXT.md |

**Deprecated/outdated:**
- `pnpm.overrides` for Recharts React 19 compatibility: no longer needed in Recharts 3.x. Existing project does not use this override. [ASSUMED]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Resend's batch emails API allows up to 100 emails per batch request | Standard Stack, Architecture Patterns | Sequential per-recipient is the safe fallback regardless; architect for sequential loop which always works |
| A2 | `voice_note_transcribe` purpose should map to `specMinutes` cap bucket (like `spec_transcribe`) | Phase 5 Interaction | If wrong, voice note transcriptions don't count against the monthly Whisper cap — a cost undercount |
| A3 | Adding `jobs.sector` column is the correct approach to unlock sector-split time-to-fill | Gap Analysis | Could instead let anchor customer self-report sector via a new jobs form field — needs product decision |
| A4 | B2B candidate outreach (limited companies) is permitted under UK PECR legitimate interest without consent | Pitfall 6 | If individual candidate outreach requires prior opt-in, the campaign builder must hard-enforce GDPR consent check |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

---

## Open Questions (RESOLVED)

1. **Should Phase 4 add `jobs.sector` to unblock sector-split time-to-fill?**
   - What we know: `time_to_fill_by_sector` currently returns single `'Unspecified'` bucket. The ROADMAP success criterion says "time-to-fill by sector."
   - What's unclear: whether the anchor customer considers this a blocker for the due-diligence demo, or whether the current acknowledged limitation is acceptable.
   - Recommendation: Add `sector` column to `jobs` in the Wave 0 hardening migration. It's a small addition that satisfies the success criterion literally.
   - **RESOLVED:** Yes — add the scalar `jobs.sector` column. Implemented in plan **04-01** Task 1 (migration `20260610000000_phase4_hardening.sql` runs `alter table public.jobs add column if not exists sector text` and supersedes `time_to_fill_by_sector` to group by `coalesce(j.sector, 'Unspecified')`). The job create/edit form surfaces the field in plan **04-06**. Closes the REPORT-02 sector gap.

2. **How should `voice_note_transcribe` minutes interact with the `specMinutes` cap?**
   - What we know: `specMinutes` is the Phase 5 cap bucket for Whisper usage. Voice notes are also Whisper.
   - What's unclear: whether to reuse `specMinutes` bucket or create a separate `voiceMinutes` bucket with its own plan cap.
   - Recommendation: Reuse `specMinutes` — voice notes are "same meter, different use case." This is simpler and avoids proliferating plan caps. Document this in the `PURPOSE_CAP_BUCKETS` comment.
   - **RESOLVED:** Reuse `specMinutes` — no new cap bucket. Implemented in plan **04-01** Task 2: `PURPOSE_CAP_BUCKETS` maps `voice_note_transcribe → 'specMinutes'` (sharing the meter with `spec_transcribe`), with an inline comment documenting the shared meter. The other three Phase 4 purposes (`voice_note_extract`, `campaign_intro_outro`, `nl_template_match`) map to `writingCalls`.

3. **Should the campaign builder restrict to candidates with GDPR consent only, or also allow opted-in contacts (client contacts)?**
   - What we know: MARKET-01 says "segmented email campaigns by `market_status`" — implies candidates only.
   - What's unclear: whether the anchor customer also wants to email client contacts (B2B outreach).
   - Recommendation: Scope to candidates only for Phase 4 (matches MARKET-01). Client contact campaigns are a deferred feature.
   - **RESOLVED:** Candidates only. Implemented in plan **04-04**: `getCampaignSegment` filters `candidates` by GDPR consent (`gdpr_consent_basis IS NOT NULL AND gdpr_consent_withdrawn_at IS NULL`) intersected with the chosen `market_status` set; there is no contacts path. Client-contact (B2B) campaigns remain a deferred feature out of scope for Phase 4.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Inngest dev server (`pnpm inngest:dev`) | Campaign fan-out, voice note pipeline | ✓ | `^4.4.0` | — |
| `RESEND_API_KEY` env var | Campaign send, email helpers | ✓ (set in Vercel) | — | fail-open (DB row canonical) |
| `ANTHROPIC_API_KEY` | All Sonnet calls | ✓ (set in Vercel) | — | AI unavailable error |
| `OPENAI_API_KEY` | Whisper transcription | ✓ (set in Vercel, per Phase 3) | — | AI unavailable error |
| Supabase storage bucket `voice-note-audio` | Voice note audio storage | ✗ (not yet created) | — | Create in Wave 0 migration |
| `pnpm build` (Vercel) | Dynamic-import chart safety check | ✓ | Next.js 16.2.6 | — |

**Missing dependencies with no fallback:**
- `voice-note-audio` storage bucket — must be created in Wave 0 migration before any voice note uploads can succeed.

**Missing dependencies with fallback:**
- None.

---

## Validation Architecture

> `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json` — this section is skipped.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Zod for server actions; D4-05 allowlist validation on `applyVoiceNoteAction`; NL template allowlist check on `nlQueryAction` |
| V4 Access Control | yes | HARD RULE 4 tenant boundary check in all Inngest functions; `security invoker` on all RPCs |
| V6 Cryptography | no | No new cryptographic operations in Phase 4 |
| V2 Authentication | no | Auth infrastructure unchanged |
| V3 Session Management | no | Session infrastructure unchanged |

### Known Threat Patterns for this Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged Inngest event payload (cross-tenant voice note/campaign) | Spoofing | HARD RULE 4: assert `storage_path.startsWith(organization_id)` and re-read `organization_id` from DB before any service-role write — same pattern as `transcribe-and-structure-spec.ts` |
| D4-05 field allowlist bypass via tampered approval payload | Tampering | Zod schema validation of approved field names in `applyVoiceNoteAction` server action |
| NL prompt injection calling arbitrary Postgres functions | Elevation of Privilege | Whitelist check: `if (!NL_TEMPLATES[pick.functionName]) throw` — Sonnet output always validated against the `NL_TEMPLATES` constant before `supabase.rpc` call |
| Campaign sending to candidates without GDPR consent | Compliance | Segment query must filter `WHERE gdpr_consent_basis IS NOT NULL AND gdpr_consent_withdrawn_at IS NULL` |
| Cross-tenant candidate data in campaign personalisation | Information Disclosure | Assert `candidate.organization_id === event.data.organization_id` before Sonnet personalisation call |
| Sonnet prompt injection via voice transcript | Tampering | Triple-quote fence the transcript in the Sonnet prompt (same pattern as `jd-extract.ts` and `outreach-draft.ts`) |

---

## Sources

### Primary (HIGH confidence — verified in codebase)

- `src/lib/inngest/functions/transcribe-and-structure-spec.ts` — canonical voice note pipeline template; all patterns derived from this file
- `src/lib/inngest/functions/spec-audio-retention-sweep.ts` — canonical 30-day audio retention sweep; voice-note retention sweep mirrors this verbatim (D4-06)
- `src/lib/ai/jd-extract.ts` — Sonnet tool-use extraction pattern for voice note extractor
- `src/lib/ai/claude.ts` — `runWithLogging` wrapper; `CapExceededError` shape; `PURPOSE_CAP_BUCKETS` integration
- `src/lib/ai/whisper.ts` — Whisper wrapper; `specMinutes` billing pattern
- `src/lib/inngest/functions/draft-outreach-email.ts` — single-recipient Sonnet + Inngest pattern; generalises to campaign fan-out
- `src/app/(app)/_dashboard/send-checkin-modal.tsx` — approval-before-send pattern (MARKET-03 reference)
- `src/app/(app)/spec/new/mic-recorder.tsx` — MediaRecorder component to reuse verbatim
- `src/lib/email/resend.ts` — existing fetch-based Resend wrapper to extend
- `supabase/migrations/20260520031200_phase3_dormant_clients_rpc.sql` — `security invoker` RPC pattern for NL templates
- `supabase/migrations/20260524000200_buyer_value_rpcs.sql` — buyer-value RPCs; REPORT-02 gap analysis source
- `src/lib/stripe/usage.ts` — `PURPOSE_CAP_BUCKETS` — Phase 4 purposes must be added here
- `src/lib/stripe/plans.ts` — plan caps; `specMinutes` bucket confirmed for Whisper

### Secondary (MEDIUM confidence — verified via official sources)

- [Resend rate limits](https://resend.com/docs/api-reference/rate-limit) — 2 requests/second; batch API 100 emails per request [CITED: resend.com/docs]
- [Resend batch emails introduction](https://resend.com/blog/introducing-the-batch-emails-api) — batch API confirmed [CITED: resend.com/blog]
- [ICO: Business-to-business marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/) — UK PECR B2B guidance [CITED: ico.org.uk]

### Tertiary (LOW confidence)

- Recharts 3.x React 19 native support without `pnpm.overrides` [ASSUMED] — inferred from existing `recharts@^3.8.1` in package.json working without overrides in production

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in package.json and production
- Architecture: HIGH — all patterns verified against existing production Inngest functions
- Gap analysis (REPORT-02, REMIND-01): HIGH — verified by reading shipped source files
- Phase 5 interaction: HIGH — verified `PURPOSE_CAP_BUCKETS`, `checkCap`, plan caps
- Resend rate limits: MEDIUM — official docs referenced via WebSearch
- UK PECR compliance: MEDIUM — ICO official guidance cited; legal advice not substituted

**Research date:** 2026-06-10
**Valid until:** 2026-09-10 (90 days — stable libraries; Resend rate limits and UK PECR are stable)
