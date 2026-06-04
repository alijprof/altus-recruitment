---
phase: 05-saas-shell
plan: 02
subsystem: ui
tags: [branding, css-custom-properties, xss, hex-validation, settings, apply-form, next-image]

# Dependency graph
requires:
  - phase: 05-00
    provides: brand_primary, brand_secondary, logo_url columns on organizations + getOrganizationBySlug/OrganizationApplyRow (SELECT already widened)

provides:
  - src/lib/branding/colours.ts — isHexColour, safeHex, BRAND_DEFAULTS (single source of truth for hex validation)
  - src/app/(app)/settings/branding/* — owner-gated branding settings page + form + Server Action
  - Public apply page branded with org logo + CSS custom property colours (XSS-safe)

affects:
  - 05-03 (custom domain / subdomain routing will reference branding)
  - Any phase that adds public candidate-facing pages (brand vars are set on the wrapper)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hex-only CSS injection: colours always go through safeHex() then into a React style object as CSS custom properties — never into a style tag string or className interpolation"
    - "R8 owner-before-write ordering in Server Actions: parse → authenticate → authorise → write"
    - "Defence-in-depth hex validation: DB CHECK (05-00) + Zod schema (Server Action) + safeHex at render"

key-files:
  created:
    - src/lib/branding/colours.ts
    - src/lib/branding/colours.test.ts
    - src/app/(app)/settings/branding/schema.ts
    - src/app/(app)/settings/branding/actions.ts
    - src/app/(app)/settings/branding/branding-form.tsx
    - src/app/(app)/settings/branding/page.tsx
  modified:
    - src/app/(public)/apply/[orgSlug]/page.tsx
    - src/app/(public)/apply/[orgSlug]/apply-form.tsx
    - src/app/(app)/settings/page.tsx

key-decisions:
  - "Single-source HEX_RE in colours.ts; Zod schema mirrors it — no duplicated regex authorship"
  - "CSS custom property injection (style object) as the XSS containment boundary — never className interpolation or style tag"
  - "Empty string → null mapping in Server Action (clear colour = revert to Altus defaults at render)"
  - "next/image with unoptimized=true for externally-hosted org logos (domain list not yet restricted)"
  - "brandPrimary/brandSecondary kept in ApplyFormProps type for future use; not destructured in function to avoid unused-var lint warning"

patterns-established:
  - "safeHex pattern: always re-validate DB colour values at the render boundary, even when DB CHECK + Server Action already validated on write"
  - "CSS custom property wrapper: set --brand-primary/--brand-secondary on a single wrapper div; all child components reference var(--brand-primary) via inline style or Tailwind arbitrary values"

requirements-completed: [BRAND-01]

# Metrics
duration: 35min
completed: 2026-06-04
---

# Phase 5 Plan 02: Branding Summary

**Per-org logo + two-colour branding on the public apply/careers page, with CSS-injection XSS closed in depth (DB CHECK + Zod hex schema + safeHex render re-validation + CSS custom property injection only)**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-04T21:53:00Z
- **Completed:** 2026-06-04T22:28:00Z
- **Tasks:** 2 (Task 2.1 TDD: RED + GREEN commits; Task 2.2: feat commit)
- **Files modified:** 9

## Accomplishments

- `src/lib/branding/colours.ts` exports `isHexColour`, `safeHex`, and `BRAND_DEFAULTS` — the single source of truth for hex validation across Server Action, Zod schema, and render layer
- Owner-gated `/settings/branding` page with colour picker + hex text input + live swatch + logo URL field, wired to `updateBrandingAction` (R8 ordering: parse → authenticate → authorise → write)
- Public apply page renders org logo (next/image) or wordmark fallback and injects validated brand colours as CSS custom properties on the wrapper `div` — never into a style tag or className string
- 19 unit tests cover injection payloads, 3-digit hex rejection, null/undefined handling, and BRAND_DEFAULTS validity
- Branding nav card added to `/settings` (owner-only, next to Billing)

## Task Commits

1. **Task 2.1 RED: Hex colour helper tests** — `d31aac8` (test)
2. **Task 2.1 GREEN: Hex helper + branding action + settings form** — `dcfcb93` (feat)
3. **Task 2.2: Branded apply page** — `bc2aa1b` (feat)

## Files Created/Modified

- `src/lib/branding/colours.ts` — isHexColour (6-digit hex only), safeHex (validated-or-fallback), BRAND_DEFAULTS
- `src/lib/branding/colours.test.ts` — 19 unit tests including CSS injection payloads
- `src/app/(app)/settings/branding/schema.ts` — Zod schema: hex or empty string fields for brand_primary/brand_secondary; z.string().url() or empty for logo_url
- `src/app/(app)/settings/branding/actions.ts` — updateBrandingAction: R8 owner check before write, empty→null mapping, revalidatePath
- `src/app/(app)/settings/branding/branding-form.tsx` — client form with colour picker + hex text + live preview swatch, toast on error, no silent success
- `src/app/(app)/settings/branding/page.tsx` — RSC settings page with back-link and owner-gated card
- `src/app/(app)/settings/page.tsx` — added Branding nav card (owner-only, before Billing)
- `src/app/(public)/apply/[orgSlug]/page.tsx` — safeHex re-validation at render, CSS custom properties on wrapper div, logo with next/image / wordmark fallback
- `src/app/(public)/apply/[orgSlug]/apply-form.tsx` — submit button styled via var(--brand-primary); brandPrimary/brandSecondary added to props type

## Decisions Made

- **Single-source regex:** HEX_RE lives only in `colours.ts`; the Zod schema mirrors it but the canonical implementation is one file. This prevents drift.
- **CSS custom property boundary:** The XSS containment point is the wrapper `div`'s `style` object in `page.tsx`. All child components reference `var(--brand-primary)` — the raw hex string never reaches a className or style tag.
- **Empty string → null:** Server Action maps empty hex fields to null (clear colour), so the render always falls back to Altus defaults. No `#000000` sentinel values needed.
- **next/image unoptimized:** Org logos are externally hosted; restricting the image domain list requires knowing all org logo hosts in advance. `unoptimized` is safe because the URL is validated as `z.string().url()` on write and renders only as an `<img>` src (not a script context).

## Deviations from Plan

None - plan executed exactly as written.

## Security Invariant Confirmation

**Brand-XSS invariant: HOLDS at all three layers.**

| Layer | Implementation | Status |
|-------|---------------|--------|
| DB CHECK (05-00) | `brand_primary ~ '^#[0-9a-fA-F]{6}$'` constraint on write | Pre-existing, not touched |
| Server Action (Zod) | `z.string().regex(/^#[0-9a-fA-F]{6}$/)` in `updateBrandingSchema` | Implemented |
| Render re-validation | `safeHex(org.brand_primary, BRAND_DEFAULTS.primary)` in `apply/[orgSlug]/page.tsx` | Implemented |
| Injection vector | `style={{ '--brand-primary': brandPrimary }}` on wrapper `div` — **no `<style>` tag, no `dangerouslySetInnerHTML`, no className interpolation** | Confirmed by grep + code review |

**Brand writes are owner/org-scoped:** `updateBrandingAction` queries `users` for `role` and rejects non-owners before calling `updateOrganization` (which is itself RLS-scoped to the authenticated user's org).

## Issues Encountered

- The plan's automated verify grep `! grep -qE "<style"` matched on comments in `page.tsx` that used `<style>` as documentation text. Reworded comments to say "raw style tag" instead of `<style>`. No functional change.

## Next Phase Readiness

- Per-org branding is live. The `--brand-primary` and `--brand-secondary` CSS custom properties are available to any child component on the apply page — future phases can extend button/link/accent styling without touching the hex validation layer.
- `BRAND_DEFAULTS` export is available to any new public-facing page that needs fallback colours.
- No new migrations were written or pushed in this plan (brand columns were added by 05-00).

---
*Phase: 05-saas-shell*
*Completed: 2026-06-04*
