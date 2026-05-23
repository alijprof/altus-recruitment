---
phase: quick-260523-tje
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/db/job-ads.ts
  - src/app/(app)/jobs/[id]/ad-panel/actions.ts
  - src/app/(app)/jobs/[id]/ad-panel/saved-ads-list.tsx
  - src/app/(app)/jobs/[id]/ad-panel/saved-ad-row-actions.tsx
  - src/app/(app)/jobs/[id]/ad-panel/saved-ad-view-dialog.tsx
autonomous: true
requirements:
  - UAT-260523-AD-SAVE-UX
must_haves:
  truths:
    - "Saved ad rows render the full markdown body (not a 240-char snippet)"
    - "Each saved ad row has a '...' dropdown with Copy / View full / Delete"
    - "Copy ad puts the full body_markdown on the clipboard and toasts confirmation"
    - "View full opens a Dialog showing the rendered ad plus inclusivity score and suggestion list (when present)"
    - "Delete prompts for confirmation, removes the row, writes an audit_log entry, revalidates /jobs/[id]"
    - "Empty state still rendered when no ads exist"
  artifacts:
    - path: "src/lib/db/job-ads.ts"
      provides: "deleteJobAd helper (returns deleted id + job_id for audit + revalidation)"
      contains: "deleteJobAd"
    - path: "src/app/(app)/jobs/[id]/ad-panel/actions.ts"
      provides: "deleteJobAdAction server action with audit_log + revalidatePath"
      contains: "deleteJobAdAction"
    - path: "src/app/(app)/jobs/[id]/ad-panel/saved-ads-list.tsx"
      provides: "Saved-ads list rendering full body + mounting per-row action island"
      contains: "SavedAdsList"
    - path: "src/app/(app)/jobs/[id]/ad-panel/saved-ad-row-actions.tsx"
      provides: "Client island: '...' dropdown + delete-confirm + clipboard + dialog mount"
      contains: "SavedAdRowActions"
    - path: "src/app/(app)/jobs/[id]/ad-panel/saved-ad-view-dialog.tsx"
      provides: "Read-only Dialog showing rendered ad + score + suggestion list"
      contains: "SavedAdViewDialog"
  key_links:
    - from: "src/app/(app)/jobs/[id]/page.tsx"
      to: "SavedAdsList"
      via: "<SavedAdsList ads={ads} jobId={id} />"
      pattern: "SavedAdsList"
    - from: "src/app/(app)/jobs/[id]/ad-panel/saved-ad-row-actions.tsx"
      to: "deleteJobAdAction"
      via: "server action invocation inside startTransition"
      pattern: "deleteJobAdAction"
    - from: "src/app/(app)/jobs/[id]/ad-panel/actions.ts"
      to: "record_audit RPC"
      via: "supabase.rpc('record_audit', { p_action: 'delete', p_entity_type: 'job_ad', ... })"
      pattern: "record_audit"
---

<objective>
Ship the ad-save UX polish from UAT 260523 Test 6. Today the saved-ads list on
`/jobs/[id]` renders a 240-char preview with no actions — the recruiter cannot
view, copy, or delete a saved ad. This plan delivers a full-body render plus a
per-row `...` dropdown (Copy / View full / Delete) mirroring the existing
`application-row-actions.tsx` pattern. No new dependencies, no migration: the
`job_ads` table already persists `inclusivity_suggestions` jsonb and the
`tenant delete` RLS policy already exists.

Purpose: closes the loop on the Phase 3 ad-panel workflow — once an ad is saved,
the recruiter can actually use it (paste into LinkedIn / a job board / email).

Output:
- `deleteJobAd` DB helper + `deleteJobAdAction` server action with audit hook
- Full-body saved-ad rendering on the job detail page
- Client island for per-row dropdown + clipboard + confirm delete + view-full Dialog
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md

# Existing patterns this plan mirrors
@src/app/(app)/jobs/[id]/application-row-actions.tsx
@src/app/(app)/jobs/[id]/actions.ts
@src/app/(app)/jobs/[id]/ad-panel/actions.ts
@src/app/(app)/jobs/[id]/ad-panel/saved-ads-list.tsx
@src/lib/db/job-ads.ts
@src/lib/db/applications.ts

<interfaces>
<!-- Extracted from src/lib/db/job-ads.ts — already present, no change needed -->

