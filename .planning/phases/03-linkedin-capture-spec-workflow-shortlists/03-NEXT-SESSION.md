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

### 1. Fix LinkedIn DOM selectors (G6) — ~30 min

The scraper in `chrome-extension/src/background/ingest.ts` (`scrapeProfileInPage`) only finds the name via `document.title` — all DOM selectors miss because LinkedIn changed their profile structure.

**Steps to fix:**

1. Open Chrome with the Altus extension installed (`chrome://extensions` should show it pinned)
2. Open a logged-in LinkedIn profile (any profile — `linkedin.com/in/<someone>` works)
3. Open the LinkedIn tab DevTools → Console
4. Paste this probe to find the actual element + class for the visible profile name (replace `'Huw Jones'` with whatever name is visible on the page you're on):

```js
JSON.stringify(
  [...document.querySelectorAll('*')]
    .filter(el => el.children.length === 0 && el.textContent?.trim().includes('Huw Jones'))
    .slice(0, 8)
    .map(el => ({
      tag: el.tagName,
      class: String(el.className || '').slice(0, 80),
      parent: el.parentElement?.tagName,
      parentClass: String(el.parentElement?.className || '').slice(0, 80),
      text: el.textContent?.trim().slice(0, 60),
    })),
  null, 2
)
```

5. Paste the output back to me. I'll generate the updated selector list and rewrite `scrapeProfileInPage` for name + headline + location + experience + education + skills against the actual current DOM.

6. Rebuild + reload + retest:
   ```bash
   cd ~/altus-recruitment/chrome-extension && pnpm build
   ```
   Then in `chrome://extensions` reload the Altus card, refresh the LinkedIn tab, capture again. Verify all fields populate.

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
