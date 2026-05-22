---
phase: 03
created: "2026-05-21"
purpose: "Session-handoff for Phase 3 UAT resume. Read this FIRST when the user says 'continue from where we left off' or runs /gsd-progress."
status: "UAT in progress — 2 of 15 tests resolved (1 pass + 1 partial), 13 blocked pending live env work"
---

# Phase 3 — resume here next session

## Where we are

Phase 3 code is on `main` and pushed (origin/main). All deployment plumbing is now wired:

- Vercel CLI installed + linked to project `altus-recruitment` under team `alijprofs-projects`
- OpenAI API key created, set on Vercel (Preview + Production + Development)
- Supabase migrations already applied on the remote (auto-applied via GitHub integration on push) — `pnpm exec supabase db diff --linked` showed zero drift
- Chrome extension built, side-loaded, ID registered with Vercel as `LINKEDIN_EXTENSION_ID`, `LINKEDIN_EXTENSION_MIN_VERSION=0.1.0`
- Production deploy live at `https://altus-recruitment.vercel.app`

## What's done in UAT (`03-UAT.md`)

| Test | Status | Note |
|------|--------|------|
| 2. LinkedIn capture creates candidate with embedding | **partial-pass** | Capture pipeline works end-to-end (auth + scrape + POST + dedup + embed). But only `name` + `linkedin_url` populate — rest of fields null because LinkedIn rebuilt the profile DOM. Tracked as G6. |
| 3. LinkedIn dedup updates instead of creating | **pass** | Confirmed via Huw Jones capture — "Updated existing candidate." toast |

All other tests (1, 4-15) still `blocked: release-build`.

## Highest-priority unfinished work

### 1. Fix LinkedIn DOM selectors (G6) — DONE in this session, needs live retest

Rewrote `scrapeProfileInPage` in `chrome-extension/src/background/ingest.ts` to use **class-name-agnostic** strategies that survive LinkedIn DOM rewrites:

- **Section discovery** via `document.getElementById('experience' | 'education' | 'skills' | 'about')` + `closest('section')`. LinkedIn maintains these anchor IDs because the in-profile jump nav depends on them.
- **Heading-text fallback** — finds the section by matching an `<h2>` whose text equals "Experience" / "Education" / "Skills" / "About".
- **Entry extraction** uses `:scope > li` against the first `<ul>` whose children contain a `span[aria-hidden="true"]` (filters nav/dropdown lists out).
- **Span-walk parser** — reads all `span[aria-hidden="true"]` texts in document order per entry, then classifies each as title / company / dates by pattern match (date regex catches "Jan 2020 - Present", employment-type filter strips "Full-time" chips).
- **Top card** (headline + location) discovered via `main section:first-of-type`, picking the first `.text-body-medium` (headline) and first `.text-body-small` (location) excluding follower/connection counts.
- **About** takes the longest aria-hidden span in the section — the actual body is invariably the longest text.

Manifest bumped to `0.1.1` so the next load is identifiable. `pnpm build` clean, `pnpm test` 15/15 pass, `tsc --noEmit` clean.

**To retest:**

1. `chrome://extensions` → Altus Capture → reload icon (the curved arrow). Confirm version reads `0.1.1`.
2. Refresh any LinkedIn profile tab.
3. Click the Altus pin → Capture this profile.
4. Open the LinkedIn tab DevTools → Console — look for `[Altus capture]` log line. It now reports `work_count`, `education_count`, `skill_count`, `confidence`. If those are non-zero, the fields will land.
5. Open the Altus candidate in the app — verify headline, location, about, experience entries, education entries, skills all populated.

**If a section still comes through empty:** capture the `[Altus capture]` line + a screenshot of the LinkedIn section that didn't populate. The DOM probe in the original handoff (kept below in git history at commit `55ff80f`) is the next diagnostic step.

### 2. Continue UAT tests 1, 4-15 — variable time

After G6 is fixed:

- **Test 1 (Cold smoke)** — quick, just load `https://altus-recruitment.vercel.app` and confirm dashboard renders
- **Test 4 (Spec call upload)** — most expensive. Need a 30-second voice memo. Walk-through:
  1. Open Voice Memos on phone (or QuickTime on Mac)
  2. Record: *"I need a senior Python developer in Aberdeen, salary 80k, must have offshore wind experience, ideally someone who's worked at a renewables consultancy. Start date flexible."*
  3. Save as `.m4a` or `.mp3`, move to laptop
  4. Go to `https://altus-recruitment.vercel.app/spec/new`, upload, submit
  5. Wait ~60s, check `/spec` for the draft → click into it → review the prefilled structured JD
- **Test 12 (Outlook Mail.Send)** — first send pops Microsoft consent screen, approve `Mail.Send`
- **Tests 6, 8-11, 13** — UI smoke, mostly clicks

### 3. Close PR #2 after UAT passes — 1 min

```bash
gh pr close 2 --comment "Phase 3 reviewed and shipped retroactively — work committed directly to main per branching_strategy=none. UAT passed against preview deploy. Closing without merge."
git push origin --delete pre-phase-3-baseline   # optional
```

## What we struggled with tonight (so next-session doesn't repeat)

1. **Chrome 147's `chrome.cookies.getAll` quirk for vercel.app cookies** — wasted ~2 hours. The cookies API returns empty for hostOnly cookies on public-suffix-list hosts (vercel.app is on the PSL). Fix: switched to `chrome.scripting.executeScript` reading localStorage + document.cookie in the page's own ISOLATED world. Committed in `02ecf6a`.

2. **ISOLATED vs MAIN world mismatch for scripting injection** — the content_scripts ran in ISOLATED, executeScript injected into MAIN, so `globalThis.__altusScrape` was invisible to the injection. Fix in `da9868d` — changed to `world: 'ISOLATED'`.

3. **`__altusScrape` global hook was fragile** anyway (needed tab refresh after each extension reload). Fix in `dbd8a30` — inlined the whole scraper into `scrapeProfileInPage`, dropped content_scripts entry, removed unused `cookies` permission.

4. **LinkedIn DOM changed since the plan was written** — original scraper used `h1` for name and `data-view-name` attributes for sections. Both are gone now. Documented as G6.

## Commits added since shipping Phase 3

| Hash | Subject |
|------|---------|
| `c34aa05` | fix(03-01): use domain filter for cookie lookup (Chrome 147 PSL host quirk) — superseded |
| `02ecf6a` | fix(03-01): replace cookies API with page-context script for token extraction |
| `da9868d` | fix(03-01): run scraper injection in ISOLATED world to match content script |
| `dbd8a30` | fix(03-01): inline scraper into injection function, drop content_scripts dependency |
| `5dd6c84` | fix(03-01): extract profile name from document.title; LinkedIn DOM removed h1 |

All pushed to origin/main.

## Resume command

When the user says "continue from where we left off" or runs `/gsd-progress`, read this file first, then read `03-UAT.md` and `03-VERIFICATION.md` for full context. The user's priority is G6 (LinkedIn DOM selectors) since they explicitly noted "it's quite important to populate it with all the work experience, education, skills, everything."
