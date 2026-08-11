---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
source_review: 07-REVIEW.md
fixed_at: 2026-08-11
base_commit: 526cb40
findings_in_scope: 24
fixed: 24
residual: 0
status: all_fixed
---

# Phase 7 — Review Fix Report

Every finding in `07-REVIEW.md` is closed: **3 blockers, 13 warnings, 8 info**.
Nothing was deferred as unfixable. Two items carry a **founder action** that no
code change can perform (marked below); both are recorded in-repo so they cannot
be forgotten.

**Base:** `526cb40` · **Commits:** 16, one per finding group.

---

## Blockers

### CR-01 — Stale edit form wiped every parsed column
**Commit:** `29a2782`

The widened form rendered all 18 fields from a page-load snapshot and submitted
the whole snapshot on every save; the action treats present-but-empty as a
deliberate clear. A phone correction made while `parse-cv` / "Accept all" / the
reconcile heal-sweep landed the parsed profile in the background silently wiped
skills, work history, education, headline and about.

- `candidate-edit-form.tsx` — submits only react-hook-form's `dirtyFields`, so
  untouched keys arrive `undefined` and the action's existing
  omitted-vs-cleared machinery skips those columns. `dirtyFields` is
  destructured **during render** because RHF's `formState` is a Proxy that only
  tracks keys read in a render pass.
- `edit/actions.ts` — **also** converted the five optional basics (`email`,
  `phone`, `location`, `current_role_title`, `current_company`) from `x || null`
  to `toNullableString`. Not in the review's suggested patch: those relied on the
  form always submitting all eight basics, so dirty-field submission alone would
  have turned this fix into a *new* wipe of exactly those columns
  (`undefined || null` → `NULL`).
- Reworded the comment that justified the helpers with "07-04 hasn't shipped
  yet" (**IN-02**) to point at CR-01 instead — that reasoning was exactly what a
  future maintainer would use to delete the guard.
- New `candidate-edit-form-dirty-fields.test.tsx` simulates the stale-snapshot
  save; 4 of its 5 original cases fail against the pre-fix payload (verified).

### CR-02 — Blocked popup produced no error, no link, nothing
**Commit:** `7654080`

- `cv-file-link.tsx` — the tab is opened **synchronously inside the click**, then
  navigated once the URL arrives. `noopener` is deliberately *not* passed to that
  call: per spec it makes `window.open` return `null`, which would have defeated
  the review's own suggested patch. `win.opener` is nulled while the tab is still
  `about:blank` as the equivalent reverse-tabnabbing mitigation.
- Failure paths: failed sign closes the placeholder tab and toasts; a blocked
  popup toasts the URL as an activatable "Open CV" action (30s, inside the 60s
  TTL) so the recruiter is never stranded.
- **Audit ordering** documented in `getCvFileUrlAction`: the row means "a signed
  URL was RELEASED to this user", which is only honest because every client
  branch now delivers that URL. **IN-05** decided explicitly in the same comment
  (audit failure does not block a customer reading their own document; what to
  change if that ever becomes unacceptable).
- New `cv-file-link.test.tsx` pins call ordering, navigation, opener severing,
  the failed-sign close, and the blocked-popup toast action.

### CR-03 — Heartbeats fired once per Inngest replay
**Commit:** `eeb3d77`

- Heartbeat is now the **first `step.run('heartbeat')`** in both `embed-batch`
  and `reconcile-cv-parses` — memoized, so exactly one event per run, while
  keeping "fires before any real work".
- **Recomputed volume** (in-code and in the runbook): 144/day + 96/day =
  **240/day ≈ 7,300/month**, down from ~816/day ≈ 24,500/month (~3.4×).
- Recorded honestly that 7,300/month **still exceeds** a 5,000/month free-tier
  errors quota on its own, with the two legitimate fixes (upgrade, or migrate to
  Sentry Crons check-ins) and a warning not to "fix" it by firing less often than
  the alert window.
