---
phase: quick-260524-cjl
reviewed: 2026-05-24
depth: deep
files_reviewed: 10
files_reviewed_list:
  - .planning/quick/260524-cjl-empty-state-polish-across-8-index-pages/260524-cjl-PLAN.md
  - .planning/quick/260524-cjl-empty-state-polish-across-8-index-pages/260524-cjl-SUMMARY.md
  - src/components/app/empty-state.tsx
  - src/app/(app)/candidates/page.tsx
  - src/app/(app)/clients/page.tsx
  - src/app/(app)/jobs/page.tsx
  - src/app/(app)/pipeline/page.tsx
  - src/app/(app)/floats/page.tsx
  - src/app/(app)/spec/page.tsx
  - src/app/(app)/reports/source-attribution/page.tsx
  - src/app/(app)/page.tsx
findings:
  blocker: 1
  warning: 5
  info: 6
  total: 12
status: issues_found
---

# Code & UI Review — 260524-cjl empty-state polish

**Reviewed:** 2026-05-24
**Reviewer:** Opus (autonomous code+UI review pre-UAT)
**Verdict:** PASS-WITH-NITS — 1 misleading CTA worth fixing, otherwise solid

The component change is clean and additive (no breaking changes to the 8 unmodified callers in `reports/buyer-value/page.tsx` and `jobs/[id]/pipeline/page.tsx`). Routes resolve. Typecheck + lint clean. The one real defect is a CTA that lies about what the destination page does. Everything else is copy nits and a semantic-heading miss on the dashboard.

## Blockers (must fix before UAT)

### BL-01 — Candidates secondary CTA "Or upload a CV to auto-extract" sends user to a form that has no upload field

**File:** `src/app/(app)/candidates/page.tsx:96`
**Severity:** Blocker (UX honesty — a first-run user clicks the CTA expecting "AI parses my CV" and gets a manual entry form instead)

The secondary CTA renders as:

```tsx
secondaryCta={{ href: '/candidates/new', label: 'Or upload a CV to auto-extract' }}
```

But `/candidates/new` (`src/app/(app)/candidates/new/page.tsx` + `candidate-form.tsx`) is a manual-entry-only form. CV upload only exists on the candidate **detail** page via `src/app/(app)/candidates/[id]/cv-upload.tsx` (`<CvUpload candidateId={candidate.id} />` in `src/app/(app)/candidates/[id]/page.tsx:390`). The new-candidate page itself even tells the user "you can upload a CV or log activity **after the candidate is created**" (line 16 of `src/app/(app)/candidates/new/page.tsx`).

The plan's "Final secondaryCta to ship" admitted the workaround ("Use `/candidates/new` for both for now (the new form already supports CV upload)") — that premise is wrong. The new form does NOT support CV upload. The SUMMARY's commentary ("Candidates secondary CTA reuses /candidates/new because that form already supports CV upload") is the same incorrect claim.

This is the single biggest "AI-first" promise on the empty state, and it lies. For a first-run user comparing Altus to Firefish, this is the wrong first impression to set.

**Fix options (pick one before UAT):**

1. **Drop the secondary CTA on candidates entirely** for now, and rewrite the body to:
   > "Candidates are the heart of the CRM. After you create one, upload their CV and we'll auto-extract every field."
   ```tsx
   <EmptyState
     heading="Add your first candidate"
     body="Candidates are the heart of the CRM. After you create one, upload their CV and we'll auto-extract every field."
     cta={{ href: '/candidates/new', label: 'Add candidate' }}
   />
   ```

2. **Or** add an `?upload=1` query param to `/candidates/new` that scrolls/highlights a CV-upload section that doesn't yet exist — out of scope for this task, but the cleanest long-term answer (matches the plan's original intent in the must_haves block).

3. **Or** relabel the secondary to be honest about the two-step flow:
   > "Add candidate, then upload CV"

Option 1 is the lowest-risk pre-UAT fix.

## High-priority issues

### WR-01 — Dashboard empty branch has no `<h1>` (heading hierarchy broken)

**File:** `src/app/(app)/page.tsx:37-48`

In the empty branch (`isEmpty === true`) the entire return is just the `EmptyState` (which uses `<h2>`). There is no `<h1>` on the page. Every other page in this PR keeps its `<h1>` outside the EmptyState (candidates:83, clients:77, jobs:63, pipeline:67, spec:63, source-attribution:121, floats:23). The dashboard is the odd one out.

The plan explicitly said "remove the outer `<header>` block in the empty branch to avoid two stacked headings" — but the fix overshot. The page should still have an `<h1>` for landmark/screen-reader navigation; the EmptyState heading is an `<h2>` inside the component.

