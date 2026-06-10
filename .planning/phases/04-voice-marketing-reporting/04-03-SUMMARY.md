---
phase: 04-voice-marketing-reporting
plan: "03"
subsystem: voice-notes
tags: [voice-notes, approval-gate, server-actions, per-field-review]
dependency_graph:
  requires: [04-02]
  provides: [VOICE-02, voice-note-review-ui, apply-reject-actions]
  affects: [candidates-detail, voice-notes-pipeline]
tech_stack:
  added: []
  patterns:
    - Zod enum allowlist validation for untrusted client field lists (T-04-18)
    - Read-then-concatenate append-only notes pattern (T-04-20)
    - Discriminated union status state machine in client form
    - AlertDialog confirmation before destructive server action
key_files:
  created:
    - src/app/(app)/candidates/[id]/voice-notes/[vnid]/review/page.tsx
    - src/app/(app)/candidates/[id]/voice-notes/[vnid]/review/voice-note-review-form.tsx
  modified:
    - src/app/(app)/candidates/[id]/voice-notes/actions.ts
    - src/lib/db/voice-notes.ts
decisions:
  - note_append maps to candidates.about (candidates table has no dedicated notes column)
  - activity always logged when any approval proceeds (even if only note_append approved)
  - applyVoiceNoteFields activity failure is non-fatal after successful field update
metrics:
  duration: "~30 minutes"
  completed: "2026-06-10T22:20:00Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 04 Plan 03: Voice Note Review Slice (VOICE-02) Summary

Per-field approval UI completing the VOICE-01/02 slice: recruiter opens the review page, sees each proposed field change as a checkbox row (before → after values), ticks what they accept, clicks "Apply N changes" — or confirms "Reject all" through an AlertDialog gate.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | applyVoiceNoteAction + rejectVoiceNoteAction + applyVoiceNoteFields | 85384cc | Done |
| 2 | Voice note review page + per-field checkbox approval form | a062e2e | Done |
| 3 | Human verify end-to-end | — | Awaiting checkpoint |

## What Was Built

### Task 1: Server actions + DB helper (85384cc)

**`src/app/(app)/candidates/[id]/voice-notes/actions.ts`** — extended with two new actions (submitVoiceNoteAction unchanged):

- `applyVoiceNoteAction`: Zod enum validates `approvedFields` against the D4-05 allowlist of exactly 4 scalar fields (`current_role_title`, `current_company`, `market_status`, `seniority_level`). Off-list items reject the whole request (not silently dropped). Loads the voice_notes row and asserts org ownership + status='ready_for_review' before any write. Delegates to `applyVoiceNoteFields` helper.

- `rejectVoiceNoteAction`: asserts org ownership, updates `voice_notes.status='rejected'`. Transcript and `audio_storage_path` are intentionally preserved.

**`src/lib/db/voice-notes.ts`** — `applyVoiceNoteFields` stub implemented:
- Builds scalar update payload for approved fields only
- market_status validated against DB enum set before write
- note_append appended to `candidates.about` (read-then-concatenate, never replace — T-04-20)
- Activity created via `createActivity` helper with source='voice_note' metadata
- Activity creation failure is non-fatal (candidate fields already written — logs to Sentry)
- Marks `voice_notes.status='applied'` + `applied_at` on success

### Task 2: Review page + form (a062e2e)

**`page.tsx`** (RSC) — handles all 5 statuses:
- `pending`/`transcribing`: amber pulse dot + "Processing…" + Refresh link (`role="status" aria-live="polite"`)
- `ready_for_review`: renders `VoiceNoteReviewForm` with proposal
- `applied`: green success banner with "Back to candidate" link (`role="alert"`)
- `rejected`: muted state panel with transcript note
- `failed`: destructive alert with parse_error message + "Log manually" link (`role="alert"`)

**`voice-note-review-form.tsx`** (Client Component) — per-field checkbox approval:
- Each `proposed_field_changes` item → Checkbox row (default checked), before (line-through, muted) → after (semibold)
- note_append renders as checkbox row "Append to notes" with quoted text
- Activity summary card (bg-muted/40, read-only, always logged if any approval)
- "Apply N changes" count reacts to checkbox toggles; disabled at 0
- "Reject all" → AlertDialog with exact UI-SPEC copy before firing rejectVoiceNoteAction
- Failure path keeps form open (no navigation on error — CLAUDE.md mutation rule)

## Security

| Threat | Mitigation |
|--------|-----------|
| T-04-18: tampered approvedFields (e.g. email, gdpr_consent_basis) | Zod enum of 4 allowlist fields; off-list → reject entire request |
| T-04-19: applying to another org's candidate | getVoiceNote org assert + RLS on candidate UPDATE |
| T-04-20: notes field overwrite | candidates.about read-then-concatenate; never bare replace |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] candidates.notes column does not exist**
- **Found during:** Task 1 typecheck
- **Issue:** The plan references `note_append` as appending to `candidates.notes`, but the candidates table has no `notes` column. The schema has `about` (string | null) as the free-text recruiter observation field.
- **Fix:** Mapped `note_append` append target to `candidates.about`. Append-only behaviour (read-then-concatenate, T-04-20) is preserved identically.
- **Files modified:** `src/lib/db/voice-notes.ts`
- **Commit:** 85384cc

**2. [Rule 1 - Bug] pnpm build runtime failure (env vars)**
- **Found during:** Task 2 build verification
- **Issue:** `pnpm build` fails in the worktree due to missing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` env vars. These are Vercel-only secrets (per memory note: `.env.local` vars are empty in the repo).
- **Fix:** Used `pnpm typecheck` (which passes cleanly) as the type verification gate, consistent with project constraints. TypeScript compilation in the build also shows "✓ Compiled successfully" and "Finished TypeScript" before the env-var runtime failure.
- **Files modified:** none (pre-existing constraint)

## Task 3: Human Checkpoint Pending

Task 3 is a `checkpoint:human-verify` task. The auto tasks (1 and 2) are complete and committed. The checkpoint requires end-to-end verification of the full voice note slice on the live app.

## Known Stubs

None — the approval form wires to real server actions and the DB helper is fully implemented. The `note_append` → `candidates.about` mapping is a deliberate deviation (documented above), not a stub.

## Threat Flags

No new threat surface beyond what was already in the plan's threat model.

## Self-Check: PASSED

- SUMMARY.md: FOUND at .planning/phases/04-voice-marketing-reporting/04-03-SUMMARY.md
- Task 1 commit 85384cc: FOUND
- Task 2 commit a062e2e: FOUND
- Key files:
  - src/app/(app)/candidates/[id]/voice-notes/[vnid]/review/page.tsx: CREATED
  - src/app/(app)/candidates/[id]/voice-notes/[vnid]/review/voice-note-review-form.tsx: CREATED
  - src/app/(app)/candidates/[id]/voice-notes/actions.ts: MODIFIED (applyVoiceNoteAction + rejectVoiceNoteAction added)
  - src/lib/db/voice-notes.ts: MODIFIED (applyVoiceNoteFields stub implemented)
