---
phase: quick-260524-cjl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/app/empty-state.tsx
  - src/app/(app)/candidates/page.tsx
  - src/app/(app)/clients/page.tsx
  - src/app/(app)/jobs/page.tsx
  - src/app/(app)/pipeline/page.tsx
  - src/app/(app)/floats/page.tsx
  - src/app/(app)/spec/page.tsx
  - src/app/(app)/reports/source-attribution/page.tsx
  - src/app/(app)/page.tsx
autonomous: true
requirements:
  - QUICK-260524-CJL

must_haves:
  truths:
    - "Every one of the 8 listed index pages, when the underlying dataset is empty, renders a richer EmptyState with a heading, a value-explaining body, and a primary CTA."
    - "EmptyState supports an optional secondary CTA (label + href) rendered as a subdued button next to / below the primary."
    - "Candidates empty state offers a secondary 'Or upload a CV to auto-extract' link."
    - "Jobs empty state offers two paths (spec call OR creating against a client), surfaced as primary + secondary CTAs."
    - "Spec calls, clients, floats, reports/source-attribution, and the dashboard empty states use the shared EmptyState component (no bespoke divs left)."
    - "No CTA links to a route that does not exist; `/jobs/new` is replaced with the existing `/clients` (jobs created against a client) and noted in SUMMARY.md."
    - "`pnpm lint` and `pnpm typecheck` both pass after the change."
  artifacts:
    - path: "src/components/app/empty-state.tsx"
      provides: "EmptyState component with optional secondary CTA"
      contains: "secondaryCta"
    - path: "src/app/(app)/candidates/page.tsx"
      provides: "Empty state with primary (Add candidate) + secondary (upload CV) CTA"
    - path: "src/app/(app)/clients/page.tsx"
      provides: "EmptyState replacing bespoke empty div; primary CTA → /clients/new"
    - path: "src/app/(app)/jobs/page.tsx"
      provides: "Empty state with primary (record spec call) + secondary (view clients) CTA"
    - path: "src/app/(app)/pipeline/page.tsx"
      provides: "Sharper empty-state copy + CTA → /jobs"
    - path: "src/app/(app)/floats/page.tsx"
      provides: "EmptyState replacing bespoke div; explanatory CTA → /candidates"
    - path: "src/app/(app)/spec/page.tsx"
      provides: "EmptyState replacing inline Card; primary CTA → /spec/new"
    - path: "src/app/(app)/reports/source-attribution/page.tsx"
      provides: "Improved empty copy when 0 placements; CTA → /pipeline"
    - path: "src/app/(app)/page.tsx"
      provides: "Dashboard empty state with secondary CTA → /clients/new"
  key_links:
    - from: "src/app/(app)/candidates/page.tsx"
      to: "src/components/app/empty-state.tsx"
      via: "import { EmptyState }"
      pattern: "from '@/components/app/empty-state'"
    - from: "src/app/(app)/clients/page.tsx"
      to: "src/components/app/empty-state.tsx"
      via: "import { EmptyState }"
      pattern: "from '@/components/app/empty-state'"
    - from: "src/app/(app)/spec/page.tsx"
      to: "src/components/app/empty-state.tsx"
      via: "import { EmptyState }"
      pattern: "from '@/components/app/empty-state'"
    - from: "src/app/(app)/floats/page.tsx"
      to: "src/components/app/empty-state.tsx"
      via: "import { EmptyState }"
      pattern: "from '@/components/app/empty-state'"
---

<objective>
Polish every empty state on the 8 main index pages so a first-time user understands (a) why the section matters, (b) what to do next, and (c) what alternative exists. Reuse the shared `EmptyState` component everywhere — extend it once to support an optional secondary CTA, then wire it across the index pages, replacing the small handful of bespoke empty `<div>`s that have drifted from the pattern.

Purpose: First-run UX is the single biggest source of "what do I do now?" friction for the anchor customer. Today some pages have rich empty states (dashboard, candidates) and others have bare one-liners (clients, spec, floats, reports). The result feels inconsistent. This task makes the empty-state pattern consistent and points each page at the most likely next action.

