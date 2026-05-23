# Quick Task 260523-ret: Mobile UX overhaul - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Task Boundary

Phone usability is broken: `src/components/app/top-nav.tsx` line 66 hides the entire `<nav>` below the `md` breakpoint (768px) with no replacement, so mobile users see the header and nothing clickable to switch between the 10 main app pages.

Additionally, data-heavy index pages (`/candidates`, `/jobs`, `/clients`, `/floats`) render desktop-style tables that overflow narrow viewports and are not usable on a phone.

This quick task fixes both: navigation + data-page layout.

</domain>

<decisions>
## Implementation Decisions

### Nav pattern
- **Hamburger drawer (slide-in from left)** — top-left ☰ icon on mobile opens a left-side drawer with all 10 nav items. Use shadcn's existing `Sheet` primitive (already in the codebase — used elsewhere e.g. `pipeline-mobile-list.tsx`).
- Drawer closes on link tap and on overlay tap.
- Desktop nav (`md+`) unchanged — keep the existing horizontal nav inside `top-nav.tsx`. Show the hamburger ONLY below `md`.

### Primary nav ordering
- Display all 10 nav items in the drawer.
- Order: Dashboard, Candidates, Search, Jobs, Pipeline, Clients, Floats, Spec calls, Reports, Settings.
- The first five (Dashboard → Pipeline) are the user-flagged "primary" set — render them in a visually distinct first group at the top of the drawer (no header text, just a visual divider before Clients). Top-5 first means the most-used items are inside one-thumb reach without scrolling.

### Scope
- **Full scope: nav + responsive header + table-to-card transformations on data-heavy pages.**
- Nav: hamburger + drawer pattern as above. On mobile, condense the header (smaller monogram, hide the email/org chip — it's recoverable via Settings).
- Search: keep as a primary nav item; do NOT promote to a dedicated header icon (the recruiter explicitly listed Search in their primary set, so a nav item is sufficient).
- Data-heavy index pages — convert tables to card lists below `md`:
  - `/candidates` (most-used list page)
  - `/jobs`
  - `/clients`
  - `/floats`
- Cards should render: primary identifier (name / title), 1-2 secondary fields, and stage / status badge. Keep row actions (the "..." dropdown menus added in 8547f25 / 00f1ed7 / 996403e) intact.

### Claude's Discretion
- Touch-target audit not in scope (defer if pages prove unusable).
- Form layouts (`/candidates/new`, `/clients/[id]/jobs/new`, etc.) not in scope.
- Drawer width, animation timing, exact mobile breakpoint (md = 768px is the obvious choice but executor may pick `sm` = 640px for the drawer if it looks better with tablets).
- Card design: each page's data is different; planner / executor have license to design per-page card layouts that read well. Match existing badge/stage colors.

</decisions>

<specifics>
## Specific Ideas

- Existing precedent for mobile bottom-sheet UI: `src/components/app/pipeline-mobile-list.tsx` uses `Sheet` from shadcn for the per-card action menu on mobile.
- Existing breakpoint pattern: `top-nav.tsx` already uses `hidden md:flex` — keep that convention; add `md:hidden` for the new mobile-only hamburger.
- All shadcn primitives already installed: `Sheet`, `Dialog`, `DropdownMenu`, `Button`, `Sheet` is already imported in `pipeline-mobile-list.tsx` so the wiring pattern is proven.
- Avoid introducing new dependencies — use only what's already in `package.json`.

</specifics>

<canonical_refs>
## Canonical References

- UI-SPEC §4: mobile patterns established in Phase 1 (kanban → accordion + sheet). The pipeline-mobile-list pattern is the precedent for "below md becomes a different shape, not a hidden version."
- CLAUDE.md §"AI integration patterns" + §"Naming": doesn't constrain UI/layout decisions but does forbid `any` without explicit reason.

</canonical_refs>