export type JobAdRow = {
  id: string
  organization_id: string
  job_id: string
  created_by: string | null
  body_markdown: string
  inclusivity_score: number | null
  inclusivity_suggestions: unknown | null   // shape: InclusivitySuggestion[] | null
  inclusivity_dimensions: unknown | null    // shape: InclusivityDimensions  | null
  model: string
  cost_pence: number
  created_at: string
  updated_at: string
}

<!-- Extracted from src/lib/ai/ad-generate.ts -->

export type InclusivitySuggestion = {
  original: string
  improved: string
  reason: string
}

<!-- Extracted from src/app/(app)/jobs/[id]/actions.ts — pattern for the audit RPC call -->

const supabaseUntyped = supabase as unknown as {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>
}
const { error: auditErr } = await supabaseUntyped.rpc('record_audit', {
  p_action: 'delete',
  p_entity_type: 'application',
  p_entity_id: <deleted-id>,
  p_metadata: { ... },
})

<!-- Extracted from supabase/migrations/20260520020702_phase3_job_ads.sql -->

-- Already exists; this plan uses it but does NOT modify it:
create policy "tenant delete" on public.job_ads
  for delete to authenticated
  using (organization_id = public.current_organization_id());
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: backend — deleteJobAd helper + deleteJobAdAction with audit hook</name>
  <files>
    src/lib/db/job-ads.ts,
    src/app/(app)/jobs/[id]/ad-panel/actions.ts
  </files>
  <action>
Add the backend half of the ad-row delete flow. Two changes, no migration:

A. **`src/lib/db/job-ads.ts` — add `deleteJobAd`.** Mirror the shape of
   `deleteApplication` in `src/lib/db/applications.ts` (read-then-delete so the
   caller has the row data for audit + revalidation after the row is gone).
   Extend the existing `JobAdsTableClient` type cast so it can `.delete()` and
   `.maybeSingle()` for the pre-read; do NOT introduce `any`. Signature:

       export async function deleteJobAd(
         supabase: SupabaseClient<Database>,
         args: { adId: string },
       ): Promise<DbResult<{ id: string; job_id: string }>>

   Behaviour: select `id, job_id` first via `.eq('id', args.adId).maybeSingle()`;
   if not found return `{ ok: false, code: 'not_found' }`; then `.delete()` by
   id. RLS scopes the read AND the delete to the caller's org, so no manual
   organization_id filter is needed. Sentry-capture both subops with
   `{ layer: 'db', helper: 'deleteJobAd', subop: 'read' | 'delete' }`.

B. **`src/app/(app)/jobs/[id]/ad-panel/actions.ts` — add `deleteJobAdAction`.**
   Mirror `removeApplicationAction` in `src/app/(app)/jobs/[id]/actions.ts`:

   1. Zod-parse `{ adId: z.string().uuid(), jobId: z.string().uuid() }`.
   2. `createSupabaseClient()` + `auth.getUser()` defensive check.
   3. Call `deleteJobAd(supabase, { adId })`. Discriminate on `result.code`:
      `'not_found'` → `{ ok: false, error: 'Ad already removed.' }`; other →
      `{ ok: false, error: 'Could not delete ad.' }`.
   4. After successful delete, call `record_audit` via the same
      `supabaseUntyped.rpc` pattern used in `removeApplicationAction`:
      `p_action: 'delete', p_entity_type: 'job_ad', p_entity_id: <deleted-id>,
      p_metadata: { job_id, via: 'saved_ads_list_row_action' }`.
      Audit failure must be Sentry-captured but MUST NOT block the success
      return — the row is already deleted (same policy as
      `removeApplicationAction`).
   5. `revalidatePath(\`/jobs/${parsed.data.jobId}\`)`.
   6. Return `{ ok: true } | { ok: false; error: string }` as
      `DeleteJobAdActionResult`.

   Export `DeleteJobAdActionResult` so the client island can type the response.

Place the new action at the bottom of `actions.ts` with a header comment block
matching the file's existing style (`---` dividers + a short rationale that
references UAT Test 6).
  </action>
  <verify>
    <automated>pnpm typecheck &amp;&amp; pnpm lint src/lib/db/job-ads.ts src/app/\(app\)/jobs/\[id\]/ad-panel/actions.ts</automated>
  </verify>
  <done>
