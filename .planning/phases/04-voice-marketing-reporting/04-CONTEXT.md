# Phase 04: Voice, Marketing & Reporting — Context

**Gathered:** 2026-05-23
**Status:** Ready for research
**Mode:** MVP — phase delivers four vertical slices in sequence

<domain>
## Phase Boundary

Phase 4 ships four distinct capabilities, each as its own MVP slice. The user is the same anchor recruiter from Phase 1-3; the bar is "this agency can drive its desk from Altus end-to-end and an acquirer would see board-ready reporting."

**In scope:**
- Voice notes that propose CRM updates (VOICE-01, VOICE-02)
- Personalised segmented email campaigns via Resend (MARKET-01, MARKET-02, MARKET-03)
- Stale-candidate + dormant-client reminders surfaced in-app (REMIND-01)
- Natural-language reporting answered via a curated template library (REPORT-01)
- Buyer-value dashboards: placements per recruiter per quarter, time-to-fill by sector, source ROI, pipeline value, commission summary (REPORT-02)

**Out of scope (deferred to later phases):**
- SaaS shell (self-service signup, Stripe billing) — Phase 5
- AI-generated long-form content (job ad regen with tweaks, etc.) — Phase 5+
- Cross-org analytics / benchmarking — Phase 5+
- Free-form SQL generation as the primary NL backend — see D4-08

</domain>

<decisions>
## Implementation Decisions

### Slice ordering (MVP mode)

- **D4-01 (locked):** Phase 4 ships **four sequential MVP slices** in this order:
  1. **Voice notes** (VOICE-01, VOICE-02)
  2. **Email campaigns** (MARKET-01, MARKET-02, MARKET-03)
  3. **Reminders** (REMIND-01)
  4. **NL reporting + buyer dashboards** (REPORT-01, REPORT-02)

  Rationale: voice notes extend Phase 3's Whisper + Sonnet pipeline with the smallest new infrastructure and immediate recruiter value; campaigns are larger and depend on Outlook OAuth + Resend; reminders are small and can land any time after voice; reporting is biggest and depends on the placement-fee data we just shipped (260523-qyc) maturing through real usage.

### Voice notes (Slice 1 — VOICE-01, VOICE-02)

- **D4-02 (locked):** Capture is **MediaRecorder primary + file upload fallback** — reuse `src/app/(app)/spec/new/mic-recorder.tsx` shipped in Phase 3. Phone-first ergonomic: open Altus on phone (PWA — shipped via 260523-ret + cd9962a), tap record, talk 30 seconds, stop. Browsers without MediaRecorder fall back to upload.

- **D4-03:** Voice notes attach to a **candidate** (not a job, not an application). Recruiter opens `/candidates/[id]`, hits a "Voice note" button, dictates. The same pattern can later support job-level notes if recruiters ask — out of scope for the MVP slice.

- **D4-04:** Approval UX is **per-field with batch-accept**. Sonnet returns a structured proposal with one row per field change (e.g., `current_role_title: "Engineer" → "Staff Engineer"`, `market_status: "passive" → "active"`, `add note: "..."`). Recruiter ticks the fields they accept (default: all checked) and clicks "Apply changes". No silent updates; recruiter can also Reject all.

