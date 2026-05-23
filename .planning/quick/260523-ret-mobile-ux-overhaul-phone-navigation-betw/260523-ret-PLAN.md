---
quick_id: 260523-ret
type: execute
tasks: 3
autonomous: true
files_modified:
  - src/components/app/top-nav.tsx
  - src/components/app/mobile-nav-drawer.tsx
  - src/hooks/use-is-mobile.ts
  - src/app/(app)/candidates/page.tsx
  - src/app/(app)/candidates/candidates-shell.tsx
  - src/app/(app)/clients/page.tsx
  - src/app/(app)/clients/clients-shell.tsx
  - src/app/(app)/jobs/page.tsx
  - src/app/(app)/jobs/jobs-shell.tsx
  - src/app/(app)/jobs/jobs-cards.tsx
  - src/app/(app)/floats/page.tsx
  - src/app/(app)/floats/floats-shell.tsx
  - src/app/(app)/floats/floats-cards.tsx
  - src/app/(app)/floats/floats-table.tsx
must_haves:
  truths:
    - "Below md (768px), the desktop horizontal nav is hidden and a hamburger icon is visible top-left"
    - "Tapping the hamburger opens a left-side Sheet drawer with all 10 nav items"
    - "The drawer shows two visual groups: Dashboard/Candidates/Search/Jobs/Pipeline first, then a divider, then Clients/Floats/Spec calls/Reports/Settings"
    - "Tapping a nav item closes the drawer and navigates"
    - "Tapping the overlay closes the drawer"
    - "The active route is visually highlighted in the drawer (aria-current=page)"
    - "On mobile, the header is condensed: smaller monogram, no email/org chip; SignOutButton is inside the drawer footer"
    - "On desktop (md+), the existing horizontal nav and email/org chip render unchanged"
    - "Below md on /candidates, /clients, /jobs, /floats, data renders as a card list regardless of ?view=; at md+ the existing table/cards toggle still works as before"
    - "Per-row action menus (the '…' DropdownMenus) remain reachable on mobile via the card UI"
  artifacts:
    - path: "src/components/app/mobile-nav-drawer.tsx"
      provides: "Client component rendering the hamburger trigger + Sheet drawer with the 10 nav items grouped 5+5, active-route highlighting, and SignOutButton in the footer"
    - path: "src/hooks/use-is-mobile.ts"
      provides: "useIsMobile() hook mirroring pipeline-shell's useSyncExternalStore + matchMedia pattern (returns true below 768px)"
    - path: "src/app/(app)/candidates/candidates-shell.tsx"
      provides: "Client wrapper that calls useIsMobile() and forces <CandidateCards> below md, otherwise renders the user's chosen view (table or cards)"
    - path: "src/app/(app)/clients/clients-shell.tsx"
      provides: "Same responsive shell for clients"
    - path: "src/app/(app)/jobs/jobs-shell.tsx"
      provides: "Same responsive shell for jobs"
    - path: "src/app/(app)/jobs/jobs-cards.tsx"
      provides: "<JobsCards> mobile card list — title, company, type, status badge, created-ago + DropdownMenu row actions (View, Pipeline)"
    - path: "src/app/(app)/floats/floats-shell.tsx"
      provides: "Responsive shell for floats"
    - path: "src/app/(app)/floats/floats-cards.tsx"
      provides: "<FloatsCards> mobile card list"
    - path: "src/app/(app)/floats/floats-table.tsx"
      provides: "<FloatsTable> extracted from the existing inline Table in page.tsx"
  key_links:
    - from: "src/components/app/top-nav.tsx"
      to: "src/components/app/mobile-nav-drawer.tsx"
      via: "import + render inside the header at md:hidden"
      pattern: "import.*MobileNavDrawer"
    - from: "src/app/(app)/candidates/page.tsx"
      to: "src/app/(app)/candidates/candidates-shell.tsx"
      via: "Server page passes rows + view choice to client shell"
      pattern: "CandidatesShell"
    - from: "src/app/(app)/jobs/page.tsx"
      to: "src/app/(app)/jobs/jobs-shell.tsx"
      via: "Server page passes rows to client shell"
      pattern: "JobsShell"
