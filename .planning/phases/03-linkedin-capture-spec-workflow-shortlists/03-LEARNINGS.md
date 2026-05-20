---
phase: 3
phase_name: "LinkedIn Capture, Spec Workflow & Shortlists"
project: "Altus — AI-First Recruitment CRM"
generated: "2026-05-20"
counts:
  decisions: 10
  lessons: 8
  patterns: 6
  surprises: 5
missing_artifacts:
  - "03-UAT.md"
---

# Phase 3 Learnings: LinkedIn Capture, Spec Workflow & Shortlists

## Decisions

### Chrome MV3 extension over server-side LinkedIn scrape
Capture mechanism is a Chrome extension that scrapes the visible profile DOM and POSTs JSON to an authenticated ingest endpoint. Side-loaded via developer mode for the anchor agency; Chrome Web Store submission deferred. LinkedIn TOS technically prohibits scraping but enforcement targets bulk automation, not 1-by-1 personal capture — risk accepted.

**Rationale:** Server-side scraping would require bot mitigation, captcha solving, and continuous evasion work. Client-side capture piggybacks on the recruiter's already-authenticated LinkedIn session — far less infrastructure, far less abuse surface.
**Source:** 03-CONTEXT.md, 03-01-PLAN.md, 03-01-SUMMARY.md

### Session-based auth for the extension (NOT service-role)
Extension reads the recruiter's Supabase auth cookie from the open Altus tab and forwards a Bearer token. The ingest endpoint runs in authenticated app context so RLS enforces tenancy. No service-role key ever ships to the extension.

**Rationale:** Service-role in the extension would be a multi-tenant bypass attack vector. RLS-enforced endpoint means a compromised extension can only affect the recruiter's own org's data.
**Source:** 03-01-PLAN.md (D3-02)

### Spec audio: file upload only (no MediaRecorder yet)
Recruiter uploads `.mp3`/`.m4a`/`.wav`/`.webm` (max 100 MiB) recorded with Voice Memos / Zoom / phone. MediaRecorder browser capture deferred to Phase 4.

**Rationale:** File upload covers ~95% of the recruiter workflow today (most spec calls already happen on Zoom/Teams or phone). MediaRecorder adds permissions UX + cross-browser fragmentation; not worth Phase 3 scope.
**Source:** 03-CONTEXT.md (D3-06)

### Whisper + Sonnet chained in a single Inngest function
`spec/uploaded` event triggers one Inngest function that runs Whisper transcribe and then Sonnet structured-JD extraction, persisting both transcript and structured draft to the `spec_drafts` table.

**Rationale:** Two separate Inngest functions would double the cold-start cost and complicate the retry semantics; chaining inside one function lets failures roll back the entire pipeline atomically.
**Source:** 03-02-PLAN.md (D3-08), 03-02-SUMMARY.md

### Reuse `applications` table for shortlists + floats
No new tables for the working set. New `application_type='shortlist'` enum value joins the existing `'float'` and `'standard'`. Float rows have `job_id IS NULL`. Pipeline kanban filters on `application_type='standard'`.

**Rationale:** A separate "shortlist" or "float" table would duplicate ~80% of the columns from `applications` and force every reporting RPC to UNION across tables. One table + enum is simpler, but requires `job_id` to be nullable with a CHECK constraint enforcing float-only NULL.
**Source:** 03-CONTEXT.md (D3-16, D3-17, D3-18), 03-03-SUMMARY.md

### Inclusivity scoring is prompt-based, not a separate model
Sonnet is instructed to score against gendered language, age signals, jargon barrier, accessibility statements, salary transparency — using a vendored Gender Decoder lexicon as input rather than a separately trained classifier.

**Rationale:** Sonnet's NLU is already strong enough for sentence-level inclusivity scoring; a separate model would require training data and ML infra that don't yet exist. Prompt-based scoring is good enough for the v1 experience.
**Source:** 03-CONTEXT.md (D3-15), 03-04-PLAN.md, 03-04-SUMMARY.md

### Microsoft Graph `Mail.Send` via incremental consent (NOT bundled at deploy)
Phase 2 requested `Mail.Read` + `User.Read` + `offline_access` only. `Mail.Send` is added via incremental consent triggered on first 403 from `sendMail` — not on deploy. Recruiter approves the consent screen in their browser once.

