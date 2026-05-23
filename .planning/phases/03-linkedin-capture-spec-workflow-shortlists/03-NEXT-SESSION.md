---
phase: 03
created: "2026-05-21"
last_updated: "2026-05-23"
purpose: "Session-handoff for Phase 3 UAT resume. Read this FIRST when the user says 'continue from where we left off' or runs /gsd-progress."
status: "LinkedIn ingest landed via PDF pivot. Top-card capture + PDF→CV-parser flow validated against Tony Wilson and Liam Steele. UAT tests 1, 4-15 still pending."
---

# Phase 3 — resume here next session

## Current state (2026-05-23)

LinkedIn ingest is **shipped and working** via the hybrid flow:

1. **Chrome extension** (`chrome-extension/` — manifest `0.1.7`) captures the top card only: name, headline, location, LinkedIn URL. Reliable across reloads.
2. **Candidate page** shows a tip in the Upload CV panel when `source='linkedin'` and `work_experience` is empty: *"From this candidate's LinkedIn profile, click More → Save to PDF, then drop that PDF here…"*
3. **User uploads the LinkedIn PDF** to that panel.
4. **Existing Phase 1 CV parser** (Claude Haiku via `parseCV`) extracts work_history/education/skills/etc.
5. **`markCandidateFieldsFromCV`** writes the structured data back. `full_name` upgrades when the CV is a strict extension of the entered name (e.g., `Liam` → `Liam Steele`). All other fields are D-08 fill-empty-only.
6. **CV review panel auto-refreshes** while parsing via `router.refresh()` polling at 3s. Capped at 5 minutes.

### What was abandoned and why

Full DOM scraping of Experience/Education/Skills sections from LinkedIn was iterated through 7 extension versions (0.1.0–0.1.6) and abandoned. Root causes:
- LinkedIn uses hashed CSS Module class names (`._6d2dbe5a`, `._81841adb`) that change every deploy
- Sections lazy-load via intersection observer; programmatic scrolling didn't reliably trigger them
- Same profile yielded different `h2_texts` counts across captures; results were structurally non-deterministic

The PDF pivot is far more reliable because LinkedIn's PDF export format is stable and the existing CV parser already handles it.

See `.claude/projects/-Users-aj-mac-altus-recruitment/memory/phase3-linkedin-pdf-pivot.md` for full context.

## Follow-ups queued (not blocking UAT)

- **PWA installability** — Make Altus installable as a phone app icon. Requires `public/manifest.json` (name, icons, theme), apple-touch-icons in `app/layout.tsx`, optional service worker for offline. Estimated 2h. Important enough that the user explicitly flagged it during Test 4 — surface this on the next session if not done by then.

## Test 4 — finishing the spec-review flow (BLOCKED at the finish line)

State as of 2026-05-23 end of session: the spec pipeline transcribes audio + extracts a structured JD correctly. The remaining failure is **UI gaps on the review/approve step**, not the backend pipeline.

### What works
- Upload `.m4a` / `.webm` / record via mic → ffmpeg recompress to WebM-Opus via `/tmp` file → Whisper transcribe → Sonnet structure → spec draft lands with parsed JD ✓
- Approve action blocks when no client is selected (fix `c0638d0`) so we don't silently lose data anymore

### What's broken / missing
1. **Review form has no client picker.** `src/app/(app)/spec/[id]/review/spec-review-form.tsx` doesn't render a `<select>` for companies. Confirmed via `grep -n "company\|client"` — only the `'use client'` directive shows. The approve action requires `draft.company_id` (jobs.company_id is NOT NULL) so without a picker the user can't progress past the inline-error toast my fix surfaces. **Need to: add a company picker to the review form, wire it to a server action that updates spec_drafts.company_id, re-render the page.** The /spec/new form already has the same picker code — copy that pattern.
2. **Failed-draft view only shows "upload another file."** When `create-job-from-spec` marks a draft `failed`, the recruiter loses the parsed JD they spent time on. The /spec/[id] page should show: status banner + the parsed JD + a "Pick a client and retry" CTA that re-fires `spec-draft/approved` after setting `company_id`. Inspect `src/app/(app)/spec/[id]/page.tsx` to see what it currently renders.

### Where to start next session

