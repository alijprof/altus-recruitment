---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 02
subsystem: pdf-generation
tags: [react-pdf, pdf, fonts, liberation-sans, unpdf, vitest, vercel]

# Dependency graph
requires: []
provides:
  - "@react-pdf/renderer installed as a runtime dependency (founder-approved 2026-08-12)"
  - "Vendored, OFL-licensed Liberation Sans Regular/Bold TTFs at src/lib/pdf/fonts/"
  - "src/lib/pdf/register-fonts.ts — module-scope Font.register + BRANDED_CV_FONT_FAMILY export"
  - "outputFileTracingIncludes wiring so the fonts ship inside the /candidates/[id] serverless function"
  - "A proven renderToBuffer path: real PDF output, £/diacritic glyph coverage, zero network I/O, sub-second"
affects: [08-04-branded-cv-document-template, 08-07-generate-action]

# Tech tracking
tech-stack:
  added: ["@react-pdf/renderer ^4.6.0"]
  patterns:
    - "Module-scope Font.register from a vendored filesystem path (never a URL) — closes the cold-start async-download race"
    - "Font.register src must be a file PATH string in this installed version, not a Buffer — see Deviations"
    - "@vitest-environment node override per-file for server-side rendering tests (default suite env is jsdom)"

key-files:
  created:
    - src/lib/pdf/register-fonts.ts
    - src/lib/pdf/fonts/LiberationSans-Regular.ttf
    - src/lib/pdf/fonts/LiberationSans-Bold.ttf
    - src/lib/pdf/fonts/LICENSE.txt
    - tests/unit/lib/pdf/render-foundation.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - next.config.ts

key-decisions:
  - "Liberation Sans (not Inter/Noto Sans as research's fallback example suggested) — already present on the build host at /usr/share/fonts/truetype/liberation2/, OFL 1.1, metric-compatible with Arial, static (non-variable) weights, full Latin-Extended-A + £ coverage"
  - "Font.register src passed as a file path string, not a Buffer — the installed @react-pdf/renderer 4.6.0 does not support Buffer src (see Deviations)"

patterns-established:
  - "Pattern: vendor binary assets (fonts) into the repo with a LICENSE.txt carrying full license text + provenance note, never fetched at build/render time"
  - "Pattern: outputFileTracingIncludes entries keyed by route path for any server code reading files via process.cwd() at runtime"

requirements-completed: [BCV-02, BCV-07]

# Metrics
duration: 25min
completed: 2026-08-12
---

# Phase 08 Plan 02: PDF Engine Foundation Summary

**Installed and load-bearing-proved `@react-pdf/renderer` with vendored OFL Liberation Sans fonts — a Node server context renders a real PDF with correct £/diacritic glyphs and zero network I/O, in well under a second.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-12
- **Tasks:** 2/2 completed
- **Files modified:** 8 (3 modified, 5 created)

## Accomplishments

- `@react-pdf/renderer ^4.6.0` installed via `pnpm add -w` (workspace root), founder-approved 2026-08-12; confirmed no `postinstall` script on the installed package
- Liberation Sans Regular + Bold (OFL 1.1, static TTFs, Arial-metric-compatible, full Latin-Extended-A + £ coverage) vendored from the Debian `fonts-liberation2` package with a full-text `LICENSE.txt` + provenance note
- `register-fonts.ts` registers the family once at module scope from the filesystem, exports `BRANDED_CV_FONT_FAMILY`, and disables react-pdf's default word-mangling hyphenation
- `next.config.ts` gained `outputFileTracingIncludes` for `/candidates/[id]` so the font directory ships inside the deployed serverless function (final proof deferred to the 08-09 Vercel-deployed smoke, since local build cannot observe function tracing — noted in research)
- A render-foundation regression test proves, empirically, all four required behaviours: real `%PDF-` output, `£1,250 per day` / `Renée Müller` surviving a real `unpdf` text-extraction round-trip, zero `http(s)` network calls, and completion in ~600ms (well under the 5s budget)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install the renderer, vendor fonts, register at module scope** - `5be6873` (feat)
2. **Task 2: Render-foundation regression test** - `6436fca` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `package.json` / `pnpm-lock.yaml` - `@react-pdf/renderer ^4.6.0` added to `dependencies`
- `next.config.ts` - `outputFileTracingIncludes` entry for `/candidates/[id]` → `./src/lib/pdf/fonts/**`
- `src/lib/pdf/register-fonts.ts` - module-scope `Font.register`, `BRANDED_CV_FONT_FAMILY` export, hyphenation-callback override, double-registration guard
- `src/lib/pdf/fonts/LiberationSans-Regular.ttf`, `LiberationSans-Bold.ttf` - vendored static TTFs (OFL 1.1)
- `src/lib/pdf/fonts/LICENSE.txt` - full SIL OFL 1.1 text + provenance note (source path, date, why this family)
- `tests/unit/lib/pdf/render-foundation.test.ts` - the four-behaviour render-foundation regression test (canary for the whole Phase 8 feature)

## Decisions Made

