---
quick_id: 260523-ret
status: complete
completed_at: 2026-05-23
duration_minutes: ~30
tasks_completed: 3
tasks_total: 3
files_created:
  - src/hooks/use-is-mobile.ts
  - src/components/app/mobile-nav-drawer.tsx
  - src/app/(app)/candidates/candidates-shell.tsx
  - src/app/(app)/clients/clients-shell.tsx
  - src/app/(app)/jobs/job-labels.ts
  - src/app/(app)/jobs/jobs-cards.tsx
  - src/app/(app)/jobs/jobs-shell.tsx
  - src/app/(app)/floats/floats-table.tsx
  - src/app/(app)/floats/floats-cards.tsx
  - src/app/(app)/floats/floats-shell.tsx
files_modified:
  - src/components/app/top-nav.tsx
  - src/app/(app)/candidates/page.tsx
  - src/app/(app)/clients/page.tsx
  - src/app/(app)/jobs/jobs-table.tsx
  - src/app/(app)/jobs/page.tsx
  - src/app/(app)/floats/page.tsx
commits:
  - hash: af56ac4
    message: "feat(260523-ret): mobile nav drawer + condensed mobile header"
  - hash: b556468
    message: "feat(260523-ret): responsive shells for /candidates and /clients"
  - hash: 5060e4c
    message: "feat(260523-ret): job/float card components + responsive shells for /jobs and /floats"
---

# Quick Task 260523-ret: Mobile UX Overhaul — Summary

**One-liner:** Hamburger + left Sheet drawer (10 nav items, dark-themed, active-route highlighting) with per-page responsive shells that auto-switch /candidates, /clients, /jobs, /floats to card layouts on viewports below 768px.

## What Was Built

### Task 1: Mobile nav drawer + condensed header

**`src/hooks/use-is-mobile.ts`** — `useIsMobile()` hook using `useSyncExternalStore` + `window.matchMedia('(min-width: 768px)')`. SSR snapshot returns `true` (desktop) to match the pipeline-shell precedent; mobile viewports swap on first hydration paint. Returns `!isDesktop` so callers get a boolean for "is this a phone".

**`src/components/app/mobile-nav-drawer.tsx`** — Client Component with:
- Hamburger `<Button variant="ghost" size="icon" className="md:hidden">` with lucide `Menu` icon
- `<Sheet open={open} onOpenChange={setOpen}>` controlling the drawer imperatively
- `<SheetContent side="left" className="w-72 bg-[#1a2738] ..."}>` — dark navbar colour, not the default light `bg-background`
- 10 nav items split 5+5 (Dashboard/Candidates/Search/Jobs/Pipeline then Clients/Floats/Spec calls/Reports/Settings) with a thin divider between groups
- Each item: `<SheetClose asChild><Link>` — closes drawer and navigates in one gesture
- Active-route highlighting via `usePathname()`: exact match for `/`, prefix match for all others; `aria-current="page"` on active item
- Footer: user name/email + org name + `<SignOutButton />`

**`src/components/app/top-nav.tsx`** changes:
- Import + render `<MobileNavDrawer>` before the brand link (hamburger is leftmost element on mobile)
- Monogram: `h-8 w-8 md:h-10 md:w-10` / inner SVG `h-5 w-5 md:h-6 md:w-6`
- Email/org chip: changed `sm:block` → `md:block` (hidden on phones, shown via drawer footer)
- `<SignOutButton>` wrapped in `<div className="hidden md:block">` (desktop-only; mobile uses drawer footer)
- Desktop horizontal `<nav className="hidden gap-1 md:flex">` unchanged

### Task 2: Responsive shells for /candidates and /clients

**`candidates-shell.tsx`** — Client wrapper accepting the same props as both `CandidateCards` and `CandidateTable`. `useIsMobile()` → always renders `CandidateCards` on mobile; on desktop, honours `desktopView` URL param.

**`clients-shell.tsx`** — Same pattern for `ClientCards`/`ClientTable` with `ClientRow[]` props.

Both pages updated to: replace inline `view === 'cards' ? ... : ...` with the shell component; wrap `<ViewToggle>` in `<div className="hidden md:inline-flex">` so it's hidden below md (toggle has no effect there, mobile always gets cards).