**Rationale:** Bundling `Mail.Send` in the initial OAuth consent screen would scare some users off ("why does my CRM want to send email as me?"). Incremental consent surfaces the request only when the recruiter is about to send a real outreach email — context makes the ask reasonable.
**Source:** 03-CONTEXT.md (D3-20), 03-05-SUMMARY.md

### Org-wide dormant client visibility
Anyone in the org sees all dormant clients. No owner-only filtering.

**Rationale:** Anchor agency is 2-3 people; transparency wins over filtering. Owner-only filtering would defer to Phase 4 if a larger SaaS customer requests it.
**Source:** 03-CONTEXT.md (D3-29)

### Source attribution report: plain table, no chart library
`/reports/source-attribution` ships as a server-rendered table with numeric badges. No chart library installed for Phase 3.

**Rationale:** A chart library (Recharts, Victory, etc.) adds ~80 KB and forces client-side rendering. Phase 3's table is informationally complete; charts can be added in Phase 4 reporting work without throwing away the underlying RPC.
**Source:** 03-CONTEXT.md (D3-23), 03-06-PLAN.md

### Audio retention 30 days after approve/reject
Storage object is deleted 30 days after the spec draft is approved or rejected (whichever is sooner). Daily Inngest cron sweeps.

**Rationale:** Audio file is needed for transcript correction in the recruiter review window. After approval, the structured JD is the source of truth — audio is dead weight + PII risk. Rejected drafts are soft-deleted with the same 30-day hard-delete sweep.
**Source:** 03-CONTEXT.md (D3-10, D3-30), 03-02-SUMMARY.md

---

## Lessons

### Claude Code worktree isolation forks from origin/HEAD, not local HEAD
The `isolation="worktree"` parameter on the `Agent()` tool creates a temporary worktree forked from `origin/HEAD` (the remote default branch), not the orchestrator's current local HEAD. Sequential plans in a phase that hadn't yet been pushed to origin will not see earlier waves' commits — the worktree thinks the project is at the pre-phase state.

**Context:** Discovered during Plan 03-02. The Plan 03-01 commits had merged locally but not pushed; the Plan 03-02 worktree forked from `ef65473` (pre-Phase-3) and the agent recreated Wave 0's `ffmpeg.ts` from scratch. Resolved by rebasing the worktree branch onto current main and taking Wave 0's `ffmpeg.ts` for the conflict. After the fix, the orchestrator started pushing to origin between plans so subsequent worktrees forked from current state.
**Source:** 03-VERIFICATION.md §F.1

### Stream idle timeouts break the executor mid-run; spot-check filesystem instead of retrying
The Claude API can terminate the SSE stream between large tool_result and the next assistant turn (especially at ~200K+ cache_read). The orchestrator may see "Stream idle timeout - partial response received" while the executor has actually completed substantial work — uncommitted in some cases.

**Context:** Plan 03-03 stalled after committing C.1 (migrations) + C.2 RED. Spot-check via filesystem revealed the GREEN implementation files (DB helpers + UI tabs + top-nav patch) were written but uncommitted. Orchestrator committed those as Task C.2 GREEN, ran typecheck + tests, and wrote SUMMARY.md to finish the plan. Re-spawning a fresh agent would have lost ~80% of completed work.
**Source:** 03-VERIFICATION.md §F.2, 03-03-SUMMARY.md

### Orchestrator CWD leaks between Bash calls — pin to main worktree before merges
Bash sessions persist `cd` between commands. If the orchestrator ran a command from inside a worktree (e.g., to inspect uncommitted state during a stall recovery), subsequent `git merge` commands run from the wrong worktree and the merge lands on the wrong branch.

**Context:** Plan 03-04 was merged while CWD was still inside Plan 03-05's worktree — the merge committed onto `worktree-agent-a4c5f968cf79f1d2b` instead of main. Recovered by merging the Plan 03-05 worktree branch into main (which carried both plans' tree-changes), accepting a slightly compressed history with one merge commit instead of two.
**Source:** 03-VERIFICATION.md §F.3

### React 19's `react-hooks/set-state-in-effect` is strict; functional updates don't satisfy it
The new ESLint rule fires on any synchronous `setState` call inside `useEffect`, even with the functional `setState(prev => ...)` form. Refactoring to a custom hook or extracting derived state is the textbook fix; for request-lifecycle effects where the setState IS the correct behavior, `eslint-disable-next-line` with an explanatory comment is acceptable.

