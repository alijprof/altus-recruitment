---
phase: quick-260603-fv0
plan: 01
subsystem: frontend/help
tags: [help, navigation, RSC, static-page]
dependency_graph:
  requires: []
  provides: [/help route, ScreenshotSlot component, Help nav entries]
  affects: [top-nav, mobile-nav-drawer]
tech_stack:
  added: []
  patterns: [RSC static page, shadcn Card sections, lucide icons, screenshot placeholder]
key_files:
  created:
    - src/app/(app)/help/page.tsx
    - src/app/(app)/help/screenshot-slot.tsx
  modified:
    - src/components/app/top-nav.tsx
    - src/components/app/mobile-nav-drawer.tsx
decisions:
  - Used aspect-video + min-h-40 on ScreenshotSlot for stable layout before real images exist
  - No next/image import in ScreenshotSlot — avoids runtime 404 state; swap-in comment left for later
  - max-w-3xl for help page (vs settings max-w-2xl) to give screenshot slots more width
metrics:
  duration: ~10 minutes
  completed: 2026-06-03
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase quick-260603-fv0 Plan 01: Build In-App Help / Cheat-Sheet Page Summary

**One-liner:** Static RSC help page at `/help` with ten feature Card sections, ScreenshotSlot placeholder component (no images, no PII), and Help nav entries on desktop top nav and mobile drawer.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | ScreenshotSlot placeholder + Help page sections | 556e0f8 | src/app/(app)/help/screenshot-slot.tsx, src/app/(app)/help/page.tsx |
| 2 | Add Help nav entry to desktop top nav and mobile drawer | f118674 | src/components/app/top-nav.tsx, src/components/app/mobile-nav-drawer.tsx |

## Verification

- `pnpm typecheck`: PASSED (0 errors)
- `pnpm lint`: PASSED (0 errors; 17 pre-existing warnings in test files only)
- `/help` route resolves under `(app)` route group as an async RSC with no data fetching
- Desktop `NAV_ITEMS` has `{ href: '/help', label: 'Help' }` after Settings
- Mobile `SECONDARY_NAV` has `{ href: '/help', label: 'Help' }` after Settings
- All ten feature sections present in order: dashboard, candidates, search, clients, jobs, spec calls, pipeline, reports, settings, integrations
- Each section contains a `ScreenshotSlot` rendering a dashed placeholder box — no image files needed
- PII HARD CONSTRAINT met: no screenshot files committed, no real tenant data anywhere on the page
- TODO(help-screenshots) swap-in comment present in screenshot-slot.tsx

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

`ScreenshotSlot` renders a placeholder box intentionally. Real PII-safe screenshots from seed/demo data can be added later by dropping `.png` files into `/public/help/` and swapping in `<Image>` at the marked TODO comment. The stub does not prevent the plan's goal (help page renders cleanly) from being achieved.

## Self-Check

- [x] src/app/(app)/help/page.tsx exists
- [x] src/app/(app)/help/screenshot-slot.tsx exists
- [x] Commits 556e0f8 and f118674 exist on main
- [x] grep confirms `/help` entries in both nav files
