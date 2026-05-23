---
phase: quick-260523-sns
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/02-search-match-intake/02-00-SUMMARY.md
  - .planning/phases/02-search-match-intake/02-01-SUMMARY.md
  - .planning/phases/02-search-match-intake/02-02-SUMMARY.md
  - .planning/phases/02-search-match-intake/02-03-SUMMARY.md
  - .planning/phases/02-search-match-intake/02-04-SUMMARY.md
  - .planning/ROADMAP.md
  - src/types/database.ts
  - src/app/(app)/spec/new/mic-recorder.tsx
  - src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx
autonomous: true
requirements:
  - QUICK-260523-SNS-01  # Phase 2 docs backfill
  - QUICK-260523-SNS-02  # Lint + data hygiene
must_haves:
  truths:
    - "Five Phase 2 plan SUMMARY.md files exist and follow the project summary template"
    - "ROADMAP.md shows Phase 2 marked complete using the same encoding as Phase 1 ([x])"
    - "src/types/database.ts has been regenerated from the linked Supabase project with `// @ts-nocheck` restored as line 1"
    - "`pnpm typecheck` passes after the regen"
    - "`pnpm lint` passes with zero errors (both react-hooks/set-state-in-effect errors gone)"
    - "Aberdeen Renewables (id `8200091c-ec61-4123-9343-cbd3271be499`) has a fresh `last_contacted_at` timestamp"
  artifacts:
    - path: ".planning/phases/02-search-match-intake/02-00-SUMMARY.md"
      provides: "Plan 02-00 (hardening) completion record"
    - path: ".planning/phases/02-search-match-intake/02-01-SUMMARY.md"
      provides: "Plan 02-01 (semantic search) completion record"
    - path: ".planning/phases/02-search-match-intake/02-02-SUMMARY.md"
      provides: "Plan 02-02 (AI match scoring) completion record"
    - path: ".planning/phases/02-search-match-intake/02-03-SUMMARY.md"
      provides: "Plan 02-03 (public apply form) completion record"
    - path: ".planning/phases/02-search-match-intake/02-04-SUMMARY.md"
      provides: "Plan 02-04 (Outlook integration) completion record"
  key_links:
    - from: ".planning/ROADMAP.md"
      to: "Phase 2 status checkbox"
      via: "literal `- [x] **Phase 2:`"
      pattern: "- \\[x\\] \\*\\*Phase 2:"
    - from: "src/types/database.ts"
      to: "Supabase schema"
      via: "supabase gen types typescript --linked"
      pattern: "@ts-nocheck"
---

<objective>
Wave 1 hygiene: close out Phase 2 documentation, regenerate DB types so subsequent work
isn't typing against a stale schema, eliminate the two pre-existing lint errors that are
muddying CI signal, and refresh the Aberdeen Renewables demo row so it isn't flagged as
dormant during demos.

Purpose: clear accumulated debt before the next feature phase starts. Phase 2 shipped but
its plan SUMMARYs were never written, which breaks the history-digest pipeline that
plan-phase uses to assemble context. Lint errors + stale types are friction every executor
will trip on otherwise.

Output:
- 5 plan summaries under `.planning/phases/02-search-match-intake/`
- ROADMAP.md with Phase 2 marked complete
- Fresh `src/types/database.ts` with `@ts-nocheck` directive preserved
- Two lint-clean components
- Aberdeen Renewables row with a current `last_contacted_at`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/02-search-match-intake/02-VERIFICATION.md
@.planning/phases/02-search-match-intake/02-LEARNINGS.md
@.planning/phases/02-search-match-intake/02-REVIEW.md
@.planning/phases/02-search-match-intake/02-00-hardening-PLAN.md
@.planning/phases/02-search-match-intake/02-01-semantic-search-PLAN.md
@.planning/phases/02-search-match-intake/02-02-ai-match-scoring-PLAN.md
@.planning/phases/02-search-match-intake/02-03-public-apply-form-PLAN.md
@.planning/phases/02-search-match-intake/02-04-outlook-integration-PLAN.md
@$HOME/.claude/get-shit-done/templates/summary.md

