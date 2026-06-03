---
status: complete
---

# Quick Task 260603-gdz — Onboarding UX

**Completed:** 2026-06-03

Four onboarding improvements (all user-selected). No schema changes, no new deps.
The executor completed Tasks 1–2 then hit an API socket error before Task 3; the
orchestrator finished Task 3 + the full pre-UAT pipeline.

## What shipped

**1. First-run welcome checklist (dashboard)** — `ae16b28`
- `getOnboardingCounts` added to `src/lib/db/dashboard.ts` (candidates, clients/
  companies, jobs all-statuses, team-member count) — a sibling read that leaves
  the existing `getDashboardMetrics` "Open jobs" semantics intact.
- `src/app/(app)/_dashboard/welcome-checklist.tsx` (client): data-driven steps
  (Add candidate → client → invite teammate → upload spec), each auto-ticks from
  the real counts. Only the **dismiss** flag is in `localStorage`
  (`altus.welcomeChecklist.dismissed`), read inside `useEffect` after mount
  (SSR-safe — review confirmed no hydration mismatch). Auto-hides when all steps
  done. Richer dashboard empty-state hero.

**2. Richer empty states + flow explainer** — `696fbde`
- Tighter empty states on `/candidates`, `/clients`, `/jobs` via the shared
  empty-state component; clearer value + primary CTA.
- `/settings`: owner-only "Invite your team" card + a plain-English role
  explainer (Owners vs Recruiters), visible to all.

**3. Optimistic invite UI (`/settings/team`)** — `25fe984`
- New `team-invites.tsx` (client) consolidates the invite dialog + pending list
  into one `useOptimistic` store so **send / resend / revoke reflect instantly**.
  Replaces (deletes) invite-member-dialog / resend-invite-button /
  revoke-invite-button (only page.tsx referenced them).
- CLAUDE.md mutation rule honoured: every failure path reverts the optimistic
  state AND fires `toast.error` — no silent false-success.

## Pre-UAT pipeline (HARD RULE #1)
- **gsd-code-review**: 0 critical, 3 warnings. Fixed `43d0cc0`:
  - WR-01 — optimistic "Sending…" ghost could coexist with the real revalidated
    row (invite action revalidates before the email send finishes) → dedupe by
    email at render.
  - WR-03 — duplicate owner Team cards on /settings → merged into one.
  - WR-02 (resend badge) confirmed correct; IN-01 (`isEmpty` guard) pre-existing,
    deferred.
- `pnpm lint` + `pnpm typecheck`: green.
- Browser pre-smoke (live): Layer A auth-guard + Layer A2 render of all changed
  pages — no client errors, no regression on the populated anchor org.

## Verification caveat
The welcome-checklist + empty-state UX is best UAT'd against an **empty/seed org**.
The live anchor org has data, so its pre-smoke only confirms no-regression + no
client errors — not the first-run appearance. The optimistic invite flow was NOT
exercised with a live send on the anchor org (that would create a real invite +
email a real person); verified by code-review + types + render. UAT the actual
invite send against a seed/demo org.

## Commits
- `ae16b28` welcome checklist + dashboard empty state (Task 1)
- `696fbde` empty states + settings invite card & role explainer (Task 2)
- `25fe984` optimistic invite UI (Task 3)
- `43d0cc0` review fixes (WR-01, WR-03)
