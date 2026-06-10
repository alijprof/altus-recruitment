---
phase: 04-voice-marketing-reporting
plan: "02"
subsystem: voice-notes
tags: [inngest, whisper, sonnet, tool-use, storage, retention, server-action]
dependency_graph:
  requires: [04-01]
  provides: [voice-note-capture, voice-note-pipeline, voice-note-audio-retention]
  affects: [candidates/[id]/page, inngest-route]
tech_stack:
  added: []
  patterns:
    - WR-02 (audio buffer never crosses step boundary)
    - HARD RULE 4 (cross-tenant storage-path check + DB org re-read)
    - tool-use with D4-05 allowlist enum restriction
    - triple-quote prompt injection fence
    - NULL-path idempotency for retention sweep
key_files:
  created:
    - src/lib/db/voice-notes.ts
    - src/lib/ai/voice-note-extract.ts
    - src/lib/inngest/functions/transcribe-and-extract-voice-note.ts
    - src/lib/inngest/functions/voice-note-audio-retention-sweep.ts
    - src/app/(app)/candidates/[id]/voice-notes/actions.ts
    - src/app/(app)/candidates/[id]/voice-notes/voice-note-form.tsx
    - src/app/(app)/candidates/[id]/voice-notes/new/page.tsx
    - src/app/(app)/candidates/[id]/voice-notes/voice-note-button.tsx
  modified:
    - src/app/api/inngest/route.ts
    - src/app/(app)/candidates/[id]/page.tsx
decisions:
  - "VoiceNoteButton is a Server Component (link-only, no client-side state) — avoids adding 'use client' to the candidate detail page"
  - "markVoiceNoteFailed uses dynamic import of createServiceClient to avoid circular imports between db/voice-notes and lib/supabase/service"
  - "Retention sweep anchors on created_at (not status_changed_at) — voice_notes has no bump-status trigger unlike spec_drafts"
  - "pnpm build fails on env validation in worktree — pre-existing issue (NEXT_PUBLIC_SUPABASE_URL undefined); Vercel is the real build gate per project memory"
metrics:
  duration: "~6 minutes"
  completed: "2026-06-10"
  tasks_completed: 3
  tasks_total: 3
  files_created: 8
  files_modified: 2
---

# Phase 04 Plan 02: Voice Note Capture Pipeline Summary

Voice note capture-to-extraction pipeline: Whisper transcription + Sonnet D4-05-constrained extraction registered in Inngest, plus the candidate-header CTA and 30-day audio retention cron.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | voice-notes DB helper + Sonnet extractor | 96bfa00 | src/lib/db/voice-notes.ts, src/lib/ai/voice-note-extract.ts |
| 2 | Inngest pipeline + retention cron + registration | 1f11127 | transcribe-and-extract-voice-note.ts, voice-note-audio-retention-sweep.ts, route.ts |
| 3 | Capture form, page, server action, VoiceNoteButton CTA | ccceea9 | actions.ts, voice-note-form.tsx, new/page.tsx, voice-note-button.tsx, page.tsx |

## What Was Built

**DB helper (voice-notes.ts):** `getVoiceNote`, `markVoiceNoteFailed`, `applyVoiceNoteFields` stub. Exports `VoiceNoteProposal` type and `VoiceNoteAllowedField` union restricted to the D4-05 scalar allowlist (current_role_title, current_company, market_status, seniority_level).

**Sonnet extractor (voice-note-extract.ts):** `extract_voice_note_updates` tool with field enum restricted to 4 D4-05 scalar fields. Notes handled via `note_append` (append-only). SYSTEM_PROMPT triple-quote fences the transcript against prompt injection (T-04-06). Calls `runWithLogging` with `purpose='voice_note_extract'` — no direct Anthropic bypass. costPence derived at 240/1200 p/MTok.

**Inngest pipeline (transcribe-and-extract-voice-note.ts):** Event `voice-note/uploaded`, concurrency `{ limit: 3, key: user_id }`. HARD RULE 4: `storage_path.startsWith(${org}/)` throws NonRetriableError before any service-role download. WR-02: download+recompress+transcribe collapsed into one step so audio buffer never crosses a step boundary. `persist-proposal` re-reads `voice_notes.organization_id` and asserts match (second HARD RULE 4 layer). onFailure + catch use name+status-only Sentry wrap (no raw err, no transcript).

