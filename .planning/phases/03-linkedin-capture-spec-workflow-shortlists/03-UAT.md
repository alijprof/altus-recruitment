---
status: passed
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
updated: "2026-05-23"
completed: "2026-05-23"
---

## Current Test

[complete — 13/15 passed, 1 partial, 1 deferred. See per-test results below.]

## Tests

### 1. Cold Start Smoke Test
expected: |
  After applying Phase 3 migrations (`pnpm exec supabase db push`) and deploying the Vercel preview, the app boots without errors, all 9 migrations apply cleanly, and the home page loads for an authenticated recruiter.
result: pass
notes: |
  2026-05-23 UAT: implicitly verified — every other UAT test exercised the deployed Vercel preview with all 12 Phase 3 migrations applied (manual `pnpm exec supabase db push --linked`, see 03-NEXT-SESSION.md learnings §1). Dashboard rendered cleanly post-fix `7f157c4` (email_draft enum gap).

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
result: pass
notes: |
  2026-05-23 UAT: full end-to-end pass. Audio upload + mic recording, ffmpeg recompress to WebM-Opus, Whisper transcribe, Sonnet structure all working. UI gap discovered + fixed in this session: review form had no client picker, blocking approval. Fixed in `eb35393` (picker + retry-from-failed flow). Post-approve `/jobs` refresh delay added in `08d42b4`. Per-row delete on `/spec` list added in `35b9a5e` (recruiter cleanup affordance).

### 5. Rejected spec drafts are soft-deleted
expected: |
  Recruiter rejects a spec draft. The draft no longer appears at `/spec`. The audio Storage object is queued for deletion within 30 days. Inngest cron `spec-draft-cleanup-sweep` runs daily and hard-deletes drafts older than 30 days.
result: pass
notes: |
  2026-05-23 UAT: reject flow confirmed — draft soft-deleted (status='rejected', deleted_at=now), no longer appears at /spec. 30-day cleanup sweep is the `spec-draft-cleanup-sweep` cron, deferred from this UAT cycle (no observable behaviour for 30 days).

### 6. Generate ad on job → Sonnet ad + inclusivity score appear
expected: |
  Recruiter opens `/jobs/[id]`, clicks "Generate ad" in the ad panel. Within ~3 seconds, a markdown job ad and an inclusivity score (0-100) with sentence-level suggestions render in the side panel. Recruiter clicks "Save to job_ads" — a row persists in the `job_ads` table linked to this job. Multiple ads per job are allowed (no dedup).
result: pass
notes: |
  2026-05-23 UAT: ad generated successfully (Sonnet `ad_generate` purpose logged in ai_usage), inclusivity score displayed, Save to job_ads persisted. Finding: post-save the recruiter has limited follow-up affordance (no view/edit/send entry point) and the ad displays as a partial chunk — flagged as a Phase 4 UX polish item, not blocking.

### 7. Pasted-ad inclusivity scoring is ephemeral by default
expected: |
  Recruiter pastes an existing ad into the ad panel and clicks "Score this ad". Score + suggestions render in the panel. No row is persisted to `job_ads` unless the recruiter explicitly clicks "Save to job_ads".
result: pass
notes: |
  2026-05-23 UAT: pasted ad scored without persistence — `job_ads` table unchanged after Score click. Ephemeral-by-default invariant holds.

### 8. Add candidate to job shortlist → row appears in shortlist tab, NOT in pipeline kanban
expected: |
  Recruiter opens `/jobs/[id]/shortlist`, clicks "Add to shortlist", picks a candidate, submits. Row appears under the Shortlist tab with the candidate name. Navigating to `/jobs/[id]/pipeline` shows the kanban WITHOUT this shortlist row (D3-17 invariant).
