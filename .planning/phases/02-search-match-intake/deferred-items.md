
## Plan 2 Task 2.1 — out-of-scope typecheck errors

`pnpm typecheck` reports errors in `src/app/(public)/apply/[orgSlug]/apply-form.tsx`
(Plan 3 territory; the directory is currently untracked in git — Plan 3 work-in-progress).
Errors are TFieldValues / Resolver inference issues in the apply form's `useForm` setup.

Out of scope for Plan 2 per the orchestrator's file-ownership rules — Plan 2 must NOT
touch `src/app/(public)/**`. Plan 3 owns the fix.

Verified Plan 2's own files typecheck cleanly:
  pnpm typecheck 2>&1 | grep -E "^src/" | grep -v "src/app/(public)/apply"
  → (no output)

## Plan 2 Task 2.3 — out-of-scope test failures

`pnpm test --run` reports 3 failures in `tests/unit/app/apply/rate-limit.test.ts`
(Plan 3 territory; the file is currently untracked in git — Plan 3 work-in-progress).

Out of scope for Plan 2 per the orchestrator's file-ownership rules — Plan 2 must NOT
touch `tests/unit/app/apply/**` or any apply-form code. Plan 3 owns the fix.

## Plan 2 Task 2.3 — sync-outlook-history lint warnings

`pnpm lint` reports 3 "Unused eslint-disable directive" warnings in
`src/lib/inngest/functions/sync-outlook-history.ts` (Plan 4 territory).

Out of scope for Plan 2. Plan 4 owns the fix.