Output: Updated `EmptyState` component + 8 polished empty states across the app, all using the same shared component.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@src/components/app/empty-state.tsx
@src/app/(app)/candidates/page.tsx
@src/app/(app)/clients/page.tsx
@src/app/(app)/jobs/page.tsx
@src/app/(app)/pipeline/page.tsx
@src/app/(app)/floats/page.tsx
@src/app/(app)/spec/page.tsx
@src/app/(app)/reports/source-attribution/page.tsx
@src/app/(app)/page.tsx

<interfaces>
<!-- Current EmptyState public API (src/components/app/empty-state.tsx) -->

```typescript
export type EmptyStateProps = {
  heading: string
  body?: string
  cta?: { href: string; label: string } | null
  className?: string
}

export function EmptyState(props: EmptyStateProps): JSX.Element
```

The component renders inside a `rounded-md border bg-card px-6 py-16 text-center` container. Heading is `text-xl font-semibold tracking-tight`; body is `text-muted-foreground mt-2 max-w-md text-sm font-normal`; the CTA is a `Button asChild` wrapping a `next/link`. The whole component is a Server Component (no `'use client'`).

<!-- Route existence (verified): -->
- `/candidates/new` — EXISTS (`src/app/(app)/candidates/new/page.tsx`)
- `/clients/new` — EXISTS (`src/app/(app)/clients/new/page.tsx`)
- `/jobs/new` — DOES NOT EXIST. Jobs are created from the client detail page (existing jobs empty state already uses `/clients` as the CTA — preserve that behaviour and surface in SUMMARY.md)
- `/spec/new` — EXISTS (`src/app/(app)/spec/new/page.tsx`)