---

<objective>
Fix the mobile UX of the app: replace the hidden-on-mobile desktop nav with a hamburger + left-side Sheet drawer, condense the mobile header, and auto-switch the four data-heavy index pages (/candidates, /clients, /jobs, /floats) to a card list below md. All changes are additive below the md breakpoint; desktop is unchanged.

Purpose: Recruiters on phone currently land on the app and can't navigate between pages — the entire horizontal nav is `hidden md:flex`. They also see overflowing tables. This task makes the app usable on a 375px-wide viewport.

Output: One mobile nav drawer, one viewport hook, three responsive page shells, two new card components (jobs + floats), one extracted table (floats), and minor server-page wiring on four pages.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260523-ret-mobile-ux-overhaul-phone-navigation-betw/260523-ret-CONTEXT.md
@CLAUDE.md
@src/components/app/top-nav.tsx
@src/app/(app)/layout.tsx
@src/components/ui/sheet.tsx
@src/components/app/sign-out-button.tsx
@src/app/(app)/jobs/[id]/pipeline/pipeline-shell.tsx
@src/components/app/pipeline-mobile-list.tsx
@src/app/(app)/candidates/page.tsx
@src/app/(app)/candidates/candidate-cards.tsx
@src/app/(app)/candidates/candidate-table.tsx
@src/components/app/view-toggle.tsx
@src/app/(app)/clients/page.tsx
@src/app/(app)/clients/client-cards.tsx
@src/app/(app)/clients/client-table.tsx
@src/app/(app)/jobs/page.tsx
@src/app/(app)/jobs/jobs-table.tsx
@src/app/(app)/floats/page.tsx

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from the codebase. -->

From src/app/(app)/layout.tsx — TopNav is rendered inside an async Server Component and receives:
```ts
<TopNav
  userEmail={string}
  userName={string | null}
  organizationName={string | null}
/>
```

From src/components/ui/sheet.tsx — available primitives:
```ts
Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription
// SheetContent accepts side: 'top' | 'right' | 'bottom' | 'left' (use 'left' for nav drawer)
```

From src/app/(app)/jobs/[id]/pipeline/pipeline-shell.tsx — the EXACT pattern for the viewport hook (mirror this, do NOT use a dual-tree hidden md:block + block md:hidden approach):
```ts
'use client'
import { useSyncExternalStore } from 'react'

const DESKTOP_MIN_WIDTH = 768
const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}
function getClientSnapshot(): boolean { return window.matchMedia(DESKTOP_MEDIA_QUERY).matches }
function getServerSnapshot(): boolean { return true } // SSR = desktop
// Hook returns isDesktop; caller derives isMobile = !isDesktop
```