`deleteJobAd` and `deleteJobAdAction` exist with the signatures above; typecheck
+ lint clean; no `any` introduced; audit RPC call present; no migration touched;
RLS `tenant delete` policy already in place handles the delete authorization.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: frontend — full-body saved-ads list + per-row Copy/View/Delete island</name>
  <files>
    src/app/(app)/jobs/[id]/ad-panel/saved-ads-list.tsx,
    src/app/(app)/jobs/[id]/ad-panel/saved-ad-row-actions.tsx,
    src/app/(app)/jobs/[id]/ad-panel/saved-ad-view-dialog.tsx
  </files>
  <action>
Replace the snippet UI with a full-render list plus a per-row action island.
Three files, no new dependencies — Tailwind `prose`-style classes + the existing
shadcn primitives only. The list stays a Server Component; only the dropdown +
dialog need `'use client'`.

A. **`saved-ads-list.tsx` (Server Component)** — overhaul:

   - Add `jobId: string` to the prop signature so the row-actions island can
     pass it through to `deleteJobAdAction` / `revalidatePath` targets.
   - Keep `ScorePill`, `formatDate`. Delete `previewBody`.
   - Render the full body in a `<div>` (NOT `<pre>`) using
     `whitespace-pre-wrap break-words text-sm leading-relaxed max-w-prose`
     with `bg-muted/40 rounded border p-3`. Match the inline-prose style
     already used in `job-detail-header.tsx` (`max-w-prose ... text-sm
     whitespace-pre-wrap`). No `react-markdown`. Long ads scroll the page, not
     the row — no `max-h-*` clamp.
   - Each `<li>` keeps its header row (score pill + metadata) and gains a
     trailing `<SavedAdRowActions adId={ad.id} jobId={jobId} bodyMarkdown={ad.body_markdown}
     inclusivityScore={ad.inclusivity_score} inclusivitySuggestions={ad.inclusivity_suggestions} />`
     in the top-right of the header flex row (use the same right-side
     placement pattern as the `application-row-actions.tsx` mount on the
     applications table).
   - The empty-state branch is unchanged.

   Update the file header comment to note: "UAT-260523-AD-SAVE-UX: full body
   render + per-row Copy / View full / Delete (mirrors
   application-row-actions.tsx)."

B. **`saved-ad-row-actions.tsx` (Client Component, new)** — `'use client'` at
   the top. Mirror `application-row-actions.tsx` structurally:

   - Imports: `MoreHorizontal` from `lucide-react`, `useRouter` from
     `next/navigation`, `useState` + `useTransition`, `toast` from `sonner`,
     `Button`, all the `DropdownMenu*` primitives from
     `@/components/ui/dropdown-menu`, and `deleteJobAdAction` +
     `DeleteJobAdActionResult` from `./actions`, and the new `SavedAdViewDialog`.
   - Props:

         type Props = {
           adId: string
           jobId: string
           bodyMarkdown: string
           inclusivityScore: number | null
           inclusivitySuggestions: unknown | null  // reason: jsonb from job_ads is shaped as InclusivitySuggestion[] | null but typed unknown on the row; the View dialog narrows it.
         }

   - `useState` for `viewOpen: boolean`. `useTransition` for the delete call.
   - **Copy ad**: `await navigator.clipboard.writeText(bodyMarkdown)` inside an
     async handler; on success `toast.success('Copied to clipboard.')`, on
     reject `toast.error('Could not copy. Try selecting the text manually.')`.
     Guard against missing `navigator.clipboard` (older browsers) by falling
     back to the same error toast.
   - **View full**: `onSelect={() => setViewOpen(true)}` — the dialog renders
     even when closed (controlled `open` prop).
   - **Delete**: `window.confirm('Delete this saved ad? This cannot be undone.')`
     then `startTransition` → `deleteJobAdAction({ adId, jobId })`; on
     `res.ok` toast success + `router.refresh()`; on `!res.ok` toast
     `res.error`. Match the destructive styling on the menu item
     (`className="text-destructive focus:text-destructive"`) as
     `application-row-actions.tsx` does for "Reject…".
   - The DropdownMenuTrigger Button: `variant="ghost"`, `size="icon"`,
     `aria-label={\`Actions for saved ad\`}`, `disabled={isPending}`,
     `className="h-8 w-8"`, with `<MoreHorizontal className="size-4" aria-hidden="true" />`.
   - At the bottom of the returned JSX, render
     `<SavedAdViewDialog open={viewOpen} onOpenChange={setViewOpen}
       bodyMarkdown={bodyMarkdown} inclusivityScore={inclusivityScore}
       inclusivitySuggestions={inclusivitySuggestions} />`.

