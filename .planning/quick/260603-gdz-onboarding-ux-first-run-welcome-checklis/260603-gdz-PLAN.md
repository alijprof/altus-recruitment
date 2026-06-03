---
phase: quick-260603-gdz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/db/dashboard.ts
  - src/app/(app)/page.tsx
  - src/app/(app)/_dashboard/welcome-checklist.tsx
  - src/components/app/empty-state.tsx
  - src/app/(app)/settings/page.tsx
  - src/app/(app)/settings/team/page.tsx
  - src/app/(app)/settings/team/pending-invites-list.tsx
  - src/app/(app)/settings/team/invite-member-dialog.tsx
  - src/app/(app)/settings/team/resend-invite-button.tsx
  - src/app/(app)/settings/team/revoke-invite-button.tsx
autonomous: false
requirements: [ONBOARD-1, ONBOARD-2, ONBOARD-3, ONBOARD-4]

must_haves:
  truths:
    - "A new org sees a dismissible welcome checklist on the dashboard whose step ticks come from real DB counts, not localStorage"
    - "Each checklist step links to its real route (/candidates/new, /clients/new, /settings/team, /spec/new) and routes are confirmed to exist"
    - "The checklist auto-hides when all four steps are complete, even if never dismissed"
    - "Dismissing the checklist persists across reloads via a single localStorage flag, and the dismiss component never crashes during SSR"
    - "The dashboard empty state explains how Candidates + Jobs drive the pipeline → AI matches → placements, and keeps its CTAs"
    - "Per-page empty states on /candidates, /clients, /jobs give a clear one-line value statement and a primary CTA"
    - "Owners see an 'Invite your team' card and a plain-English role explainer on /settings; non-owners do not see the invite card"
    - "Sending, resending, or revoking an invite updates the pending-invites list immediately (optimistic) without a full page refresh"
    - "If an invite mutation rejects, the optimistic row rolls back AND an error toast shows — no false-success state"
  artifacts:
    - path: "src/app/(app)/_dashboard/welcome-checklist.tsx"
      provides: "Dismissible, data-driven first-run checklist (client component for dismiss + mounted guard)"
      contains: "use client"
    - path: "src/app/(app)/settings/team/pending-invites-list.tsx"
      provides: "Client wrapper owning the optimistic pending-invites array"
      contains: "useOptimistic"
    - path: "src/lib/db/dashboard.ts"
      provides: "Extended metrics fetch exposing clients + jobs + team-member counts for the checklist"
      contains: "getOnboardingCounts"
  key_links:
    - from: "src/app/(app)/page.tsx"
      to: "src/app/(app)/_dashboard/welcome-checklist.tsx"
      via: "RSC passes real counts as props"
      pattern: "WelcomeChecklist"
    - from: "src/app/(app)/settings/team/pending-invites-list.tsx"
      to: "src/app/(app)/settings/team/actions.ts"
      via: "server actions invoked inside useOptimistic transition; result.ok gates rollback + toast"
      pattern: "useOptimistic"
---

<objective>
Ship four onboarding UX improvements for Altus with NO database/schema changes and NO new dependencies:

1. A dismissible, data-driven first-run welcome checklist on the dashboard.
2. Richer dashboard empty state + tightened per-page empty states (candidates/clients/jobs).
3. An owner-only "Invite your team" card + plain-English role explainer on /settings.
4. Optimistic invite UI (send/resend/revoke) on /settings/team with mandatory error surfacing + rollback.

Purpose: A new org's first session should make the next action obvious and reflect real progress, and invite management should feel instant instead of requiring a refresh.

Output: One new dashboard client component, one new team client wrapper, edits to the dashboard data layer, the dashboard page, the shared empty-state callers, the settings page, and the three team invite client components.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md

# Conventions are NON-NEGOTIABLE (from CLAUDE.md + .planning conventions):
# - No semicolons, single quotes, 2-space indent, trailing commas everywhere, printWidth 100
# - Server Components are the default; add 'use client' ONLY for state/effects/event handlers
# - Mutations via Server Actions (already exist for invites) — do NOT add route handlers
# - Non-component files kebab-case; component files PascalCase export but kebab-case filename
#   (existing team components are kebab-case filenames exporting PascalCase — MATCH that)
# - No `any` without a `// reason:` comment
# - noUncheckedIndexedAccess is ON — array index access is `T | undefined`, guard it
# - React Query / mutation rule: NEVER leave a false-success state. On reject: roll back + toast.error.
#   Do not close a dialog / mutate UI as if it succeeded when the server action returned !ok.

