---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 04
subsystem: pdf
tags: [react-pdf, unpdf, pdf-generation, branding, vitest]

# Dependency graph
requires:
  - phase: 08-02
    provides: "@react-pdf/renderer install + BRANDED_CV_FONT_FAMILY vendored-font registration (src/lib/pdf/register-fonts.ts)"
  - phase: 08-03
    provides: "BrandedCvData type + toBrandedCvData contact-strip mapper (src/lib/pdf/branded-cv-data.ts)"
provides:
  - "BrandedCvDocument component + renderBrandedCv(data, branding) => Promise<Buffer> — the actual template a client receives"
  - "BrandedCvBranding type (orgName/primary/secondary/logo-as-bytes) — the contract 08-07 (delivery) must satisfy"
  - "unpdf text-extraction regression suite proving BCV-03 end-to-end (mapper -> renderer -> extracted PDF text)"
affects: [08-07, 08-08, 08-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "unpdf getDocumentProxy + extractText round-trip on generated PDF bytes as the honest end-to-end pin for 'this document never contains X' — both merged-text AND raw-latin1-buffer checks, since raw bytes is the stronger absence proof"
    - "In-test tiny-PNG base64 constant (68 bytes, real PNG signature) instead of a disk fixture, for exercising the logo-image render path without I/O"
    - "WRITE_PDF_SAMPLES=1-gated sample generation inside the test file itself — founder-review artifacts come from the same code path the regression suite exercises, written to a gitignored dir, zero side-effect on ordinary runs"

key-files:
  created:
    - src/lib/pdf/branded-cv-document.tsx
    - tests/unit/lib/pdf/branded-cv-document.test.ts
  modified: []

key-decisions:
  - "Removed `lineHeight` from the Page-level style entirely and scoped it to only the specific text styles that wrap (bodyText/headline/contextLine/entryTitle/entryMeta/sectorLine) — root-caused a real @react-pdf/renderer 4.6.0 layout bug where a Page-level lineHeight silently dropped the footer's flexDirection:row org-name/page-number children once a header/headerRule/identity block preceded it"
  - "Footer wording implements the plan's exact copy: '{org name}' left / 'Page N of M' right / 'Candidate contact details available from {org name}.' below, per criterion 7"
  - "Skill-chip tint uses an 8-digit #RRGGBBAA hex (react-pdf's color-string parser supports it) rather than a new dependency, for the brand_secondary low-opacity accent in criterion 5"

patterns-established:
  - "Never set `lineHeight` (or, by extension, any style property that visibly changes flex-row layout) at the react-pdf Page level if a `position: absolute` + `flexDirection: row` footer/header follows other block content — scope such properties to leaf text styles instead"

requirements-completed: []  # BCV-02/BCV-03 are CODE-complete and test-verified (Tasks 1-2), but Task 3 is a founder design-eyeball checkpoint (gate="blocking") that has not yet been resolved — do not mark complete until the founder approves or requests changes.

duration: ~35min (Tasks 1-2 + a real bug found/fixed while writing Task 2's pagination test; Task 3 is the founder checkpoint)
completed: 2026-08-12
---

# Phase 8 Plan 04: Standard Branded CV Template Summary

**BrandedCvDocument (@react-pdf/renderer) implementing all nine visual-acceptance criteria — white wide-logo header, brand-accent-only colouring, contact-stripped sections, fixed multi-page footer — pinned end-to-end by 13 unpdf text-extraction assertions that render real PDF bytes and prove email/phone/salary never appear in them.**

## Status: CHECKPOINT-PENDING

Tasks 1 and 2 are complete, verified (typecheck/lint/full test suite all
green), and committed. Task 3 is a `checkpoint:human-verify`
(`gate="blocking"`) — the founder must visually eyeball the two sample
PDFs before any downstream plan (08-07 delivery, 08-08, 08-09) builds on
this template. Sample PDFs have been generated and copied outside the
repo for review; see "What the founder must do" below.

## Performance

- **Duration:** ~35 min (Tasks 1-2, including a real bug found and fixed
  while building Task 2's pagination test)
- **Completed:** 2026-08-12T12:47Z
- **Tasks:** 2 of 3 executed (Task 3 is the founder checkpoint)
- **Files created:** 2

## Accomplishments

- `src/lib/pdf/branded-cv-document.tsx`: `BrandedCvDocument` component +
  `renderBrandedCv(data, branding) => Promise<Buffer>`, `BrandedCvBranding`
  type. Every one of the plan's nine numbered visual-acceptance criteria
  is implemented and comment-mapped in the `StyleSheet`: A4 portrait
  ~40pt margins; white (never full-bleed-coloured) header with a
  160×54pt `objectFit: 'contain'` logo slot; a deliberate org-name
  wordmark fallback when there's no logo; `brand_primary` on accents only
  (section headings, header/footer rules, skill-chip border/text) with
  `brand_secondary` as an 8-digit-hex low-opacity chip tint;
  identity → Profile → Skills(+Sectors) → Experience → Education, each
  section omitted entirely when empty; a fixed footer on every page
  (`{org name}` / `Page N of M` / the contact-availability line); both
  hex colours pass through `safeHex` before use. Props typed
  `BrandedCvData` only (08-03) — no db/supabase/next imports, no fetch.
- `tests/unit/lib/pdf/branded-cv-document.test.ts`: 13 passing assertions
  (+1 env-gated) built on the REAL `toBrandedCvData -> renderBrandedCv`
  chain against a `candidates`-shaped fixture that includes
  email/phone/salary, extracting text back out with `unpdf`
  (`getDocumentProxy` + `extractText`). Covers: full-fixture
  name/headline/skills/work/education presence; email/phone/salary
  absence checked in BOTH extracted text and the raw latin1 buffer (the
  stronger pin); city-level location presence (A1, founder-confirmed);
  £/é/ü glyph survival; a sparse (`full_name`-only) candidate rendering
  exactly one page with no empty section headings; an 8-work-entry +
  long-`about` fixture forcing pagination to 2 pages with the literal
  `Page N of M` string present on every extracted page; a PNG logo
  (built in-test from a base64 constant, no disk fixture) rendering
  without error; the no-logo wordmark fallback; `safeHex` fallback pinned
  against `'javascript:alert(1)'`/`'red'`/malformed hex never appearing
  in the PDF bytes.
- `WRITE_PDF_SAMPLES=1`-gated sample generation writes
  `sample-with-logo.pdf` / `sample-no-logo.pdf` to the gitignored
  `playwright-report/branded-cv-samples/` directory, using the same
  full-fixture data the regression suite already exercises.

## Task Commits

Each task was committed atomically:

1. **Task 1: The branded CV template component** - `168bad7` (feat)
2. **Task 2: PDF text-extraction assertions** - `b5561e7` (test)
3. **[Rule 1 bug fix, found while completing Task 2]** - `9ea58ad` (fix)
4. **Task 3: Founder eyeball on the template design** — CHECKPOINT, not yet executed (see below)

**Plan metadata:** this SUMMARY + commit (pending, committed alongside this file)

## Files Created/Modified

- `src/lib/pdf/branded-cv-document.tsx` — the template component + `renderBrandedCv` (new)
- `tests/unit/lib/pdf/branded-cv-document.test.ts` — 13-assertion unpdf extraction suite (new)

## Decisions Made

- **Page-level `lineHeight` removed, scoped to leaf text styles instead**
  — see the bug writeup below. This is the one substantive design
  deviation from a naive first draft; the visual result (line spacing on
  wrapping paragraphs) is unchanged, only *where* the style lives.
- **Footer copy matches the plan verbatim**: "Candidate contact details
  available from {org name}." — flagged in the checkpoint's
  `<how-to-verify>` as a tone question for the founder, not decided
  unilaterally here.
- **Work/education entry rendering**: a bold title line (job title or
  school) plus a lighter meta line (company/degree + dates), degrading to
  whichever fields are actually present — the mapper guarantees at least
  one of title/company/dates (or school/degree/dates) is non-empty per
  entry, so the title line is never blank.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Page-level `lineHeight` silently dropped the footer's org-name/page-number row**
- **Found during:** Task 2, while writing the multi-page pagination test and visually eyeballing the first rendered sample PDF (self-check before handing off to the founder — the extracted text was missing "Page 1 of 2" even though the test as originally written still passed, because the org name also appears inside the separate footer-notice sentence).
- **Issue:** `styles.page` set `lineHeight: 1.4`. With the installed `@react-pdf/renderer@4.6.0` (`@react-pdf/layout@4.7.0`), a `lineHeight` inherited from the Page down into a `flexDirection: 'row', justifyContent: 'space-between'` footer view (containing the org-name `Text` and a `render`-prop page-number `Text`) caused that row's children to silently fail to render, once a header/headerRule/identity block preceded it in the tree. Root-caused via a bisection across ~20 minimal `@react-pdf/renderer` repro variants (not committed — scratch files, deleted after diagnosis) that isolated the exact combination of factors required to reproduce it; local `lineHeight` overrides on the row or its children did not cancel the inherited effect, only removing it from the Page style did.
- **Fix:** Dropped `lineHeight` from `styles.page`; added `lineHeight: 1.4` individually to `bodyText`, `headline`, `contextLine`, `entryTitle`, `entryMeta`, and `sectorLine` — the styles that actually render potentially-wrapping text. Left a detailed comment on `styles.page` explaining the constraint so it isn't reintroduced.
- **Also strengthened the two footer-adjacent tests** (sparse-candidate single-page, multi-page pagination) to assert the literal `Page N of M` string per page rather than a loose "org name appears somewhere" check, since the org name also appears in the separate footer-notice sentence and could mask a regression of exactly this class. Verified the strengthened tests actually catch the bug by temporarily reverting the fix (`git stash` on just the component file) and confirming both tests fail against the buggy component, before restoring the fix.
- **Files modified:** `src/lib/pdf/branded-cv-document.tsx`, `tests/unit/lib/pdf/branded-cv-document.test.ts`
- **Verification:** `pnpm vitest run tests/unit/lib/pdf/branded-cv-document.test.ts` — 13/13 green (was a false-positive-passing 13/13 before the fix, due to the test gap above); `pnpm typecheck` / `pnpm lint` clean; visually re-confirmed via the regenerated sample PDFs (both pages now show `Steele Charles Ltd` left / `Page N of M` right in the footer).
- **Committed in:** `9ea58ad`

---

**Total deviations:** 1 auto-fixed (Rule 1 — a real, user-visible rendering bug that would otherwise have shipped to the founder's design review undetected).
**Impact on plan:** No scope creep — the fix is entirely internal to the template's `StyleSheet` and the test file. Visual output is unchanged from the plan's intent (paragraph line-spacing still ~1.4); the footer now actually shows what criterion 7 requires.

## Issues Encountered

- **`node_modules` missing at start** (git worktrees don't share it with the main checkout) — ran `pnpm install --frozen-lockfile` before anything else. Not a deviation, a one-time environment setup step.
- **`git stash`/`git stash pop` used during debugging** to isolate the component fix from the test-file changes and confirm the strengthened tests genuinely fail against the pre-fix code. Both stash operations were scoped to specific already-tracked files (never `git stash -u`, never touched untracked files), and the worktree's `git status` was empty before proceeding to commit — no risk to other in-flight work.

## User Setup Required

**BLOCKING — Task 3 of this plan is a founder checkpoint.** No later Phase 8 plan should build on this template until the founder has seen it.

### What the founder must do

1. Open the two sample PDFs (generated from the full test fixture,
   copied outside the repo for this review):
   - `sample-with-logo.pdf`
   - `sample-no-logo.pdf`
2. Check the things only a human can judge (per the plan's Task 3
   `<how-to-verify>`):
   - Does this look like a document you'd send to a client under the
     Steele Charles name?
   - Header: is the wide logo slot the right size/position? Does the
     no-logo wordmark version still look deliberate?
   - Colour: is `brand_primary` (sample uses a deep bottle green,
     `#1A6B50`, as a stand-in for SC's real value) used tastefully on
     accents rather than a big filled band?
   - Section order/content: identity → profile → skills → experience →
     education — anything missing, anything you'd drop?
   - Footer wording: "Candidate contact details available from
     {org name}." — right tone, or would you word it differently?
3. Visual confirm only (scope itself was signed off 2026-08-12): the
   name and city-level location are present, and no email, phone or
   salary figure appears anywhere. (Note: the sample's `about` paragraph
   is deliberately very long — repeated filler sentences — purely to
   force the 2-page pagination test; ignore its content, judge the
   layout/pagination behaviour instead.)

Reply "approved", or list the specific layout/copy/colour changes
wanted, to resume Phase 8 execution.

## Next Phase Readiness

- **Blocked:** 08-07 (delivery/generation Server Action), 08-08, and
  08-09 should not consume `BrandedCvDocument`/`renderBrandedCv` as final
  until the founder has approved the design (or this plan has been
  revised per their feedback and re-verified).
- **Not blocked:** the component and its test suite are code-complete,
  fully typechecked/linted, and independently verifiable without a live
  database or any external service — a sibling executor's 08-05 (branding
  settings UI, disjoint file set) can proceed in parallel regardless of
  this checkpoint's outcome.

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12 (Tasks 1-2); Task 3 checkpoint-pending*

## Self-Check: PASSED

All claimed files and commits verified present in the worktree and git history.

## Addendum (2026-08-19) — founder design verdict

Founder reviewed the real-logo sample (rendered with the actual Steele Charles
lockup pulled from steelecharles.co.uk, tinted to their site green #1B3B29)
and approved it **as a first draft** ("Looks good as a first draft"). The
08-04 Task 3 design checkpoint is satisfied for phase progression; refinement
requests remain welcome at UAT and are cheap (single template file).
