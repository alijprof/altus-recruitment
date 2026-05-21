---
status: blocked
phase: 03-linkedin-capture-spec-workflow-shortlists
source:
  - 03-00-SUMMARY.md
  - 03-01-SUMMARY.md
  - 03-02-SUMMARY.md
  - 03-03-SUMMARY.md
  - 03-04-SUMMARY.md
  - 03-05-SUMMARY.md
  - 03-06-SUMMARY.md
started: "2026-05-20"
updated: "2026-05-20"
blocked_reason: "release-build — Phase 3 introduces 9 new migrations, a Chrome extension that must be side-loaded, Microsoft Mail.Send incremental consent, and Whisper/Sonnet API integrations. Live UAT requires a deployed Vercel preview + applied Supabase migrations + an OPENAI_API_KEY + an authenticated recruiter session. Not runnable from the orchestrator's CLI environment. Reserved for human UAT after PR review and preview deploy."
---

## Current Test

[blocked — awaiting deployed environment with migrations applied]

## Tests

### 1. Cold Start Smoke Test
expected: |
  After applying Phase 3 migrations (`pnpm exec supabase db push`) and deploying the Vercel preview, the app boots without errors, all 9 migrations apply cleanly, and the home page loads for an authenticated recruiter.
result: blocked
blocked_by: release-build
reason: "Requires deployed Vercel preview + Supabase migrations applied"

### 2. LinkedIn capture creates candidate with embedding
expected: |
  Recruiter installs the unpacked `chrome-extension/` via `chrome://extensions` (developer mode), navigates to a LinkedIn profile, clicks the extension icon, clicks "Capture this profile". Within ~10 seconds, a new candidate appears in `/candidates` with `source='linkedin'`, the LinkedIn URL stored as `source_detail`, and a populated embedding (visible because the candidate is findable via semantic search from Phase 2).
result: partial-pass
notes: |
  2026-05-21 UAT: extension built, side-loaded, deployed against production Vercel, captured Huw Jones from linkedin.com/in/huw-jones-a739851bb/. Popup showed "Updated existing candidate." (dedup matched a row already in the DB — implicitly covers Test 3). End-to-end auth/scrape/POST/embed pipeline works.

  HOWEVER: only `name` and `linkedin_url` populate correctly. Headline, location, work_experience, education, skills all return null because LinkedIn rebuilt their profile DOM and our selectors no longer match (h1 element is gone entirely). The `name` field works because we fall back to `document.title` ("<Name> | LinkedIn").

  This is a known DOM-drift issue tracked as G6 in VERIFICATION.md — needs the full selector set updated before declaring Test 2 a clean pass.

### 3. LinkedIn dedup on existing candidate updates instead of creating
expected: |
  Recruiter captures the same LinkedIn profile twice. The second capture shows an "Updated existing candidate" toast and does NOT create a duplicate row. Dedup matches on `source_detail` OR email.
result: pass
notes: |
  2026-05-21 UAT: confirmed via Huw Jones capture during Test 2 — popup showed "Updated existing candidate." green-status toast. Dedup matched on source_detail (the LinkedIn URL), no duplicate row created. CR-01 unique partial index would have caught any race anyway.

### 4. Spec call upload → Whisper → Sonnet draft → review/approve creates job
expected: |
  Recruiter navigates to `/spec/new`, uploads a `.mp3` spec recording (≤ 100 MiB), submits. Within ~60 seconds the draft appears at `/spec/[id]/review` with a Sonnet-extracted structured JD prefilled (title, location, salary range, must-haves, nice-to-haves, urgency). Recruiter picks a client, edits any fields, clicks Approve. A new row appears in `/jobs` with the approved data; the spec_draft row's audio Storage object is queued for deletion (30-day retention sweep).
result: blocked
blocked_by: release-build
reason: "Requires OPENAI_API_KEY + ANTHROPIC_API_KEY in Vercel env + applied spec_drafts migration + ffmpeg binary on Vercel"

### 5. Rejected spec drafts are soft-deleted
expected: |
  Recruiter rejects a spec draft. The draft no longer appears at `/spec`. The audio Storage object is queued for deletion within 30 days. Inngest cron `spec-draft-cleanup-sweep` runs daily and hard-deletes drafts older than 30 days.
result: blocked
blocked_by: release-build
reason: "Same as test 4"

### 6. Generate ad on job → Sonnet ad + inclusivity score appear
expected: |
  Recruiter opens `/jobs/[id]`, clicks "Generate ad" in the ad panel. Within ~3 seconds, a markdown job ad and an inclusivity score (0-100) with sentence-level suggestions render in the side panel. Recruiter clicks "Save to job_ads" — a row persists in the `job_ads` table linked to this job. Multiple ads per job are allowed (no dedup).
result: blocked
blocked_by: release-build
reason: "Requires ANTHROPIC_API_KEY + applied job_ads migration"