From src/app/(app)/candidates/page.tsx and src/app/(app)/clients/page.tsx — pages already implement a ViewToggle and import both `<CandidateCards>`/`<ClientCards>` and `<CandidateTable>`/`<ClientTable>`. The view choice is in URL as `?view=cards|list`. The mobile-force-cards behaviour must override the URL choice WITHOUT mutating the URL (so going back to desktop restores the user's chosen view).

From src/lib/db/jobs.ts — `JobListRow` shape used by jobs-table.tsx:
```ts
// row.id, row.title, row.company_name, row.company_id, row.job_type, row.status, row.created_at
```

From src/lib/db/shortlists.ts — float row shape (read from existing floats/page.tsx usage):
```ts
// row.id, row.created_at, row.candidate?: { id, full_name, current_role_title?, current_company? }
```

Tailwind breakpoint: md = 768px. SSR snapshot must be desktop (true) — the brief one-frame swap on mobile hydration is acceptable per the existing pipeline-shell precedent.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Mobile nav drawer + condensed mobile header</name>
  <files>
    src/hooks/use-is-mobile.ts,
    src/components/app/mobile-nav-drawer.tsx,
    src/components/app/top-nav.tsx
  </files>
  <action>
Create three things:

(a) `src/hooks/use-is-mobile.ts` — a Client-side `useIsMobile()` hook implemented with `useSyncExternalStore` and `window.matchMedia('(min-width: 768px)')`. Mirror the pattern in `src/app/(app)/jobs/[id]/pipeline/pipeline-shell.tsx` (DESKTOP_MIN_WIDTH = 768, getServerSnapshot returns true for SSR = desktop). Export `useIsMobile(): boolean` that returns the negation of the desktop snapshot. The file must start with `'use client'`. This hook will be reused by all three pages' shells in Tasks 2 and 3.

(b) `src/components/app/mobile-nav-drawer.tsx` — a Client Component (`'use client'`) that:
  - Accepts props `{ userEmail: string; userName: string | null; organizationName: string | null }`.
  - Uses `useState` for `open`, controls the `<Sheet>` via `open`/`onOpenChange`.
  - Renders a `<SheetTrigger asChild>` wrapping a `<Button variant="ghost" size="icon" className="text-slate-100 hover:bg-white/10 md:hidden" aria-label="Open navigation">` with the lucide `Menu` icon (size-5).
  - `<SheetContent side="left" className="w-72 bg-[#1a2738] text-slate-100 border-r border-[#0f1a26] p-0 flex flex-col">` so the drawer matches the dark navbar styling, NOT the default light `bg-background`.
  - Inside SheetContent: a `<SheetHeader>` (or plain header div) with the small monogram + "ALTUS Recruit" wordmark for context.
  - Two `<nav>` groups, primary then secondary, with a thin divider (`<div className="my-2 border-t border-white/10" />`) between them. Item lists:
    - Primary: Dashboard `/`, Candidates `/candidates`, Search `/search`, Jobs `/jobs`, Pipeline `/pipeline`.
    - Secondary: Clients `/clients`, Floats `/floats`, Spec calls `/spec`, Reports `/reports`, Settings `/settings`.
  - Each item is a `<SheetClose asChild>` wrapping a `<Link>` so tapping closes the drawer AND navigates in one gesture. Item class: `flex items-center min-h-11 px-4 text-sm text-slate-200 hover:bg-white/10` with `rounded-md mx-2` and active-state highlight when `usePathname()` matches the href (for `/`, match exactly; for other hrefs, match exactly OR pathname starts with `${href}/`). Active state: add `bg-white/10 text-slate-50 font-medium` and `aria-current="page"`.
  - `<SheetFooter>` (or a `mt-auto` div) at the bottom showing user identity chip (`userName ?? userEmail` and `organizationName` underneath in small muted text) and then `<SignOutButton />` — re-use the existing component from `src/components/app/sign-out-button.tsx`, no changes there.
  - Be deliberate about closing on `SignOutButton` tap: SignOutButton already navigates via `router.replace('/sign-in')`, so the drawer doesn't need to close manually; the route change unmounts it.
  - Import `Menu` from `lucide-react`. Use the `cn` utility from `@/lib/utils` for conditional classes.

(c) Modify `src/components/app/top-nav.tsx`:
  - Import `MobileNavDrawer` from `@/components/app/mobile-nav-drawer`.
  - Render `<MobileNavDrawer ... />` BEFORE the `<Link href="/">` brand link inside the leading flex container so the hamburger is the leftmost element on mobile. Pass userEmail, userName, organizationName through.
  - The hamburger button itself is `md:hidden` (already set in the drawer). The existing `<nav className="hidden gap-1 md:flex">` stays exactly as-is — desktop is untouched.
  - Condense the brand link on mobile: change the monogram wrapper from `h-10 w-10` to `h-8 w-8 md:h-10 md:w-10`, the inner SVG from `h-6 w-6` to `h-5 w-5 md:h-6 md:w-6`. The existing wordmark block is already `hidden sm:flex` so it stays hidden on phones (intentional — keeps the header tight).
  - Condense the trailing user chip on mobile: change `<div className="hidden text-right ... sm:block">` to `<div className="hidden text-right ... md:block">` so the email/org chip is hidden below md (recoverable via the drawer footer and Settings). The SignOutButton in the desktop header REMAINS — keep it visible at md+ unchanged. Wrap it in `<div className="hidden md:block"><SignOutButton /></div>` so on mobile it's only in the drawer footer (no duplicate buttons). Do NOT delete the SignOutButton from the header — desktop still wants it.
  - Tighten the container's horizontal padding on the smallest viewports if necessary (existing `px-4 sm:px-6` is fine — leave it).

DO NOT touch any desktop-only styles or behaviour. Every change is additive at sub-md breakpoints or uses md+ prefixes.
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint src/hooks/use-is-mobile.ts src/components/app/mobile-nav-drawer.tsx src/components/app/top-nav.tsx</automated>
    <human-check>
      Open the app on a phone viewport (≤375px wide, e.g. Chrome DevTools iPhone 12):
      1. Header shows: hamburger (left) → small monogram → SignOutButton hidden, no email chip
      2. Tap hamburger — drawer slides in from the left, dark `#1a2738` background, all 10 items visible, divider between Pipeline and Clients
      3. Current route is visually highlighted and has `aria-current="page"` (inspect)
      4. Tap any item — drawer closes AND navigation happens in one gesture
      5. Tap the overlay (dim area to the right of the drawer) — drawer closes, no navigation
      6. Resize to ≥768px — hamburger disappears, horizontal nav appears, email/org chip + SignOutButton reappear, no duplicates
      7. Drawer footer shows user name/email + org + Sign out button; Sign out from the drawer logs out and redirects to /sign-in
    </human-check>
  </verify>
  <done>Mobile navigation works on a 375px viewport. Desktop nav unchanged. No duplicate SignOutButtons. Active route highlighted. TypeScript and ESLint pass.</done>
</task>

<task type="auto">
  <name>Task 2: Responsive shells for /candidates and /clients (reuse existing cards)</name>
  <files>
    src/app/(app)/candidates/candidates-shell.tsx,
    src/app/(app)/candidates/page.tsx,
    src/app/(app)/clients/clients-shell.tsx,
    src/app/(app)/clients/page.tsx
  </files>
  <action>
These two pages already have both `<CandidateCards>`/`<ClientCards>` AND `<CandidateTable>`/`<ClientTable>` plus a `<ViewToggle>` that writes `?view=cards|list` to the URL. We're not building new card components — we're forcing the cards branch on mobile regardless of the URL state, using a thin client shell.

Mirror the `pipeline-shell.tsx` pattern: a single client wrapper renders ONE child, chosen via the `useIsMobile()` hook from Task 1. This avoids the dual-tree `hidden md:block` antipattern (which would ship both subtrees in the DOM and double the JS for the heavier of the two — explicitly called out in RESEARCH §21 / the pipeline-shell comment).

(a) `src/app/(app)/candidates/candidates-shell.tsx` — Client Component:
  - `'use client'` at the top.
  - Import `useIsMobile` from `@/hooks/use-is-mobile`, `CandidateCards` and `CandidateTable` from the colocated files.
  - Props: `{ desktopView: 'list' | 'cards'; rows, total, page, pageSize, sort, dir, query }` — accept exactly the same fields both card and table components consume so the shell is just a router.
  - Behaviour: `const isMobile = useIsMobile()`; if `isMobile` → render `<CandidateCards rows={rows} total={total} page={page} pageSize={pageSize} sort={sort} dir={dir} query={query} />`. Else if `desktopView === 'cards'` → `<CandidateCards ... />`. Else → `<CandidateTable ... />`.
  - Type the props by importing `CandidateListRow`, `SortKey`, `SortDir` from `@/lib/db/candidates` — no `any`.

(b) Modify `src/app/(app)/candidates/page.tsx`:
  - Replace the inline `{view === 'cards' ? <CandidateCards .../> : <CandidateTable .../>}` block with `<CandidatesShell desktopView={view} rows={rows} total={total} page={page} pageSize={PAGE_SIZE} sort={sort} dir={dir} query={q} />`.
  - The `<ViewToggle>` stays in the page — on mobile it'll still write `?view=` but the shell will override; on desktop it works as before. Optionally wrap the `<ViewToggle>` in `<div className="hidden md:inline-flex">` so the toggle is hidden on mobile (it has no effect there). Do this — it's cleaner UX.
  - Import the new shell with a `from './candidates-shell'` relative import to match the existing colocation pattern.

(c) `src/app/(app)/clients/clients-shell.tsx` — same pattern for clients:
  - `'use client'`.
  - Props: `{ desktopView: 'list' | 'cards'; rows: ClientRow[] }` (ClientTable and ClientCards both just take `rows`; pagination lives in page.tsx outside the shell).
  - `useIsMobile()` → `<ClientCards rows={rows} />`; else `desktopView === 'cards'` → `<ClientCards />`; else `<ClientTable />`.
  - Import `ClientRow` from `@/lib/db/clients`.

(d) Modify `src/app/(app)/clients/page.tsx`:
  - Replace the `view === 'cards' ? <ClientCards .../> : <ClientTable .../>` block (inside the `isNoMatch ? ... : ...` ternary) with `<ClientsShell desktopView={view} rows={rows} />`. Keep the `isNoMatch` branch as-is — the empty-state message should still show on mobile too.
  - Wrap the `<ViewToggle>` in `<div className="hidden md:inline-flex">` like in candidates.

Do NOT touch `<CandidateCards>`, `<CandidateTable>`, `<ClientCards>`, `<ClientTable>` themselves — they already work and contain the row-action DropdownMenus the user explicitly wants preserved.
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint src/app/\(app\)/candidates/candidates-shell.tsx src/app/\(app\)/candidates/page.tsx src/app/\(app\)/clients/clients-shell.tsx src/app/\(app\)/clients/page.tsx</automated>
    <human-check>
      1. /candidates on a 375px viewport — renders the existing CandidateCards grid (1-column on phone via the existing `grid-cols-1 sm:grid-cols-2 ...`), NOT the overflowing table; row "…" dropdown still works
      2. /candidates on ≥768px viewport with no `?view=` — renders the table (default); ViewToggle visible; switching to cards still works
      3. /candidates on ≥768px with `?view=cards` — renders cards; ViewToggle visible
      4. Same three checks for /clients
      5. No console errors, no hydration warning beyond the one-frame matchMedia swap (matches pipeline-shell precedent)
    </human-check>
  </verify>
  <done>/candidates and /clients show cards on mobile regardless of `?view=`. Desktop unchanged. ViewToggle hidden on mobile. TypeScript and ESLint pass.</done>
</task>

<task type="auto">
  <name>Task 3: Build job + float cards and wire responsive shells on /jobs and /floats</name>
  <files>
    src/app/(app)/jobs/jobs-cards.tsx,
    src/app/(app)/jobs/jobs-shell.tsx,
    src/app/(app)/jobs/page.tsx,
    src/app/(app)/floats/floats-table.tsx,
    src/app/(app)/floats/floats-cards.tsx,
    src/app/(app)/floats/floats-shell.tsx,
    src/app/(app)/floats/page.tsx
  </files>
  <action>
Build the two missing card components, extract the inline floats table into its own file, then wire the responsive shells. Match the visual language of `candidate-cards.tsx` and `client-cards.tsx` (rounded-lg border, p-4, hover lift, truncate long fields, status badge top-right).

(a) `src/app/(app)/jobs/jobs-cards.tsx`:
  - Server Component (no `'use client'` needed — pure rendering, the DropdownMenu inside is already a Client primitive that hydrates itself).
  - Props: `{ rows: JobListRow[]; total: number; page: number; pageSize: number }` (mirror jobs-table.tsx shape so the shell can pass identical props).
  - Reuse `TYPE_LABEL`, `STATUS_VARIANT`, `STATUS_LABEL` from jobs-table.tsx — either copy them inline OR (preferred) extract them to a new `src/app/(app)/jobs/job-labels.ts` and import in both files. Extracting is the cleaner move; do that.
  - Render `<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">` with one card per row:
    - Outer `<Link href={\`/jobs/\${row.id}\`}>` styled `bg-card flex flex-col gap-2 rounded-lg border p-4 hover:-translate-y-0.5 hover:shadow-md transition-all focus-visible:ring-2 focus-visible:ring-ring/40`.
    - Top row: `<div className="flex items-start justify-between gap-2">` containing job title (font-semibold, text-sm, truncate) on the left and `<Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>` on the right.
    - Second row: company name (muted text-xs, truncate); make it a separate `<Link href={\`/clients/\${row.company_id}\`}>` ONLY if you can do it without nesting `<a>` inside `<a>` — you can't, so render it as plain text inside the card and let the whole card link to the job. Acceptable trade-off; same pattern as candidate-cards.
    - Third row: `<div className="flex items-center justify-between text-xs text-muted-foreground">` with `TYPE_LABEL[row.job_type]` left and `formatTimeAgo(row.created_at)` right.
    - Per-row actions: render the SAME `<DropdownMenu>` block as jobs-table.tsx (View + Pipeline items) in the card's top-right corner, ABOVE the badge — but because of the outer `<Link>`, the DropdownMenuTrigger needs to be an absolutely-positioned overlay that stops event propagation. Implementation: position the dropdown via `<div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>` and make the outer `<Link>` `className="relative ..."`. Move the badge to be below the title (or display badge inline with title, dropdown floating in corner). Use whichever shape reads cleanest; the important behavioural rule is: tapping the "…" opens the menu without navigating; tapping anywhere else navigates to the job.
  - Pagination: render the same Prev/Next pagination block as `jobs-table.tsx` below the grid. Extract it if you want, or duplicate — duplication is fine for a 12-line snippet.
  - No `any`. Type everything via the imports from `@/lib/db/jobs`.

(b) `src/app/(app)/jobs/jobs-shell.tsx`:
  - `'use client'`. Props: `{ rows: JobListRow[]; total: number; page: number; pageSize: number }`.
  - `const isMobile = useIsMobile()`; return `isMobile ? <JobsCards ...props /> : <JobsTable ...props />`.

(c) Modify `src/app/(app)/jobs/page.tsx`:
  - Replace `<JobsTable rows={rows} total={total} page={page} pageSize={PAGE_SIZE} />` with `<JobsShell rows={rows} total={total} page={page} pageSize={PAGE_SIZE} />`.
  - Import `JobsShell` from `./jobs-shell`. Remove the now-unused `JobsTable` import (the shell imports it).

(d) `src/app/(app)/floats/floats-table.tsx`:
  - Extract the existing `<Table>...</Table>` block from `floats/page.tsx` lines 44-96 into a new Server Component `<FloatsTable rows={...} />`. Props: `{ rows: FloatListRow[] }` where `FloatListRow` is whatever `listAllFloats` returns; import the type from `@/lib/db/shortlists` (look at its return type; if it's not exported as a named type, use `Awaited<ReturnType<typeof listAllFloats>>` narrowed via the `Ok` arm — or just define a local `type FloatRow = { id: string; created_at: string; candidate: { id: string; full_name: string; current_role_title?: string | null; current_company?: string | null } | null }` matching what page.tsx currently consumes).
  - Move the imports the table needs (`Table`, `TableBody`, `TableCell`, etc., `Badge`, `formatTimeAgo`, `Link`) into this file. Keep the existing JSX structure verbatim.

(e) `src/app/(app)/floats/floats-cards.tsx`:
  - Server Component. Props: same `{ rows }`.
  - Empty-state already handled by page.tsx, so this just renders cards.
  - `<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">` of `<Link href={\`/candidates/\${row.candidate.id}/floats\`}>` cards:
    - Top row: candidate full_name (font-semibold, text-sm) + `<Badge variant="outline">Float</Badge>` right.
    - Second row: current_role_title · current_company (muted, text-xs, truncate, fall back to '—' if both null).
    - Third row: `formatTimeAgo(row.created_at)` muted text-xs.
  - Handle `row.candidate === null` by rendering "Unknown" as title (mirror existing table behaviour) and NOT wrapping in a Link (no candidate to go to).

(f) `src/app/(app)/floats/floats-shell.tsx`:
  - `'use client'`. Props: `{ rows: FloatListRow[] }`.
  - `useIsMobile() ? <FloatsCards rows={rows} /> : <FloatsTable rows={rows} />`.

(g) Modify `src/app/(app)/floats/page.tsx`:
  - Remove the inline `<Table>...</Table>` block and its supporting imports (Table*, Badge, formatTimeAgo, Link) — they migrate to floats-table.tsx.
  - In place of the inline table, render `<FloatsShell rows={rows} />`.
  - Keep the empty-state branch (`rows.length === 0`) exactly as it is.

Do NOT change the desktop tables' look or columns. The cards are mobile-only via the shell.
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint src/app/\(app\)/jobs/jobs-cards.tsx src/app/\(app\)/jobs/jobs-shell.tsx src/app/\(app\)/jobs/page.tsx src/app/\(app\)/floats/floats-table.tsx src/app/\(app\)/floats/floats-cards.tsx src/app/\(app\)/floats/floats-shell.tsx src/app/\(app\)/floats/page.tsx</automated>
    <human-check>
      1. /jobs on 375px viewport — single-column cards, each shows title + status badge + company + type + created-ago + "…" dropdown that still navigates to View / Pipeline without also navigating to the job
      2. /jobs on ≥768px — table unchanged, columns and "…" dropdown identical to before
      3. /floats on 375px — single-column cards, candidate name + Float badge + role/company line + created-ago; tapping navigates to /candidates/[id]/floats
      4. /floats on ≥768px — table looks identical to the pre-refactor version (because the extraction is a pure move)
      5. No console errors, no `<a>` nested in `<a>` warnings, no TypeScript errors
    </human-check>
  </verify>
  <done>/jobs and /floats render cards on mobile, tables on desktop. Row actions preserved. No regressions on desktop. TypeScript and ESLint pass.</done>
</task>

</tasks>

<verification>
End-to-end on a 375px mobile viewport:
- All 10 main pages reachable from the drawer
- Drawer closes on link tap and overlay tap; active route highlighted
- /candidates, /clients, /jobs, /floats render cards (single column); per-row "…" dropdowns work
- /pipeline still uses the existing PipelineMobileList (untouched)
- SignOutButton works from the drawer footer

End-to-end on a 1280px desktop viewport:
- Hamburger not visible
- Horizontal nav, email/org chip, header SignOutButton all unchanged
- All four data pages render their existing tables by default; ViewToggle still works on /candidates and /clients

Type + lint:
```
pnpm typecheck
pnpm lint
```
Both must pass with zero new errors or warnings.
</verification>

<success_criteria>
1. Mobile user (≤375px) can reach every main page from the drawer in one tap
2. Drawer matches the dark navbar styling (`bg-[#1a2738]`), not the default light Sheet background
3. Below md, the four data-heavy pages never render an overflowing table
4. Above md, no visible regression on any page
5. No new dependencies; only shadcn primitives already in the codebase
6. No `any` types; strict mode satisfied
7. `pnpm typecheck` and `pnpm lint` both clean
</success_criteria>

<output>
After all three tasks complete, write `.planning/quick/260523-ret-mobile-ux-overhaul-phone-navigation-betw/260523-ret-SUMMARY.md` capturing:
- Files created and modified
- Mobile vs desktop behaviour split
- Any deferred items (e.g. forms not touched; touch-target audit not run)
</output>