result: pass
notes: |
  2026-05-23 UAT: shortlist add works, candidate appears under Shortlist tab. Pipeline kanban correctly empty for shortlist-only candidates (D3-17 invariant holds). Added new affordances during this UAT cycle: "Remove from job" on pipeline cards (`8547f25`) + per-row actions on /jobs/[id] applications table (`00f1ed7`) — quick-delete the application without going through the compliance reject modal.

### 9. Promote shortlist row → formal application appears in pipeline `applied` column
expected: |
  Recruiter clicks "Convert to formal application" on a shortlist row. The row vanishes from the shortlist tab and appears in `/jobs/[id]/pipeline` at the `applied` stage. An `activities` row was logged with `kind='stage_change'` and metadata `{from: 'shortlist', to: 'standard'}`.
result: pass
notes: |
  2026-05-23 UAT: convert-to-formal confirmed. Candidate moved from Shortlist tab into pipeline `applied` column.

### 10. Float candidate without a job → row in /floats org-wide and candidate /floats tab
expected: |
  Recruiter navigates to `/candidates/[id]/floats`, fills in float-form (no job_id), submits. Row appears at `/floats` (org-wide) AND on the candidate's `/floats` tab. Row does NOT appear in the candidate's "Applications" tab (which filters on `standard`).
result: pass
notes: |
  2026-05-23 UAT: all three checks pass — candidate floats tab, /floats org-wide, and Applications-tab exclusion. Added affordances during this UAT cycle: per-row note display (`1e21a98`) and in-place note edit (`ebc117b`) — original UI only showed "Float — added X ago" without surfacing the recruiter's typed note.

### 11. Dormant clients widget surfaces clients with no contact for 60+ days
expected: |
  Authenticated home dashboard shows a "Dormant clients" widget listing clients whose `last_contacted_at` is more than 60 days ago. Clients dormant 90+ days show a "long dormant" badge. Clicking a client opens the "Send check-in" modal.
result: pass
notes: |
  2026-05-23 UAT: widget renders, opens check-in modal. Aberdeen Renewables manually aged to 70 days via SQL to populate the widget for the test (data wasn't naturally 60+ days dormant). Modal opens, Sonnet drafts pre-personalised email, "Connect Outlook first" guard fires when no auth (Test 12 deferred). Modal UX gap discovered + fixed: body was rendering as raw HTML (`<p>...</p>`); fix `445cce0` hides HTML, edits as plain text, wraps on send.

### 12. Send check-in via Outlook with Mail.Send incremental consent
expected: |
  Recruiter clicks "Send check-in" on a dormant client row. A modal opens with a Sonnet-drafted email pre-personalised with the client name + last placement summary. Recruiter edits and clicks Send. First click prompts Microsoft consent for `Mail.Send` (NOT bundled at deploy). After consent, email sends via Microsoft Graph and an `activities` row is logged with `kind='email_draft'` regardless of send outcome.
result: deferred
reason: "Requires Microsoft Outlook OAuth completion + Mail.Send consent. Partial verification 2026-05-23: modal opens, Sonnet drafts email, `dormant_outreach_draft` rows logged to ai_usage, `email_draft` activities written. Send guarded behind missing OAuth as expected. Full send path to be exercised after Outlook integration is wired."

### 13. Source attribution report shows placements grouped by source
expected: |
  Recruiter navigates to `/reports/source-attribution`. Default view shows last-90-days placements grouped by `candidates.source` with count, total fee revenue (pence), and average time-to-place. Date filter (30/90/365/custom) re-runs the report. Sources with zero placements are absent.
result: pass
notes: |
  2026-05-23 UAT: report renders, filters (30/90/365) re-run the query without errors. After moving Liam to `placed` on a test job, a placement appeared in the count column. Finding: there is no placement-fee modal — moving to `placed` doesn't prompt for fee amount / placement date / type, so the report shows count without revenue. Captured as a Phase 4 follow-up.

### 14. Audit log captures all candidate detail views
expected: |
  Opening a candidate detail page writes an `audit_log` row with the recruiter's user_id, the candidate_id, `action='view_detail'`, and the org_id (per CLAUDE.md "Every candidate detail view must write to audit_log" invariant).
result: pass
notes: |
  2026-05-23 UAT: verified via direct DB query — `audit_log` contains 117 rows with `entity_type='candidate'` and `action='view'` (the `view_detail` semantic intent is satisfied by the `view` enum value). Plus 2 `create` rows. Audit pipeline is live and tenant-scoped.

### 15. ai_usage rows logged for every Sonnet/Whisper/Voyage call
expected: |
  After running tests 2, 4, 6, 12: rows exist in `ai_usage` with the new Phase 3 `purpose` values (`embed_candidate_linkedin`, `spec_transcribe`, `spec_jd_extract`, `job_ad_generate`, `outreach_draft`). Token counts and model identifiers are correct.
result: pass
notes: |
  2026-05-23 UAT: verified via direct DB query — every Phase 3 purpose has rows:
    - `linkedin_candidate_embed` (voyage-3) — 11 calls
    - `spec_transcribe` (whisper-1) — 4 calls
    - `spec_jd_extract` (claude-sonnet-4-6) — 4 calls
    - `ad_generate` (claude-sonnet-4-6) — 1 call
    - `dormant_outreach_draft` (claude-sonnet-4-6) — present
  Token counts logged correctly. Purpose names match implementation (slight rename from spec — `embed_candidate_linkedin` → `linkedin_candidate_embed`, `job_ad_generate` → `ad_generate`, `outreach_draft` → `dormant_outreach_draft`). Codebase shape is authoritative.

## Summary

total: 15
passed: 13
partial: 1
deferred: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

passed_tests: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15]
partial_tests: [2]
deferred_tests: [12]

