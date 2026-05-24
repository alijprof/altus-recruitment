---
phase: 260524-b6v-in-app-feedback-widget-floating-button-d
plan: 01
subsystem: feedback
tags: [feedback, ux, multi-tenant, rls, resend]
requires:
  - public.users
  - public.organizations
  - public.set_organization_id (trigger fn)
  - public.current_organization_id (RLS helper)
  - @/components/ui/{dialog,button,textarea,label}
  - @/lib/supabase/server (createClient)
  - @/lib/db/profiles (getProfile)
provides:
  - public.feedback table (RLS append-only)
  - sendResendEmail (best-effort fetch wrapper)
  - submitFeedbackAction (server action)
  - FloatingFeedbackButton (FAB on every (app) route)
affects:
  - src/app/(app)/layout.tsx (mounts the FAB)
tech-stack:
  added: []
  patterns:
    - feedback_set_org trigger mirrors spec_drafts_set_org (alphabetical-first
      BEFORE-INSERT trigger naming, see 20260520003437_phase3_spec_drafts.sql)
    - Fire-and-forget outbound email — DB row is canonical; Resend failure
      returns ok:true to the user
    - Discriminated-union Status state machine for client form (matches
      sign-in-form convention)
key-files:
  created:
    - supabase/migrations/20260524000000_feedback.sql
    - src/lib/email/resend.ts
    - src/app/(app)/_actions/submit-feedback.ts
    - src/components/app/floating-feedback-button.tsx
  modified:
    - src/lib/env.ts (added RESEND_API_KEY + RESEND_FROM, both optional)
    - src/types/database.ts (hand-patched feedback Row/Insert/Update — see
      deviation #2: supabase link unavailable in worktree)
    - src/app/(app)/layout.tsx (import + render <FloatingFeedbackButton />)
decisions:
  - Append-only table (no UPDATE / DELETE RLS policies): feedback is a
    forward-only audit channel; recruiters cannot edit prior submissions
  - body CHECK constraint (length 1-2000) duplicates the Zod cap as defence
    in depth against direct SQL-side inserts
  - Plaintext-only Resend email (text:, never html:) prevents HTML injection
    via user-controlled body/page_url/user_agent (T-260524-b6v-05)
  - Insert payload casts via `as unknown as TablesInsert<'feedback'>` to
    omit organization_id (filled by trigger) — same pattern as
    src/lib/db/spec-drafts.ts:106-116
metrics:
  duration: ~25min
  completed: 2026-05-24
  tasks: 2/2
---

# Quick 260524-b6v: In-app Feedback Widget Summary

**One-liner:** Floating bottom-right FAB opens a shadcn Dialog that
persists user feedback to a new tenant-scoped `public.feedback` table and
fires a best-effort Resend email to alasdairj8@gmail.com.

## What shipped

| Layer | Artefact | Purpose |
|-------|----------|---------|
| DB | `public.feedback` table | Append-only feedback row with RLS (select + insert only); `feedback_set_org` trigger auto-fills `organization_id` |
| Env | `RESEND_API_KEY`, `RESEND_FROM` | Both optional; production must set RESEND_API_KEY for email to fire |
| Lib | `src/lib/email/resend.ts` | `sendResendEmail()` — fetch-based wrapper that never throws; returns discriminated `{ ok | no_api_key | http_error }` result |
| Action | `submitFeedbackAction` | Zod-validates body 1-2000, inserts via supabase server client, fires Resend email in try/catch — returns `{ ok: true }` even if Resend fails |
| UI | `FloatingFeedbackButton` | Client component: fixed FAB → Dialog → Textarea + char counter + Cancel/Send; auto-closes 1.5s after success |
| Mount | `src/app/(app)/layout.tsx` | Renders FAB after `<main>` inside the (app) wrapper — does NOT appear on (auth) or (public) routes |

## Files changed

| File | Status | Lines |
|------|--------|-------|
| `supabase/migrations/20260524000000_feedback.sql` | new | 49 |
| `src/lib/env.ts` | modified | +12 |
| `src/lib/email/resend.ts` | new | 84 |
| `src/app/(app)/_actions/submit-feedback.ts` | new | 137 |
| `src/types/database.ts` | modified | +47 (hand-patched — see deviation #2) |
| `src/components/app/floating-feedback-button.tsx` | new | 143 |
| `src/app/(app)/layout.tsx` | modified | +2 |

## Commits

| Commit | Message |
|--------|---------|
| `a9e105b` | feat(260524-b6v): feedback table + server action + Resend email |
| `e06f9c8` | feat(260524-b6v): floating feedback button + layout mount |

## DB schema confirmation (from migration file — applies on next push)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | `default gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL FK organizations(id) ON DELETE CASCADE` | Auto-filled by `feedback_set_org` trigger; RLS WITH CHECK validates |
| `submitted_by` | `uuid NOT NULL FK users(id) ON DELETE CASCADE` | RLS WITH CHECK enforces `= auth.uid()` (no impersonation) |
| `body` | `text NOT NULL` | `CHECK (length(body) between 1 and 2000)` |
| `page_url` | `text NULL` | User-controlled — never parsed/eval'd |
| `user_agent` | `text NULL` | User-controlled — never parsed/eval'd |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

Index: `feedback_org_created_at_idx (organization_id, created_at DESC)` for the
future "Recent feedback" admin view.

RLS policies:
- `"tenant select" FOR SELECT TO authenticated USING (organization_id = public.current_organization_id())`
- `"tenant insert" FOR INSERT TO authenticated WITH CHECK (organization_id = public.current_organization_id() AND submitted_by = auth.uid())`
- NO update / delete policies (append-only by design)

Trigger: `feedback_set_org BEFORE INSERT ... EXECUTE FUNCTION public.set_organization_id()`

## Resend email status

- **Code path:** wired. `submitFeedbackAction` calls `sendResendEmail` after a
  successful insert, inside a `try/catch`. Failure returns `{ ok: true }` to
  the user and logs a Sentry warning (status + message only, never body text).
- **Production env vars to set on Vercel:**
  - `RESEND_API_KEY` — get from https://resend.com/api-keys
  - `RESEND_FROM` — optional; defaults to `Altus <feedback@updates.altus.app>`
- **Domain verification required:** YES. Before the first email goes out the
  user MUST verify the sending domain (likely `updates.altus.app`) in the
  Resend dashboard, then add the DKIM + SPF records to the DNS for that
  domain. Until verified Resend will return a 422 and the action will still
  succeed (Sentry warning logged).
- **Email recipient:** hard-coded `alasdairj8@gmail.com` (per plan).
- **Subject:** `Altus feedback — <org name>` (or `unknown org` if profile
  lookup failed).
- **Body (plaintext, never HTML):** From line (full_name + email), Org line,
  Page line, then a separator + the feedback body verbatim.

## Test evidence

This is a dispatch-time SUMMARY — no live DB row id or screenshot yet because
the migration has not been applied to the linked Supabase project from this
worktree (see deviation #2). Manual UAT steps for the next session:

1. From the main repo: `pnpm exec supabase db push --linked` to apply the
   migration to the linked project.
2. `pnpm db:types` to regenerate `src/types/database.ts` cleanly (replaces
   the hand-patched entry with the canonical regen).
3. Boot the app (`pnpm dev`), sign in, confirm the FAB appears bottom-right
   on `/dashboard`, `/candidates`, `/jobs`, `/clients`, `/pipeline`,
   `/settings`.
4. Confirm the FAB does NOT appear on `/sign-in`, `/sign-up`, `/apply/*`,
   `/auth/auth-code-error`.
5. Click FAB → type "first feedback test" → Send → confirm "Thanks — sent."
   → dialog auto-closes after ~1.5s.
6. In Supabase Studio: `select id, body, page_url, organization_id from
   public.feedback order by created_at desc limit 1;` — confirm row.
7. Cross-tenant smoke: sign in as a user in a different org, run the same
   select, confirm zero rows from the first org are returned (RLS).
8. Empty submit: open dialog, click Send without typing — confirm inline
   error "Please enter some feedback" and that no DB row is written.
9. With `RESEND_API_KEY` unset: confirm submit still succeeds; no Sentry
   error. With it set: confirm email lands at `alasdairj8@gmail.com`.

## Deviations from plan

### 1. `[Rule 3 - Blocking]` Hand-patched `src/types/database.ts` instead of regenerating

- **Found during:** Task 1 step 5 (`pnpm exec supabase db push --linked`)
- **Issue:** Supabase CLI link state lives in `supabase/.temp/project-ref`
  (gitignored) and is not propagated into git worktrees. Push failed with
  `Cannot find project ref. Have you run supabase link?` Re-linking from the
  worktree would require an access token I don't have.
- **Fix:** Per the explicit constraint in the task brief
  ("If `pnpm db:types` fails because the DB push didn't happen, add the
  `feedback` type manually to `src/types/database.ts` following the existing
  pattern (Row/Insert/Update triplet under `Tables`) so typecheck passes,
  AND note this in SUMMARY.md so the next session can regenerate cleanly."),
  hand-patched the `feedback` triplet between `contacts` and `hnsw_build_state`
  (alphabetical insertion point). Used the same `Insert: { organization_id: string }`
  shape that regen produces for trigger-filled `not null` columns (matches
  `spec_drafts`).
- **Files modified:** `src/types/database.ts`
- **Commit:** `a9e105b`
- **Follow-up required:** Run `pnpm exec supabase db push --linked` then
  `pnpm db:types` from the main repo (where the link state lives) after
  this branch is merged. The regen should produce an identical block; if it
  doesn't, the regen wins.

### 2. `[Rule N/A - Documented out-of-scope]` Pre-existing lint error in `cv-review-panel.tsx`

- **Found during:** Task 1 verification (`pnpm lint`)
- **Issue:** Line 98 `const startedAtRef = useRef(Date.now())` violates the
  Next.js / React 19 rule "Cannot call impure function during render".
- **Scope decision:** Not auto-fixed. Verified pre-existing on base commit
  `7916c2f` by stashing my changes and re-running `pnpm lint` — same single
  error. Outside the scope boundary ("Only auto-fix issues DIRECTLY caused
  by the current task's changes").
- **Logged to:** `.planning/quick/260524-b6v-.../deferred-items.md`

## Verification

- [x] Migration file written with the exact table + RLS + trigger from the plan
- [x] `feedback_set_org` trigger named to sort before any future `_verify_*`
- [x] `tenant select` and `tenant insert` policies present; NO update/delete
- [x] `submitted_by = auth.uid()` enforced in the insert WITH CHECK
- [x] `RESEND_API_KEY` + `RESEND_FROM` declared optional in `env.ts` with
      explanatory comments matching the `OPENAI_API_KEY` style
- [x] `sendResendEmail` never throws (transport errors caught and reduced
      to `{ ok: false, reason: 'http_error', message }`)
- [x] `submitFeedbackAction` does NOT pass `organization_id` from the client;
      the trigger fills it
- [x] Resend call wrapped in `try/catch` — failure logs Sentry warning + still
      returns `{ ok: true }`
- [x] FAB mounted only inside `(app)` layout — does NOT render on
      `(auth)`/`(public)` routes
- [x] Char counter, error display, success auto-close all wired
- [x] `pnpm typecheck` passes
- [x] `pnpm lint` produces only one pre-existing error (in `cv-review-panel.tsx`,
      not in any file authored by this task)
- [x] `git diff main..HEAD --stat package.json pnpm-lock.yaml` shows zero
      changes — no new dependencies added
- [x] Two atomic commits on the branch: `a9e105b`, `e06f9c8`

## Self-Check: PASSED

**Files claimed created (verified on disk):**
- `supabase/migrations/20260524000000_feedback.sql` — FOUND
- `src/lib/email/resend.ts` — FOUND
- `src/app/(app)/_actions/submit-feedback.ts` — FOUND
- `src/components/app/floating-feedback-button.tsx` — FOUND

**Files claimed modified (verified on disk via git diff HEAD~2):**
- `src/lib/env.ts` — modified
- `src/types/database.ts` — modified
- `src/app/(app)/layout.tsx` — modified

**Commits claimed (verified via git log):**
- `a9e105b feat(260524-b6v): feedback table + server action + Resend email` — FOUND
- `e06f9c8 feat(260524-b6v): floating feedback button + layout mount` — FOUND
