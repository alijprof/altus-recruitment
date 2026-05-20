# Deferred Items — Phase 3

Issues discovered during Plan 03-06 execution that are out of scope for this plan.

## Pre-existing lint error
- File: `src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx:62:7`
- Rule: react-hooks/set-state-in-effect (from Plan 03-03 shortlist work)
- Description: "Calling setState synchronously within an effect can trigger cascading renders"
- Action: defer to a maintenance pass — not introduced by Plan 03-06 and not
  blocking the source-attribution feature.