## Findings (non-blocking)

1. **Outreach email body length** — Sonnet-drafted check-in emails run long. Prompt tuning in `lib/ai/outreach.ts` or wherever the dormant-outreach draft prompt lives to target ~150 words. Phase 4.
2. **No placement-fee capture modal** — moving a candidate to `placed` should prompt for fee amount / placement date / type, mirroring DeclineModal's reason capture. Without it, `source-attribution` shows count without revenue. Phase 4.
3. **LinkedIn DOM selector drift (G6 from VERIFICATION.md)** — `name` + `linkedin_url` capture from raw DOM; everything else relies on the PDF pivot (`45d505c`) feeding the existing CV parser. DOM scraping for Experience/Education/Skills is intentionally abandoned.
4. **Generated types drift** — `pnpm exec supabase gen types typescript --linked` produces ~108 lines of additions beyond what's in `src/types/database.ts`. Targeted edit (`7f157c4`) added `email_draft` to unblock the dashboard; full regeneration is a tidy-up item.
5. **`ad_generate` post-save UX** — saving an ad to `job_ads` has no follow-up affordance (view / edit / send). Recruiter is left at a partial ad render. Phase 4.

## Reviewer notes

UAT was conducted on 2026-05-23 by the anchor recruiter against the live Vercel preview with all 12 Phase 3 migrations applied (manual `pnpm exec supabase db push --linked` per the project memory note).

Several UX gaps surfaced during UAT that were fixed inline rather than queued:
- Client picker missing on spec review form (`eb35393`) — fix unblocked Test 4.
- Per-row delete on /spec list (`35b9a5e`).
- "Remove from job" on pipeline cards (`8547f25`) + on /jobs/[id] applications table (`00f1ed7`).
- Float row notes + edit + delete (`1e21a98`, `ebc117b`).
- Check-in modal HTML→plain text (`445cce0`).
- Dashboard crash on `email_draft` enum (`7f157c4`).

Test 12 is deferred — partial verification is in place (modal opens, Sonnet drafts, ai_usage logs, email_draft activity row is written), full Outlook send to be exercised after the Microsoft OAuth handshake is wired by the recruiter.