<!-- Already-imported lucide icons in the codebase (use these, no new icons): -->
Plus, Building2, Briefcase, Mic, Upload, Users, MessageSquare, MessageSquarePlus, Sparkles, ArrowRight, ExternalLink
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extend EmptyState with optional secondary CTA</name>
  <files>src/components/app/empty-state.tsx</files>
  <behavior>
    - Component still accepts `heading`, `body`, `cta`, `className` exactly as today (no breaking changes).
    - Adds an optional `secondaryCta?: { href: string; label: string } | null` prop.
    - When `secondaryCta` is provided AND `cta` is provided, renders both side by side: primary `Button` (default variant), secondary `Button` with `variant="outline"`, both as `Link`s. Gap between them is `gap-2`, stacked vertically on mobile (`flex-col sm:flex-row`).
    - When only `secondaryCta` is provided (no primary), it still renders as the outline button.
    - When neither is provided, no button row is rendered (matches today).
  </behavior>
  <action>
    Edit `src/components/app/empty-state.tsx`:

    1. Add `secondaryCta?: { href: string; label: string } | null` to `EmptyStateProps`.
    2. Replace the current single-button render block with a row container that conditionally renders the primary button and/or the secondary button:
       - Wrap both buttons in a `<div className="mt-6 flex flex-col sm:flex-row items-center gap-2">` that is only rendered if either `cta` or `secondaryCta` is truthy.
       - Primary: existing `Button asChild` (default variant) wrapping `<Link href={cta.href}>{cta.label}</Link>`.
       - Secondary: `Button asChild variant="outline"` wrapping `<Link href={secondaryCta.href}>{secondaryCta.label}</Link>`.
    3. Keep the file as a Server Component (no `'use client'`). Do not introduce new imports beyond what's already there — `Button` and `Link` are sufficient.
    4. Preserve the existing single-CTA layout when `secondaryCta` is absent so existing callers don't visually shift (single button stays centered with `mt-6`).

    DO NOT add icons to the EmptyState component itself — keep it text-only; per-page callers already use icons inline if they want them inside button labels.
  </action>
  <verify>
    <automated>pnpm typecheck</automated>
  </verify>
  <done>EmptyState exports `secondaryCta` in its props; both single-CTA and dual-CTA cases render correctly; typecheck passes.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Wire richer EmptyStates across the 8 index pages</name>
  <files>src/app/(app)/candidates/page.tsx, src/app/(app)/clients/page.tsx, src/app/(app)/jobs/page.tsx, src/app/(app)/pipeline/page.tsx, src/app/(app)/floats/page.tsx, src/app/(app)/spec/page.tsx, src/app/(app)/reports/source-attribution/page.tsx, src/app/(app)/page.tsx</files>
  <action>
    For every page below, replace the current empty-state markup with `EmptyState` from `@/components/app/empty-state`, using the heading / body / primary CTA / secondary CTA shown. Keep all other page logic untouched. Where the page already uses `EmptyState`, only upgrade the props.

    1. **`src/app/(app)/candidates/page.tsx`** (already uses EmptyState — upgrade props only):
       - heading: `"Add your first candidate"`
       - body: `"Candidates are the heart of the CRM. Add one manually, or upload a CV and we'll auto-extract their details."`
       - cta: `{ href: '/candidates/new', label: 'Add candidate' }`
       - secondaryCta: `{ href: '/candidates/new?upload=1', label: 'Upload a CV' }` — if `?upload=1` is not currently handled, leave the same `/candidates/new` href but keep the secondary label; either way the secondary just deep-links into the same form. Use `/candidates/new` for both for now (the new form already supports CV upload).
       - Final secondaryCta to ship: `{ href: '/candidates/new', label: 'Or upload a CV to auto-extract' }`.

    2. **`src/app/(app)/clients/page.tsx`** (currently uses a bespoke `<div>` with a `Plus` icon button — REPLACE with EmptyState):
       - Remove the bespoke empty `<div className="bg-card flex flex-col items-center ...">` block entirely.
       - Add `import { EmptyState } from '@/components/app/empty-state'` at the top.
       - In the `if (isEmpty)` branch, render:
         - heading: `"Add your first client"`
         - body: `"Clients are the companies you place candidates into. Add one to start logging contacts, jobs, and revenue against them."`
         - cta: `{ href: '/clients/new', label: 'Add client' }`
       - No secondary CTA for clients (single, obvious next step).
       - The `Plus` icon import becomes unused inside the empty branch — keep the import only if still used in the header `Add client` button (it is — leave it).

    3. **`src/app/(app)/jobs/page.tsx`** (already uses EmptyState):
       - heading: `"Add your first job"`
       - body: `"Jobs hang off a client. Pick a client and create a job against them — or record a spec call and we'll extract the JD for you."`
       - cta: `{ href: '/spec/new', label: 'Record a spec call' }` (primary — fastest AI-first path)
       - secondaryCta: `{ href: '/clients', label: 'Pick a client' }`
       - NOTE: `/jobs/new` does NOT exist; that's why the primary is `/spec/new` and the secondary is `/clients`. SUMMARY.md MUST call this out as a deferred item: "Phase 4 should add `/jobs/new` standalone form so jobs can be created without a spec call or client-first flow."

    4. **`src/app/(app)/pipeline/page.tsx`** (already uses EmptyState — upgrade unfiltered branch only):
       - When NO filters active (`!ownerId && !jobId && !clientId`):
         - heading: `"No candidates in pipeline yet"`
         - body: `"The pipeline shows every active application across your open jobs. Once you add candidates to a job, they appear here as draggable cards."`
         - cta: `{ href: '/jobs', label: 'View jobs' }`
         - secondaryCta: `{ href: '/candidates', label: 'Browse candidates' }`
       - When filters ARE active, keep the existing behaviour (heading: `"No candidates in pipeline"`, body about filters, no CTA).

    5. **`src/app/(app)/floats/page.tsx`** (currently uses a bespoke `<div>` with inline copy — REPLACE with EmptyState):
       - Add `import { EmptyState } from '@/components/app/empty-state'`.
       - Replace the `<div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">...</div>` with:
         - heading: `"No floats yet"`
         - body: `"A float is a speculative candidate submission with no specific job — 'you should meet this person'. From any candidate's page, click Floats to record one."`
         - cta: `{ href: '/candidates', label: 'Browse candidates' }`
       - No secondary CTA.

    6. **`src/app/(app)/spec/page.tsx`** (currently uses an inline Card with text + link — REPLACE with EmptyState):
       - Add `import { EmptyState } from '@/components/app/empty-state'`.
       - Remove the empty `<Card><CardContent>...</CardContent></Card>` branch.
       - Render:
         - heading: `"Record your first spec call"`
         - body: `"Upload an audio recording of your spec call and we'll transcribe it, extract a structured job description, and drop it here for review."`
         - cta: `{ href: '/spec/new', label: 'New spec call' }`
       - No secondary CTA.

    7. **`src/app/(app)/reports/source-attribution/page.tsx`** (currently shows a flat `<p>` inside a Card — REPLACE with EmptyState in the "By source" card only):
       - Add `import { EmptyState } from '@/components/app/empty-state'`.
       - Inside the "By source" `<Card>`, replace `<p className="text-muted-foreground text-sm">No placements in this date range.</p>` with:
         - heading: `"No placements in this date range"`
         - body: `"Move candidates into the Placed stage on a job to see them attributed back to their source channel."`
         - cta: `{ href: '/pipeline', label: 'Open pipeline' }`
       - Leave the second "Top sources by revenue" card's empty text as-is (visually it's a subordinate panel — adding another EmptyState would double-stack).

    8. **`src/app/(app)/page.tsx`** (dashboard — already uses EmptyState — upgrade props only):
       - heading: `"Welcome to Altus"`
       - body: `"Start with a candidate or a client — CV uploads, semantic search, and pipeline tracking all build from there."`
       - cta: `{ href: '/candidates/new', label: 'Add your first candidate' }`
       - secondaryCta: `{ href: '/clients/new', label: 'Or add your first client' }`
       - The outer header `<h1>Welcome to Altus</h1>` becomes redundant with the EmptyState heading — remove the outer `<header>` block in the empty branch to avoid two stacked headings. Keep only the EmptyState.

    ## Final hygiene
    - Run `pnpm lint --fix` to catch any unused imports introduced/removed.
    - Verify `pnpm typecheck` is clean.
    - DO NOT introduce any new lucide-react icons or new dependencies.
    - DO NOT change any non-empty branches of these pages.
    - DO NOT touch any other page in the app.
  </action>
  <verify>
    <automated>pnpm lint &amp;&amp; pnpm typecheck</automated>
  </verify>
  <done>All 8 pages render the upgraded empty states using the shared EmptyState; lint + typecheck clean; no new dependencies; SUMMARY.md notes the `/jobs/new` deferred item.</done>
