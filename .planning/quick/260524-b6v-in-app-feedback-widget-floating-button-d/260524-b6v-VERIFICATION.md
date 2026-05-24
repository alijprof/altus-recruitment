---
phase: 260524-b6v-in-app-feedback-widget-floating-button-d
verified: 2026-05-24T00:00:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Sign in and visit /dashboard, /candidates, /jobs, /clients, /pipeline, /settings — confirm the round FAB with MessageSquarePlus icon appears bottom-right on every page"
    expected: "Floating button visible bottom-right on every authenticated page, not clipped, above other content (z-50)"
    why_human: "Visual placement and rendering — cannot verify pixel position via grep"
  - test: "Open /sign-in, /sign-up, /apply/{any-token}, /auth/auth-code-error in an authed AND an unauthed browser session"
    expected: "Floating button does NOT appear on any of these routes (different layout groups)"
    why_human: "Confirms route-group isolation visually; grep proves mount point but not actual rendered DOM"
  - test: "Click FAB → leave textarea empty → click Send"
    expected: "Inline error 'Please enter some feedback' shown with role='alert'; no DB row written; no network request"
    why_human: "Verifies client-side guard + accessibility role render"
  - test: "Click FAB → type a 1-char message → Send → verify success state then auto-close"
    expected: "Submit button shows 'Sending…' briefly, dialog swaps to 'Thanks — sent.' for ~1.5s, then auto-closes; dialog reopens cleanly on next click"
    why_human: "Confirms success state UX timing and reset behavior"
  - test: "After above submission, query `select id, body, page_url, user_agent, organization_id, submitted_by from public.feedback order by created_at desc limit 1;` in Supabase Studio as the same authed user"
    expected: "Row exists with correct body, page_url matching the path the user was on, populated user_agent, organization_id matching the user's org, submitted_by = user.id"
    why_human: "Live DB inspection — verifier cannot query the linked Supabase project"
  - test: "Sign in as user in Org A, submit feedback. Then sign in as user in Org B; run `select * from public.feedback` from Org B session"
    expected: "Org B session sees zero rows from Org A (RLS isolation)"
    why_human: "Multi-tenant RLS verification requires two real auth sessions and a live DB"
  - test: "With RESEND_API_KEY unset in dev: submit feedback"
    expected: "Dialog still shows success; DB row written; no Sentry error captured (no_api_key is silenced)"
    why_human: "Behavioral verification of fail-open path requires running the dev server"
  - test: "With RESEND_API_KEY set + verified sending domain: submit feedback"
    expected: "Email lands at alasdairj8@gmail.com with subject 'Altus feedback — <org name>' and plaintext body listing user full_name, email, page_url, then separator, then verbatim body text"
    why_human: "Outbound email delivery + content verification needs real Resend account + mailbox check"
  - test: "Paste 2001-char body into textarea (bypass maxLength via JS if needed) and submit"
    expected: "Server-side Zod rejects with 'Max 2000 characters' (and DB CHECK constraint enforces defence in depth); no DB row written"
    why_human: "Verifies server-side validation + DB CHECK; textarea maxLength prevents this via UI but server must reject too"
---

# Quick 260524-b6v: In-app Feedback Widget Verification Report

**Phase Goal:** Add in-app feedback widget. Floating Feedback button (MessageSquarePlus icon) bottom-right on authenticated pages; Dialog with required Textarea (max 2000 chars); auto-captures page_url + user_agent; server action writes row to public.feedback with RLS multi-tenant; sends Resend email to alasdairj8@gmail.com (best-effort with graceful degradation if RESEND_API_KEY missing); no new npm dependencies.

