---
phase: quick-260523-qyc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20260523160000_phase3_placement_type_and_required_fields.sql
  - supabase/migrations/20260523160100_move_application_with_placement_fields.sql
  - src/components/app/placement-modal.tsx
  - src/lib/db/applications.ts
  - src/app/(app)/jobs/[id]/actions.ts
  - src/components/app/pipeline-board.tsx
  - src/components/app/pipeline-mobile-list.tsx
  - src/app/(app)/jobs/[id]/application-row-actions.tsx
  - src/app/(app)/candidates/[id]/candidate-applications.tsx
  - src/types/database.ts
autonomous: true
requirements:
  - UAT-260523-PLACEMENT-CAPTURE

must_haves:
  truths:
    - "Recruiter cannot move an application to 'placed' without entering fee, placement date, and placement type."
    - "Placement metadata (fee in pence, currency, date, type) is persisted on the applications row and surfaced in the stage_change activity for audit."
    - "Existing decline-to-rejected/withdrawn flow continues to work unchanged via the same RPC and the same DeclineModal."
    - "Source-attribution report at /reports/source-attribution shows non-zero fee revenue once a placement is recorded with fee."
    - "All four 'Move to → Placed' entry points (desktop kanban dropdown, desktop kanban drag-to-Placed-column, mobile list, jobs table row dropdown, candidate apps panel row dropdown) intercept and present the PlacementModal instead of calling moveApplicationAction directly."
  artifacts:
    - path: supabase/migrations/20260523160000_phase3_placement_type_and_required_fields.sql
      provides: "placement_type enum, applications.placement_type column, applications.placement_currency column, placement_fields_present_when_placed CHECK constraint"
      contains: "create type public.placement_type"
    - path: supabase/migrations/20260523160100_move_application_with_placement_fields.sql
      provides: "Recreated move_application RPC accepting p_placement_fee_pence, p_placement_date, p_placement_type, p_placement_currency"
      contains: "create or replace function public.move_application"
    - path: src/components/app/placement-modal.tsx
      provides: "Modal component capturing fee/date/type/currency/notes when moving to placed"
      min_lines: 150
    - path: src/lib/db/applications.ts
      provides: "MoveApplicationArgs extended with placement fields"
    - path: src/app/(app)/jobs/[id]/actions.ts
      provides: "moveApplicationAction schema + guard for placement fields"
  key_links:
    - from: "PlacementModal"
      to: "moveApplicationAction"
      via: "direct import + call with toStage='placed' + placement fields"
      pattern: "moveApplicationAction\\(\\{[^}]*toStage:\\s*['\"]placed['\"]"
    - from: "moveApplicationAction"
      to: "moveApplication (db helper)"
      via: "passes placement fields through"
      pattern: "placementFeePence"
    - from: "moveApplication (db helper)"
      to: "move_application RPC"
      via: "supabase.rpc('move_application', { p_placement_fee_pence, ... })"
      pattern: "p_placement_fee_pence"
    - from: "pipeline-board.tsx drag handler"
      to: "PlacementModal"
      via: "intercept toStage==='placed' before optimistic move, open modal, only call moveApplicationAction on confirm"
      pattern: "PlacementModal"
---

<objective>
UAT 2026-05-23 finding: moving a candidate to `placed` skips the fee/date/type capture step, so the source-attribution report shows placement counts but no revenue. Recruiter has no way to record perm placement value, contract type, or actual placement date — the per-source ROI picture is structurally incomplete.

Build the placement analogue of `DeclineModal`: an amber/emerald confirmation modal that captures fee (£), placement date, placement type (perm / contract / temp / fixed_term), and optional notes whenever any move-to-placed surface fires. Persist via new applications columns and a recreated `move_application` RPC, with a CHECK constraint mirroring `decline_reason_present_when_terminal` so the database is the final authority that a placed row must carry these fields.

Purpose: Make placement revenue capturable and accurate. The source-attribution RPC + report page already aggregate `fee_pence` — the gap is the *input* side. After this lands, every placement records its fee at the moment of the stage change.

Output:
- 2 new append-only migrations (new `placement_type` enum + column + currency column + CHECK; recreated `move_application` RPC that accepts placement params).
- `src/components/app/placement-modal.tsx` — new component, mirrors DeclineModal structure.
- 4 trigger surfaces (pipeline-board desktop kanban dropdown + drag-to-placed-column, pipeline-mobile-list, jobs row dropdown, candidate-applications row dropdown) intercept `toStage === 'placed'` and open the modal first.
- Source-attribution report needs no code change (already sums `fee_pence`); verification confirms revenue surfaces end-to-end after a recorded placement.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md

