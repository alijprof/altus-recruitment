---
phase: 260603-gdz-onboarding-ux-first-run-welcome-checklist
reviewed: 2026-06-03T00:00:00Z
depth: quick
files_reviewed: 8
files_reviewed_list:
  - src/lib/db/dashboard.ts
  - src/app/(app)/_dashboard/welcome-checklist.tsx
  - src/app/(app)/page.tsx
  - src/app/(app)/candidates/page.tsx
  - src/app/(app)/clients/page.tsx
  - src/app/(app)/jobs/page.tsx
  - src/app/(app)/settings/page.tsx
  - src/app/(app)/settings/team/page.tsx
  - src/app/(app)/settings/team/team-invites.tsx
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: issues_found
---

# 260603-gdz: Code Review Report

**Reviewed:** 2026-06-03
**Depth:** quick (+ targeted deep trace on team-invites.tsx per brief)
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the onboarding UX / welcome-checklist / optimistic-invite batch.
The SSR-safety approach in welcome-checklist.tsx is sound. Role-gating on
the settings invite-team cards is correct (owner-only, checked server-side).
No PII is exposed. Broken-import risk from the three deleted files is nil —
team-invites.tsx is cleanly self-contained.

Three findings warrant attention before the feature ships. The most
consequential is a **stuck "Sending…" badge** that the user sees whenever
the invite action succeeds on the server but the revalidatePath-triggered RSC
refresh is fast enough to replace the optimistic row before React removes the
`pending: 'adding'` marker — a UX bug that looks like a production failure.
The other two are a duplicate Team-card on /settings and a logic flaw in the
dashboard's empty-state guard.

---

## Warnings

### WR-01: `onSubmit` closes dialog and optimistically inserts BEFORE the transition starts — "Sending…" badge can persist forever after a successful invite

**File:** `src/app/(app)/settings/team/team-invites.tsx:189-224`

**Issue:**
`onSubmit` calls `setOpen(false)` and `form.reset()` synchronously, then
calls `startTransition(async () => { addOptimistic(...) ... })`. Inside the
transition the optimistic row is added with `pending: 'adding'` and the
"Sending…" badge is shown.

On the **success path**, `revalidatePath('/settings/team')` fires in
`inviteMemberAction` **before** the action returns `{ ok: true }`. This
means the RSC parent re-renders with the real DB row (which has no `pending`
field), replacing the optimistic list. However, the timing is not guaranteed:
if the re-render arrives and React reconciles it while the transition is still
in flight (before `addOptimistic` for type `add` fires, or before the `ok`
branch can clean up), the optimistic row is never cleaned up from the
client's perspective — the real row takes its place but with a different
`id` (`'optimistic-...'` vs the real UUID). React's `key` prop on `<li>`
(`key={row.id}`) means the optimistic row and the real row are considered
**different elements**, so the optimistic "Sending…" row can appear alongside
the real row until the next navigation or hard refresh.

**Root cause:** There is no `type: 'remove'` dispatch on the success path for
the `add` action. `useOptimistic` reverts to `initialInvites` only when the
transition **commits** — but the transition commits with the real row already
in `initialInvites` (from revalidatePath), so both the real row and the
ghost `optimistic-${email}` row momentarily coexist until React can reconcile
the key mismatch.

**Fix:** After a successful `inviteMemberAction` call, explicitly remove the
optimistic row so it is gone before React merges in the refreshed list:
```ts
const result = await inviteMemberAction(data)
if (result.ok) {
  addOptimistic({ type: 'remove', id: `optimistic-${data.email}` })
  toast.success('Invitation sent')
  return
}
```
This ensures the optimistic ID is removed from the list within the same
transition, eliminating the duplicate-row window regardless of revalidation
timing.

---

### WR-02: `handleResend` has no "resending → resolved" cleanup — badge stays after success

**File:** `src/app/(app)/settings/team/team-invites.tsx:101-110`

**Issue:**
`handleResend` dispatches `{ type: 'resending', id }` to show the
"Resending…" badge, then calls `resendInviteAction`. On the **success** path
it only calls `toast.success('Invitation resent')` and returns. There is no
corresponding optimistic dispatch to clear `pending: 'resending'` from the
row.

`useOptimistic` will revert to `initialInvites` once the transition
completes — but `revalidatePath('/settings/team')` inside `resendInviteAction`
triggers a re-render of the RSC parent that refreshes `initialInvites`. If
that re-render arrives and commits before the transition ends (possible with
fast server responses), the row with `pending: 'resending'` can briefly
re-appear on the next render tick until React reconciles. In slower
environments the transition ends first and the badge disappears correctly, but
the behaviour is timing-dependent.

More critically: on the **error** path, `pending: 'resending'` is never
cleared because the optimistic state reverts to `initialInvites` — that is
correct. But on success, a cleaner approach is explicit:
```ts
if (result.ok) {
  addOptimistic({ type: 'resending', id: '__clear' }) // no-op clear
  // or: dispatch a 'clearPending' action type
  toast.success('Invitation resent')
  return
}
```
The simplest fix is to add a `clearPending` action type to the reducer:
```ts
// reducer addition:
case 'clearPending':
  return state.map((i) => (i.id === action.id ? { ...i, pending: undefined } : i))
```
Then in `handleResend` success path:
```ts
addOptimistic({ type: 'clearPending', id })
toast.success('Invitation resent')
```

---

### WR-03: `/settings` renders TWO "Team" / "Invite your team" link-cards for owners — duplicate navigation

**File:** `src/app/(app)/settings/page.tsx:85-122`

**Issue:**
Lines 85–101 render a "Team" card (links to `/settings/team`). Lines
103–122 render a second, separate "Invite your team" card — also an
`isOwner`-gated link to `/settings/team`. Both cards are wrapped in the same
`{isOwner ? ... : null}` gate and point to the same route. A user clicking
either lands on `/settings/team`. This is almost certainly a copy-paste
artifact from adding the new "Invite your team" CTA without removing the
original "Team" card.

The result is visible duplication in the settings UI for every owner: two
adjacent clickable cards pointing to the same destination, which looks like
a bug to the user.

**Fix:** Remove one of the two cards. The richer "Invite your team" card
(lines 103–122) has better descriptive copy. Remove the generic "Team" card
(lines 85–101) and keep only the "Invite your team" card, or merge the two
descriptions into one card.

---

## Info

### IN-01: Dashboard empty-state guard uses `metrics.candidates === 0 && metrics.openJobs === 0` — hides checklist for a user who has jobs but no candidates

**File:** `src/app/(app)/page.tsx:38-51`

**Issue:**
The `isEmpty` guard is `metrics.candidates === 0 && metrics.openJobs === 0`.
This shows the full-page empty-state only when BOTH are zero. A user who has
added one job but no candidates yet sees the full dashboard (with metric
cards) rather than the onboarding empty-state — so the welcome checklist is
shown (correct), but the "Your pipeline starts here" empty-state headline is
never shown to a partially-onboarded user.

The `WelcomeChecklist` (which is data-driven) handles partial onboarding
correctly on its own, so this is low-severity. But the empty-state logic is
inconsistent with the `jobs/page.tsx` pattern (which treats `total === 0`
alone as empty), and a user with 1 job and 0 candidates sees an empty
activity feed, zero candidate metric card, and the welcome checklist all at
once — slightly confusing.

This is an info-level UX inconsistency, not a correctness bug. No immediate
fix required; file for a follow-up UX pass.

---

_Reviewed: 2026-06-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
