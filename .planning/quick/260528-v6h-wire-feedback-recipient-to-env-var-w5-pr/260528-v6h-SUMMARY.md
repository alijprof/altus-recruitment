---
phase: 260528-v6h-wire-feedback-recipient-to-env-var-w5-pr
plan: 01
subsystem: feedback-email
tags: [feedback, resend, env-config, w5-prep]
requires: []
provides:
  - env.RESEND_FEEDBACK_RECIPIENT (optional server env var)
  - submit-feedback fail-open guard when recipient unset
affects:
  - src/app/(app)/_actions/submit-feedback.ts
tech-stack:
  added: []
  patterns:
    - Optional email env var with Zod `z.string().email().optional()`
    - Fail-open Sentry warning (`resend_send_skipped` / `no_recipient_configured`) — DB row stays canonical
key-files:
  created: []
  modified:
    - src/lib/env.ts
    - src/app/(app)/_actions/submit-feedback.ts
decisions:
  - Recipient is now Vercel-env-configurable; no code commit needed to change it during W5 sending-domain swap
metrics:
  duration_minutes: 4
  completed_date: 2026-05-28
---

# Quick 260528-v6h: Wire feedback recipient to env var (W5 prep) Summary

Recipient address for the in-app feedback widget is now read from `env.RESEND_FEEDBACK_RECIPIENT` rather than the hardcoded `aj@altus-consultancy.com` constant, unblocking the W5 `RESEND_FROM → noreply@altusmove.com` switch without leaving the recipient stale.

## What Changed

### `src/lib/env.ts`
- Added `RESEND_FEEDBACK_RECIPIENT: z.string().email().optional()` to the server scope, immediately after `RESEND_FROM`.
- Server-only var — not added to `client:` or `experimental__runtimeEnv:`.
- Comment matches surrounding density: short, explains the fail-open contract.

### `src/app/(app)/_actions/submit-feedback.ts`
- Added `import { env } from '@/lib/env'` between `@/lib/db/profiles` and `@/lib/supabase/server` (per plan import-ordering directive).
- Removed the 11-line hardcoded-recipient comment block and the `const FEEDBACK_RECIPIENT = 'aj@altus-consultancy.com'` line.
- Refactored the email-send block inside the existing `try { … } catch { … }` to branch on `env.RESEND_FEEDBACK_RECIPIENT`:
  - **Unset:** `Sentry.captureMessage('resend_send_skipped', { level: 'warning', tags: { feature: 'feedback', step: 'resend' }, extra: { reason: 'no_recipient_configured' } })` and skip the outbound call. Control falls through to `return { ok: true }`. DB row remains canonical.
  - **Set:** call `sendResendEmail({ to: env.RESEND_FEEDBACK_RECIPIENT, subject, text })`. The existing `http_error → 'resend_send_failed' Sentry warning` branch is preserved unchanged.
- PII guard comments, Zod schema, profile lookup, DB insert path, and final `return { ok: true }` all untouched.

## Verification

### Autonomous gates
- `pnpm typecheck` — PASS (the new optional field exposes `env.RESEND_FEEDBACK_RECIPIENT: string | undefined`).
- `pnpm lint` — PASS for modified files. The repo has 1 pre-existing unrelated error in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` (last committed in 57b171e, untouched by this task) — see "Deferred Issues" below.

### Mechanical greps (from plan)
- `grep -n RESEND_FEEDBACK_RECIPIENT src/lib/env.ts` → 1 match (line 115). PASS.
- `grep -n "env.RESEND_FEEDBACK_RECIPIENT" "src/app/(app)/_actions/submit-feedback.ts"` → 2 matches (line 117 guard, line 128 `to:`). PASS.
- `grep -n "aj@altus-consultancy.com" "src/app/(app)/_actions/submit-feedback.ts"` → 0 matches. PASS.
- `grep -nE "FEEDBACK_RECIPIENT\s*=" "src/app/(app)/_actions/submit-feedback.ts"` → 0 matches. PASS.
- `grep -n "no_recipient_configured" "src/app/(app)/_actions/submit-feedback.ts"` → 1 match (line 124). PASS.

### Functional verification
Out of scope here per plan — local dev is unusable (Vercel Sensitive vars pull back as empty strings on `vercel env pull`). Verification happens post-deploy via `vercel:verification` browser-automation once the user sets `RESEND_FEEDBACK_RECIPIENT` in Vercel env vars and the deploy lands.

## Commits

- `16d6dbf` — feat(feedback): read recipient from RESEND_FEEDBACK_RECIPIENT env var

## Deviations from Plan

None. Plan executed exactly as written.

## Deferred Issues

- `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` — pre-existing lint error `Cannot call impure function during render`. Out of scope for this quick task (file not touched by this commit; error pre-dates the 2b7ffe6 base commit per the file's last touching commit 57b171e). Should be addressed in a dedicated cleanup pass.
- Other lint output is 17 `no-unused-vars` warnings in `tests/unit/**` test files — pre-existing, out of scope.

## Follow-up

The user must now:
1. Set `RESEND_FEEDBACK_RECIPIENT` in Vercel env vars (Production + Preview + Development scopes as appropriate) to the desired delivery address.
2. Land the matching `RESEND_FROM = noreply@altusmove.com` switch (W5 launch-blocker — separate change).
3. Trigger a redeploy (auto-trigger fires on this commit, but the env var must be in Vercel BEFORE the deploy lands or the first feedback submission after deploy will log a `no_recipient_configured` Sentry warning).

## Self-Check: PASSED

- File `src/lib/env.ts` exists, contains `RESEND_FEEDBACK_RECIPIENT`. VERIFIED.
- File `src/app/(app)/_actions/submit-feedback.ts` exists, contains `env.RESEND_FEEDBACK_RECIPIENT` (2x) + `no_recipient_configured` Sentry skip path, no hardcoded recipient. VERIFIED.
- Commit `16d6dbf` exists on branch `worktree-agent-ae0ecac54655d55b6`. VERIFIED.
