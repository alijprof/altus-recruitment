---
phase: 260603-fv0
reviewed: 2026-06-03T00:00:00Z
depth: quick
files_reviewed: 4
files_reviewed_list:
  - src/app/(app)/help/page.tsx
  - src/app/(app)/help/screenshot-slot.tsx
  - src/components/app/top-nav.tsx
  - src/components/app/mobile-nav-drawer.tsx
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 260603-fv0: Code Review Report

**Reviewed:** 2026-06-03
**Depth:** quick
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Four files reviewed for the static in-app Help page. No PII exposure, no real tenant data rendered, no client-only APIs in a server component. The page is entirely static RSC with no DB calls — correct and intentional. Nav wiring is correct in both `NAV_ITEMS` (desktop) and `SECONDARY_NAV` (mobile): `/help` is present in both. Screenshot placeholders render a `<figure>` with a `<figcaption>` — no `<img>` tags, so there is no broken-image / 404 risk. Two warnings and three info items follow.

## Critical Issues

None.

## Warnings

### WR-01: `<figure>` placeholder has no accessible name for screen readers

**File:** `src/app/(app)/help/screenshot-slot.tsx:14`
**Issue:** The `<figure>` element contains only a decorative icon (`aria-hidden="true"`) and a visible text node ("Screenshot coming"). Screen readers announcing the figure have no concise description of *what* the screenshot will depict. The `caption` prop is used only in `<figcaption>`, which is fine for sighted users; but `aria-label` on the `<div>` placeholder would allow AT users to understand what content is pending in each slot.
**Fix:**
```tsx
<div
  aria-label={`Screenshot placeholder: ${caption}`}
  className="flex aspect-video min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40"
>
```
This is a low-risk change; the `<figure>` itself is already semantically correct — only the inner placeholder `<div>` needs the label.

---

### WR-02: `AltusMonogram` duplicated verbatim across two files — divergence risk

**File:** `src/components/app/mobile-nav-drawer.tsx:19–33` and `src/components/app/top-nav.tsx:22–36`
**Issue:** The `AltusMonogram` component is copy-pasted identically into both files. The inline comment in `mobile-nav-drawer.tsx` even acknowledges this ("matches the one in top-nav.tsx"). Any future brand-mark change (stroke colour, viewBox, proportions) must be made in two places; a missed update produces a visible inconsistency. This is not currently broken, but the duplication is a concrete maintenance hazard.
**Fix:** Extract to `src/components/app/altus-monogram.tsx` and import it in both files:
```tsx
// src/components/app/altus-monogram.tsx
export function AltusMonogram({ className }: { className?: string }) { ... }
```

## Info

### IN-01: `page.tsx` is `async` but performs no async work

**File:** `src/app/(app)/help/page.tsx:19`
**Issue:** `export default async function HelpPage()` — the `async` keyword adds an unnecessary microtask boundary on every render. The function body is entirely synchronous JSX. This is harmless in Next.js App Router but is misleading (implies a DB call or `await` that does not exist).
**Fix:** Remove `async`:
```tsx
export default function HelpPage() {
```

---

### IN-02: TODO comment left in shipped code

**File:** `src/app/(app)/help/screenshot-slot.tsx:8`
**Issue:** A `// TODO(help-screenshots): once PII-safe captures exist …` comment documents future intent. Per project conventions, TODO comments in shipped files should reference a tracked work item; the current comment does not. It is not harmful but will accumulate if not tracked.
**Fix:** Either convert to a GitHub issue and reference the issue number, or remove the comment and rely on the plan document. If keeping it, prefix with the issue number: `// TODO(#NNN): …`.

---

### IN-03: `handleClose` in `MobileNavDrawer` is a one-liner that could be inlined

**File:** `src/components/app/mobile-nav-drawer.tsx:93–95`
**Issue:** `function handleClose() { setOpen(false) }` is declared as a named function and passed to every `NavItem`. Because it captures `setOpen` via closure, it is recreated on every render without `useCallback`. In a component with this many nav items this is negligible, but it is an unnecessary named indirection.
**Fix:** Either inline `() => setOpen(false)` at the call site or wrap with `useCallback` if future renders prove costly:
```tsx
// inline approach
onClick={() => setOpen(false)}
```

---

_Reviewed: 2026-06-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
