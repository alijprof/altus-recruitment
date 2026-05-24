# Deferred items — Quick 260524-b6v

Out-of-scope issues discovered while executing this task. NOT fixed here per
the executor's scope-boundary rule ("Only auto-fix issues DIRECTLY caused by
the current task's changes").

## Pre-existing lint error in src/app/(app)/candidates/[id]/cv-review-panel.tsx

- **Discovered:** Task 1 verification (`pnpm lint`)
- **Error:** `Cannot call impure function during render` on line 98:
  `const startedAtRef = useRef(Date.now())`
- **Status:** Pre-existing on the task base commit (`7916c2f`). Verified by
  stashing my changes and re-running `pnpm lint` — same error count.
- **Scope decision:** Not my task; not my files; cv-review-panel is a Phase 1
  Plan 3 artefact unrelated to the feedback widget. Logging here for a future
  hygiene pass.
- **Suggested fix:** Wrap in `useState(() => Date.now())[0]` or move into a
  `useEffect` ref-assign.

## Supabase CLI link unavailable in this worktree

- **Discovered:** Task 1 step 5 (`pnpm exec supabase db push --linked`)
- **Symptom:** `Cannot find project ref. Have you run supabase link?`
- **Cause:** The Supabase CLI link state lives in `supabase/.temp/project-ref`
  in the main repo and is not propagated into git worktrees (it's in
  `.gitignore`). Re-linking would require an access token.
- **Action taken (per constraint):** Migration file
  `supabase/migrations/20260524000000_feedback.sql` is committed and will
  apply on the next manual `pnpm exec supabase db push --linked` from the
  main repo. `src/types/database.ts` was hand-patched with the `feedback`
  Row/Insert/Update triplet so `pnpm typecheck` passes. The next session
  should run `pnpm db:types` to regenerate cleanly once the migration is
  applied to the linked project.