<interfaces>
<!-- Extracted from codebase. Executor should use these directly — no exploration needed. -->

From src/components/app/empty-state.tsx (REUSE — do not reinvent):
```typescript
export type EmptyStateProps = {
  heading: string
  body?: string
  cta?: { href: string; label: string } | null
  secondaryCta?: { href: string; label: string } | null
  className?: string
}
export function EmptyState(props: EmptyStateProps): JSX.Element
```

From src/lib/db/dashboard.ts (existing — Task 1 EXTENDS this file):
```typescript
export type DashboardMetrics = {
  candidates: number
  openJobs: number
  openApplications: number
  placementsThisMonth: number
}
export async function getDashboardMetrics(
  supabase: SupabaseClient<Database>,
): Promise<DashboardMetrics>
// NOTE: existing metrics does NOT expose a clients count, a total-jobs count,
// or a team-member count. The checklist needs those. Add a small sibling
// count helper rather than overloading getDashboardMetrics (keeps the metric
// cards' meaning intact: "Open jobs" must stay status='open').
```

From src/app/(app)/settings/team/actions.ts (existing server actions — DO NOT change their signatures):
```typescript
type ActionResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

export async function inviteMemberAction(rawInput: unknown): Promise<ActionResult>
export async function revokeInviteAction(rawInput: unknown): Promise<ActionResult>
export async function resendInviteAction(rawInput: unknown): Promise<ActionResult>
// All three call revalidatePath('/settings/team') on success — that is what
// currently forces the refresh. After this plan the optimistic list updates
// instantly; revalidatePath still re-syncs the canonical server data underneath.
```

From src/app/(app)/settings/team/page.tsx (existing — the PendingInvite row shape the new client wrapper must accept as a prop):
```typescript
type PendingInvite = {
  id: string
  email: string
  expires_at: string
  created_at: string
  invited_by: string
}
// Page also derives `inviterLabel` per row from the members array (memberById).
// The optimistic list must keep rendering inviter + expiry + Resend/Revoke buttons.
```

Sonner Toaster is mounted globally in src/app/layout.tsx (`<Toaster richColors closeButton position="top-right" />`).
So `toast.success` / `toast.error` from 'sonner' work everywhere — no setup needed.
</interfaces>

@src/app/(app)/page.tsx
@src/components/app/empty-state.tsx
@src/app/(app)/settings/page.tsx
@src/app/(app)/settings/team/page.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Data-driven welcome checklist + richer dashboard empty state</name>
  <files>
    src/lib/db/dashboard.ts,
    src/app/(app)/_dashboard/welcome-checklist.tsx,
    src/app/(app)/page.tsx
  </files>
  <action>
    Implements ONBOARD-1 (checklist) and the dashboard half of ONBOARD-2 (richer empty state).

    STEP A — data layer (src/lib/db/dashboard.ts): Add an exported async helper `getOnboardingCounts(supabase)` returning `{ candidates: number; clients: number; jobs: number; teamMembers: number }`. Use four parallel `select('id', { count: 'exact', head: true })` count queries against tables `candidates`, `companies` (clients are the `companies` table per the existing dashboard resolveEntity mapping company → /clients), `jobs` (ALL statuses — the checklist step is "upload a job spec", not "open job"), and `users` (team members). Do NOT append organization_id filters — RLS is the tenancy authority (mirror the existing getDashboardMetrics comment). Wrap each `.error` in `Sentry.captureException` with `tags: { layer: 'db', helper: 'getOnboardingCounts:<table>' }` exactly like the existing helper, and coalesce `count ?? 0`. This is read-only — NO schema change.

    STEP B — checklist component (new file src/app/(app)/_dashboard/welcome-checklist.tsx): Mark `'use client'` (it needs localStorage for the dismiss flag + a mounted guard). Props: `{ candidates: number; clients: number; jobs: number; teamMembers: number }`. Derive four steps, each `{ label, href, done }`:
      - "Add your first candidate" → /candidates/new → done when candidates > 0
      - "Add your first client" → /clients/new → done when clients > 0
      - "Invite a teammate" → /settings/team → done when teamMembers > 1
      - "Upload a job spec" → /spec/new → done when jobs > 0
    DISMISS persistence: read/write a single localStorage key `altus.welcomeChecklist.dismissed` ('1' = dismissed). SSR guard: initialise a `mounted` state to false in a `useEffect` that reads localStorage and sets mounted=true; render `null` until mounted (prevents hydration mismatch — there is no localStorage on the server). AUTO-HIDE: if all four steps `done`, render `null` regardless of the dismiss flag. Also render `null` if the dismiss flag is set. Otherwise render a shadcn `Card` titled "Get started" with a short subtitle, a list of the four steps (each a `Link` to its href; completed steps show a filled lucide `CheckCircle2` and muted/struck label, incomplete steps show `Circle` and an arrow affordance), and a small ghost "Dismiss" button that writes the localStorage flag and hides the card via state. Match existing card styling patterns (see /settings cards). Do NOT store step completion in localStorage — only the dismiss flag.

    STEP C — wire into dashboard (src/app/(app)/page.tsx): In the RSC, add `getOnboardingCounts(supabase)` to the existing `Promise.all` parallel fetch. Render `<WelcomeChecklist candidates=... clients=... jobs=... teamMembers=... />` at the TOP of the populated dashboard (before the metrics section) so an org with partial data still gets guidance. ALSO improve the `isEmpty` branch's EmptyState: keep the existing two CTAs but expand the `body` to a one-or-two-sentence hero explaining the flow — Candidates + Jobs drive the pipeline, AI generates match explanations, matches become placements. Copy only; keep the existing EmptyState component + props.

    Keep formatting strict: no semicolons, single quotes, 2-space, trailing commas.
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint</automated>
    <human-check>On an EMPTY/seed org: dashboard shows the "Get started" checklist with all steps unticked and correct links; after adding a candidate the first step ticks on reload; clicking Dismiss hides it and it stays hidden after reload. On the POPULATED anchor org: pre-smoke confirms NO client errors and (if all steps already complete) the checklist auto-hides — empty-state copy can only be fully UAT'd against an empty org.</human-check>
  </verify>
  <done>
    getOnboardingCounts exported and called in the dashboard Promise.all; welcome-checklist.tsx exists as a 'use client' component that renders null during SSR/until mounted, auto-hides when all done, persists only the dismiss flag; dashboard empty-state body explains the candidate→job→pipeline→AI-match→placement flow with CTAs intact; typecheck + lint pass.
  </done>