<interfaces>
<!-- Phase 2 plan IDs (used to scope git log) -->
Plans to backfill:
- 02-00-hardening
- 02-01-semantic-search
- 02-02-ai-match-scoring
- 02-03-public-apply-form
- 02-04-outlook-integration

ROADMAP encoding (existing pattern from Phase 1):
- Line 12: `- [x] **Phase 1: Internal ATS** - ...`
- Line 13 (current, to flip): `- [ ] **Phase 2: Search, Match & Intake** - ...`

Aberdeen Renewables row:
- table: companies
- id: 8200091c-ec61-4123-9343-cbd3271be499
- column to update: last_contacted_at

Lint errors to clear (`pnpm lint` output):
- src/app/(app)/spec/new/mic-recorder.tsx:57 — react-hooks/set-state-in-effect
- src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx:62 — react-hooks/set-state-in-effect (this file currently uses two `eslint-disable-next-line` directives on lines 62 and 67; the rule still fires — those disables are not silencing the error)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Backfill Phase 2 plan SUMMARYs, mark Phase 2 complete in ROADMAP, regenerate database.ts</name>
  <files>
    .planning/phases/02-search-match-intake/02-00-SUMMARY.md,
    .planning/phases/02-search-match-intake/02-01-SUMMARY.md,
    .planning/phases/02-search-match-intake/02-02-SUMMARY.md,
    .planning/phases/02-search-match-intake/02-03-SUMMARY.md,
    .planning/phases/02-search-match-intake/02-04-SUMMARY.md,
    .planning/ROADMAP.md,
    src/types/database.ts
  </files>
  <action>
    Three-part artifact cluster — all docs/types changes, no application logic.

    (a) Plan SUMMARYs. For each of the 5 Phase 2 plans (02-00, 02-01, 02-02, 02-03, 02-04):
    1. Read the corresponding PLAN.md to extract objective, files_modified, requirements,
       must_haves, and task list.
    2. Cross-reference with `02-VERIFICATION.md` (what shipped vs. spec), `02-LEARNINGS.md`
       (decisions + gotchas), and `02-REVIEW.md` (review findings).
    3. Pull commit hashes with `git log --oneline --all -- .planning/phases/02-search-match-intake/02-${NN}-*-PLAN.md` and
       `git log --oneline --all --grep="${NN}-" --grep="${plan-slug}"` (e.g. for 02-01:
       `git log --oneline --all --grep="02-01"`). Match commits to tasks; if the mapping is
       ambiguous, write `unknown` for the hash and note it in Issues Encountered.
    4. Write `.planning/phases/02-search-match-intake/02-${NN}-SUMMARY.md` following the
       template at `$HOME/.claude/get-shit-done/templates/summary.md`. Frontmatter MUST
       include: phase (`02-search-match-intake`), plan (matching number), subsystem, tags,
       requires/provides/affects, tech-stack added + patterns, key-files (created vs.
       modified — pull from the PLAN's files_modified), key-decisions (lift from LEARNINGS),
       patterns-established, requirements-completed (copy verbatim from the PLAN's
       requirements frontmatter), duration (use "unknown — backfilled" if not recoverable),
       completed (use the date of the last task commit; if unknown use 2026-05-22).
       Body sections: substantive one-liner (NOT "phase complete"), Performance, Accomplishments,
       Task Commits, Files Created/Modified, Decisions Made (from LEARNINGS), Deviations from Plan
       (from VERIFICATION/REVIEW — note this is backfilled so deviations may be incomplete),
       Issues Encountered, User Setup Required, Next Phase Readiness.
       Add a one-line note at the top of the body: `_Backfilled on 2026-05-23 from VERIFICATION/LEARNINGS/REVIEW + git log; some execution-time detail (exact durations, granular deviation list) is approximate._`

    (b) ROADMAP.md. Open `.planning/ROADMAP.md`. Locate line 13:
    `- [ ] **Phase 2: Search, Match & Intake** - Differentiating AI capability live: semantic search, match scoring, public apply form, Outlook integration`
    Flip the checkbox to `[x]` (mirror line 12's Phase 1 encoding exactly). If there is a
    "Phase 2" subsection elsewhere in the file that lists status/Plans, update its status
    field to match Phase 1's encoding (look for whatever Phase 1 uses — `Status: Complete`,
    a date, etc.) and tick any per-plan checkboxes. Do not touch Phase 3 or later sections.

    (c) database.ts regen. Run:
        pnpm exec supabase gen types typescript --linked > src/types/database.ts
    The generator strips the `// @ts-nocheck` directive — restore it as the FIRST line of
    the file (before any blank line, before the autogenerated header comment). Verify with
    `head -1 src/types/database.ts` showing exactly `// @ts-nocheck`.
    Then run `pnpm typecheck`. If new errors appear, fix only the callers that are now
    type-mismatched (e.g. enum value list changes); do not chase unrelated pre-existing
    errors. If the regen produces zero diff vs. the prior file (other than whitespace), still
    keep the regen — it confirms the linked DB matches what's checked in.

    Commit format: `docs(02): backfill Phase 2 plan summaries + mark complete; chore(types): regen database.ts from linked supabase` — or split into two commits if cleaner (one `docs(02)` for the 5 summaries + ROADMAP, one `chore(types)` for database.ts). Both commit prefixes are acceptable.
  </action>
  <verify>
    <automated>ls .planning/phases/02-search-match-intake/02-0{0,1,2,3,4}-SUMMARY.md && head -1 src/types/database.ts | grep -q "^// @ts-nocheck$" && grep -q "^- \[x\] \*\*Phase 2:" .planning/ROADMAP.md && pnpm typecheck</automated>
  </verify>
  <done>
    All 5 SUMMARY files exist, each has a frontmatter block + substantive one-liner + the standard body sections. ROADMAP.md shows `- [x] **Phase 2:` on the status checkbox line. `src/types/database.ts` line 1 is `// @ts-nocheck`. `pnpm typecheck` exits 0.
  </done>
</task>

<task type="auto">
  <name>Task 2: Clear two react-hooks/set-state-in-effect lint errors + un-age Aberdeen Renewables demo data</name>
  <files>
    src/app/(app)/spec/new/mic-recorder.tsx,
    src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx
  </files>
  <action>
    Two code edits + one data-only DB update.

    (a) `src/app/(app)/spec/new/mic-recorder.tsx` — the `useEffect` at lines 55-59 calls
    `setState({ kind: 'unsupported' })` synchronously on mount, which is exactly the
    pattern `react-hooks/set-state-in-effect` flags. Push the support detection into the
    `useState` initializer (lazy init) and DELETE the useEffect entirely (it has no other
    work to do). Concrete change:
        // Replace this:
        const [state, setState] = useState<State>({ kind: 'idle' })
        // ...
        useEffect(() => {
          if (typeof MediaRecorder === 'undefined' || pickMime() === '') {
            setState({ kind: 'unsupported' })
          }
        }, [])
        // With:
        const [state, setState] = useState<State>(() =>
          typeof MediaRecorder === 'undefined' || pickMime() === ''
            ? { kind: 'unsupported' }
            : { kind: 'idle' },
        )
    After removing the useEffect, also remove the `useEffect` import from the React import
    line at the top of the file (it's no longer referenced). Keep `useRef`, `useState`.
    Note: the brief mentions an unused `eslint-disable` on line 67 — inspect the file
    after editing; line 67 in the current source is the `start = async () => {` declaration,
    not a comment, so there's nothing to remove. If `pnpm lint` reports an unused-disable
    after the change, remove whatever it points to.

    (b) `src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx` — the `useEffect` at
    lines 59-78 has TWO `eslint-disable-next-line react-hooks/set-state-in-effect` directives
    (lines 62 and 67) and the rule is still firing at line 62. The setState calls model a
    request lifecycle: when the debounced query is too short go back to idle; when it's
    valid mark loading then kick off an async search. The cleanest fix is to keep the
    debounced query in state but move the search lifecycle into a separate handler tied to
    debouncedQuery, OR — simpler — split the work so the loading transition happens inside
    the same effect that fires the fetch, and use a ref-derived guard rather than reading
    `prev` from setState. Recommended pattern:
        useEffect(() => {
          const q = debouncedQuery.trim()
          if (q.length < 2) {
            setSearch({ kind: 'idle' })
            return
          }
          const reqId = ++reqRef.current
          setSearch({ kind: 'loading', q })
          void searchCandidatesAction(q).then((res) => {
            if (reqRef.current !== reqId) return
            if (!res.ok) {
              setSearch({ kind: 'done', q, options: [] })
              toast.error(res.formError)
              return
            }
            setSearch({ kind: 'done', q, options: res.data })
          })
        }, [debouncedQuery])
    The functional-updater form (`setSearch((prev) => ...)`) is what most aggressively
    trips the rule; replacing it with a direct set + dropping the `eslint-disable-next-line`
    comments should silence both lint errors. Remove BOTH `eslint-disable-next-line` directives
    (lines 62 and 67 in the current file). If the rule still fires after the rewrite, fall
    back to driving the state machine from a `useTransition` wrapping the fetch, or extract
    the effect body into an async function defined outside the effect and called from it —
    whichever produces a clean lint run.

    Run `pnpm lint` after both edits. Zero errors required. `pnpm typecheck` must still pass.
    Run `pnpm test` if vitest is installed and there are tests touching either file (likely
    none yet for Phase 2 UI); skip silently if no test command applies.

    (c) Aberdeen Renewables un-age. Run (single line):
        pnpm exec supabase db query --linked "update companies set last_contacted_at = now() where id = '8200091c-ec61-4123-9343-cbd3271be499' returning id, name, last_contacted_at;"
    Confirm the returned row shows name=`Aberdeen Renewables` (or whatever the seeded name
    is — should not be empty) and `last_contacted_at` within the last minute. This is a
    data-only update; do NOT create a migration file. Per CLAUDE.md, migrations are
    append-only; runtime data fixes go through `db query`.

    Commit format: `fix(lint): clear react-hooks/set-state-in-effect in mic-recorder and add-to-shortlist-dialog` for the code changes. The data update has no commit (no file change).
  </action>
  <verify>
    <automated>pnpm lint && pnpm typecheck</automated>
  </verify>
  <done>
    `pnpm lint` exits 0 with zero errors (warnings tolerated only if pre-existing and unrelated). `pnpm typecheck` exits 0. The Supabase `db query` returned a row showing Aberdeen Renewables with a `last_contacted_at` timestamp within the last 5 minutes.
  </done>
</task>

</tasks>

<verification>
- All 5 Phase 2 SUMMARYs exist and parse as valid markdown with the template's frontmatter fields
- `grep -c "^- \[x\] \*\*Phase 2:" .planning/ROADMAP.md` returns 1
- `head -1 src/types/database.ts` is `// @ts-nocheck`
- `pnpm lint` exits 0
- `pnpm typecheck` exits 0
- Aberdeen Renewables row's `last_contacted_at` is current
</verification>

<success_criteria>
- Phase 2 documentation closed out and discoverable by future plan-phase invocations
- DB types match the linked Supabase schema as of plan execution
- Lint signal restored (no false-positive baseline noise)
- Demo data presentable without "dormant client" framing on Aberdeen Renewables
</success_criteria>

<output>
Create `.planning/quick/260523-sns-wave-1-hygiene-backfill-phase-2-plan-sum/260523-sns-SUMMARY.md` when done, following the standard summary template. The SUMMARY should note which Phase 2 commits could not be precisely mapped to plans (if any) so future audits know the SUMMARYs are best-effort backfills.
</output>