@.planning/STATE.md

@src/components/app/decline-modal.tsx
@src/app/(app)/jobs/[id]/actions.ts
@src/lib/db/applications.ts
@supabase/migrations/20260518201900_move_application_function.sql
@supabase/migrations/20260520023100_phase3_applications_placement_fields.sql
@supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql
@supabase/migrations/20260513152244_phase1_domain_schema.sql
@src/components/app/pipeline-board.tsx
@src/components/app/pipeline-mobile-list.tsx
@src/app/(app)/jobs/[id]/application-row-actions.tsx
@src/app/(app)/candidates/[id]/candidate-applications.tsx
@src/app/(app)/reports/source-attribution/page.tsx

<interfaces>
<!-- Reality check from the existing codebase. Use these directly — do not re-derive. -->

State of `public.applications` BEFORE this plan (already in db):
- `fee_pence bigint NULL` (added 20260520023100, nullable)
- `placed_at timestamptz NULL` (added 20260520023100, nullable)
- Existing CHECK: `decline_reason_present_when_terminal` — `stage in ('rejected','withdrawn') → decline_reason IS NOT NULL`
- NO `placement_type` column exists yet.
- NO `placement_currency` column exists yet.
- NO CHECK requires `fee_pence` / `placed_at` / placement_type when `stage='placed'`.

State of `move_application` RPC BEFORE this plan:
- Signature: `(p_application_id uuid, p_to_stage application_stage, p_decline_reason decline_reason default null, p_decline_notes text default null, p_actor_user_id uuid default null) returns void`
- No placement params. We MUST recreate (not edit — append-only) with the new signature + drop the old explicit grant/revoke for the old signature in the same migration (`drop function if exists public.move_application(uuid, public.application_stage, public.decline_reason, text, uuid);` then `create or replace function ... <new sig>;`). The new signature has 5 extra trailing params, all defaulted, so callers passing only the old positional/named args continue to compile.

State of `source_attribution_summary` RPC BEFORE this plan:
- Already aggregates `coalesce(sum(a.fee_pence), 0)` per source and the report renders it via `formatPence(row.total_fee_pence)` at `src/app/(app)/reports/source-attribution/page.tsx:208`. **No RPC or report change required** — the revenue column appears as soon as a placement is recorded with a fee.

`MoveApplicationArgs` (current shape, src/lib/db/applications.ts:348):
```ts
export type MoveApplicationArgs = {
  applicationId: string
  toStage: ApplicationStage
  declineReason?: Enums<'decline_reason'> | null
  declineNotes?: string | null
  actorUserId?: string | null
}
```

`moveSchema` (current shape, src/app/(app)/jobs/[id]/actions.ts:152):
```ts
const moveSchema = z.object({
  applicationId: idSchema,
  toStage: z.enum(APPLICATION_STAGES),
  declineReason: z.enum([...]).optional().nullable(),
  declineNotes: z.string().trim().max(5_000).optional().nullable(),
  jobId: idSchema.optional().nullable(),
  candidateId: idSchema.optional().nullable(),
})
```

DeclineModal call-site contract (mirror this for PlacementModal):
- `applicationId`, `candidateName`, `jobId`, `candidateId`, `open`, `onOpenChange`, `onDeclined`, `onError`.
- Internally calls `moveApplicationAction({ applicationId, toStage: 'rejected', declineReason, declineNotes, jobId, candidateId })`.
- PlacementModal will do the same with `toStage: 'placed'` + placement fields.

Trigger surface integration pattern (already used for DeclineModal):
1. Each surface holds local state `{declineState: { open, applicationId, candidateName, ... }}`.
2. In its "Move to → Stage X" dropdown handler, if `toStage === 'rejected'` (or `'withdrawn'`), open DeclineModal instead of calling moveApplicationAction.
3. Otherwise call moveApplicationAction directly.
4. Mirror EXACTLY for `toStage === 'placed'` → open PlacementModal.

`pipeline-board.tsx` drag-and-drop case: `handleDragEnd` (line ~157) computes `toStage` from the drop target. If `toStage === 'placed'`, instead of calling `performMove(card, fromStage, toStage)` directly, set placementState `{open:true, card, fromStage}` and let the modal's onConfirm call `performMove` after the action returns ok. This means `performMove` needs an optional `placementFields` arg, OR we bypass `performMove` and call `moveApplicationAction` directly from the modal — see Task 2 action notes.