</task>

<task type="auto">
  <name>Task 2: Tighten per-page empty states + settings invite card & role explainer</name>
  <files>
    src/app/(app)/candidates/page.tsx,
    src/app/(app)/clients/page.tsx,
    src/app/(app)/jobs/page.tsx,
    src/app/(app)/settings/page.tsx
  </files>
  <action>
    Implements the per-page half of ONBOARD-2 and all of ONBOARD-3. PURE copy/layout + an owner-gated card — NO logic changes to data fetching, sorting, or pagination.

    STEP A — per-page empty states (candidates, clients, jobs pages): These already use the shared `<EmptyState>` in their empty branches. Tighten the `heading` + `body` so each leads with a clear one-line value statement and keeps a single primary CTA (and the jobs page's existing secondaryCta to /spec/new). Examples of the desired tone (refine, don't copy verbatim): candidates "Your talent pool starts here — add a candidate, then upload their CV to auto-extract skills and make them searchable."; clients "Clients are the companies you place into — add one to log contacts, jobs and revenue."; jobs keep the existing two-CTA shape. Do NOT touch the `isEmptyDatabase` / `isEmpty` derivation, the search/no-match branches, or any list rendering. Only the EmptyState `heading`/`body`/CTA-label strings change.

    STEP B — settings invite card + role explainer (src/app/(app)/settings/page.tsx): The page already computes `isOwner` and already gates an owner-only Team link card with `{isOwner ? ... : null}`. Add, INSIDE the existing `{isOwner ? (...) : null}` owner gate (or as a second owner-gated block beside the Team card), an "Invite your team" Card whose CTA links to /settings/team — phrase it as an active nudge ("Bring your colleagues into Altus") distinct from the existing passive Team-management card; reuse the same Card + ChevronRight pattern already in the file. Then add a role explainer that is visible to EVERYONE (owners and recruiters): a short Card (or CardDescription block) in plain English — "Owners manage organisation settings and invite/manage teammates. Recruiters add candidates, clients and jobs, and work the pipeline." Add a `<Separator />` between new sections to match the file's existing rhythm. Role-gate the invite nudge CONSISTENTLY with the existing `isOwner` checks — do not invent a new gating mechanism. Copy + existing components only.

    Keep formatting strict: no semicolons, single quotes, 2-space, trailing commas. Escape apostrophes in JSX text as `&apos;` (the file already does this).
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint</automated>
    <human-check>Per-page empty states only fully render on an empty/seed org — pre-smoke against an empty org confirms each shows the new one-line value + CTA. On /settings as an OWNER: the "Invite your team" card and the role explainer both render and the invite card links to /settings/team. As a RECRUITER (non-owner): the invite card is HIDDEN but the role explainer still shows. Pre-smoke on the populated org confirms no client errors.</human-check>
  </verify>
  <done>
    candidates/clients/jobs empty-state copy tightened with one-line value + primary CTA, no logic changed; /settings shows an owner-only "Invite your team" card linking to /settings/team plus an everyone-visible plain-English role explainer, gated consistently with existing isOwner usage; typecheck + lint pass.
  </done>
