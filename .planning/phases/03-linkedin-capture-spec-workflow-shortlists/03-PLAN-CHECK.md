# Phase 3 Plan Check

**Reviewed:** 2026-05-19
**Reviewer:** gsd-plan-checker (goal-backward verification)
**Scope:** 7 plans (03-00 through 03-06)

**Verdict:** PASS WITH NOTES (3 CRITICAL fixes folded into plans on 2026-05-19; see "Fix applied" markers)

A handful of CRITICAL fixes were required before Wave 1 — all addressed in-place. Every requirement and every D3-XX decision is delivered by a concrete task. Architecture is sound; migration ordering correctly aware of Phase 1 bug class; multi-tenant boundary checks in the right places.

---

## Goal coverage

| # | Success criterion (ROADMAP.md) | Delivering plan(s) / task(s) | Status |
|---|---|---|---|
| 1 | LinkedIn → candidate w/ embedding, no form filling | Plan A: A.1, A.2, A.3 | COVERED |
| 2 | Spec call → Whisper → Sonnet JD → review/approve | Plan B: B.1, B.2, B.3, B.4 | COVERED |
| 3 | Generate ad + inclusivity score on existing ad | Plan D: D.1, D.2, D.3 | COVERED |
| 4 | Shortlists, floats, dormant client widget | Plans C + E | COVERED |
| 5 | Source attribution report | Plan F: F.1, F.2, F.3 | COVERED |

## Decision coverage

All 34 D3-XX decisions referenced by at least one task. No misses.

## Hard rules (CLAUDE.md)

| Rule | Status |
|---|---|
| Claude calls through `claude.ts` wrapper | PASS — `runWithLogging` imported by B/D/E; grep invariants on `new Anthropic(` |
| Whisper calls through `whisper.ts` wrapper | PASS — Plan B.2 |
| Voyage calls through `voyage.ts` wrapper | PASS — Plan A.3 reuses |
| `record_ai_usage` from every wrapper | PASS — 6 new `purpose` values |
| Calls >2s in Inngest | PASS — sync Sonnet ad-gen escapes per D3-25 with Sentry span monitoring |

## Multi-tenant safety

Every service-role write passes `organization_id` explicitly and has a tenant-boundary assertion before any row touch. PASS across Plans A/B/E/C.

## Migration trigger ordering

Plan B `spec_drafts` + Plan D `job_ads` — both correct (`_set_org` < `_verify_same_org_check`). Phase 1 commit `3f748f8` cited in headers. PASS.

## Cross-plan dependencies

Wave order (0 → A/B/C parallel → D/E parallel → F) respects all declared deps. Shared file conflicts limited to `src/app/api/inngest/route.ts` — mechanical not semantic.

## Chrome extension scope

`host_permissions` minimal (linkedin.com/* + Altus domain + localhost). Auth = cookie-from-tab + Bearer (NEVER service-role). Capture rate-limit 1/5s per tab. NO profile photo URL. PASS.

## Microsoft Mail.Send

Incremental consent — surfaced ONLY on first 403, `prompt=consent` forces fresh refresh token. NOT bundled at deploy. PASS.

## Schema gotchas

Plan C M2 drops `applications.job_id NOT NULL` + CHECK enforces float-only NULL + M3 null-safe FK guard. PASS.

## AI cost ceiling

Total Phase 3 AI cost: ~£15-18/recruiter/year. Within research projection. No runaway.

---

## Findings

### CRITICAL — fix before execution

- **CRITICAL-1 — Plan A CORS Allow-Origin wrong.** Should be `chrome-extension://${EXTENSION_ID}` (with `key` pinned in manifest), not `https://www.linkedin.com` (the extension service worker, not LinkedIn, makes the fetch). → **Fix applied** in Plan A Task A.2.

- **CRITICAL-2 — Plan 0 missing `probeDurationSeconds`.** Plan B's Inngest function calls `probeDurationSeconds(buffer)` from `ffmpeg.ts`, but Plan 0 Task 0.2 only ships `recompressToOpus`. → **Fix applied** in Plan 0 Task 0.2 (extends exports + adds unit test).

- **CRITICAL-3 — Plan F RPC `coalesce(placed_at, stage_changed_at)` branch untested.** Test must seed both NULL and NOT NULL placed_at rows. → **Fix applied** in Plan F Task F.2 (acceptance criteria + test seed shapes).

### HIGH — folded in for quality

- **HIGH-1** — Storage path convention disagreement (PATTERNS vs Plan B). Harmonized to `${org}/${user.id}/${draft.id}.${ext}`. → **Fix applied** Plan B + PATTERNS.
- **HIGH-2** — Plan E modal needs preflight `Mail.Send` check before draft (avoid losing modal state). → **Fix applied** Plan E Task E.2.
- **HIGH-3** — Plan A advisory-lock under-specified. Use `pg_try_advisory_xact_lock(hashtext(org::text), hashtext(linkedin_url))`. → **Fix applied** Plan A Task A.2.

### MEDIUM — executor-aware

- M-1: Plan B 60-min audio cap not UI-enforced (only 100 MiB). Executor adds duration probe or fails draft inside Inngest.
- M-2: `src/lib/ai/__mocks__/claude.ts` mock helper assumed by Plan D tests; add to Plan 0 Task 0.3 file list.
- M-3: Plan F `avg_time_to_place_days` baseline ambiguous — clarify in RPC comment.
- M-4: Plan E modifies Phase 2 file `outlook.ts` — already gated by ROADMAP `Depends on: Phase 2`.

### LOW — advisory

- L-1: Plan C "survey existing RPCs first" advisory → make checkpoint.
- L-2: Plan A fixture anonymisation has no acceptance bar → add grep check.
- L-3: Plan E uses `layer: 'integration'` Sentry tag, not in canonical list.
- L-4: Plan B cron times `03:00`/`03:30` may overlap Supabase maintenance window.
- L-5: Plan F Task F.1 conditional migration leaves no audit trail.

---

## Conclusion

Phase 3's plan set is fundamentally sound. Every ROADMAP success criterion is delivered by named, fully-specified tasks. All 34 locked decisions are referenced and implemented — no scope reduction, no silent simplification. Multi-tenant safety is tight, migration ordering correct, Chrome extension minimal, Mail.Send incremental.

**Verdict: PASS WITH NOTES.** The 3 CRITICAL items have been folded into the plans on this same review pass. The 3 HIGH items were also applied for quality. MEDIUM and LOW findings are advisory for the executor pool.

**Execute:** `/clear` then `/gsd-execute-phase 03-linkedin-capture-spec-workflow-shortlists`

Wave order: 0 → 1 (A/B/C parallel) → 2 (D/E parallel) → 3 (F).