- **Liberation Sans over Inter/Noto Sans:** the plan explicitly offered Liberation Sans (present on this build host at `/usr/share/fonts/truetype/liberation2/`) as the primary choice, with DejaVu Sans as a documented fallback if unavailable. Liberation Sans was available, so it was used — Arial-metric-compatibility also reads as more conventional for a professional recruitment CV than Inter (which research's generic code examples used as a placeholder name).
- **`Font.register` src = file path, not Buffer:** see Deviations below — this is a compile-time and runtime constraint of the installed library version, not a stylistic choice.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `Font.register`'s `src` cannot be a Buffer in the installed `@react-pdf/renderer` version**

- **Found during:** Task 1 (register-fonts.ts), confirmed by Task 1's `pnpm typecheck` verify step
- **Issue:** The plan's `<interfaces>` block and the phase research both assumed `Font.register({ src: <Buffer> })` was supported ("Font.register accepts a Buffer `src` (filesystem-loaded), NOT only a URL"). The installed `@react-pdf/renderer@4.6.0` (`@react-pdf/font@4.0.9`) types declare `src: string`, and empirical testing confirmed the runtime also rejects a Buffer: `Font.register({ src: readFileSync(...) })` → `renderToBuffer` throws `dataUrl.substring is not a function` (its internal data-URL sniff assumes `src` is a string; a Buffer's `.indexOf(',')` can match a byte sequence in binary font data, then `.substring()` — not present on Buffer — is called next).
- **Fix:** Verified empirically with a throwaway Node script that passing the file PATH string (still built via `join(process.cwd(), ...)`, never a URL) works correctly — `@react-pdf/font` resolves it via `fontkit.open(path)` → `fs.promises.readFile(path)`, a pure filesystem read with the same zero-network, no-async-download-race properties the plan required. `register-fonts.ts` still calls `readFileSync` at module scope on both paths (result discarded) purely as a fail-fast existence check — if the vendored TTFs are missing from a deployed bundle, this throws a clear `ENOENT` at cold start instead of an obscure fontkit error at first render. The header comment documents the discrepancy and why it doesn't compromise the underlying invariant (filesystem-only, no URL, no race).
- **Files modified:** `src/lib/pdf/register-fonts.ts`
- **Verification:** `pnpm typecheck` clean; empirical Node script confirmed `renderToBuffer` succeeds and produces valid PDF bytes with the path-based registration; the Task 2 render-foundation test exercises this exact code path and passes.
- **Committed in:** `5be6873` (Task 1 commit)

**2. [Rule 1 - Bug] The plan's literal "fails if `globalThis.fetch` is called during the render" would be permanently, incorrectly red**

- **Found during:** Task 2 (render-foundation test), first run
- **Issue:** `@react-pdf/layout`'s `yoga-layout` dependency (the flexbox engine react-pdf uses for `<View>`/`<Text>` layout) bootstraps its WASM binary via a one-time, process-memoized `fetch('data:application/octet-stream;base64,...')` call (`instancePromise ??= loadYoga()` in `@react-pdf/layout`). A `data:` URI is resolved entirely in-process — no DNS lookup, no socket, no bytes leave the machine — so it is not network I/O in any meaningful sense, but it IS a call to `globalThis.fetch`. Asserting "zero fetch calls, full stop" would fail this test on every run for a reason completely unrelated to the actual regression it exists to catch (research Pitfall 4: a font `src` reverting to a real `https://` URL).
- **Fix:** Scoped the assertion to reject only fetch calls whose target is an `http://` or `https://` URL, with a comment explaining the yoga-layout WASM bootstrap finding. This still catches the real regression (a `Font.register({ src: 'https://...' })` reintroduction would show up as an http(s) fetch) while not producing a false-positive failure on the layout engine's own local WASM loading.
- **Files modified:** `tests/unit/lib/pdf/render-foundation.test.ts`
- **Verification:** Test passes consistently across 3 repeated runs (`pnpm vitest run tests/unit/lib/pdf/render-foundation.test.ts`); full `pnpm test` run afterwards shows 960/960 passing (0 failures, 28 todo — consistent with pre-existing suite state plus this new test).
- **Committed in:** `6436fca` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - bug, both in the PDF-library integration surface)
**Impact on plan:** Both fixes were necessary for the plan's stated behaviours to actually hold against the real installed library version — without them, Task 1's font registration would throw at every render, and Task 2's test would be a permanent false-positive failure unrelated to the invariant it protects. No scope creep; both fixes stayed inside the plan's two named files.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None — no external service configuration required. The dependency install and font vendoring are fully self-contained in the repo; no environment variables or dashboard steps needed.

## Next Phase Readiness

- `BRANDED_CV_FONT_FAMILY` from `src/lib/pdf/register-fonts.ts` is ready for the template component (08-04) to consume via `StyleSheet.create({ fontFamily: BRANDED_CV_FONT_FAMILY })`.
- `renderToBuffer` is proven to produce a real, glyph-correct PDF from this Node server context — 08-07's generation Server Action can call it directly with no further font/registration work.
- `outputFileTracingIncludes` covers `/candidates/[id]` only (where 08-07's action will live, per the plan). If a later plan moves generation to a different route, that entry needs a matching addition — flagging this for whoever builds 08-07.
- **Not yet verified:** the actual Vercel-deployed function bundle includes the fonts (local build cannot observe output file tracing, per research) — this is explicitly deferred to the 08-09 acceptance-gate smoke against a real deploy, not a gap in this plan.
- No blockers for 08-04 (template) or 08-03 (parallel: storage/schema plan for the branded-CV artifact, out of this plan's file scope).

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12*

## Self-Check: PASSED

All 8 claimed files verified present on disk (register-fonts.ts, both vendored TTFs, LICENSE.txt, render-foundation.test.ts, next.config.ts, package.json, pnpm-lock.yaml). Both task commits (`5be6873`, `6436fca`) verified present in `git log --oneline --all`.
