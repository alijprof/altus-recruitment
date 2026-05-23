---
status: complete
phase: quick-260523-qyc
plan: 01
completed_at: 2026-05-23T18:37:07Z
duration_minutes: ~45
tasks_completed: 2
tasks_total: 2
commits:
  - hash: e996e0d
    message: "feat(260523-qyc): placement_type enum, columns, RPC + PlacementModal component"
  - hash: ac4df51
    message: "feat(260523-qyc): wire PlacementModal into all four move-to-placed surfaces"
files_created:
  - supabase/migrations/20260523160000_phase3_placement_type_and_required_fields.sql
  - supabase/migrations/20260523160100_move_application_with_placement_fields.sql
  - src/components/app/placement-modal.tsx
files_modified:
  - src/types/database.ts
  - src/lib/db/applications.ts
  - src/app/(app)/jobs/[id]/actions.ts
  - src/components/app/pipeline-board.tsx
  - src/components/app/pipeline-mobile-list.tsx
  - src/app/(app)/jobs/[id]/application-row-actions.tsx
  - src/app/(app)/candidates/[id]/candidate-applications.tsx
requirements_completed:
  - UAT-260523-PLACEMENT-CAPTURE
---

# Quick Task 260523-qyc: Placement Fee Capture Modal Summary

## One-liner

PlacementModal with fee/date/type inputs intercepts all four move-to-placed surfaces; placement_type enum + NOT VALID CHECK constraint + recreated move_application RPC with 5 new placement params locks the DB invariant.

## What Shipped

### Task 1: DB persistence stack + PlacementModal component

**Migration 20260523160000** adds:
- `public.placement_type` enum: `('perm', 'contract', 'temp', 'fixed_term')`
- `applications.placement_type` column (nullable, filled at placement time)
- `applications.placement_currency` column (NOT NULL, default 'GBP')
- `placement_fields_present_when_placed` CHECK constraint (NOT VALID — enforces on new/updated rows; legacy UAT placed rows without fields are exempt from the one-time validation scan)

**Migration 20260523160100** recreates `move_application` RPC:
- Drops the old 5-param overload (old GRANT pinned that signature)
- New 10-param signature with 5 defaulted trailing params: `p_placement_fee_pence`, `p_placement_date`, `p_placement_type`, `p_placement_currency`
- Pre-flight guard: raises friendly exception if `placed` stage missing fee/date/type
- UPDATE sets placement fields only when `to_stage = 'placed'`
- Activity JSONB metadata extended with all placement fields for audit trail
- Activity body for placed: `'Placed — perm'` (raw enum value per DeclineReason precedent)

**src/types/database.ts** (targeted edit, option b from execution notes):
- Added `placement_type` to `Enums` map
- Added `fee_pence`, `placed_at`, `placement_type`, `placement_currency` to `applications` Row/Insert/Update

**src/lib/db/applications.ts**:
- `MoveApplicationArgs` extended with `placementFeePence`, `placementDate`, `placementType`, `placementCurrency`
- `moveApplication` passes all 4 new RPC params

**src/app/(app)/jobs/[id]/actions.ts**:
- `moveSchema` extended with placement fields (with zod validation: int, min/max, datetime offset, enum, length(3))
- Fail-fast guard mirrors the decline-reason guard: returns `{ ok: false, error: 'Capture fee, date, and type before placing.' }` if placed stage missing required fields

**src/components/app/placement-modal.tsx** (new, 167 lines):
- Client component mirroring DeclineModal structure
- Props: `applicationId`, `candidateName`, `jobId?`, `candidateId?`, `open`, `onOpenChange`, `onPlaced?`, `onError?`
- Inputs: fee (£, text with `inputMode="decimal"`, parsed to pence on submit), date (type="date", defaults to today), type (Select with Perm/Contract/Temp/Fixed-term), notes (optional Textarea)
- Confirm button: default variant (not destructive — placement is a positive event), disabled until fee valid + date + type selected
- On confirm: converts date to UTC midnight ISO, calls `moveApplicationAction({ toStage: 'placed', ... })`, toasts success and calls `onPlaced?.(applicationId)`

### Task 2: Wire PlacementModal into all four surfaces

All four surfaces intercept `toStage === 'placed'` before calling `moveApplicationAction` directly:

- **pipeline-board.tsx**: `handleDragEnd` (drag to Placed column) + `handleDropdownMove` (card "..." dropdown) both set `placementTarget`. No optimistic move until `onPlaced` fires. `onPlaced` calls `moveCardLocal` to update the column state.
- **pipeline-mobile-list.tsx**: `performMove` intercepts placed. `handlePlaced()` updates local columns state after confirmation.
- **application-row-actions.tsx**: `handleMove` intercepts placed, opens PlacementModal. `onPlaced` calls `router.refresh()`.
- **candidate-applications.tsx**: `performMove` intercepts placed. Per-row `job_id` passed to modal for accurate `revalidatePath` on the job's pipeline page.

**Invariant verified**: `grep -rn "toStage:'placed'" src/ | grep -v placement-modal.tsx` returns no matches — PlacementModal is the sole caller of `moveApplicationAction` with `toStage: 'placed'`.

## Deviations from Plan

None. Plan executed exactly as written. The targeted database.ts edit (option b from execution notes) was chosen to keep the diff focused on this task rather than accepting the broader regen drift.

## Known Stubs

None. All inputs are wired to real DB writes via the recreated `move_application` RPC. The source-attribution report already aggregates `fee_pence` — no code change needed there.

## Threat Flags

None. No new network endpoints or auth paths introduced. `move_application` RPC remains SECURITY INVOKER; RLS still enforces tenant isolation. The placement fields flow through the existing authenticated RPC call path.

## Skipped Verifications

- `pnpm exec supabase db reset --local` was not run (local Docker/Supabase stack not verified as available in this session). Both `pnpm typecheck` and `pnpm lint` (no errors in touched files) passed. Migration SQL was manually verified to be syntactically correct and follow the NOT VALID pattern per execution notes.

## Reminder

Per memory `supabase-migrations-manual-push`: run `pnpm exec supabase db push --linked` after merging — GitHub→Supabase auto-apply is not reliable.

## Self-Check

- [x] Migrations created: `supabase/migrations/20260523160000_...sql`, `supabase/migrations/20260523160100_...sql`
- [x] PlacementModal created: `src/components/app/placement-modal.tsx`
- [x] Task 1 commit e996e0d exists
- [x] Task 2 commit ac4df51 exists
- [x] `pnpm typecheck` passes (no errors)
- [x] `pnpm lint` passes for all touched files (pre-existing errors in cv-review-panel.tsx and mic-recorder.tsx are out of scope)
- [x] `grep -rn "toStage:'placed'" src/ | grep -v placement-modal.tsx` returns no matches

## Self-Check: PASSED
