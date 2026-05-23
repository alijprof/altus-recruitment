# Phase 3 Deferred Items

deferred-item: lint error in src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx:62
  Rule: Calling setState synchronously within an effect can trigger cascading renders.
  Origin: introduced in Plan 03-03 (commit 05e2786, Wave 1).
  Out of scope for Plan 03-05 — to be addressed by the verifier or a follow-up.
  Re-observed by Plan 03-06 (still present; not introduced or fixed here).

deferred-item: lint error in src/app/(app)/spec/new/mic-recorder.tsx:57
  Rule: Calling setState synchronously within an effect can trigger cascading renders.
  Origin: Plan 03-02 mic-recorder Client Component.
  Pre-existing — surfaced again during 2026-05-23 UAT lint runs.

deferred-item: UAT Test 12 — Outlook Mail.Send incremental consent (partial)
  Status: deferred at end of UAT 2026-05-23.
  Verified: modal opens, Sonnet drafts email, `dormant_outreach_draft` row logged to ai_usage,
  `email_draft` activity written, "Connect Outlook first" guard fires when no OAuth.
  Outstanding: full send via Microsoft Graph + Mail.Send consent prompt on first click.
  Blocked by: Microsoft Outlook OAuth handshake (Phase 2 wiring not completed by anchor).

deferred-item: Outreach email body too long
  AI-drafted dormant check-in emails run long during UAT 2026-05-23.
  Tighten the Sonnet prompt (target ~150 words) in the dormant-outreach drafter.
  Phase 4.

deferred-item: No placement-fee capture modal
  Moving a candidate to `placed` does not prompt for fee amount / placement date / type.
  Result: source-attribution report shows placement count without revenue.
  Mirror DeclineModal's reason capture pattern but for placements.
  Phase 4.

deferred-item: `ad_generate` post-save UX
  Saving an ad to `job_ads` leaves the recruiter at a partial ad render with no
  follow-up affordance (view / edit / send / preview). Phase 4 polish.

deferred-item: Generated types regeneration
  `pnpm exec supabase gen types typescript --linked` produces ~108 lines beyond what's
  in src/types/database.ts. Targeted edit (`7f157c4`) added `email_draft` to unblock
  the dashboard; full regeneration is a tidy-up item that should be done before any
  type-sensitive change in Phase 4.

deferred-item: PWA installability
  Make Altus installable as a phone app icon. Requires `public/manifest.json`
  (name, icons, theme), apple-touch-icons in `app/layout.tsx`, optional service
  worker for offline. Estimated 2h. Flagged by user during 2026-05-23 UAT Test 4.