`application_stage` enum values include `'placed'` (line 42 phase1_domain_schema.sql). New enum to create: `placement_type` as `('perm','contract','temp','fixed_term')`.

CHECK constraint pattern (mirror `decline_reason_present_when_terminal` at line 316 of phase1_domain_schema.sql):
```sql
constraint placement_fields_present_when_placed
  check (
    stage <> 'placed'
    or (fee_pence is not null and placed_at is not null and placement_type is not null)
  )
```
Note: a constraint ADD on an existing table with existing rows must either be `not valid` (deferred) or pass for every existing row. Recommended: `alter table ... add constraint ... not valid;` then `alter table ... validate constraint ...;` in the same migration so legacy placed rows that lack the fields don't break the migration. Action notes call this out.

</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: DB persistence stack + PlacementModal component</name>
  <files>
    supabase/migrations/20260523160000_phase3_placement_type_and_required_fields.sql,
    supabase/migrations/20260523160100_move_application_with_placement_fields.sql,
    src/components/app/placement-modal.tsx,
    src/lib/db/applications.ts,
    src/app/(app)/jobs/[id]/actions.ts,
    src/types/database.ts
  </files>
  <action>
    Step A — Migration `20260523160000_phase3_placement_type_and_required_fields.sql` (append-only, never edit older migrations):
    - `create type public.placement_type as enum ('perm','contract','temp','fixed_term');`
    - `alter table public.applications add column if not exists placement_type public.placement_type;`
    - `alter table public.applications add column if not exists placement_currency text not null default 'GBP';`
    - Add CHECK constraint named `placement_fields_present_when_placed` using `not valid` first (so any legacy `stage='placed'` rows missing fields don't block the migration), then `validate constraint` ONLY IF a probe `select count(*) from applications where stage='placed' and (fee_pence is null or placed_at is null or placement_type is null)` is zero. If non-zero, leave the constraint `not valid` and add a top-of-file comment explaining the trade-off — new rows still get enforced because Postgres always checks new/updated rows against `not valid` constraints; only existing-row validation is deferred. This satisfies the goal (no future placed row may be missing the fields) without forcing a backfill we can't safely automate.
    - `comment on column public.applications.placement_type is ...` and same for `placement_currency`, referencing this UAT.

    Step B — Migration `20260523160100_move_application_with_placement_fields.sql`:
    - First line: `drop function if exists public.move_application(uuid, public.application_stage, public.decline_reason, text, uuid);` to clear the prior explicit grant signature (the grant/revoke in the original migration pinned that exact signature).
    - Re-create `public.move_application` with 5 new defaulted trailing params: `p_placement_fee_pence bigint default null`, `p_placement_date timestamptz default null`, `p_placement_type public.placement_type default null`, `p_placement_currency text default null`. Body mirrors the existing function (read row, idempotent same-stage short-circuit, pre-flight decline-reason check) and ADDS a pre-flight check: `if p_to_stage = 'placed' and (p_placement_fee_pence is null or p_placement_date is null or p_placement_type is null) then raise exception 'placement fields required when moving to placed'; end if;`.
    - In the UPDATE statement, set `fee_pence = case when p_to_stage = 'placed' then p_placement_fee_pence else fee_pence end`, `placed_at = case when p_to_stage = 'placed' then p_placement_date else placed_at end`, `placement_type = case when p_to_stage = 'placed' then p_placement_type else placement_type end`, `placement_currency = case when p_to_stage = 'placed' then coalesce(p_placement_currency, placement_currency) else placement_currency end`.
    - Activity row: extend the `jsonb_build_object(...)` metadata with `'placement_fee_pence', p_placement_fee_pence, 'placement_date', p_placement_date, 'placement_type', p_placement_type, 'placement_currency', p_placement_currency` so the audit trail captures placement metadata. Body string for placed: `'Placed — ' || replace(p_placement_type::text, '_', ' ')` (RAW enum, label resolved at render time per the DeclineReason precedent).
    - `security invoker`, `set search_path = public`, same revoke/grant pair for the NEW signature (`uuid, application_stage, decline_reason, text, uuid, bigint, timestamptz, placement_type, text`).

    Step C — `src/types/database.ts` regenerate:
    - Run `pnpm exec supabase gen types typescript --linked > src/types/database.ts` (memory: `supabase-migrations-manual-push`. After regen, restore the `// @ts-nocheck` first line — generator strips it. Confirm `Enums<'placement_type'>` is in the generated map.

    Step D — `src/lib/db/applications.ts`:
    - Extend `MoveApplicationArgs`:
      ```ts
      export type MoveApplicationArgs = {
        applicationId: string
        toStage: ApplicationStage
        declineReason?: Enums<'decline_reason'> | null
        declineNotes?: string | null
        actorUserId?: string | null
        placementFeePence?: number | null
        placementDate?: string | null  // ISO 8601
        placementType?: Enums<'placement_type'> | null
        placementCurrency?: string | null
      }
      ```
    - In `moveApplication`, pass the new RPC args: `p_placement_fee_pence: args.placementFeePence ?? null`, `p_placement_date: args.placementDate ?? null`, `p_placement_type: args.placementType ?? null`, `p_placement_currency: args.placementCurrency ?? null`.

    Step E — `src/app/(app)/jobs/[id]/actions.ts`:
    - Extend `moveSchema` with `placementFeePence: z.number().int().min(0).max(100_000_000).optional().nullable()`, `placementDate: z.string().datetime({ offset: true }).optional().nullable()`, `placementType: z.enum(['perm','contract','temp','fixed_term']).optional().nullable()`, `placementCurrency: z.string().length(3).optional().nullable()` (ISO 4217).
    - Add fail-fast guard mirroring the decline-reason one: `if (toStage === 'placed' && (placementFeePence == null || !placementDate || !placementType)) { return { ok: false, error: 'Capture fee, date, and type before placing.' } }`.
    - Pass the new fields through to `moveApplication(...)`.

    Step F — `src/components/app/placement-modal.tsx` (new file, mirror DeclineModal):
    - Client component (`'use client'`).
    - Props: `applicationId, candidateName, jobId?, candidateId?, open, onOpenChange, onPlaced?, onError?`.
    - Local state: `feeGbp` (string — text input, parsed at submit), `placementDate` (string, ISO date, defaults to today's `YYYY-MM-DD`), `placementType` (`'perm' | 'contract' | 'temp' | 'fixed_term' | ''`), `notes` (string, optional), `isPending`.
    - Layout matches DeclineModal:
      - Title: `Mark {candidateName} as placed`
      - Description: explains this records the placement on the application and writes a stage_change activity with placement metadata.
      - Number input for fee (label "Fee (£)") — `inputMode="decimal"`, accepts integers + up to 2 decimals. On submit convert: `Math.round(parseFloat(feeGbp) * 100)` → `placementFeePence`. Reject NaN / negative.
      - Date input `type="date"`, default `new Date().toISOString().slice(0,10)`. On submit: `new Date(date + 'T00:00:00Z').toISOString()` → `placementDate`.
      - Select for placement type with options Perm / Contract / Temp / Fixed-term (labels resolved locally; values are raw enum strings).
      - Optional Textarea for notes (rows=4).
      - Footer: outline "Cancel" + (primary, no `destructive` variant — placements are positive events) "Confirm placement" button. Disabled until fee parses to a valid non-negative integer of pence AND date present AND type selected.
    - On confirm: `moveApplicationAction({ applicationId, toStage: 'placed', placementFeePence, placementDate, placementType, placementCurrency: 'GBP', jobId: jobId ?? null, candidateId: candidateId ?? null })`. On `ok`: `toast.success('Placement recorded.')`, fire `onPlaced?.(applicationId)`, reset local state, close. On `!ok`: `toast.error(res.error)`, fire `onError?.(applicationId)`.
    - DO NOT import from `'@/components/app/decline-modal'` — implement independently to keep the two evolutions decoupled.

    Constraints check:
    - TypeScript strict — no `any` without `// reason:` comment. The RPC arg cast in `moveApplication` already uses an untyped passthrough — extend that pattern, don't add new `any`s.
    - No new dependencies; uses existing shadcn Dialog/Label/Input/Select/Textarea/Button + sonner.
    - RLS untouched — RPC stays `security invoker`.
    - Migrations append-only; the second migration's `drop function` only removes the OLD signature so the explicit grant on that signature doesn't leak.
  </action>
  <verify>
    <automated>
      pnpm lint && pnpm typecheck && pnpm exec supabase db reset --local 2>&1 | tail -20 && echo "--- check columns ---" && pnpm exec supabase db diff --schema public 2>&1 | grep -E "(placement_type|placement_currency|placement_fields_present)" | head -10
    </automated>
  </verify>
  <done>
    - Both migrations apply cleanly to a fresh local Supabase (`pnpm exec supabase db reset --local`).
    - `\d public.applications` shows `placement_type`, `placement_currency`, and the `placement_fields_present_when_placed` constraint (even if `not valid`).
    - `\df+ public.move_application` shows the new 10-param signature, `security invoker`.
    - `pnpm typecheck` passes with `Enums<'placement_type'>` resolvable.
    - `src/components/app/placement-modal.tsx` exists, exports `PlacementModal`, is referenced by NO call site yet (Task 2 wires it).
    - `moveApplicationAction` rejects `{ toStage: 'placed' }` with no placement fields with error `"Capture fee, date, and type before placing."`.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire PlacementModal into all four move-to-placed surfaces</name>
  <files>
    src/components/app/pipeline-board.tsx,
    src/components/app/pipeline-mobile-list.tsx,
    src/app/(app)/jobs/[id]/application-row-actions.tsx,
    src/app/(app)/candidates/[id]/candidate-applications.tsx
  </files>
  <action>
    Each surface currently calls `moveApplicationAction({ ..., toStage })` (sometimes via a local `performMove`/`handleDropdownMove` helper) AND already renders a DeclineModal for `toStage in ('rejected','withdrawn')`. The change is symmetrical: intercept `toStage === 'placed'` and open PlacementModal instead, only firing the action after the modal confirms.

    Common pattern — apply identically in all four files:
    1. Import `PlacementModal` from `@/components/app/placement-modal`.
    2. Add local state next to the existing `declineState`:
       ```ts
       const [placementState, setPlacementState] = useState<{
         open: boolean
         applicationId: string
         candidateName: string
       } | null>(null)
       ```
    3. In the existing move handler (`handleDropdownMove` / `performMove` / `handleMoveTo` / dropdown onClick), branch BEFORE calling `moveApplicationAction`:
       - if `toStage === 'rejected' || toStage === 'withdrawn'` → existing DeclineModal open path (unchanged).
       - **NEW**: if `toStage === 'placed'` → `setPlacementState({ open: true, applicationId, candidateName })` and return; do NOT optimistically move or call moveApplicationAction here.
       - else → call moveApplicationAction directly (existing path).
    4. Render `<PlacementModal>` next to the existing `<DeclineModal>`, passing `open={placementState?.open ?? false}`, `applicationId`, `candidateName`, `jobId` (when known by the surface), `candidateId` (when known), `onOpenChange={(o) => setPlacementState(prev => prev ? { ...prev, open: o } : null)}`, `onPlaced` and `onError` callbacks that update the parent's optimistic state if any.

    Per-surface specifics:

    a) `src/components/app/pipeline-board.tsx` — TWO entry points to handle:
       - `handleDropdownMove(card, toStage)` (line ~167) — easy branch as above. `onPlaced` should perform the same optimistic local move that `performMove` does today (set `columns` to reflect new stage), since the modal call already wrote to the DB. Wrap that into a tiny helper `optimisticPlace(card)` to avoid duplicating with the dropdown's existing optimistic path.
       - `handleDragEnd` (line ~157) drag-to-Placed-column — when the drop target's stage is `placed`, DO NOT call `performMove`. Capture the card + open PlacementModal. Critically, do NOT optimistically render the card in the Placed column yet — wait for `onPlaced` to fire, then move it. If the modal is cancelled, the card stays in its original column.

    b) `src/components/app/pipeline-mobile-list.tsx` — single entry point `performMove(card, toStage)` at line ~62. Same branch. The current `performMove` optimistically moves THEN calls the action; for placed, defer the optimistic move until `onPlaced` fires.

    c) `src/app/(app)/jobs/[id]/application-row-actions.tsx` — single entry point in the dropdown menu items (around line ~58 where it calls `moveApplicationAction`). Branch on the chosen stage. The "Mark as placed" menu item should open PlacementModal.

    d) `src/app/(app)/candidates/[id]/candidate-applications.tsx` — same as (c). Note the file already has special-case handling near line 43 (`case 'placed'`); make sure the new modal path supersedes whatever that case currently does (likely the same action call). `jobId` is per-row here — pass `candidateApp.job_id` to the modal so `revalidatePath` fires for the right job.

    Visual rule: PlacementModal renders with the primary button (NOT `destructive` variant). The DeclineModal is destructive; PlacementModal is a celebratory event. No styling overrides required beyond using `variant="default"` (omit the prop) on the confirm button.

    Smoke test (manual, after wiring):
    1. Add a candidate to a job. Drag their card from any column to the Placed column on `/jobs/[id]/pipeline`. PlacementModal opens. Fill fee=2500, date=today, type=Perm. Confirm. Card lands in Placed. Toast "Placement recorded.".
    2. Reload — card still in Placed; `applications.fee_pence`, `placed_at`, `placement_type`, `placement_currency` populated; activities timeline shows `Placed — perm` with placement metadata in the row's `metadata` JSONB.
    3. Visit `/reports/source-attribution` (use 90-day default range). The candidate's `source` shows non-zero "Total fee" of £25.00.
    4. From the jobs table row dropdown, mobile list, and candidate-applications row dropdown, attempt the same path — all three open the modal.
    5. Try to "Mark as placed" then click Cancel — card stays put, no DB change.

    Constraints check:
    - No prop drilling beyond what DeclineModal already uses.
    - Optimistic-update semantics: for `placed`, NEVER update local state before the action returns ok. For other stages, behaviour is unchanged.
    - Do NOT bypass `moveApplicationAction` from any new path — the modal is the only new caller of it for placed.
  </action>
  <verify>
    <automated>
      pnpm lint && pnpm typecheck && grep -c "PlacementModal" src/components/app/pipeline-board.tsx src/components/app/pipeline-mobile-list.tsx 'src/app/(app)/jobs/[id]/application-row-actions.tsx' 'src/app/(app)/candidates/[id]/candidate-applications.tsx'
    </automated>
  </verify>
  <done>
    - All four surfaces import and render `PlacementModal`.
    - `grep -v '^//' src/components/app/pipeline-board.tsx | grep -c "PlacementModal"` returns at least 2 (import + render).
    - Same for the other three files (at least 2 occurrences each).
    - No surface calls `moveApplicationAction` with `toStage: 'placed'` directly anymore — the only caller is `PlacementModal`. Verify with: `grep -rn "toStage:\s*'placed'" src/ | grep -v placement-modal.tsx` returns no matches.
    - Manual smoke per the action checklist passes end-to-end.
    - `/reports/source-attribution` renders non-zero "Total fee" for the source of the placed candidate (no code change needed on the report page — it already reads `total_fee_pence`).
  </done>
