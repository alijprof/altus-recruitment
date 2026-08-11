# Phase 7: CV Lifecycle & Trust - Context

**Gathered:** 2026-08-11 (customer feedback session + 4-agent evidence workflow wf_034921d5)
**Status:** Ready for planning

<domain>
## Task Boundary

Make the CV data the customer already trusts us with VISIBLE, CORRECTABLE, and
TRUSTWORTHY: stored-file access with version history, proactive low-confidence
flagging, full editing of AI-parsed fields, match-score coverage on all
applications, and background-job hardening so queue stalls alert same-day.
Direct response to customer feedback items 1 + 3 (2026-08-11 session; raw
capture + triage in .planning/inbox/).
</domain>

<evidence>
## Verified reality (file:line evidence from the investigation — trust these)

- CV files ARE stored (cvs bucket, {org}/{candidate}/{uuid}-{slug}.{ext},
  uploadCVAction src/app/(app)/candidates/[id]/actions.ts:185-192) and storage
  RLS already grants tenant SELECT (migration 20260517204501:17-22). NO UI
  exposes view/download anywhere; only createSignedUrl call in the app is the
  public apply upload (apply actions.ts:155).
- Versioning EXISTS (candidate_cvs.version, unique (candidate_id, version),
  nextCVVersion candidate-cvs.ts:135-152). "Previous CVs" list renders ONLY
  when >1 CV (page.tsx:413-449), no dates, no file links; Latest CV panel
  (cv-review-panel.tsx CompleteState:387-427) shows no filename/date/link.
  SC prod: 81 candidates with >=1 CV, 7 with multiple versions (max 6).
- Review sheet is re-openable but VIEW-ONLY with Accept-all filling only
  EMPTY fields (D-08, markCandidateFieldsFromCV candidate-cvs.ts:427-563).
  /candidates/[id]/edit covers exactly 8 basic fields; NO edit path exists for
  work_experience, education, skills, sector_tags, seniority_level,
  years_experience, salary_current_estimate, salary_expectation, headline,
  about. A wrong accepted value is permanently uncorrectable in-UI.
- confidence_per_field EXISTS and renders per-field ConfidenceBadge INSIDE the
  sheet only (cv-review-panel.tsx:79+93, components/app/confidence-badge.tsx).
  SC prod: 83/87 complete parses carry confidence; 82 have >=1 low/medium
  field. No aggregate cue anywhere outside the sheet.
- Candidate edits do NOT re-embed: embed sweep picks only NULL embeddings
  (embed-batch.ts:129); the invalidation trigger's column list is the SQL
  source of truth (migration 20260519092951 + embed-text.ts sync contract).
- Match scores: auto-scoring ships on application-create since 4 Aug; SC has
  7/10 applications pre-dating it with NO badge; /jobs/[id]/matches has
  per-card Explain + refresh-to-see friction. Backfill cost: pennies,
  org-cap-guarded (score-application-match verifies tenancy + idempotency).
- Cron fleet: reconcile-cv-parses + embed-batch are concurrency-1 with no
  function-level timeout — one wedged run blocked ALL crons for days (4-9 Aug,
  Inngest free-tier + a now-being-paused sibling app were root causes).
  Sentry cron-heartbeat prior art: refresh-outlook-subscription.ts:49,
  stripe-reconcile.ts:93.
</evidence>

<decisions>
## Implementation Decisions (locked from triage; founder approved phase)

1. Option A — file access: server action getCvFileUrlAction(candidateCvId):
   RLS-scoped fetch -> createSignedUrl(~60s TTL) -> open in new tab. Filename +
   upload date + View link on Latest CV panel AND every Previous CVs row;
   render the files section for single-CV candidates too (retitle "CV files").
   Disable link for upload-incomplete rows (isUploadIncomplete,
   parse-messages.ts). AUDIT each download via record_audit (audit-ready
   principle; action='view' or 'export' — planner decides with evidence).
2. Option B — proactive flagging: compute low/medium counts server-side from
   confidence_per_field; amber count badge on the Review button ("3 fields
   unsure") + one-line summary naming the fields in the Latest CV panel.
   Rows without confidence data show nothing.
3. Option C — full parsed-field editing on /candidates/[id]/edit: add
   seniority_level, years_experience, salary fields, headline, about,
   tag-inputs for skills/sector_tags, repeating-row editors for
   work_experience {title, company, dates} and education {school, degree,
   dates} matching page.tsx:85-120 shapes. Collapsible sections. On save,
   when search-relevant fields changed, invalidate embedding (NULL it or fire
   the embed event) so the sweep re-embeds — handle the trigger-column-list
   sync contract (embed-text.ts comment) correctly.
4. Match-score backfill + freshness: one-off backfill for existing unscored
   applications (all orgs, idempotency-guarded, org-cap-guarded); kill the
   refresh-to-see toast (auto-revalidate after Explain); "Score all" bulk
   affordance on matches page. NO auto-rescore loops beyond what exists.
5. Cron hardening: function-level timeouts on the two concurrency-1 crons so
   a wedged run can never block the queue for days; Sentry cron-heartbeats on
   embed-batch + reconcile-cv-parses following the existing pattern.
6. D-08 stays intact: manual edits are protected from parse overwrite (that
   is now a feature). Per-field accept-time controls (triage option D) are
   OUT of this phase.
7. Branded CV, sourcing, job board, website: OUT — separate decisions.

### Claude's Discretion
Component structure for the array editors; signed-URL TTL; badge wording;
whether backfill is an Inngest one-off function or admin-triggered action.

## Constraints carried from project rules
LIVE PROD, real customer data. Migrations append-only FILES ONLY, founder
pushes (6 still pending from 4 Aug — this phase must stay correct with or
without them). Mandatory /gsd-code-review + authed browser pre-smoke
(smoke:auth pattern, SMOKE_ALLOWED_USER_ID guard) before founder UAT. pnpm
only; TS strict; no PII to Sentry; RLS is tenancy authority; no new deps
without justification. The frozen Phase-6 red-suite files must not change.
</decisions>

<specifics>
## Specific Ideas
- The retry-12 pattern proved the review+verify pipeline works — same bar here.
- SC org is the acceptance context: 81 CV-holding candidates make the file
  links instantly meaningful; 82 unsure-flagged parses make the badges land.
</specifics>

<canonical_refs>
## Canonical References
- .planning/inbox/feedback-session-2026-08-11.md (raw customer voice)
- .planning/inbox/feedback-triage-2026-08-11.md (triage + option analysis)
- Phase 6 artifacts (.planning/phases/06-*/) — harness + pipeline the edits sit on
</canonical_refs>
