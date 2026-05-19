# Phase 3: LinkedIn Capture, Spec Workflow & Shortlists — Context

**Gathered:** 2026-05-19
**Status:** Ready for research
**Mode:** mvp (per ROADMAP.md)
**Depends on:** Phase 2

<domain>
## Phase Boundary

Phase 3 makes Altus genuinely **competitive with Firefish core for perm recruitment** by removing the two biggest day-to-day frictions and unlocking a working-set workflow recruiters already do informally:

1. **LinkedIn → candidate in one click** (no form-filling)
2. **Spec call recording → structured JD** (no re-typing what the client said)
3. **One-click job-ad generation + inclusivity score**
4. **Per-job shortlists + speculative floats** (recruiters' "hot lists")
5. **Source attribution report** (which channels actually produce placements)
6. **Dormant client widget** (silent-for-60/90-days flag + one-click outreach hook)

**In scope:**
- Chrome extension (Manifest V3) that scrapes the visible LinkedIn profile DOM and POSTs to a new authenticated ingest endpoint; backend creates/updates `candidates`, embeds via Voyage
- Spec-call file upload (`.mp3`/`.m4a`/`.wav`), Whisper transcription via Inngest, Sonnet-structured draft JD (title, location, salary range, must-haves, nice-to-haves, culture, reporting line, urgency) presented for recruiter review/approval before the job lands in `jobs`
- Sonnet-generated job ad from an approved JD; same Sonnet call (or a sibling) produces an inclusivity score + suggestions on any pasted existing ad
- Shortlist + float feature reusing the existing `applications` table via a new `application_type` enum value (`shortlist`, `float`) — no new tables for the working set
- Source attribution report at `/reports/source-attribution` (or similar): placements grouped by `candidates.source`, with cost/placement if data exists
- Dormant client surfaces on the dashboard with a "Send check-in" outreach hook (drafts a Sonnet email — recruiter approves before send)
- New `job_ads` table to persist generated ads + inclusivity scores (so we can A/B and edit later)
- Audio file storage in Supabase Storage with a 30-day retention policy (delete object after transcript + structured JD have been persisted and reviewed)

**Out of scope (deferred):**
- LinkedIn outreach automation, InMail integration (out of scope forever — separate product class)
- Voice notes / mid-meeting dictation (Phase 4 — VOICE-01/02)
- Outbound campaigns (Phase 4 — MARKET-01/02/03)
- Reminders for stale candidates (Phase 4 — REMIND-01)
- Natural-language reporting / "ask the CRM" (Phase 4 — REPORT-01/02)
- Auto-publishing job ads to LinkedIn/Indeed (Phase 5 or later)
- WYSIWYG ad editor — Phase 3 ships plain-text output with clipboard copy; rich editing deferred
- Chrome extension store distribution — Phase 3 ships an unpacked extension recruiters side-load via `chrome://extensions` developer mode. Store submission deferred.

</domain>

<decisions>
## Implementation Decisions

### LinkedIn capture (LINKEDIN-01)

- **D3-01 (locked):** Capture mechanism is a **Chrome extension (Manifest V3)** — content script scrapes the visible profile DOM, POSTs JSON to a new authenticated ingest endpoint (`/api/linkedin/ingest`). Anchor agency side-loads via developer mode for Phase 3; Chrome Web Store submission is deferred. LinkedIn TOS technically prohibits scraping but enforcement targets bulk automation, not 1-by-1 personal capture — risk accepted.
- **D3-02:** Authentication is **session-based** — the extension reads the recruiter's existing Supabase auth cookie from the open Altus tab (or a paired magic-link flow if the user prefers). The ingest endpoint runs in the authenticated app context (NOT service-role) so RLS enforces tenancy.
- **D3-03:** What gets captured: full name, headline, current role, current company, location, "About" section, work-experience entries (company + title + dates), education entries, declared skills. Profile photo URL is NOT captured (storage + privacy). LinkedIn URL is captured as `source_detail` for deduplication.
- **D3-04:** Deduplication: if an existing candidate has a matching LinkedIn URL in `source_detail` OR matching email, the extension **updates** instead of creating. Recruiter sees an "Updated existing candidate" toast.
- **D3-05:** After ingest, the new/updated candidate triggers an Inngest event that runs `parseCV` logic adaptation (skip extraction, use the LinkedIn data directly as the parsed structured fields) + the Voyage embed step. Result: candidate is searchable in ~10 seconds.

### Spec call workflow (SPEC-01, SPEC-02)

- **D3-06 (locked):** Audio ingestion is **file upload only** (`.mp3`/`.m4a`/`.wav`/`.webm`, max 100 MiB). In-browser MediaRecorder deferred to Phase 4 if voice-notes work surfaces it. Recruiter uses Voice Memos / Zoom / phone recorder.
- **D3-07:** Transcription is **OpenAI Whisper API** via a new `src/lib/ai/whisper.ts` wrapper that mirrors `claude.ts` — token logging, retry, model selection. `record_ai_usage` writes `purpose='spec_transcribe'`.
- **D3-08:** Whisper transcript + Sonnet-structured JD draft both run in a single Inngest function (`spec/uploaded` event). Sonnet uses tool-use with a strict JSON schema: `title`, `location`, `salary_range_min`, `salary_range_max`, `currency`, `must_haves[]`, `nice_to_haves[]`, `culture_notes`, `reporting_line`, `urgency` (`now`/`weeks`/`exploratory`), `seniority_level`, `job_type` (perm/contract).
- **D3-09:** Recruiter reviews the draft on a new `/spec/[id]/review` page. The UI is a form prefilled with the Sonnet output — every field editable. On approve, a `jobs` row is created with the recruiter as `created_by`. Until approved, the draft lives in a new `spec_drafts` table (with the same RLS + tenant guards as other domain tables).
- **D3-10:** Audio file retention: delete the Storage object **30 days after the draft is approved or rejected** (whichever is sooner). A scheduled Inngest cron sweeps daily.
- **D3-11:** Transcript is persisted on the `spec_drafts` row (`transcript text`). Cap at 50 000 chars (typical spec call ≤ 15 min ≈ 8 000 words ≈ 50 000 chars).

### Job ads + inclusivity (AD-01)

- **D3-12:** New `job_ads` table — one row per generated ad, linked to a `jobs.id`. Columns: `id`, `job_id`, `body_markdown`, `inclusivity_score smallint` (0-100), `inclusivity_suggestions text[]`, `model`, `cost_pence`, `created_by`, `created_at`, plus standard `organization_id` + audit cols.
- **D3-13:** Ad generation and inclusivity scoring use the **same Sonnet tool-use call**, separate outputs. Cost ~1.5p per call.
- **D3-14:** UI lives on the job detail page: a "Generate ad" button → opens a side panel with the generated markdown + score + suggestions. "Copy to clipboard" + "Save to job_ads" buttons. Scoring an **existing pasted ad** runs the same Sonnet call with a different prompt path; no persistence unless the user opts in.
- **D3-15:** Inclusivity rubric is **prompt-based**, not a separate model. Sonnet is instructed to score against: gendered language, age signals, jargon barrier-to-entry, accessibility statements presence, salary transparency. Suggestions are sentence-level rewrite hints.

### Shortlists + floats (SHORT-01, SHORT-02)

- **D3-16 (locked):** Reuse the `applications` table. **Research correction:** `application_type` enum already has `'spec'` and `'float'` values from Phase 1 — only `'shortlist'` needs adding via migration. (`'spec'` is unused but exists; we treat it as a synonym for `'float'`.)
  - **Shortlist:** `application_type='shortlist'`, `job_id` set, `stage='applied'` (kept default — invisible because kanban filters on `application_type='standard'`). Lives in a per-job "Shortlist" tab.
  - **Float:** `application_type='float'`, `job_id` NULL, no stage progression. Lives on the candidate detail page + a new "Floats" view.
  - **Promotion:** "Convert to formal application" button on a shortlist row updates `application_type='standard'`. One-way; no demotion.
- **D3-17:** The pipeline kanban and the candidate-detail Applications section both filter on `application_type='standard'` — shortlists and floats render in their own tabs/sections so they don't pollute the live pipeline.
- **D3-18:** Drop the `applications.job_id NOT NULL` constraint so floats can exist with `job_id IS NULL`. Cross-tenant FK guard already handles this (no candidate-id or job-id mismatch can cross tenants).

### Dormant client widget + outreach (REPEAT-01)

- **D3-19:** Dormant threshold is **60 days** for the widget; 90+ days get an extra "long dormant" badge. The widget lives on the dashboard and the `/clients` page header.
- **D3-20:** "Send check-in" button on a dormant row opens a Sonnet-drafted email modal (subject + body), pre-personalized with the client name + last placement summary. Recruiter edits + sends via Outlook (re-uses Phase 2 Microsoft Graph integration). **Research correction:** Phase 2 only requested `Mail.Read` + `User.Read` + `offline_access` — `Mail.Send` MUST be added now via Microsoft incremental consent, triggered the first time the recruiter clicks "Send check-in" (NOT on deploy). NO auto-send.
- **D3-21:** The drafted email is logged as an activity with `kind='email_draft'` whether or not it's sent — useful for retro on outreach hit rate.

### Source attribution (REPEAT-02)

- **D3-22:** New page `/reports/source-attribution`. Shows placements (applications in `stage='placed'`) grouped by `candidates.source`, with: count, total fee revenue, average time-to-place. Server-side aggregation via a new RPC `source_attribution_summary(p_from date, p_to date)`.
- **D3-23:** Date filter (last 30/90/365 days, custom). No chart library — plain table + numeric badges for Phase 3. Chart library deferred to Phase 4 reporting work.

### Defaults locked from research open questions

- **D3-28:** Extension UX is a **popup button only** (click extension icon → button captures profile) — no JS injection of UI into LinkedIn pages. Lower risk, simpler manifest, easier to update.
- **D3-29:** Dormant client widget is **org-wide visibility** — anyone in the org sees all dormant clients (anchor is 2-3 person agency; transparency wins over owner-only filtering).
- **D3-30:** Rejected spec drafts are **soft-deleted** (`deleted_at timestamptz`) — recruiters sometimes change their mind; keeps an audit trail. Daily Inngest sweep hard-deletes drafts older than 30 days.
- **D3-31:** Pasted-ad inclusivity scoring is **ephemeral by default** — score + suggestions render in the side panel but are NOT persisted unless the recruiter clicks "Save to job_ads". Avoids polluting `job_ads` with drive-by experiments.
- **D3-32:** Outreach drafts use a **single professional tone** for Phase 3 (warm, concise, second-person). Tone selector deferred to Phase 4 marketing.
- **D3-33:** Job ad dedup is per-job — a job can have multiple `job_ads` rows (history of variants); no global uniqueness constraint.
- **D3-34:** Max 3 spec-call uploads concurrently per recruiter via Inngest concurrency key `event.data.user_id` (matches Phase 2 parse-cv concurrency pattern).

### Cross-cutting

- **D3-24:** Every Phase 3 AI call (Sonnet for spec-call structure, ad generation, inclusivity score, outreach drafts; Whisper for transcription) MUST go through a typed `src/lib/ai/*` wrapper and MUST write `ai_usage` (non-negotiable per CLAUDE.md).
- **D3-25:** All long-running AI calls run in Inngest. The only synchronous user-facing AI call is the inclusivity-score-an-existing-ad path (Sonnet, ~3 s) — acceptable in a server action with a loading spinner; if it consistently exceeds 5 s we lift it to Inngest.
- **D3-26:** New migrations append-only (never edit committed). Trigger pattern for new tables follows the Phase 1 `<table>_set_org` → `<table>_verify_same_org_check` ordering convention (Phase 1 LEARNINGS bug class).
- **D3-27:** Multi-tenant RLS on every new table (`spec_drafts`, `job_ads`). FK guards where the row references another tenant-scoped row (e.g. `spec_drafts.created_by` → `users.id`).

</decisions>

<canonical_refs>
- ROADMAP.md → Phase 3 success criteria
- REQUIREMENTS.md → LINKEDIN-01, SPEC-01, SPEC-02, AD-01, SHORT-01, SHORT-02, REPEAT-01, REPEAT-02
- Phase 1 LEARNINGS.md → trigger ordering, cross-tenant FK guards
- Phase 2 LEARNINGS (TBD) → service-role + organization_id pattern, Voyage rate limits
- CLAUDE.md → AI wrapper pattern + ai_usage non-negotiable
</canonical_refs>
