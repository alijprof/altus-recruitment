# Code & UI Review — 260524-b6v feedback widget

**Reviewed:** 2026-05-24
**Reviewer:** Opus (autonomous code+UI review pre-UAT)
**Verdict:** PASS-WITH-NITS

Scope reviewed:
- `supabase/migrations/20260524000000_feedback.sql`
- `src/lib/email/resend.ts`
- `src/lib/env.ts` (Resend additions, lines 100-109)
- `src/app/(app)/_actions/submit-feedback.ts`
- `src/components/app/floating-feedback-button.tsx`
- `src/app/(app)/layout.tsx` (mount at line 39)
- `src/types/database.ts` (feedback Row/Insert/Update at lines 699-743)

Cross-references verified: `set_organization_id()` (20260517204504), `spec_drafts` pattern (20260520003437), `getProfile` (src/lib/db/profiles.ts), `dialog.tsx` (Radix-based, focus trap + Escape built in), `top-nav.tsx` (mobile drawer, no fixed bottom nav so no z-index clash).

---

## Blockers (must fix before UAT)

**None.** The implementation is functionally correct and security boundaries are intact: RLS WITH CHECK on insert binds `organization_id = current_organization_id()` and `submitted_by = auth.uid()`; the `_set_org` BEFORE-INSERT trigger fires before the WITH CHECK predicate is evaluated, so the trigger-filled `organization_id` is the value RLS sees; Sentry payloads carry no feedback body or PII; Resend failures degrade gracefully and the DB row remains canonical.

UAT can begin once the high-priority items below are decided on (most are 30-second fixes, two require a product call).

---

## High-priority issues (should fix before customer-facing demo)

### H-1 — `page_url` captures `window.location.search`, which can leak sensitive query params

**File:** `src/components/app/floating-feedback-button.tsx:59`
**What's wrong:** `page_url: window.location.pathname + window.location.search` writes the full search string into `public.feedback.page_url` AND into the outbound Resend email. Several routes in this codebase put recoverable state in query params — search terms (`/candidates?q=...`), filter selections, and (more concerning) one-time tokens for auth flows if the user happens to be on a route that carries one. The Resend email also goes to a personal Gmail inbox, so anything in `?q=...` becomes a permanent record in a non-tenant-owned mailbox.
**Why it matters:** A user reporting a bug while on `/candidates?q=John%20Smith%20%2B447...` will silently send a candidate's name + phone number to Resend and to the dev's Gmail. That's an audit-trail problem at minimum and a PII leak at worst (CLAUDE.md: "Never log CV text, candidate names, or any PII").
**Suggested fix:** Strip the search string, or whitelist innocuous params:
```ts
page_url: window.location.pathname  // drop ?search entirely
```
If the search is useful for debugging, redact:
```ts
const search = window.location.search ? '?[redacted]' : ''
page_url: window.location.pathname + search
```

### H-2 — `RESEND_FROM` default `feedback@updates.altus.app` is almost certainly an unverified domain; first prod email will 422 and the customer-facing demo will silently lack the bonus email

**File:** `src/lib/email/resend.ts:16`
**What's wrong:** SUMMARY.md flags this as a known follow-up but it's not gated anywhere. If the user demos to a customer before verifying the domain in Resend, every feedback submission will quietly fail (with a Sentry warning the user may not see). The user will tell the customer "feedback emails arrive in our inbox" and the customer will see nothing.
**Why it matters:** This is the exact failure mode the user will find embarrassing in front of a customer.
**Suggested fix:** Before UAT, the user should (a) verify the domain in Resend or (b) set `RESEND_FROM` to an already-verified Resend test address. No code change needed — just a UAT-day reminder. If you want a code-side guard, log a `Sentry.captureMessage('resend_send_failed', { level: 'warning', extra: { hint: 'unverified domain?' }})` differentiating 422 from other statuses.

### H-3 — Form has `noValidate` AND `required` on the textarea — the `required` does nothing

