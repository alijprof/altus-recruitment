// Shared client-side confirmations for pipeline actions that can silently
// destroy a placement (audit min-24 + batch4 review).
//
// A placement is modelled purely as stage='placed', and EVERY revenue surface
// keys on that stage — the dashboard "placements this month" KPI and all
// acquirer-facing buyer-value/source-attribution RPCs. So moving an application
// OUT of 'placed', or hard-deleting a placed application, drops the placement +
// its recorded fee from every report with no other signal. These are
// centralised so each move/remove surface shares ONE message + ONE rule and a
// newly-added surface can't silently omit the guard (the review found several
// surfaces the first pass missed).
//
// Browser-only: uses window.confirm; call from client event handlers only.

// Returns false when the user cancels an un-place; true otherwise (including
// when the move is not a leave-placed, so callers can guard unconditionally).
export function confirmLeavePlaced(
  fromStage: string,
  toStage: string,
  candidateName: string,
): boolean {
  if (fromStage !== 'placed' || toStage === 'placed') return true
  return window.confirm(
    `Move ${candidateName} out of Placed? This removes the placement and its fee from your revenue and dashboard reports. The placement stays in the activity history.`,
  )
}

// Confirms an application hard-delete. When the application is PLACED the delete
// is unrecoverable and destroys the recorded placement + fee, so the warning is
// explicit; otherwise it reassures that only the junction row is removed.
export function confirmRemoveApplication(
  stage: string,
  candidateName: string,
  jobLabel = 'this job',
): boolean {
  if (stage === 'placed') {
    return window.confirm(
      `Remove ${candidateName}'s PLACEMENT from ${jobLabel}? This permanently DELETES the application and its recorded placement + fee — it cannot be undone and removes it from your revenue reports. The candidate record stays.`,
    )
  }
  return window.confirm(
    `Remove ${candidateName} from ${jobLabel}? Their candidate record will remain — only the application is deleted.`,
  )
}