```bash
# Read these to load context:
cat src/app/\(app\)/spec/\[id\]/review/spec-review-form.tsx       # missing picker
cat src/app/\(app\)/spec/\[id\]/page.tsx                          # failed-state view
cat src/app/\(app\)/spec/new/spec-upload-form.tsx                 # has the picker pattern to copy
cat src/lib/inngest/functions/create-job-from-spec.ts             # the function that needs the company_id
```

Then:
1. Add `clients={clients}` prop wiring in `review/page.tsx` (server page that loads clients via existing `listClients`-style helper), pass into form.
2. Add a `<select>` for `company_id` in `spec-review-form.tsx`, default to the draft's current company_id if set.
3. Update `approveSpecDraftAction` to accept `companyId` in the input schema and persist it via `update spec_drafts set company_id = $1`.
4. On `/spec/[id]/page.tsx`, when status='failed' and parsed JD exists, render the JD + a "Pick client + retry" link that takes the user back to `/spec/[id]/review`.

Existing orphaned draft from UAT can be repaired by editing `spec_drafts.company_id` directly via Supabase Studio, then `update spec_drafts set status='ready_for_review' where id='<id>'` to make it reviewable again — the new fix path will then work end-to-end.

### Remaining UAT tests after Test 4 closes

Tests 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 — see `03-UAT.md`.

## What's left

### 1. Continue UAT tests 1, 4-15 — variable time

Test 2 (LinkedIn capture creates candidate) and Test 3 (LinkedIn dedup) were resolved in earlier sessions. Validation of the new PDF flow:
- **Tony Wilson** capture + PDF upload → name, headline, location, current_role_title, current_company, seniority_level, years_experience, skills, sector_tags all populated.
- **Liam Steele** capture as just "Liam" + PDF upload → upgraded to "Liam Steele" via the new strict-extension rule. Auto-refresh on parse complete worked.

Still pending tests:
- **Test 1 (Cold smoke)** — load `https://altus-recruitment.vercel.app`, confirm dashboard renders.
- **Test 4 (Spec call upload)** — needs a 30-second voice memo. See `03-UAT.md` for the script.
- **Test 12 (Outlook Mail.Send)** — first send pops Microsoft consent screen, approve `Mail.Send`.
- **Tests 6, 8-11, 13** — UI smoke, mostly clicks.

### 2. Close PR #2 once UAT passes — 1 min

```bash
gh pr close 2 --comment "Phase 3 reviewed and shipped retroactively — work committed directly to main per branching_strategy=none. UAT passed against preview deploy. Closing without merge."
git push origin --delete pre-phase-3-baseline   # optional
```

## Key learnings worth remembering

1. **Supabase migration auto-apply is unreliable on this project.** On 2026-05-23, 12 Phase 3 migrations (Plans 03-02 through 03-06 plus my profile-fields migration) were sitting unapplied on remote for days. This caused intermittent 500s on LinkedIn ingest and "Couldn't merge CV fields" toasts. After each new migration is committed, run `pnpm exec supabase db push --linked` manually. Verify with `pnpm exec supabase db diff --linked` → expect "No schema changes found".

2. **LinkedIn DOM scraping is structurally fragile.** The pivot to PDF + existing CV parser is the right architecture. Don't reintroduce class-based scraping or attempt to extract Experience/Education/Skills from the page DOM.

3. **Iterative selector tweaks aren't problem-solving** — when the failure mode shifts between captures of the same input, stop and step back. The user explicitly asked me to think deeper rather than continue whack-a-mole. The strategic pivot to PDF was the right call.

## Commits in this session

Latest: `57b171e` — feat(03): full_name upgrade + auto-refresh CV review panel while parsing

Notable Phase 3 commits leading here:
- `eb9e351` — fix(03): defensive merge SELECT + Sentry breadcrumb + show all parsed fields
- `45d505c` — feat(03): pivot LinkedIn ingest to PDF + existing CV parser
- `5537e1e` — feat(03-01): persist + render LinkedIn headline/about/experience/education
- 12 migrations applied manually via `pnpm exec supabase db push --linked` on 2026-05-23

All pushed to `origin/main`.

## Resume command

When the user says "continue from where we left off" or runs `/gsd-progress`, read this file first, then `03-UAT.md` for outstanding tests. The PDF-based LinkedIn ingest is the validated path — no need to revisit the DOM scraper.
