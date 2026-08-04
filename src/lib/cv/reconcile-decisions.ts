// Pure decision logic for the stuck-pending sweep in
// src/lib/inngest/functions/reconcile-cv-parses.ts. No imports beyond types
// — this file must stay trivially unit-testable with zero mocking.
//
// Rationale (SF-4 + SF-5, 2026-07-31 Steele Charles feature review): the
// age window IS the re-enqueue cap. With a 15-min sweep cadence and a
// 15-to-45-min requeue window, a row can be re-enqueued at most twice
// before it flips to 'fail-stuck' — so no attempt-counter column is
// needed. This means the reconciler works correctly even before the
// `parse_error_detail` migration (20260804120000) reaches production.

/** Grace window after which a 'pending' row is eligible for reconciliation. */
export const STUCK_PENDING_GRACE_MS = 15 * 60_000

/** Age past which a still-pending row with a Storage object gives up. */
export const STUCK_PENDING_REQUEUE_LIMIT_MS = 45 * 60_000

export type StuckPendingAction = 'skip' | 'requeue' | 'fail-no-file' | 'fail-stuck'

export type DecideStuckPendingArgs = {
  /** Milliseconds since the candidate_cvs row was created. */
  ageMs: number
  /** Whether the Storage object at the row's storage_path exists. */
  hasStorageObject: boolean
}

/**
 * Decide what the reconciler should do with a `pending` candidate_cvs row.
 *
 * Boundary rules (asserted in the unit tests):
 *   - The grace threshold is INCLUSIVE of its boundary — `ageMs >= 15 min`
 *     leaves the grace window (exactly 15 min behaves as "past grace").
 *   - The requeue budget is EXCLUSIVE at its top — `ageMs >= 45 min` is
 *     'fail-stuck' (exactly 45 min behaves as "budget exhausted").
 */
export function decideStuckPendingAction(args: DecideStuckPendingArgs): StuckPendingAction {
  const { ageMs, hasStorageObject } = args

  // Still inside the grace window — the client PUT to Storage, or the
  // Inngest cold-start, may still be in flight. Never act yet, regardless
  // of whether the Storage object is visible.
  if (ageMs < STUCK_PENDING_GRACE_MS) return 'skip'

  // Past grace with no Storage object: the upload itself never completed.
  // Retrying the parse can't help — there's nothing to parse.
  if (!hasStorageObject) return 'fail-no-file'

  // Past grace, object present, and the requeue budget is exhausted: two
  // re-enqueues (at the 15-min sweep cadence) have already been attempted.
  if (ageMs >= STUCK_PENDING_REQUEUE_LIMIT_MS) return 'fail-stuck'

  // Past grace, object present, budget remains: re-enqueue the parse.
  return 'requeue'
}