**Fix:**
```tsx
if (isEmpty) {
  return (
    <div className="space-y-8">
      <h1 className="sr-only">Dashboard</h1>
      <EmptyState
        heading="Welcome to Altus"
        body="Start with a candidate or a client — CV uploads, semantic search, and pipeline tracking all build from there."
        cta={{ href: '/candidates/new', label: 'Add your first candidate' }}
        secondaryCta={{ href: '/clients/new', label: 'Or add your first client' }}
      />
    </div>
  )
}
```

(`sr-only` keeps the visible single-heading design while preserving the document outline. Or use a visible `<h1>Welcome</h1>` and change the EmptyState heading to something less duplicative — but the sr-only option preserves the plan's intent.)

### WR-02 — Jobs empty state copy buries the lede on multi-tenancy reality and exposes deferred-route guilt

**File:** `src/app/(app)/jobs/page.tsx:68-72`

Body reads: *"Jobs hang off a client. Pick a client and create a job against them — or record a spec call and we'll extract the JD for you."*

Two problems:

1. The primary CTA is **"Record a spec call"** (`/spec/new`) but the body reads client-first ("Pick a client and create a job against them — **or** record a spec call"). The body suggests "Pick a client" is the default; the buttons suggest the opposite. Mixed signal.
2. "Jobs hang off a client" is internal data-model language. A first-time user doesn't know that's a constraint, only that you've made them go through two clicks.

**Fix (reorder body to match button order):**
```tsx
body="The fastest way is a spec call — record one and we'll transcribe it into a structured job description. Or pick a client and add a job manually."
```

### WR-03 — Floats body uses a stray ASCII single quote inside the JSX string literal — renders fine but inconsistent with other copy

**File:** `src/app/(app)/floats/page.tsx:32`

```tsx
body="A float is a speculative candidate submission with no specific job — 'you should meet this person'. From any candidate's page, click Floats to record one."
```

Two issues:

1. The single-quoted phrase `'you should meet this person'` uses ASCII apostrophes inside a JSX string attribute. This compiles, but renders as straight quotes; every other piece of copy in this PR uses proper en-dashes (— ✓) and curly quotes are missing here. Minor consistency nit.
2. **"From any candidate's page, click Floats to record one."** — this references a "Floats" button on the candidate detail page. Verify that this button actually exists and is labeled "Floats" before UAT. If it's labeled differently (e.g., "Add to float", "Float candidate", "Spec out"), the copy is misleading.

**Fix copy:**
```tsx
body={'A float is a speculative candidate submission with no specific job — "you should meet this person". Open any candidate to record one.'}
```

(Uses smart-ish double quotes via JSX expression to avoid the single-quote/apostrophe collision, and replaces the specific UI-element reference with the broader instruction so the copy doesn't go stale.)

### WR-04 — Source-attribution `cta` to `/pipeline` is the wrong call to action for "no placements"

**File:** `src/app/(app)/reports/source-attribution/page.tsx:185-189`

The empty state says *"Move candidates into the Placed stage on a job to see them attributed back to their source channel."* and the CTA is `Open pipeline`.

But this empty state fires on any date range with zero placements, including *fresh date ranges where the user has placements but not in this window*. Sending them to `/pipeline` when they may already have placements in a different window is a non-sequitur — the fix is to widen the date filter, not to open the pipeline.

**Fix:**
- Either drop the CTA in this context (the user's first action should be to widen the date filter, which is already visible on the page above), or
- Detect "totally empty agency" vs "empty window" before choosing the CTA. The cheapest heuristic: only show the CTA if `totalPlacements` is zero across *any* window, which would require an extra query. Simplest: drop the CTA and rely on the existing DateFilter above the card.

Cheapest, lowest-risk fix:
```tsx
<EmptyState
  heading="No placements in this date range"
  body="Try widening the date range above, or move candidates into the Placed stage on a job to attribute future placements."
/>
```

### WR-05 — Pipeline filtered branch uses `cta={null}` explicitly — works, but is the only place in the PR doing this

**File:** `src/app/(app)/pipeline/page.tsx:77-81`

```tsx
<EmptyState
  heading="No candidates in pipeline"
  body="No applications match the active filters."
  cta={null}
/>
```

Functionally fine — the component's `hasAnyCta = Boolean(cta || secondaryCta)` correctly treats `null` as falsy. But every other caller in the codebase that wants "no CTA" either omits the prop or, in the case of `reports/buyer-value/page.tsx:234-237`, just leaves it off. Drop the explicit `cta={null}` for consistency:

```tsx
<EmptyState
  heading="No candidates in pipeline"
  body="No applications match the active filters. Try clearing one to see more cards."
/>
```

(Bonus: added "Try clearing one" gives the user the next action — currently the filtered branch is a dead end.)

## Medium-priority issues / copy improvements

### IN-01 — Spec page secondary "context" line is now redundant with EmptyState body

**File:** `src/app/(app)/spec/page.tsx:64-66, 75-77`

The page-level subtitle reads: *"Upload a spec-call recording; the structured JD lands here for review."*
The EmptyState body reads: *"Upload an audio recording of your spec call and we'll transcribe it, extract a structured job description, and drop it here for review."*

These say the same thing in different words, stacked vertically about 60px apart. A first-time user reads the explanation twice. Suggest tightening the subtitle to a one-liner or removing the body redundancy:

```tsx
// Option A: drop the subtitle in the empty branch
// Option B: shorten the EmptyState body to:
body="Record or upload audio; we'll transcribe and extract a structured JD."
```

### IN-02 — Jobs empty state has no page-level subtitle; other index pages do

**File:** `src/app/(app)/jobs/page.tsx:62-64`

Compare:
- `clients/page.tsx:77` — bare `<h1>Clients</h1>` (also missing a subtitle, fine)
- `spec/page.tsx:63-66` — has `<p>` subtitle
- `pipeline/page.tsx:67-70` — has `<p>` subtitle
- `floats/page.tsx:23-26` — has `<p>` subtitle
- `source-attribution/page.tsx:124-126` — has `<p>` subtitle
- `jobs/page.tsx:62-64` — header is just `<h1>Jobs</h1>`

The Jobs page header lacks a one-line description that an authenticated-but-zero-data user would see. Not a blocker; out of scope of this PR strictly. Flagging because the empty state polish is the reasonable moment to fix it.

### IN-03 — Dashboard empty heading "Welcome to Altus" stops being correct on revisit

**File:** `src/app/(app)/page.tsx:41`

If the user adds a candidate, then deletes it, the page falls back to the empty branch — and greets them with "Welcome to Altus" again, which is wrong on a revisit. Low likelihood, but the copy should be tense-agnostic:

```tsx
heading="Nothing on the dashboard yet"
body="Add a candidate or a client to start building your pipeline."
```

(Less marketing-warm, more accurate on second-encounter.)

### IN-04 — Mobile button stacking is centered-shrink-to-content, not full-width

**File:** `src/components/app/empty-state.tsx:40`

```tsx
<div className="mt-6 flex flex-col items-center gap-2 sm:flex-row">
```

On mobile, `flex-col items-center` stacks the two buttons centered at their content width. With one short button ("Add candidate", ~120px) above a longer secondary ("Or upload a CV to auto-extract", ~280px), the two stacked pills look misaligned and reinforce the asymmetry of CTA importance.

This is consistent with the plan's spec, but reasonable users might expect mobile CTA buttons to be full-width-stacked. Optional: change to `flex-col items-stretch sm:flex-row sm:items-center` and let the buttons fill the row width on mobile (the `Button` component has `whitespace-nowrap` so labels won't wrap).

Not blocking; flagging for a UX call.

### IN-05 — Floats page `<h1>` is `text-xl` while every other page uses `text-2xl`

**File:** `src/app/(app)/floats/page.tsx:23`

```tsx
<h1 className="text-xl font-semibold">Floats</h1>
```

Compare candidates/clients/jobs/pipeline/spec/source-attribution — all `text-2xl font-semibold tracking-tight`. Floats is the only page with a smaller, less-tracked H1. Out of scope of this PR strictly, but it's the only index page that looks visually subordinate to the rest. Cheap one-line fix while touching this file.

### IN-06 — `source-attribution` "Top sources by revenue" card keeps the bare `<p>` instead of EmptyState (intentional, but unflagged)

**File:** `src/app/(app)/reports/source-attribution/page.tsx:233-236`

The plan explicitly said to keep this as-is to avoid double-stacking, and the SUMMARY repeated it. Fine — but `topByRevenue` is derived from the same `rows` as the upper table, so the two empty states are *always* triggered together. If the upper EmptyState already handles the empty case visually, the lower `<p>` becomes vestigial — visible only because Card always renders. Suggest collapsing the entire lower Card when `rows.length === 0`:

```tsx
{rows.length > 0 && (
  <Card>
    <CardHeader>...</CardHeader>
    <CardContent>
      <ul>...</ul>
    </CardContent>
  </Card>
)}
```

Removes a redundant "No placements in this date range." 30px below the styled EmptyState saying the same thing.

## UI/UX observations (per-page)

### Dashboard (`src/app/(app)/page.tsx`)
- Empty branch loses the page `<h1>` — see WR-01.
- Copy is warm and on-brand. Body's "CV uploads, semantic search, and pipeline tracking all build from there" sets correct expectations.
- Dual CTA (Add candidate / Add client) is the right choice for first-run.

### Candidates (`src/app/(app)/candidates/page.tsx`)
- Primary CTA is correct; secondary CTA is dishonest — see BL-01.
- The conditional "Add candidate" button in the header (line 84-88) is hidden when empty, which is correct — the empty state is the CTA.
- Body copy is good ("Candidates are the heart of the CRM" — on-brand).

### Clients (`src/app/(app)/clients/page.tsx`)
- Replacement of the bespoke div is clean.
- The `Plus` icon import (line 2) is still used in the populated header (line 97) — no unused-import lint warning. Confirmed.
- Body copy is accurate and uses the right domain terms ("contacts, jobs, and revenue").
- No secondary CTA is the right call — clients have one obvious next step.

### Jobs (`src/app/(app)/jobs/page.tsx`)
- Primary/secondary CTA inversion vs body copy — see WR-02.
- Routes both resolve (`/spec/new` exists, `/clients` exists).
- Acknowledgement of the missing `/jobs/new` route in the inline comment (lines 54-57) is appropriately defensive.
- No page-level subtitle — see IN-02.

### Pipeline (`src/app/(app)/pipeline/page.tsx`)
- Branching on filter state is correct; both branches render the right EmptyState.
- `cta={null}` is unidiomatic — see WR-05.
- Filtered branch is a dead end with no "clear filters" affordance — see WR-05.
- Routes both resolve.

### Floats (`src/app/(app)/floats/page.tsx`)
- Bespoke div removed cleanly.
- Copy references a specific UI element ("click Floats") that may be miscalibrated — see WR-03.
- Page H1 is smaller than every other page — see IN-05.

### Spec (`src/app/(app)/spec/page.tsx`)
- Inline Card replacement is clean.
- Empty branch keeps the header `<Button asChild>` "New spec call" (line 68-70) AND renders an EmptyState with primary CTA "New spec call" (line 77) — two identical buttons within ~120px of each other. Not a bug but visually redundant. Consider hiding the header button when empty (see candidates page pattern at line 84).
- Subtitle + body redundancy — see IN-01.

### Source-attribution (`src/app/(app)/reports/source-attribution/page.tsx`)
- `/pipeline` is the wrong destination for an empty-window state — see WR-04.
- Lower "Top sources by revenue" empty `<p>` becomes redundant — see IN-06.
- The error-state Card (lines 135-142) and the empty-state EmptyState (lines 184-189) coexist on the same page. If `result.ok` is false, `rows` is `[]` and BOTH render, stacking the error message above an EmptyState that claims "No placements in this date range" — but the truth is "we couldn't load". Worth defending against:
  ```tsx
  {result.ok && rows.length === 0 ? <EmptyState ... /> : ...}
  ```
  Currently lines 100, 184: `const rows = result.ok ? result.data : []` then `{rows.length === 0 ? <EmptyState ... /> : ...}`. The error state and empty state confuse each other.

## Things that look right

1. **EmptyState component change is genuinely additive.** `cta?: ... | null` is unchanged; `secondaryCta?: ... | null` is purely new. The other 7 in-repo callers (`reports/buyer-value/page.tsx` lines 205, 234, 255, 279, 309; `jobs/[id]/pipeline/page.tsx` line 63) don't pass `secondaryCta` and continue to render the same single-button layout. Backwards-compatibility verified by reading each call site.
2. **All CTA routes resolve.** Confirmed `/candidates/new`, `/clients/new`, `/spec/new`, `/pipeline`, `/jobs`, `/clients`, `/candidates` all exist on the filesystem. `/jobs/new` is correctly not used.
3. **TypeScript types are clean.** `secondaryCta?: { href: string; label: string } | null` — no `any`, matches the existing `cta` shape exactly.
4. **No emojis introduced** — confirmed by grep.
5. **No new lucide-react icons or dependencies added** — confirmed.
6. **Lint + typecheck pass** on the 9 modified files (confirmed by running `pnpm typecheck` and `pnpm exec eslint` against the file list).
7. **Server Component preserved** — no `'use client'` introduced in EmptyState.
8. **Domain language used correctly:** "candidate", "client", "spec call", "float", "placement", "pipeline" — all on-spec with the CLAUDE.md glossary.
9. **Both commits exist** in `git log --all` (`5699230`, `6e50a41`).
10. **Pipeline filtered-vs-unfiltered branch logic is correctly preserved** — only the unfiltered branch was upgraded, per the plan.
11. **Dashboard outer `<header>` correctly removed in empty branch** — eliminates the double "Welcome to Altus" heading the plan called out (though it overshoots — see WR-01).
12. **Semantic `<h2>` in EmptyState** is correct given each page's outer `<h1>`. Only the dashboard violates this hierarchy.
13. **Buttons use `<Link>` via `asChild`**, not `onClick={() => router.push(...)}`. Correct — preserves keyboard navigation, right-click "open in new tab", and middle-click behavior.

---

_Reviewed: 2026-05-24_
_Reviewer: Claude Opus 4.7 (pre-UAT review)_
_Depth: deep_