C. **`saved-ad-view-dialog.tsx` (Client Component, new)** — `'use client'`. A
   thin read-only dialog using the existing shadcn `Dialog` primitives:

   - Imports: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`,
     `DialogDescription`, `DialogFooter` from `@/components/ui/dialog`; `Badge`
     from `@/components/ui/badge`; `Button` from `@/components/ui/button`.
   - Props: `{ open: boolean; onOpenChange: (v: boolean) => void; bodyMarkdown:
     string; inclusivityScore: number | null; inclusivitySuggestions: unknown | null }`.
   - Narrow `inclusivitySuggestions` inside the component with a small type
     guard (no `any`): treat as an array, filter to entries that look like
     `{ original, improved, reason }` where all three are strings. Anything
     else collapses to an empty list.
   - `DialogContent`: wide enough to read (`className="max-w-2xl
     max-h-[85vh] overflow-y-auto"`). `DialogTitle="Saved ad"`. Description:
     `"Read-only view. Use Copy ad from the row menu to send it elsewhere."`.
   - Body: the inclusivity score badge (same pill colour rules as the list),
     then the ad text in a `<div>` with the same `whitespace-pre-wrap
     max-w-none text-sm leading-relaxed` styling as the list (no row scrolling
     — the Dialog scrolls). Then, if the narrowed suggestions list is
     non-empty, a `<section>` titled "Inclusivity suggestions" with a `<ul>`
     of `<li>` each rendering `original → improved` plus the `reason` muted
     below.
   - `DialogFooter`: a single `Close` button (`<Button variant="outline"
     onClick={() => onOpenChange(false)}>Close</Button>`).

The result: the saved-ads section becomes a usable artefact — the recruiter
can see the whole ad, copy it, view it in a roomy dialog with suggestions, or
delete a bad save with one confirm. The Server Component remains the list
shell; only the per-row controls + dialog ship as a small client island.

Finally, update `src/app/(app)/jobs/[id]/page.tsx` to pass `jobId={id}` to
`<SavedAdsList>` (the only call site).
  </action>
  <verify>
    <automated>pnpm typecheck &amp;&amp; pnpm lint src/app/\(app\)/jobs/\[id\]/ad-panel src/app/\(app\)/jobs/\[id\]/page.tsx</automated>
  </verify>
  <done>
Saved-ads list renders the full body of every ad (no snippet); each row has a
'...' dropdown with Copy ad / View full / Delete; Copy puts the markdown on the
clipboard with a toast; View full opens a read-only Dialog with the rendered
ad, score badge, and (when present) the inclusivity suggestions; Delete
prompts, calls `deleteJobAdAction`, revalidates `/jobs/[id]`, and toasts the
outcome; no new dependencies; typecheck + lint clean; no `any` introduced.
  </done>
</task>

</tasks>

<verification>
After both tasks land:

1. `pnpm typecheck` passes.
2. `pnpm lint` passes for the touched paths.
3. Manual end-to-end on `/jobs/[id]`:
   - Generate + Save an ad via the existing AdPanel.
   - Confirm the row shows the full markdown (not a `…` snippet).
   - Click `...` → Copy ad → paste into a scratch file; full body matches.
   - Click `...` → View full → Dialog opens, score badge correct, suggestions
     list renders when the underlying ad has any.
   - Click `...` → Delete → confirm → row disappears after revalidation; toast
     fires; `audit_log` row exists (`action='delete', entity_type='job_ad'`).
4. Cross-tenant isolation untouched — RLS `tenant delete` policy already
   restricts deletes to the caller's org.
</verification>

<success_criteria>
- Recruiter can read, copy, view, and delete saved ads on `/jobs/[id]`
  without leaving the page.
- Every delete writes an `audit_log` entry (compliance picture intact).
- No new dependencies, no new migration, no RLS change.
- All work behind the existing TypeScript strict rules + shadcn primitives.
</success_criteria>

<output>
Create `.planning/quick/260523-tje-ad-save-ux-polish-full-saved-ad-render-p/260523-tje-SUMMARY.md` when done.
</output>