**Context:** Plan 03-03's `add-to-shortlist-dialog.tsx` triggered the rule on a debounced-query search effect. Refactoring to a custom hook was disproportionate to a 17-line debounce effect; scoped disables documented the intent.
**Source:** 03-VERIFICATION.md §F.4, post-merge fix commit `1ee7aea`

### Pre-Phase-3 schema column name was `company_id`, not `client_id`
Plan 03-02 referenced `client_id` and `public.clients` in its prose, but the Phase 1 schema actually uses `company_id` and `public.companies`. Plan 03-05 made the same assumption.

**Context:** Found during execution; fixed in migrations + types. Recruitment domain glossary uses "client" but the database schema standardized on "company" — a naming gap between domain vocabulary and DB physical layer. Future plans should grep schema before writing SQL.
**Source:** 03-02-SUMMARY.md deviation #2, 03-05-SUMMARY.md

### Filename convention mismatch for SUMMARY.md surfaces only at merge
Plan 03-06's executor wrote `03-06-source-attribution-SUMMARY.md` instead of `03-06-SUMMARY.md`. The gsd-sdk's `roadmap.update-plan-progress` requires the short convention (`NN-SUMMARY.md`) to detect completion.

**Context:** Renamed post-merge via `git mv`. Future executor prompts should emphasize the exact SUMMARY.md filename convention.
**Source:** orchestrator merge step

### Wave-3 plan can read from any Wave-1 plan's table without explicit dependency declaration
Plan 03-06's `source_attribution_summary` RPC aggregates `applications` rows including Plan 03-01 LinkedIn-sourced candidates and Plan 03-02 spec-originated jobs. The dependency chain is data-flow not file-overlap, and the plan correctly documented this in its `Depends on:` block.

**Context:** Confirmed wave ordering (W3 after W1+W2) was correct even though no source files overlap. Future plans should document data-flow dependencies as explicitly as file-overlap dependencies.
**Source:** 03-06-PLAN.md "Wave 3 placement justification"

### Bundling `chrome-extension/node_modules` is a real accident risk
Plan 03-03's stalled executor had `git add -A` style commits during recovery and accidentally staged `chrome-extension/node_modules/`. Caught at orchestrator review.

**Context:** Root-level `.gitignore` has `/node_modules` (anchored) but not unanchored `node_modules/`. The pnpm workspace's nested `chrome-extension/node_modules` was not covered by the root rule. Future: either anchor-strip the gitignore line or add per-workspace `.gitignore`.
**Source:** orchestrator merge step (Plan 03-03)

---

## Patterns

### Push to origin between plans when worktree isolation is in use
After every plan in a phase, run `git push origin main` (or the working branch). Subsequent `Agent(isolation="worktree")` calls will then fork from a current origin and see prior waves' commits.

**When to use:** Any multi-plan phase that uses `Agent(isolation="worktree")` and where plans build on earlier ones (almost all).
**Source:** 03-VERIFICATION.md §F.1

### Rebase-on-rescue, never merge-from-stale-fork
When a worktree forked from a stale base, do not try to `git merge` it directly — it will delete files added in the intervening commits. Instead `cd` into the worktree, `git rebase main`, resolve any add/add conflicts by preferring the more-complete version, then merge the rebased branch.

**When to use:** Any worktree that turns out to be forked from a pre-current commit. Detect via `git log worktree-branch | grep -q <expected-recent-commit>`.
**Source:** 03-VERIFICATION.md §F.1

### Spot-check via filesystem, not just stream signals
On `Stream idle timeout` from `Agent()`, check `ls SUMMARY.md`, `git log --oneline | head -20`, and `git status --short` inside the worktree before declaring failure. Often the work is mostly done — recover by completing the last task inline rather than respawning.

**When to use:** Any executor that returns a stream-idle / partial-response error.
**Source:** 03-VERIFICATION.md §F.2, 03-03-SUMMARY.md

### Pre-approve human-verify checkpoints in the orchestrator prompt when packages are well-known
Plan 03-00 had a `checkpoint:human-verify (gate=blocking-human)` for npm package legitimacy. The orchestrator verified packages on npm registry first (creation date, publisher, version maturity), then passed the evidence into the executor prompt with an explicit pre-approval. Executor skipped the gate without losing the audit trail.