### Task 3: Job/float cards + responsive shells

**`job-labels.ts`** — Extracted `TYPE_LABEL`, `STATUS_VARIANT`, `STATUS_LABEL` from `jobs-table.tsx` into a shared module. `jobs-table.tsx` updated to import from there.

**`jobs-cards.tsx`** — Mobile card grid: `grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3`. Each card is a `<Link>` to `/jobs/[id]` with title + status badge + company name + type + created-ago. Row `DropdownMenu` (View, Pipeline) is an absolutely-positioned overlay (`absolute right-2 top-2 z-10`) with `onClick={e.stopPropagation()}` to prevent the outer Link from activating — no nested `<a>` elements. Pagination block identical to `jobs-table.tsx`.

**`jobs-shell.tsx`** — `useIsMobile() ? <JobsCards> : <JobsTable>`.

**`floats-table.tsx`** — Pure extraction of the inline `<Table>` block from `floats/page.tsx`. Byte-for-byte identical JSX, just moved to its own file. Uses `ShortlistRow` from `@/lib/db/shortlists`.

**`floats-cards.tsx`** — Mobile card grid: `grid-cols-1 sm:grid-cols-2`. Handles `row.candidate === null` by rendering "Unknown" as plain text without a Link. For known candidates: name + Float badge, role · company line, created-ago. Links to `/candidates/[id]/floats`.

**`floats-shell.tsx`** — `useIsMobile() ? <FloatsCards> : <FloatsTable>`.

`floats/page.tsx` updated to import `FloatsShell`, remove inline table JSX + its imports (Table*, Badge, formatTimeAgo, Link).

## Mobile vs Desktop Behaviour Split

| Page | Below md (< 768px) | At md+ |
|------|-------------------|--------|
| All pages | Hamburger visible; 10-item Sheet drawer; condensed header | Horizontal nav, email/org chip, header SignOutButton |
| /candidates | CandidateCards (1-col phone, 2-col sm+), ViewToggle hidden | Table by default; ViewToggle visible; user's `?view=` choice honoured |
| /clients | ClientCards (1-col phone, 2-col sm+), ViewToggle hidden | Table by default; ViewToggle visible; user's `?view=` choice honoured |
| /jobs | JobsCards (1-col phone, 2-col sm+) | JobsTable unchanged |
| /floats | FloatsCards (1-col phone, 2-col sm+) | FloatsTable unchanged (same JSX, just extracted to floats-table.tsx) |

## Deviations from Plan

None — plan executed exactly as specified.

The `onClick={e.stopPropagation()}` approach for the jobs card DropdownMenu is the pattern the plan described (absolutely positioned overlay with event propagation stopped); no `<a>` nesting occurs.

## Deferred Items

- **Touch-target audit** — not in scope per CONTEXT.md decisions.
- **Form layouts** (`/candidates/new`, `/clients/[id]/jobs/new`, etc.) — not in scope.
- **Jobs page `?view=` URL toggle** — `/jobs` has no ViewToggle currently; mobile/desktop split is pure useIsMobile. A future toggle could be added following the same shell pattern.
- **Pre-existing lint errors** in `cv-review-panel.tsx`, `mic-recorder.tsx`, chrome extension, and tests — pre-existed before this task; out of scope per plan constraints.

## Self-Check

Files created:
- src/hooks/use-is-mobile.ts — EXISTS
- src/components/app/mobile-nav-drawer.tsx — EXISTS
- src/app/(app)/candidates/candidates-shell.tsx — EXISTS
- src/app/(app)/clients/clients-shell.tsx — EXISTS
- src/app/(app)/jobs/job-labels.ts — EXISTS
- src/app/(app)/jobs/jobs-cards.tsx — EXISTS
- src/app/(app)/jobs/jobs-shell.tsx — EXISTS
- src/app/(app)/floats/floats-table.tsx — EXISTS
- src/app/(app)/floats/floats-cards.tsx — EXISTS
- src/app/(app)/floats/floats-shell.tsx — EXISTS

Commits verified: af56ac4, b556468, 5060e4c — all present in git log.

`pnpm typecheck` — PASSED (zero errors)
`pnpm lint` (touched files) — PASSED (zero errors or warnings)