**Retention cron (voice-note-audio-retention-sweep.ts):** `TZ=Europe/London 0 3 * * *` (same nightly BST tick as spec sweep). RETENTION_DAYS=30, anchored on `created_at`. Removes from `voice-note-audio` bucket; on success sets `audio_storage_path=null, deleted_at=now()` scoped by id+organization_id. Per-row soft-failure `continue`. Heartbeat captureMessage fires every run. Does NOT delete the voice_notes row (transcript+proposal retained for audit).

**Server action (actions.ts):** MIME allowlist + 100 MiB cap verbatim from spec actions. Candidate UUID validated with Zod. Storage path `${org}/${user}/${id}.${ext}` into `voice-note-audio` bucket. Fires `voice-note/uploaded` event. Sentry-wrapped error paths throughout.

**VoiceNoteForm:** `'use client'`, imports MicRecorder from `@/app/(app)/spec/new/mic-recorder` (not reimplemented). File-upload fallback. "Submit for processing" CTA disabled until file/recording present. aria-live status copy on submit.

**VoiceNoteNewPage:** RSC, heading "Voice note — [full_name]" at text-2xl font-semibold, max-w-2xl mx-auto, fetches candidate via getCandidate (RLS-scoped).

**VoiceNoteButton:** Server Component link-button, `variant="outline" size="sm"`, Mic icon, amber dot badge for `hasPendingReview`.

**Candidate detail page:** VoiceNoteButton added to action row. RLS-scoped count query for `ready_for_review` voice notes drives the badge dot.

## Threat Model Coverage

| Threat | Mitigation Applied |
|--------|-------------------|
| T-04-05 Spoofing (forged event) | HARD RULE 4 storage-path check + DB org re-read in persist step |
| T-04-06 Prompt injection via transcript | D4-05 field enum restriction + triple-quote fence + SYSTEM_PROMPT instruction |
| T-04-07 MIME/size abuse | ACCEPTED_AUDIO_MIME set + 100 MiB cap (verbatim from spec actions) |
| T-04-08 Sentry PII leak | name+status-only wrap in onFailure + catch; raw err never passed to Sentry |
| T-04-09 Audio retained indefinitely | D4-06: 30-day retention cron registered and removes audio_storage_path |

## Deviations from Plan

**1. [Rule 2 - Missing critical] markVoiceNoteFailed uses dynamic import**
- **Found during:** Task 1
- **Issue:** A static import of `createServiceClient` from `@/lib/supabase/service` inside `src/lib/db/voice-notes.ts` would create a module that imports the service key at load time in DB helper modules — a server-only pattern that could cause issues in browser bundle boundaries. The pattern in `spec-drafts.ts` avoids this because it calls markSpecFailed inline in the Inngest function (which already imports service). Since `markVoiceNoteFailed` is a standalone export callable from any context, dynamic import is safer.
- **Fix:** Used `const { createServiceClient } = await import('@/lib/supabase/service')` inside the try block.
- **Files modified:** src/lib/db/voice-notes.ts

**2. [Note] pnpm build not runnable in worktree**
- Pre-existing issue: `pnpm build` fails in the worktree due to missing `NEXT_PUBLIC_SUPABASE_URL` env var (not available in the local worktree environment). This is documented in project memory — Vercel is the real build gate. The base branch exhibits the same failure on the same error. `pnpm typecheck` and `pnpm lint` both pass cleanly.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `applyVoiceNoteFields` returns `{ ok: false, code: 'internal' }` | src/lib/db/voice-notes.ts | Implementation deferred to plan 04-03 (review UI + field application). Stub defined here so the function signature is importable for type-checking in 04-03. |

The stub does not prevent this plan's goal: the capture-to-queue path (record → store → transcribe → Sonnet proposal → ready_for_review) is fully wired. The approval/application step is plan 04-03's scope.

## Self-Check: PASSED

Files created/exist:
- src/lib/db/voice-notes.ts — FOUND
- src/lib/ai/voice-note-extract.ts — FOUND
- src/lib/inngest/functions/transcribe-and-extract-voice-note.ts — FOUND
- src/lib/inngest/functions/voice-note-audio-retention-sweep.ts — FOUND
- src/app/(app)/candidates/[id]/voice-notes/actions.ts — FOUND
- src/app/(app)/candidates/[id]/voice-notes/voice-note-form.tsx — FOUND
- src/app/(app)/candidates/[id]/voice-notes/new/page.tsx — FOUND
- src/app/(app)/candidates/[id]/voice-notes/voice-note-button.tsx — FOUND

Commits: 96bfa00, 1f11127, ccceea9 — verified in git log.