- `cron-hardening.test.ts` (07-05's own test, not frozen) updated **in the same
  commit** — it pinned `heartbeatIdx < firstStepRunIdx` and would otherwise have
  actively prevented the fix. It now asserts the first `step.run` id is
  `'heartbeat'` and that `captureMessage` lives inside it.

---

## Warnings

| ID | Fix | Commit |
|----|-----|--------|
| WR-01 | Pre-filter chunks by **rows** (50), bounding *both* `.in()` lists to ~4.5 kB; a chunk read failure now **fails CLOSED** (skip + count + warn) instead of open. | `932e87f` |
| WR-02 | Cap moved from the **scan** to **enqueues** (500), with a bounded scan (20×500) that walks past scored rows — so re-runs advance and newer rows are reachable. `.gte` cursor + seen-set survives bulk-import `created_at` ties; `truncated` is now truthful and carries `next_cursor` (event accepts `created_after`). | `932e87f` |
| WR-03 | Button `disabled={isPending \|\| isPolling}`; action sends an hour-bucketed dedup id `score-top:{jobId}:{hour}`, mirroring `enqueue-match-score.ts`. | `2726a3c` |
| WR-04 | Read-only pre-flight on spend ceiling + `checkCap` returns specific messages; unscorable candidates render "Profile too sparse to score" (no Explain button); page excludes them from `allCardsFresh` so "Score all" can't be pinned on forever. | `9155bee` |
| WR-05 | Chips deduped case-insensitively with unique index-based keys; removing a chip drops every stored entry it stands for; Backspace removes the last **chip**. | `1660e88` |
| WR-06 | Native `required` dropped; the flag now drives an aria-hidden asterisk rendered as a **sibling** of the Label (so the accessible name stays "Title"/"School"), letting the schema's documented blank-row drop actually happen. | `d740b69` |
| WR-07 | `years_experience` validated against the real `numeric(4,1)` grid (≤3 integral digits, ≤1 decimal ⇒ max 999.9) with a message that says so — closes the 999.95→1000.0 rounding cliff. | `debadee` |
| WR-08 | Action flattens nested `{id, patch}` issue paths to real field names; form only `setError`s on fields it renders and toasts anything unmapped. | `02b6780` |
| WR-09 | Contract test globs `supabase/migrations/*.sql` and binds to the **last** file defining the trigger, throwing loudly if none do. | `0bc4034` |
| WR-10 | Runbook §7 added: two-minute dashboard check with a status line, and exactly what changes if `timeouts` turns out to be paid-only. §4's cancelled-run signal now points at it. **Founder action.** | `8b92338` |
| WR-11 | `RepeatingRows` accepts and applies `id` / `aria-describedby` / `aria-invalid` on its `role="group"` container, matching `TagInput`. | `d740b69` |
| WR-12 | Parsers report whether the round trip is **lossless**; when it isn't, the section renders read-only with an explanation. Guarantee is structural — no editor means the field can never be dirty, so CR-01's submission never sends it. Parsers extracted to `edit/parse-rows.ts` and tested. | `3eb0413` |
| WR-13 | `.claude/**` added to `globalIgnores` (verified load-bearing: 1 error → 0 with a simulated nested worktree). | `c8b401b` |

---

## Info

| ID | Fix | Commit |
|----|-----|--------|
| IN-01 | `prettier --write` on `edit/schema.ts`. | `debadee` |
| IN-02 | Stale "07-04 hasn't shipped" comment reworded to point at CR-01. | `29a2782` |
| IN-03 | Dead-looking `?? 'Pending'` **kept and documented** as a runtime guard for the window where the PG enum has gained a value but `database.ts` hasn't been regenerated. | `58effbf` |
| IN-04 | `EMPTY_SUMMARY` shared-mutable constant replaced with a factory. | `58effbf` |
| IN-05 | Audit-completeness trade **decided and documented** in-code, with the change required if it ever becomes unacceptable. | `7654080` |
| IN-06 | AlertDialog confirmation on the all-orgs backfill, matching `DangerZone`'s pattern; description corrected to match WR-02's new re-run behaviour. | `1b1c425` |
| IN-07 | UUID prefix regex matches the real 8-4-4-4-12 grouping, case-insensitively. | `58effbf` |
| IN-08 | Plain-digit patterns on `years_experience` and both salaries — `'0x10'`/`'1e3'` no longer pass. | `debadee` |

---

## Founder actions (cannot be closed in code)

1. **WR-10 — confirm `timeouts` is enforced on the current Inngest plan.**
   `docs/cron-monitoring.md` §7, two minutes, has a status line to edit. Until
   then, treat wedge protection as unconfirmed. No prod/dashboard access from
   here, so the runbook states it as unverified rather than implying it works.
2. **CR-03 — Sentry errors quota.** Heartbeats are down ~3.4× but ~7,300/month
   still exceeds a 5,000/month free tier. See `docs/cron-monitoring.md` §2.

## Gates

| Gate | Result |
|------|--------|
| `pnpm typecheck` | clean |
| `pnpm lint` | **0 errors**, 25 warnings (all pre-existing `_unused` args in test stubs) |
| `prettier --check` (32 touched files) | all clean |
| `pnpm vitest run` | **952 passed**, 28 todo, **0 failed** (baseline 890 → +62 new tests, zero regressions) |
| Frozen Phase-6 files | all 7 hashes byte-identical to base |
| Migrations / `package.json` / lockfile | untouched |
| `tests/smoke/**`, `tests/fixtures/**` | untouched |
| `role="alert"` in new UI | none (only inside explanatory comments) |
| Raw control bytes | none |
