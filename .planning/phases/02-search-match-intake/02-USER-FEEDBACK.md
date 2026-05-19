# Phase 2 — User Smoke-Test Feedback (2026-05-19)

User did a real-data walkthrough on Vercel after Phase 2 wave 3 + review fixes
landed. Overall: features working as intended, especially impressed with the
`/settings/usage` cost dashboard. One bug + four UX requests.

## P0 — BLOCKER: Apply form submission fails

**Symptom:** filling out `/apply/altus` with valid data + CV upload + Turnstile
"Success" + consent ticked → click Submit → red toast "Something went wrong.
Please try again." Apply form fully populated per screenshot.

**Investigation so far:**
- Candidate row WAS created (name "Big Boaby", source='apply_form', 2026-05-19T14:44:52)
- `candidate_cvs` row was NOT created
- `audit_log` row was NOT created via `record_audit_anonymous`
- Rate-limit table shows 2 attempts in 14:40 window + 1 attempt in 14:45 — so user did try multiple times
- Conclusion: failure is in `submitApplyAction` between the candidate insert
  (around line 300 of `src/app/(public)/apply/[orgSlug]/actions.ts`) and the
  `createCandidateCV` call (around line 354).

**Most likely failure points (need Vercel logs or Sentry to confirm):**
1. `createSignedUploadUrl` (line 331) — `cvs` Storage bucket access from
   service role on production. Bucket exists (Phase 1 Plan 0 migration), but
   storage RLS may be rejecting service-role minting (Plan 0 storage policies
   were keyed on `(storage.foldername(name))[1] = current_organization_id()::text`
   which evaluates to NULL under service-role — should bypass RLS, but worth
   checking).
2. M-2 tenant assertion (line 352) — would only fail if `storagePath` doesn't
   start with `${org.id}/applicants/`. Both values are server-constructed so
   shouldn't fail. Worth logging on Vercel.
3. `nextCVVersion` helper — count query failure (unlikely).

**Suggested fix path:**
- Install Vercel CLI (`npm i -g vercel && vercel login`)
- Tail logs: `vercel logs altus-recruitment --since 1h`
- OR add a temporary `Sentry.captureMessage` at each step of `submitApplyAction`
  with breadcrumbs, redeploy, retry, read the breadcrumb trail in Sentry (if
  configured) or Vercel logs.
- Most likely fix: surface the actual error message to logs so future
  failures aren't opaque "Something went wrong".

## P1 — Stage change from candidate detail page

**User quote:** "It'd be quite handy to be able to change that in the page as
well. So just doing it on the pipeline. Uh, if you know you want to change it,
it's a bit annoying to have to go out of that client and then... or or customer
and then go and change it in the pipeline."

**Translation:** when viewing a candidate's detail page, recruiter sees the
application(s) the candidate has. If they want to move the candidate's stage
on a job, they currently have to navigate to `/jobs/[id]/pipeline` to drag the
card. Add inline stage-change dropdown / button on the candidate detail page's
application list section.

**Scope:** small. Add a `<Select>` on each application row in the candidate
detail with the same `move_application` RPC call the kanban uses. Reuse the
decline-modal for terminal stages.

## P2 — List ↔ Card view toggle on `/candidates` and `/clients`

**User quote:** "I just sometimes think the Kanban just has a nicer look with
that little box ... could be made to look a bit more aesthetically pleasing,
uh, and can pop a bit more when you sort of hover over it and stuff."

**Translation:** add a view toggle (list / card) on the candidates and clients
list pages. List is the current default; card view shows each row as a card
similar to the kanban card style with hover effects.

**Scope:** medium. New `<ViewToggle>` component, `view=list|card` URL search
param, new `<CandidateCard>` / `<ClientCard>` components. Hover polish across
both views (Tailwind `hover:` + `transition`).

## P2 — Pipeline horizontal scroll fix

**User quote:** "The pipeline page works really well, but there's just quite a
lot of white space just now ... it's just a bit annoying not to be able to see
the whole pipeline in the one page and having to scroll along to see the rest
of it."

**Translation:** 7 pipeline stages don't fit in the viewport, requiring
horizontal scroll. Fix: compact card layout, narrower columns, possibly
collapse less-active stages, OR responsive breakpoints that fit all 7 on
desktop (e.g., min-width 1280px shows all stages without scroll).

**Scope:** mostly CSS. ~1 hour.

## P3 — Card hover polish on candidate/client lists

**User quote:** "could be made to look a bit more aesthetically pleasing, uh,
and can pop a bit more when you sort of hover over it and stuff, uh, before
you click in and view your candidate or client"

**Translation:** subtle hover affordances on list/card rows (shadow elevation,
border accent, etc.). Tailwind `hover:` utilities.

**Scope:** small. Wrap in a UI-polish task.

---

## Sign-off

User: "I'm happy once these fixes have been made to sort of proceed because,
I mean, it's all working as intended."

Phase 2 is functionally complete; this backlog captures the gap between
"working as intended" and "polished for the anchor to actually live in".
