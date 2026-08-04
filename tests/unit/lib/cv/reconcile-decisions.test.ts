/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  decideStuckPendingAction,
  STUCK_PENDING_GRACE_MS,
  STUCK_PENDING_REQUEUE_LIMIT_MS,
} from '@/lib/cv/reconcile-decisions'

const MIN = 60_000

describe('decideStuckPendingAction', () => {
  it('skips within the 15-min grace window (object present)', () => {
    expect(decideStuckPendingAction({ ageMs: 5 * MIN, hasStorageObject: true })).toBe('skip')
  })

  it('requeues once past grace with the storage object present (20 min)', () => {
    expect(decideStuckPendingAction({ ageMs: 20 * MIN, hasStorageObject: true })).toBe('requeue')
  })

  it('still requeues at 40 min with the storage object present', () => {
    expect(decideStuckPendingAction({ ageMs: 40 * MIN, hasStorageObject: true })).toBe('requeue')
  })

  it('fails as stuck once the requeue budget is exhausted (50 min, object present)', () => {
    expect(decideStuckPendingAction({ ageMs: 50 * MIN, hasStorageObject: true })).toBe('fail-stuck')
  })

  it('fails as no-file when the storage object is missing past grace (20 min)', () => {
    expect(decideStuckPendingAction({ ageMs: 20 * MIN, hasStorageObject: false })).toBe(
      'fail-no-file',
    )
  })

  it('skips within grace even when the storage object is absent (client PUT may still be in flight)', () => {
    expect(decideStuckPendingAction({ ageMs: 5 * MIN, hasStorageObject: false })).toBe('skip')
  })

  it('boundary: grace threshold is INCLUSIVE — exactly 15 min with object present requeues', () => {
    expect(
      decideStuckPendingAction({ ageMs: STUCK_PENDING_GRACE_MS, hasStorageObject: true }),
    ).toBe('requeue')
  })

  it('boundary: requeue budget is EXCLUSIVE at the top — exactly 45 min with object present fails as stuck', () => {
    expect(
      decideStuckPendingAction({ ageMs: STUCK_PENDING_REQUEUE_LIMIT_MS, hasStorageObject: true }),
    ).toBe('fail-stuck')
  })

  it('boundary: exactly 15 min with no object fails as no-file', () => {
    expect(
      decideStuckPendingAction({ ageMs: STUCK_PENDING_GRACE_MS, hasStorageObject: false }),
    ).toBe('fail-no-file')
  })
})