**Verified:** 2026-05-24
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                              | Status     | Evidence                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Authenticated user sees a floating Feedback button (bottom-right) on every page under (app)/                                       | ✓ VERIFIED | `src/app/(app)/layout.tsx:39` renders `<FloatingFeedbackButton />` inside the `(app)` group's wrapper div; component sets `className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"` (`floating-feedback-button.tsx:92`) |
| 2   | Clicking the button opens a dialog with a required Textarea (max 2000 chars) and Submit button                                     | ✓ VERIFIED | `floating-feedback-button.tsx:87` `<DialogTrigger asChild><Button …>` wraps `MessageSquarePlus`; `Textarea` has `maxLength={MAX_BODY_LENGTH}` (=2000) and `required` (lines 113-114); Submit button at line 133                          |
| 3   | Submitting writes a row to public.feedback containing body, page_url, user_agent, organization_id, submitted_by                    | ✓ VERIFIED | `submit-feedback.ts:74-81` builds payload with `submitted_by: user.id`, `body`, `page_url`, `user_agent`, then `supabase.from('feedback').insert(payload)`. `organization_id` auto-filled by `feedback_set_org` trigger (migration L43-45) |
| 4   | RLS prevents users from reading other organisations' feedback rows                                                                 | ✓ VERIFIED | Migration L28: `enable row level security`. L30-32: `"tenant select" using (organization_id = public.current_organization_id())`. Insert policy L34-39 additionally enforces `submitted_by = auth.uid()`                                  |
| 5   | On success the dialog shows a success state and auto-closes after ~1.5s                                                            | ✓ VERIFIED | `floating-feedback-button.tsx:63-66`: `setStatus({ kind: 'success' })` then `window.setTimeout(reset, AUTO_CLOSE_MS)` with `AUTO_CLOSE_MS = 1500`; L104-105 renders "Thanks — sent." when `status.kind === 'success'`                    |
| 6   | When RESEND_API_KEY is set, an email is sent to alasdairj8@gmail.com containing user name + email + page_url + body + org name      | ✓ VERIFIED | `submit-feedback.ts:108-122`: plaintext body assembles `From`, `Org`, `Page`, separator, `body`; subject `Altus feedback — ${orgName}`; recipient = `FEEDBACK_RECIPIENT` constant = `'alasdairj8@gmail.com'` (L22)                       |
| 7   | When RESEND_API_KEY is missing or the Resend call fails, the DB row is still written and the user sees success                     | ✓ VERIFIED | `resend.ts:32-35` returns `{ ok: false, reason: 'no_api_key' }` without throwing. `submit-feedback.ts:91-137` wraps email in `try/catch`; HTTP failures only `Sentry.captureMessage` warning; action returns `{ ok: true }` at L139    |
| 8   | Unauthenticated routes (/sign-in, /sign-up, /apply/*, etc.) do NOT render the button                                                | ✓ VERIFIED | `grep -rn FloatingFeedbackButton src/` shows mounts ONLY in `src/app/(app)/layout.tsx`. `(auth)/layout.tsx` and `(public)/layout.tsx` do not import it; root `src/app/layout.tsx` does not import it                                     |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact                                              | Expected                                                    | Status     | Details                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260524000000_feedback.sql`     | feedback table + RLS policies + _set_org trigger            | ✓ VERIFIED | 46 lines. Table, index, RLS enable, 2 policies, trigger all present. Comment header explains pattern. CHECK constraint enforces 1-2000 chars |
| `src/lib/email/resend.ts`                             | Resend REST helper (fetch-based; no SDK)                    | ✓ VERIFIED | 83 lines. Exports `sendResendEmail`. Uses `fetch` to `https://api.resend.com/emails`. Never throws (try/catch on fetch). Returns discriminated union |
| `src/app/(app)/_actions/submit-feedback.ts`           | Server action: validate body, insert row, fire-and-forget email | ✓ VERIFIED | 141 lines. `'use server'`. Exports `submitFeedbackAction`. Zod validates (1-2000). Insert via Supabase server client. Resend in try/catch returning ok:true on email fail |
| `src/components/app/floating-feedback-button.tsx`     | Client component: fixed FAB + Dialog + Textarea + Submit    | ✓ VERIFIED | 142 lines. `'use client'`. Exports `FloatingFeedbackButton`. Discriminated-union Status state. Char counter, error display with role="alert", success state |
| `src/app/(app)/layout.tsx`                            | Authenticated layout now mounts <FloatingFeedbackButton />  | ✓ VERIFIED | Line 3 imports, line 39 renders after `</main>` inside the `flex min-h-svh flex-col` wrapper             |
| `src/lib/env.ts`                                      | Adds RESEND_API_KEY + RESEND_FROM (both optional)           | ✓ VERIFIED | Lines 100-109. Both optional. Comment block matches OPENAI_API_KEY style with production guidance       |
| `src/types/database.ts`                               | Regenerated to include feedback Row/Insert/Update           | ✓ VERIFIED | Lines 699-742. Row + Insert + Update + Relationships (FK to organizations and users) — generated by supabase CLI (commit 3eedd96 reduced file by 29 lines vs hand-patched stub) |

### Key Link Verification

| From                                                | To                                                          | Via                                       | Status | Details                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `src/components/app/floating-feedback-button.tsx`   | `src/app/(app)/_actions/submit-feedback.ts`                 | `submitFeedbackAction` import + submit handler | ✓ WIRED | L15 import; L57 invocation with `{ body, page_url, user_agent }` from `window.location` + `navigator.userAgent` |
| `src/app/(app)/_actions/submit-feedback.ts`         | `public.feedback` (DB)                                      | Supabase server client `.from('feedback').insert(...)` | ✓ WIRED | L81 `supabase.from('feedback').insert(payload)`; error captured at L83; DB types confirm 'feedback' is a valid table name |
| `src/app/(app)/_actions/submit-feedback.ts`         | `src/lib/email/resend.ts`                                   | `sendResendEmail` import (try/catch wrapped) | ✓ WIRED | L17 import; L118 invocation inside `try { … } catch (emailErr) { Sentry.captureException(…) }` block; failure does NOT change return value |
| `src/app/(app)/layout.tsx`                          | `src/components/app/floating-feedback-button.tsx`           | `<FloatingFeedbackButton />` after `</main>`, inside (app) wrapper | ✓ WIRED | L3 import, L39 render after `</main>` and inside the outer `<div className="flex min-h-svh flex-col">` |

### Data-Flow Trace (Level 4)

| Artifact                                          | Data Variable | Source                                                                  | Produces Real Data | Status     |
| ------------------------------------------------- | ------------- | ----------------------------------------------------------------------- | ------------------ | ---------- |
| `floating-feedback-button.tsx`                    | `body` (state) | User input via Textarea `onChange` (line 116)                          | Yes — user types  | ✓ FLOWING  |
| `submit-feedback.ts` insert payload               | payload      | Built from parsed Zod input + `auth.getUser().user.id`                  | Yes — real user + real input | ✓ FLOWING |
| `submit-feedback.ts` email body                   | text         | Built from `profileData.full_name/email`, `parsed.data.page_url`, parsed body | Yes — populated from real profile + form | ✓ FLOWING |
| `public.feedback.organization_id`                 | column       | `feedback_set_org` trigger → `public.set_organization_id()` → `public.current_organization_id()` from auth context | Yes — server-derived | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                                                                | Command                                                                                 | Result                                                                                   | Status |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| TypeScript compiles                                                     | `pnpm typecheck` (`tsc --noEmit`)                                                       | Exit 0, no output                                                                        | ✓ PASS |
| No new npm dependencies added                                           | `git diff a9e105b^..HEAD --stat -- package.json pnpm-lock.yaml`                         | Empty output — neither file changed                                                      | ✓ PASS |
| Migration applied + types regenerated from live DB                      | inspect commit `3eedd96` + `grep -n feedback src/types/database.ts`                     | Commit reduced file by 29 lines (replaced hand-patched stub with canonical regen); FK Relationships block (L727-741) is regen-only output | ✓ PASS |
| Feedback table type has correct shape                                   | `grep -n feedback src/types/database.ts` then read L699-742                             | Row/Insert/Update present with `body string`, `organization_id string`, `submitted_by string`, nullable `page_url` and `user_agent` | ✓ PASS |
| FAB component is a Client Component                                     | head of `floating-feedback-button.tsx`                                                  | Line 1 `'use client'`                                                                    | ✓ PASS |
| FAB uses MessageSquarePlus icon                                         | grep                                                                                     | L13 `import { MessageSquarePlus } from 'lucide-react'`; L94 `<MessageSquarePlus …/>`     | ✓ PASS |
| FAB is positioned fixed bottom-right                                    | grep                                                                                     | L92 `className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"`           | ✓ PASS |

### Probe Execution

No phase-declared probes; no `scripts/*/tests/probe-*.sh` exist in the repo. Skipping.

### Requirements Coverage

| Requirement      | Source Plan | Description                                           | Status     | Evidence                                                                 |
| ---------------- | ----------- | ----------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| QF-260524-b6v-01 | 260524-b6v  | (declared in PLAN frontmatter; no separate REQS file for quick tasks) | ✓ SATISFIED | All artifacts + truths above |
| QF-260524-b6v-02 | 260524-b6v  | (declared in PLAN frontmatter; no separate REQS file for quick tasks) | ✓ SATISFIED | All artifacts + truths above |

### Anti-Patterns Found

| File                                                | Line | Pattern                | Severity | Impact                                                          |
| --------------------------------------------------- | ---- | ---------------------- | -------- | --------------------------------------------------------------- |
| (none in files modified by this task)               | —    | No TBD/FIXME/XXX/TODO  | —        | Clean — verified by grep across all 6 modified/created source files |

Pre-existing lint warning in `cv-review-panel.tsx` (line 98) noted in SUMMARY deviation #2 is outside the scope of this task and unrelated to feedback functionality.

### Human Verification Required

See YAML frontmatter `human_verification:` block — 9 items covering visual rendering, route-group isolation, multi-tenant RLS isolation, dialog state-machine transitions, server-side Zod enforcement, and live Resend email delivery.

### Gaps Summary

No gaps. All 8 observable truths are supported by working code, all artifacts exist and are substantive, all key links are wired with real data flow, the migration is applied to the linked DB (per regen evidence), and no new dependencies were introduced. The remaining work is purely human verification: visual confirmation of the FAB across authenticated pages, route-group negative tests, live DB inspection of inserted rows, multi-tenant RLS isolation tests, and Resend email delivery with both KEY-set and KEY-missing configurations.

---

_Verified: 2026-05-24_
_Verifier: Claude (gsd-verifier)_
