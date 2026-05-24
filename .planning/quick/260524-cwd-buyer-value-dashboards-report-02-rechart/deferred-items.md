# Deferred items — quick task 260524-cwd

Out-of-scope issues discovered during execution. Not fixed; surfaced here per the deviation-rule scope boundary.

## Pre-existing lint error (unrelated to this plan)

- **File:** `src/app/(app)/candidates/[id]/cv-review-panel.tsx`
- **Line:** 98:31
- **Rule:** `Error: Cannot call impure function during render`
- **Last touched by:** `57b171e feat(03): full_name upgrade + auto-refresh CV review panel while parsing`
- **Why deferred:** Touches a file outside this plan's scope. Surfaced for a future Phase 3 hygiene pass.
- **Confirmed not introduced by this plan:** `git log --oneline -1` on the file shows the change predates 260524-cwd.

Running `pnpm lint` exits non-zero because of this single pre-existing error. The new chart wrappers, RPCs, db helpers, and page introduced by this plan add **zero** new lint errors.