**File:** `src/components/app/floating-feedback-button.tsx:107, 114`
**What's wrong:** `<form ... noValidate>` disables HTML5 validation, which means the `required` attribute on the Textarea will never trigger a native browser bubble. The custom JS check `if (body.trim() === '')` does the same job. The inconsistency is cosmetic but it makes the code lie about its own validation strategy.
**Why it matters:** Future maintainer reads `required` and assumes browser-native validation is in play, then removes the JS guard. Same outcome as the (already-handled) bug.
**Suggested fix:** Drop the `required` attribute from the Textarea (the JS guard is the canonical one and matches the discriminated-union pattern in `sign-in-form.tsx`). Or drop `noValidate` and let the browser do it — but then you need to remove the JS guard. Either way, pick one.

---

## Medium-priority issues / nice-to-haves

### M-1 — Cancel-during-submit causes harmless but visible state churn after the in-flight action resolves

**File:** `src/components/app/floating-feedback-button.tsx:43-74`
**What's wrong:** User clicks Send → state goes `submitting` → user clicks Cancel before the server action resolves → `reset()` fires (`open=false`, `body=''`, `status=idle`). The awaited `submitFeedbackAction(...)` then resolves and the `if (result.ok)` branch runs `setStatus({ kind: 'success' })` and schedules `setTimeout(reset, 1500)`. The dialog is already closed, so the user sees nothing, but state briefly transitions `idle → success → idle`. If the result was an error, the error message gets injected into a closed dialog — when the user re-opens the dialog they will see the stale error (`status.kind === 'error'`).
**Why it matters:** Reproducible regression after Cancel: open dialog → see the previous attempt's error. Not catastrophic but unprofessional.
**Suggested fix:** Track an `AbortController` or a cancellation token; OR check `status.kind` before applying the result:
```ts
const result = await submitFeedbackAction(...)
// If the user cancelled while we were awaiting, drop the result.
setStatus((prev) => prev.kind === 'submitting' ? (result.ok ? { kind: 'success' } : {...}) : prev)
```
The `reset` on close already sets `status` to `idle`, so the cleanest fix is to make every state setter inside `onSubmit` after the await conditional on `prev.kind === 'submitting'`.

### M-2 — Char counter does not warn as the user approaches 2000

**File:** `src/components/app/floating-feedback-button.tsx:120-122`
**What's wrong:** `{body.length} / 2000` stays muted-foreground all the way to 2000. The browser hard-stops typing at 2000 via `maxLength`, so the user types, types, types, then suddenly can't type anymore with no warning.
**Why it matters:** UAT will notice this. It's a five-second fix.
**Suggested fix:**
```tsx
<p className={cn(
  'text-xs',
  body.length >= 1800 ? 'text-destructive' : 'text-muted-foreground'
)}>
  {body.length} / {MAX_BODY_LENGTH}
</p>
```

### M-3 — `organizations` fetch error inside the email-enrichment block is silently swallowed

**File:** `src/app/(app)/_actions/submit-feedback.ts:94-100`
**What's wrong:** `.maybeSingle()` returns `{ data, error }`. Only `data` is destructured. If the query errors (it shouldn't under normal RLS — same-tenant select — but could under transient DB issues), `orgName` becomes `null` and the email goes out with `Org: (unknown)`. The error never reaches Sentry.
**Why it matters:** Low severity — the row is already inserted, the email is best-effort, and the surrounding `try/catch` would catch a thrown error. Still, the disposition of "swallow and ship a degraded email" deserves a Sentry breadcrumb.
**Suggested fix:**
```ts
const { data: org, error: orgErr } = await supabase.from('organizations')...
if (orgErr) {
  Sentry.captureException(orgErr, { tags: { feature: 'feedback', step: 'org_lookup' } })
}
orgName = org?.name ?? null
```

### M-4 — Resend response `message` could contain echoed user input in adversarial cases; the Sentry payload may then leak fragments

**File:** `src/app/(app)/_actions/submit-feedback.ts:124-131` and `src/lib/email/resend.ts:64-72`
**What's wrong:** `message: result.message` is captured into Sentry's `extra` block. `result.message` is `res.text().slice(0, 500)` from Resend's response. Resend error messages typically describe the rejection reason ("domain not verified", "invalid `to` address") — not user input. BUT if a future Resend API change echoes back, say, the subject line (which contains `orgName`, user-controlled at org-creation time), Sentry receives org-name fragments. Org name is not PII per se, but CLAUDE.md is broad — "any PII".
**Why it matters:** Borderline. Today's Resend behaviour is fine; this is a defensive note in case API responses change.
**Suggested fix:** Either don't pass `message` at all (status code is enough to diagnose) or whitelist statuses you care about:
```ts
extra: { status: result.status }  // drop message
```