</task>

<task type="auto">
  <name>Task 3: Optimistic invite UI on /settings/team with rollback + error toast</name>
  <files>
    src/app/(app)/settings/team/pending-invites-list.tsx,
    src/app/(app)/settings/team/page.tsx,
    src/app/(app)/settings/team/invite-member-dialog.tsx,
    src/app/(app)/settings/team/resend-invite-button.tsx,
    src/app/(app)/settings/team/revoke-invite-button.tsx
  </files>
  <action>
    Implements ONBOARD-4. Make send/resend/revoke reflect in the UI immediately instead of requiring a full refresh, WITHOUT swallowing rejections.

    CRITICAL (CLAUDE.md mutation rule): the server actions in actions.ts already return `{ ok: true } | { ok: false, formError } | { ok: false, fieldErrors }`. On any `!ok` result OR thrown error you MUST (a) roll back the optimistic change and (b) `toast.error(...)`. Never leave a false-success row. Do NOT change the server action signatures or their `revalidatePath('/settings/team')` calls — revalidatePath re-syncs the canonical list underneath the optimistic layer.

    STEP A — new client wrapper (src/app/(app)/settings/team/pending-invites-list.tsx): `'use client'`. Accept props `{ pending: PendingInviteRow[] }` where each row carries everything the current page renders per invite: `{ id, email, inviterLabel, createdAt, expiresAt }` (resolve inviterLabel in the RSC and pass it down — keep the existing memberById lookup server-side; do NOT fetch in the client). Use `useOptimistic(pending, reducer)` with actions `{ type: 'remove'; id }` (revoke) and `{ type: 'refresh'; id }` (resend → mark a row as "Resending…" briefly) and `{ type: 'add'; row }` (new invite). Render the same list markup currently in page.tsx's Pending invitations Card body (inviter + expiry + Resend/Revoke), driven by the optimistic array, including the empty "No pending invitations." state. Provide context/callbacks so the Resend/Revoke buttons and the invite dialog can dispatch optimistic actions. Because `useOptimistic` only applies inside a transition and auto-reverts when the transition ends, wrap each action call in `startTransition`; if the awaited server action returns `!ok` (or throws), call `toast.error` with the action's `formError` (or a fallback) — the optimistic state reverts automatically when the transition resolves to the unchanged server prop, so the row reappears (revoke) / the new row disappears (invite). Show `toast.success` only on `ok: true`.

    STEP B — wire page.tsx (RSC): Replace the inline Pending invitations list body with `<PendingInvitesList pending={pendingRows} />`, building `pendingRows` from the existing `pending` + `memberById` (compute `inviterLabel` server-side exactly as the current JSX does). Keep the Card/CardHeader/CardDescription shell in the RSC; only the list body moves into the client component. Members list and InviteMemberDialog placement stay as-is.

    STEP C — adapt the three existing client components to participate:
      - invite-member-dialog.tsx: on a successful `inviteMemberAction`, optimistically add the new pending row (email known from the form; createdAt = now, expiresAt = now + 7d for display, inviterLabel = "You"). Keep the existing zod fieldErrors handling and the existing `toast.error(result.formError)` on failure — on failure do NOT add the row.
      - resend-invite-button.tsx: dispatch the optimistic "refresh" (brief Resending state) before awaiting; on `!ok` toast.error and let the optimistic state revert. Keep existing success toast.
      - revoke-invite-button.tsx: dispatch optimistic "remove" inside the confirm transition; on `!ok` toast.error and let the row revert (reappear). Keep the AlertDialog confirm flow + existing success toast.
    The cleanest wiring is for PendingInvitesList to own the optimistic state and expose dispatch callbacks via props/context to its child rows; the InviteMemberDialog (rendered in the page header, outside the list) can call a shared callback passed down from the same client boundary — if that crosses the RSC boundary awkwardly, hoist the InviteMemberDialog render INTO PendingInvitesList (or a shared client island) so dialog + list share one `useOptimistic`. Do NOT introduce any new dependency or global store to achieve this.

    Keep formatting strict: no semicolons, single quotes, 2-space, trailing commas, `&apos;` for apostrophes in JSX.
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint</automated>
    <human-check>Pre-smoke against the live app as an owner: (1) Send an invite → the new pending row appears instantly without a full reload; a success toast shows. (2) Revoke a pending invite → the row disappears immediately; success toast. (3) Resend → brief Resending state then success toast, row remains. (4) FORCE A FAILURE (e.g. invite an email that already has a pending invite, which the action rejects with a fieldError/formError) → confirm the optimistic row does NOT stick: it rolls back and an error toast appears, no false-success. Check the browser console for zero client errors throughout.</human-check>
  </verify>
  <done>
    pending-invites-list.tsx owns a useOptimistic pending array; page.tsx passes server-resolved rows (incl. inviterLabel) to it; invite/resend/revoke update the list instantly and, on any !ok result or thrown error, roll back the optimistic change AND show toast.error (no false-success); server action signatures and revalidatePath unchanged; typecheck + lint pass.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → server action (invite/resend/revoke) | Untrusted form input; ownership + org scoping enforced server-side |