**When to use:** Long-known mainstream packages (openai, fluent-ffmpeg, well-published OSS); not for unfamiliar or recently-published packages where independent human verify is warranted.
**Source:** 03-00-SUMMARY.md Task 0.1 detail, orchestrator pre-flight

### Cite Phase 1 commit hash in migration headers for cross-tenant guard ordering
Migrations adding tenant-scoped tables include header comment citing Phase 1 commit `3f748f8` (the original guard ordering rule) so future readers know why `_set_org` triggers must precede `_verify_same_org_check`.

**When to use:** Every new tenant-scoped Postgres table migration.
**Source:** 03-02, 03-03, 03-04, 03-05, 03-06 migrations

### Single Sonnet tool-use call producing multiple structured outputs
Plan 03-04 ad generation produces the ad markdown AND the inclusivity score + suggestions in a single Sonnet tool-use call (one schema with all four fields). Cheaper, lower-latency, and the two outputs are consistent with each other.

**When to use:** Any feature where two outputs are computed from the same input prompt and you want them mutually-consistent (e.g., summary + sentiment, draft + tone analysis, code + tests).
**Source:** 03-04-PLAN.md (D3-13), 03-04-SUMMARY.md

---

## Surprises

### Pre-existing Phase 1 ESLint warning surfaced as a Phase 3 blocker
The `react-hooks/set-state-in-effect` rule fired only on Plan 03-03's new dialog component, but the rule itself shipped with React 19 + Next 16 well before Phase 3. The rule had been disabled or tolerable on other components; the new Shortlist dialog was the first place it actually blocked.

**Impact:** ~10 minutes lost discovering, refactoring, then accepting a scoped `eslint-disable-next-line`. Future React 19 plans should audit existing components against the new rules upfront.
**Source:** 03-VERIFICATION.md §F.4

### `jobs.company_id` NOT NULL surfaces after spec approval, not before
Plan 03-02's `/spec/[id]/review` page lets recruiters edit a draft and approve. The approve action constructs a `jobs` row, but `jobs.company_id` is NOT NULL from Phase 1, and the spec draft has no client picker. Approval throws a `parse_error`. Fixed by surfacing the error; client picker UI deferred.

**Impact:** Minor UX gap that requires a follow-up. Future spec-style flows should validate "do all FK targets exist?" at draft creation time, not at approve time.
**Source:** 03-02-SUMMARY.md deviation #3

### `chrome-extension/` is a pnpm workspace package, not just a folder
The chrome extension lives as `@altus/chrome-extension` in the pnpm workspace (registered in `pnpm-workspace.yaml`). This means `pnpm install` from the repo root resolves the extension's deps too, and `chrome-extension/node_modules/` exists.

**Impact:** Initial confusion about whether the extension was buildable from repo root (it is). Reminder that pnpm workspace members compose into a single dependency graph but each has its own `node_modules`.
**Source:** 03-01-SUMMARY.md, 03-01-PLAN.md "Chrome extension scaffold"

### Wave-2 plans had ZERO file overlap — first wave to run fully parallel
Plans 03-04 (ads) and 03-05 (dormant outreach) had no shared file modifications. They ran fully parallel via `run_in_background: true` on the Agent() calls. Total wall-clock for Wave 2: ~25 min vs ~50 min sequential.

**Impact:** Demonstrates the value of file-overlap detection BEFORE wave dispatch. Wave 1's 2-pair overlap (route.ts + top-nav.tsx) forced sequential there; cleaner planning could push more plans into truly parallel waves.
**Source:** orchestrator Wave 2 dispatch step

### Plan 03-03 was the smallest plan but stalled mid-execution; Plan 03-04+05 were larger but ran clean
Plan 03-03 has 2 tasks declared but stalled with a stream-idle timeout. Plans 03-04 (3 tasks) and 03-05 (2 tasks) ran clean to completion. Plan size does not predict stall risk; transient API state does.

**Impact:** Don't bias execution decisions on plan-task-count as a proxy for risk. Have spot-check + manual-completion patterns ready for every plan.
**Source:** Stall during Plan 03-03 execution