### M-5 — `submitted_by` and `organization_id` columns lack their own indexes; `feedback_org_created_at_idx` covers org but not per-user lookups

**File:** `supabase/migrations/20260524000000_feedback.sql:25-26`
**What's wrong:** The only index is `(organization_id, created_at desc)`. A future "feedback by this user" query (e.g., admin tooling) will table-scan. Not a problem today at anchor scale (a 2-3 person agency, maybe 100 rows in 6 months) but worth a note.
**Why it matters:** Trivial today; not a blocker. Out of scope for v1 per the CLAUDE.md performance carve-out anyway.
**Suggested fix:** Defer until a UI needs it.

### M-6 — `text-destructive text-sm` ordering on the error `<p>` doesn't match the codebase's typical Tailwind ordering

**File:** `src/components/app/floating-feedback-button.tsx:125`
**What's wrong:** Pure style nit — `prettier-plugin-tailwindcss` should have sorted this. Likely already canonical; flagging because Prettier may want `text-sm text-destructive` order.
**Why it matters:** It doesn't. Just verify `pnpm lint` is clean on this file (SUMMARY.md says it is).
**Suggested fix:** None unless lint complains.

---

## UI/UX observations

### UX-1 — FAB has `shadow-lg` but no hover/focus elevation cue
A first-time user will see the floating button and recognise it as interactive (the icon and circular shape help). On focus-visible there's no extra ring — Button's default variant ring should kick in, but on a fixed FAB over arbitrary content the focus ring can blend in. Acceptable for v1; nice-to-have to add `focus-visible:ring-2 focus-visible:ring-offset-2` on the FAB specifically.

### UX-2 — FAB persists on every authenticated page including `/candidates/[id]` detail pages with mobile bottom whitespace
At `bottom-4 right-4` (16px from each edge) on a phone, the FAB sits in the thumb zone. On `/candidates/[id]` detail or `/pipeline` (kanban) where the user is scrolling/dragging, accidental taps are possible. Anchor uses this on desktop primarily — not a blocker, but worth a "is the bottom-right placement right for mobile?" call. Could move to `bottom-6 right-6` or use safe-area-inset on iOS.

### UX-3 — Success state ("Thanks — sent.") auto-closes after 1.5s with no way to dismiss faster
First-time user might want to immediately submit a second piece of feedback. They have to wait the 1.5s for auto-close, then click the FAB again. Minor. Add `<DialogClose>` or let the success state itself be clickable to close.

### UX-4 — No way to know whether the feedback was actually saved vs the Resend email failed
The success state says "Thanks — sent." which is accurate for the DB row, but the user (the dev themselves, in UAT) may genuinely want to know whether the email landed. Suggest a one-line note in the dialog like "We've logged this — you may not see an email immediately if we're still verifying our sending domain." Or just check the Resend dashboard during UAT.

### UX-5 — Focus management on dialog close: Radix returns focus to the trigger (the FAB)
Verified — Radix Dialog handles focus trap, focus restoration to trigger, and Escape-to-close out of the box (`src/components/ui/dialog.tsx`). All a11y boxes from focus #6 are checked by the underlying primitive. Good.

### UX-6 — Char counter starts at "0 / 2000" before the user types
Visually noisy when the textarea is empty. Common pattern is to hide the counter until the user types or until they cross some threshold. Trivial. Leave as-is for v1 unless it irritates UAT.

### UX-7 — Cancel button position: shadcn `DialogFooter` is `flex-col-reverse` on mobile, `flex-row sm:justify-end` on desktop
On mobile the Send button stacks above Cancel, which is fine. On desktop they're right-aligned with Cancel left of Send (per shadcn convention). Matches expectations.

### UX-8 — No "Send anyway" path if user enters whitespace-only — the error message is correct but the button is also disabled because of `body.trim().length === 0`
User enters spaces, sees Send is disabled, then clicks Send (which they can't because it's disabled), then has to figure out they need to type real characters. The empty-body error path inside `onSubmit` is dead code because `submitDisabled` already gates this. Not a bug — defence in depth — but a comment would help maintainers.

---

## Things that look right