</task>

</tasks>

<verification>
- `pnpm lint` passes
- `pnpm typecheck` passes
- Manual smoke (recorded in SUMMARY.md, not blocking): visit each of the 8 pages in a fresh-org / empty state and confirm the new heading + body + CTAs render. Use the Settings → Team or a second incognito sign-up to reach a clean org if needed.
- No new lucide icons or npm dependencies added (check `git diff package.json` is empty).
</verification>

<success_criteria>
- Every must_haves.truths line above is observably true in the running app.
- `EmptyState` is the single source of truth for empty states on these 8 pages — no bespoke empty `<div>` or empty-state `<Card>` remains on any of them.
- The `/jobs/new` non-existence is acknowledged in SUMMARY.md as a deferred item with a recommended Phase 4 follow-up.
- Existing single-CTA callers (anywhere else in the app that already uses EmptyState) are unaffected — the secondary CTA prop is purely additive.
</success_criteria>

<output>
Create `.planning/quick/260524-cjl-empty-state-polish-across-8-index-pages/260524-cjl-SUMMARY.md` when done, documenting:
- What changed per page (8-line table is fine)
- The `/jobs/new` route gap and its recommended Phase 4 follow-up
- Lint + typecheck status
- Any visual screenshots / browser checks performed (or that none were, and why that's fine for a copy-only change)
</output>