- **D4-05:** Allowed Sonnet-proposed changes are limited to a fixed allowlist of candidate fields to prevent prompt injection from escalating into arbitrary writes:
  - `current_role_title`, `current_company`, `market_status`, `seniority_level`, `notes` (append-only — never replace)
  - `add activity` of `kind='note'` with body=transcript
  - `add activity` of `kind='call'` or `kind='meeting'` with body=summary (Sonnet decides)
  - Stage changes on existing applications are PROPOSED but require the recruiter to navigate to the application (we don't auto-fire `moveApplicationAction` from voice)

- **D4-06:** Audio retention mirrors Phase 3 spec-call (D3-30): 30-day soft-delete sweep via Inngest cron. Same Storage bucket structure (`${org}/${user}/${id}.${ext}`). Voice notes table: `voice_notes(id, organization_id, candidate_id, created_by, audio_storage_path, audio_mime_type, audio_duration_seconds, transcript, structured_data jsonb, status, applied_at, parse_error, created_at, deleted_at)`.

### Email campaigns (Slice 2 — MARKET-01, MARKET-02, MARKET-03)

- **D4-07 (locked):** Personalisation depth is **hybrid** — Sonnet writes 2-3 personalised sentences per recipient (intro + outro) drawing on the recipient's CV + last activity; the middle of the email is a recruiter-authored template body. Satisfies MARKET-02 ("personalised drawing on CV + recent activity") at ~£0.002/email (~£0.20 for a 100-recipient campaign).

### NL reporting (Slice 4 — REPORT-01)

- **D4-08 (locked):** Safety model is a **predefined query template library**. ~20 hand-curated templates (e.g., "placements by sector last quarter", "time-to-fill by recruiter", "source ROI for the last N days"). Sonnet's job is to **pick the right template and fill its parameters** — it never writes raw SQL. Templates are parameterised Postgres functions (`security invoker`, returning aggregated rows). The recruiter sees the natural-language question + the matched template name in the result for transparency.

  Rationale: covers ~90% of recruiter questions with tighter safety than free-form SQL gen. Free-form SQL with allowlist + read-only role remains an option for Phase 5 if template coverage proves insufficient.

### Cross-cutting (carries forward from Phase 3)

- **D4-09:** Every Sonnet / Whisper / Voyage call writes `ai_usage` with a new `purpose` value. New purposes for Phase 4: `voice_note_transcribe` (Whisper), `voice_note_extract` (Sonnet), `campaign_intro_outro` (Sonnet, per-recipient), `nl_template_match` (Sonnet). Mirrors D3-24 — non-negotiable.

- **D4-10:** Long-running AI runs in Inngest (D3-25). Voice-note transcribe + extract is a single Inngest function (mirrors `create-job-from-spec.ts`). Campaign send is an Inngest function with per-recipient fan-out + Resend client. NL template match is fast enough for a synchronous server action (Sonnet template-picker call ~1s).

### Claude's Discretion (implementation details for planner/researcher)

- Inngest function naming + step structure (mirror existing Phase 3 patterns)
- Voice note button placement on `/candidates/[id]` (header? floating action button? row in the activities widget?)
- Campaign builder UX shape (table-of-recipients view, segment-rule builder, preview-before-send pane)
- Reminder widget styling (mirror dormant clients widget aesthetic)
- Chart library choice for buyer dashboards — D3-23 deferred this; researcher should evaluate Recharts vs visx vs chart-less SVG tables for the 7 specific metrics in REPORT-02
- Template library SQL function organisation (one migration per template? grouped?)
- Read-only Postgres role provisioning (or service-invoker functions with hand-written safe queries — the template approach may not need a read-only role at all)

</decisions>

<specifics>
## Specific Ideas

- Voice note pattern reference: existing `src/app/(app)/spec/new/page.tsx` + `mic-recorder.tsx` + `create-job-from-spec.ts` Inngest function — same shape but candidate-scoped.
- Email send pattern reference: existing `src/app/(app)/_dashboard/send-checkin-modal.tsx` (one-off dormant outreach) — campaign is the multi-recipient generalisation.
- Resend SDK is already in `package.json` (per CLAUDE.md "Email: Resend") but no wiring exists yet — campaign slice is when it lands.
- The Microsoft Outlook OAuth + Mail.Send consent path is already wired but not yet exercised end-to-end (Test 12 deferred). Campaign slice will exercise it for real.
- Buyer dashboards' "placements per recruiter per quarter" requires the `placement_fee_pence` + `placed_at` + `placement_type` columns shipped in 260523-qyc. Source ROI is already computed by the `source_attribution_summary` RPC from Phase 3.
- Template library should mirror the existing `dormant_clients(p_dormant_days, p_long_dormant_days)` RPC shape (parameterised, `security invoker`, RLS-respecting).

</specifics>

<canonical_refs>
## Canonical References

**External requirements:**
- `.planning/REQUIREMENTS.md` — MARKET-01/02/03, REMIND-01, VOICE-01/02, REPORT-01/02
- `.planning/ROADMAP.md#phase-4-voice-marketing--reporting` — goal + success criteria

**Carry-forwards from Phase 3 (locked there, applied here):**
- D3-06 (audio file shape; we extend MediaRecorder to voice notes)
- D3-07 (Whisper wrapper at `src/lib/ai/whisper.ts`)
- D3-19 / D3-29 (dormant pattern — REMIND-01 mirrors)
- D3-20 (Outlook OAuth + Mail.Send consent — campaigns reuse)
- D3-23 (chart library deferred; buyer dashboards is where it lands)
- D3-24 / D3-25 (ai_usage logging + Inngest for long-running)

**Project rules:**
- `CLAUDE.md` § "AI integration patterns" (Claude wrapper, ai_usage logging, Inngest for >2s calls)
- `CLAUDE.md` § "What 'AI-integrated' means here" — explicit "no auto-send" rule. Reinforces MARKET-03 + VOICE-02 approval gates.
- `CLAUDE.md` § "Database" — RLS, organization_id on every domain table, append-only migrations.

**Reference implementations:**
- `src/app/(app)/spec/new/mic-recorder.tsx` — MediaRecorder client component
- `src/app/(app)/spec/[id]/review/` — recruiter-approval UX pattern (Sonnet draft → recruiter edits → approve)
- `src/lib/inngest/functions/create-job-from-spec.ts` — Inngest fan-out + DB write pattern
- `src/app/(app)/_dashboard/send-checkin-modal.tsx` — single-recipient personalised send (campaign generalises this)
- `supabase/migrations/20260520031200_phase3_dormant_clients_rpc.sql` — `security invoker` RPC pattern for NL templates

</canonical_refs>

<deferred>
## Deferred Ideas

Captured for the roadmap backlog — not in scope for Phase 4:

- **Free-form SQL gen for NL reporting** — bigger scope, full prompt-eng + allowlist + read-only role. Revisit in Phase 5 if template coverage at end of Phase 4 proves insufficient.
- **Voice notes attached to jobs / applications / contacts** (not just candidates) — adds entity discrimination to the UI. Defer until recruiter requests it.
- **Campaign A/B testing + reply tracking** — too much for MVP. Defer.
- **Voice note real-time transcription** (streaming Whisper) — deferred; batch transcribe-after-upload is fine for 30-second notes.
- **Audio attachments on activities for non-voice activities** — out of scope.
- **Buyer-value PDF export of dashboards** — deferred; in-app view sufficient for MVP.

</deferred>