</task>

</tasks>

<verification>
End-to-end: starting from a fresh `pnpm exec supabase db reset --local`, a recruiter signs in, adds a candidate to a job, drags them to Placed, fills the modal (£25 / today / Perm), reloads, sees the card persistently in Placed, sees the stage_change activity with placement metadata, and finally visits `/reports/source-attribution` and sees the candidate's source row showing 1 placement and £25.00 total fee.

Database invariants:
- `select count(*) from public.applications where stage='placed' and (fee_pence is null or placed_at is null or placement_type is null);` returns 0 for any row created/updated AFTER the migration applied (the `not valid` CHECK still enforces new rows).
- `select pg_get_functiondef('public.move_application'::regproc::oid);` shows the new 10-param signature and the placed-stage UPDATE branch.

UI invariants:
- DeclineModal flow (rejected/withdrawn) is completely unchanged — regression test by declining a candidate end-to-end.
- The "Move to → Placed" menu item is the only path that opens PlacementModal; no other stage opens it.
- Cancel on PlacementModal makes no DB change (no optimistic update for placed).
</verification>

<success_criteria>
- 2 migrations applied: placement_type enum + columns + CHECK; recreated move_application RPC with placement params.
- `src/components/app/placement-modal.tsx` exists and is wired into 4 surfaces.
- moveApplicationAction rejects `toStage='placed'` without all three placement fields.
- Source-attribution report shows non-zero revenue after a placement is recorded.
- `pnpm lint` and `pnpm typecheck` pass.
- Existing decline-to-rejected flow regression-tested manually and passes unchanged.
</success_criteria>

<output>
Create `.planning/quick/260523-qyc-add-placement-fee-capture-modal-prompt-f/260523-qyc-SUMMARY.md` when done.

Reminder (memory `supabase-migrations-manual-push`): run `pnpm exec supabase db push --linked` after merging — GitHub→Supabase auto-apply isn't reliable.
</output>
