# Phase 3 Deferred Items

deferred-item: lint error in src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx:62 [RESOLVED 2026-05-23 / quick-260523-sns]
  Fixed in commit cb4f7df. The setState reset for empty-query state stays
  synchronous (documented exception) but the second occurrence was a real
  rule violation and is gone. Net lint output for this file: zero errors.

deferred-item: lint error in src/app/(app)/spec/new/mic-recorder.tsx:57 [RESOLVED 2026-05-23 / quick-260523-sns]
  Fixed in commit cb4f7df by moving the MediaRecorder support check from
  a post-mount useEffect into a lazy useState initializer. Empty effect
  removed; unused eslint-disable removed.

deferred-item: UAT Test 12 — Outlook Mail.Send incremental consent (partial)
  Status: deferred at end of UAT 2026-05-23.
  Verified: modal opens, Sonnet drafts email, `dormant_outreach_draft` row logged to ai_usage,
  `email_draft` activity written, "Connect Outlook first" guard fires when no OAuth.
  Outstanding: full send via Microsoft Graph + Mail.Send consent prompt on first click.
  Blocked by: Microsoft Outlook OAuth handshake (Phase 2 wiring not completed by anchor).

deferred-item: Outreach email body too long [RESOLVED 2026-05-23 / 4f739b2]
  Sonnet prompt + tool schema tightened to target 70-100 words across
  3-4 short sentences. Re-verify on next Send check-in run.

deferred-item: No placement-fee capture modal [RESOLVED 2026-05-23 / quick-260523-qyc]
  Shipped via /gsd-quick:
  - Migration 20260523160000: placement_type enum + placement_type/placement_currency columns + NOT VALID CHECK
  - Migration 20260523160100: recreated move_application RPC with 5 placement params + pre-flight guard
  - src/components/app/placement-modal.tsx — mirror of DeclineModal for placed stage
  - Wired into all four move-to-placed surfaces (pipeline desktop + mobile, jobs table row, candidate apps panel)
  - moveApplicationAction guard returns "Capture fee, date, and type before placing." when fields missing
  Commits: e996e0d, ac4df51.

deferred-item: `ad_generate` post-save UX [RESOLVED 2026-05-23 / quick-260523-tje]
  Shipped via /gsd-quick (commits 7d28560 + c469ffa):
  - Full ad body now renders inline on the saved-ads list (no more partial snippet)
  - Per-row "..." dropdown with Copy / View full / Delete actions
  - View dialog shows the full ad + inclusivity score + suggestions
  - deleteJobAdAction with confirm prompt + audit log entry
  Edit-in-place, send-to-LinkedIn, and versioning remain deferred (Phase 4 scope).

deferred-item: Generated types regeneration [RESOLVED 2026-05-23 / quick-260523-sns]
  Regenerated in commit b8fdb69. `// @ts-nocheck` preserved as first line.
  `eslint.config.mjs` now ignores `src/types/database.ts` so the mandatory
  @ts-nocheck doesn't trigger ban-ts-comment.

deferred-item: PWA installability [RESOLVED 2026-05-23 / cd9962a]
  Shipped via Next.js App Router convention files: app/manifest.ts,
  app/icon.tsx (512x512), app/apple-icon.tsx (180x180 maskable),
  appleWebApp metadata + viewport.themeColor in app/layout.tsx.
  Placeholder "A" wordmark — swap with a designed icon by replacing the
  two .tsx files. Optional service worker for offline is still deferred.