### 7. Pasted-ad inclusivity scoring is ephemeral by default
expected: |
  Recruiter pastes an existing ad into the ad panel and clicks "Score this ad". Score + suggestions render in the panel. No row is persisted to `job_ads` unless the recruiter explicitly clicks "Save to job_ads".
result: blocked
blocked_by: release-build
reason: "Same as test 6"

### 8. Add candidate to job shortlist → row appears in shortlist tab, NOT in pipeline kanban
expected: |
  Recruiter opens `/jobs/[id]/shortlist`, clicks "Add to shortlist", picks a candidate, submits. Row appears under the Shortlist tab with the candidate name. Navigating to `/jobs/[id]/pipeline` shows the kanban WITHOUT this shortlist row (D3-17 invariant).
result: blocked
blocked_by: release-build
reason: "Requires applied application_type='shortlist' enum migration"

### 9. Promote shortlist row → formal application appears in pipeline `applied` column
expected: |
  Recruiter clicks "Convert to formal application" on a shortlist row. The row vanishes from the shortlist tab and appears in `/jobs/[id]/pipeline` at the `applied` stage. An `activities` row was logged with `kind='stage_change'` and metadata `{from: 'shortlist', to: 'standard'}`.
result: blocked
blocked_by: release-build
reason: "Same as test 8"

### 10. Float candidate without a job → row in /floats org-wide and candidate /floats tab
expected: |
  Recruiter navigates to `/candidates/[id]/floats`, fills in float-form (no job_id), submits. Row appears at `/floats` (org-wide) AND on the candidate's `/floats` tab. Row does NOT appear in the candidate's "Applications" tab (which filters on `standard`).
result: blocked
blocked_by: release-build
reason: "Requires applied applications nullable job_id + CHECK constraint migration"

### 11. Dormant clients widget surfaces clients with no contact for 60+ days
expected: |
  Authenticated home dashboard shows a "Dormant clients" widget listing clients whose `last_contacted_at` is more than 60 days ago. Clients dormant 90+ days show a "long dormant" badge. Clicking a client opens the "Send check-in" modal.
result: blocked
blocked_by: release-build
reason: "Requires applied dormant_clients_rpc migration + seeded last_contacted_at on companies"

### 12. Send check-in via Outlook with Mail.Send incremental consent
expected: |
  Recruiter clicks "Send check-in" on a dormant client row. A modal opens with a Sonnet-drafted email pre-personalised with the client name + last placement summary. Recruiter edits and clicks Send. First click prompts Microsoft consent for `Mail.Send` (NOT bundled at deploy). After consent, email sends via Microsoft Graph and an `activities` row is logged with `kind='email_draft'` regardless of send outcome.
result: blocked
blocked_by: release-build
reason: "Requires Phase 2 Outlook OAuth completed + recruiter consent for Mail.Send + ANTHROPIC_API_KEY"

### 13. Source attribution report shows placements grouped by source
expected: |
  Recruiter navigates to `/reports/source-attribution`. Default view shows last-90-days placements grouped by `candidates.source` with count, total fee revenue (pence), and average time-to-place. Date filter (30/90/365/custom) re-runs the report. Sources with zero placements are absent.
result: blocked
blocked_by: release-build
reason: "Requires applied source_attribution_summary RPC migration + seeded placements"

### 14. Audit log captures all candidate detail views
expected: |
  Opening a candidate detail page writes an `audit_log` row with the recruiter's user_id, the candidate_id, `action='view_detail'`, and the org_id (per CLAUDE.md "Every candidate detail view must write to audit_log" invariant).
result: blocked
blocked_by: release-build
reason: "Requires live recruiter session + writable audit_log"

### 15. ai_usage rows logged for every Sonnet/Whisper/Voyage call
expected: |
  After running tests 2, 4, 6, 12: rows exist in `ai_usage` with the new Phase 3 `purpose` values (`embed_candidate_linkedin`, `spec_transcribe`, `spec_jd_extract`, `job_ad_generate`, `outreach_draft`). Token counts and model identifiers are correct.
result: blocked
blocked_by: release-build
reason: "Requires live env with all AI integrations exercised"

## Summary

total: 15
passed: 1
partial: 1
issues: 0
pending: 0
skipped: 0
blocked: 13

## Gaps

[none — all gaps are environment-pending, not code defects; tracked in 03-VERIFICATION.md §D as G1–G5]

## Reviewer notes

This UAT was authored by the orchestrator at phase-completion time, NOT by a live recruiter testing the deployed app. All 15 tests are inventoried but marked `blocked: release-build` because Phase 3 introduces 9 new migrations + a Chrome extension + Microsoft Mail.Send incremental consent + Whisper/Sonnet API integrations that cannot be exercised from a CLI orchestrator.

After the PR for this phase merges to `main` and Vercel deploys a preview with migrations applied + Phase 3 env vars set (`OPENAI_API_KEY`, `LINKEDIN_EXTENSION_ID`, `LINKEDIN_EXTENSION_MIN_VERSION`), a human reviewer should re-open this file and walk through each test, marking results. Tests 14 and 15 may require querying Supabase directly.