| browser localStorage → dashboard UI | Client-only dismiss flag; advisory, never a security control |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-gdz-01 | Elevation of Privilege | Optimistic invite UI dispatch | accept | Optimistic state is presentation-only; authority remains in actions.ts (owner check + RLS, unchanged). A non-owner who forges an optimistic row still gets a rejected server action → rollback + toast. |
| T-gdz-02 | Spoofing | localStorage dismiss flag | accept | Per-browser cosmetic flag; carries no auth/tenancy meaning and gates no data. Worst case: checklist reappears on another device. Step completion is DB-derived, so it cannot be spoofed to "complete". |
| T-gdz-03 | Information Disclosure | getOnboardingCounts head-count queries | mitigate | Counts run on the user-scoped Supabase client; RLS scopes every count to the caller's org. No organization_id is appended client-side and no service-role is used. |
| T-gdz-04 | Tampering | Mutation false-success (CLAUDE.md class) | mitigate | Every optimistic mutation rolls back on `!ok`/throw and surfaces `toast.error`; no dialog closes / row persists on failure. Verified in Task 3 human-check by forcing a duplicate-invite rejection. |
| T-gdz-SC | Tampering | npm/pip/cargo installs | mitigate | No new dependencies are added by this plan. No install tasks → no package-legitimacy checkpoint required. |
</threat_model>

<verification>
- `pnpm typecheck` passes (strict mode, noUncheckedIndexedAccess) after every task.
- `pnpm lint` passes after every task.
- No new files in `package.json` dependencies (grep `git diff package.json` shows no dependency changes).
- No new migration files under `supabase/migrations/` (this plan is UI-only; schema untouched).
- MANDATORY PRE-UAT PIPELINE (CLAUDE.md HARD RULE #1) before asking the user to test:
  1. `/gsd-code-review` on the changed files — specifically check the optimistic mutations surface errors (toast + rollback) and do not leave a false-success state.
  2. `vercel:verification` browser pre-smoke against the deployed preview/prod URL for the invite flow + dashboard render.
- UAT NOTE: the welcome checklist and per-page empty states only fully render against an EMPTY/seed org. The live anchor org has data, so the browser pre-smoke there only confirms no-regression + zero client errors on a populated org. The empty-org UX must be verified on a seed/demo org.
</verification>

<success_criteria>
- Dashboard shows a dismissible, DB-count-driven welcome checklist for new/partial orgs; auto-hides when all four steps complete; only the dismiss flag is client-persisted and SSR-safe.
- Dashboard empty state explains the candidate→job→pipeline→AI-match→placement flow; per-page empty states (candidates/clients/jobs) lead with a one-line value + primary CTA.
- /settings shows an owner-only "Invite your team" card linking to /settings/team plus an everyone-visible plain-English role explainer, gated consistently with existing `isOwner`.
- /settings/team invite send/resend/revoke update the pending list instantly; any failure rolls back the optimistic change and shows an error toast (no false-success).
- No schema changes, no new dependencies; `pnpm lint` + `pnpm typecheck` pass.
</success_criteria>

<output>
Create `.planning/quick/260603-gdz-onboarding-ux-first-run-welcome-checklis/260603-gdz-SUMMARY.md` when done.
</output>