- **RLS multi-tenancy is airtight.** The INSERT WITH CHECK clause binds both `organization_id = public.current_organization_id()` AND `submitted_by = auth.uid()` (migration line 36-39). Cannot impersonate another user in same org. Cannot insert into another org. Confirmed against the `spec_drafts` pattern.
- **Trigger ordering is correct.** `feedback_set_org` is a BEFORE INSERT trigger; Postgres semantics fire the trigger before the WITH CHECK clause is evaluated, so `organization_id` is populated when RLS validates. Verified via `20260517204504_harden_set_organization_id.sql` (the function sets `NEW.organization_id := public.current_organization_id()` when null).
- **Append-only by design.** No UPDATE or DELETE policies — even an admin in the same org cannot tamper with prior feedback. This is correct for an audit/feedback channel.
- **Sentry PII guard observed.** `submit-feedback.ts:85` passes only `insertErr` plus a static `{ feature: 'feedback' }` tag — no `body`, no email, no user-agent. Resend failure logger (line 126-130) passes only `status` and `message` (the Resend response body, NOT user input). Compliant with CLAUDE.md.
- **Email is plaintext-only.** `sendResendEmail({ ..., text })` — no `html` field — so user-controlled `body`, `page_url`, `user_agent`, `fullName`, `email`, `orgName` cannot become HTML. The plaintext newlines in the body could in principle contain content that looks like email headers if interpreted by a downstream parser, but `text` is the email body (not headers) and Resend's API will not interpret it as headers. Verified.
- **`from` and `to` headers are NOT user-controllable.** `to` is hard-coded `'alasdairj8@gmail.com'`. `from` is the env default. User input never reaches header fields → no header injection.
- **`sendResendEmail` never throws.** Transport errors caught and translated to `{ ok: false, reason: 'http_error', message }`. The action's surrounding `try/catch` is genuine defence-in-depth, not a redundant guard.
- **Auth boundary returns cleanly on `user === null`.** Returns `{ ok: false, formError: 'Not signed in' }` — no server state leakage, no stack trace exposure.
- **`organization_id` is NOT passed from the client.** Server action sends only `submitted_by`, `body`, `page_url`, `user_agent`. Trigger fills the rest. Even if the client tried to spoof an org id, RLS WITH CHECK would reject it.
- **Double-click protection.** Submit button is `disabled={status.kind === 'submitting' || status.kind === 'success' || body.trim().length === 0}` — cannot fire the action twice.
- **TypeScript discipline.** Single `as unknown as TablesInsert<'feedback'>` cast on line 79, properly preceded by a `// reason:` comment on lines 70-73 explaining the trigger-fills-organization_id pattern. CLAUDE.md compliant. No bare `any`.
- **No emojis in source.** Checked all three new files plus the migration; only the em-dash in "Thanks — sent." which is correct typography, not an emoji.
- **No `console.log` / `debugger` artifacts.** Grep confirms clean.
- **Dialog accessibility.** `htmlFor="feedback-body"` correctly associates the Label with the Textarea. Error message has `role="alert"`. Radix handles focus trap, focus restoration to trigger, and Escape-to-close.
- **FAB does not clash with mobile UI.** The mobile nav is a hamburger drawer triggered from `top-nav.tsx` (not a fixed bottom bar). Bottom-right at `bottom-4 right-4 z-50` has no competing element.
- **Mount scope is correct.** `<FloatingFeedbackButton />` is in `src/app/(app)/layout.tsx` only — does not appear on `(auth)` (sign-in/sign-up) or `(public)` (apply) routes. Verified by reading the layout files.
- **Database types are correctly hand-patched.** `feedback: { Row, Insert, Update, Relationships }` at lines 699-743 of `src/types/database.ts` matches the migration schema exactly. `organization_id: string` (non-null) on Insert reflects the FK; the action's `as unknown as` cast is the documented workaround for trigger-filled columns.
- **DB CHECK constraint duplicates the Zod cap** (`length(body) between 1 and 2000`) — defence in depth against direct-SQL inserts.
- **`pnpm typecheck` + `pnpm lint` pass** per SUMMARY.md (one pre-existing lint error in `cv-review-panel.tsx` documented out of scope).

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (Opus 4.7)_
_Depth: deep (pre-UAT gate)_
