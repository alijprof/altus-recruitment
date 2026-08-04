/**
 * @vitest-environment node
 *
 * parse-messages — the CV-failure copy and the predicates keyed off it.
 *
 * Every substring these predicates match is LOAD-BEARING: the reconciler
 * selects budget-capped rows with an `ilike` against the stored copy, and the
 * review panel decides whether to offer a "Try again" button by matching the
 * stored copy. A copy edit that drops one of those phrases silently disables
 * an auto-resume or ships a doomed affordance, with nothing to catch it —
 * review 2026-08-04 L1 and C2. These tests are that catch.
 */
import { describe, expect, it } from 'vitest'

import {
  CV_BUDGET_CAPPED_ILIKE_PATTERN,
  CV_BUDGET_CAPPED_MESSAGE,
  CV_NO_TEXT_MESSAGE,
  CV_PARSE_FAILED_MESSAGE,
  CV_STUCK_MESSAGE,
  CV_UPLOAD_INCOMPLETE_MESSAGE,
  isBudgetCapped,
  isUnparseableSource,
  isUploadIncomplete,
} from '@/lib/cv/parse-messages'

/** Mirror of PostgREST `ilike` semantics for the single pattern we use. */
function ilikeMatches(pattern: string, value: string): boolean {
  const body = pattern.replace(/^%/, '').replace(/%$/, '')
  return value.toLowerCase().includes(body.toLowerCase())
}

describe('parse-messages predicates', () => {
  it('the budget-capped message matches the reconciler ilike pattern (L1)', () => {
    expect(ilikeMatches(CV_BUDGET_CAPPED_ILIKE_PATTERN, CV_BUDGET_CAPPED_MESSAGE)).toBe(true)
    expect(isBudgetCapped(CV_BUDGET_CAPPED_MESSAGE)).toBe(true)
  })

  it('no other failure message is picked up by the budget auto-resume sweep', () => {
    for (const message of [
      CV_PARSE_FAILED_MESSAGE,
      CV_NO_TEXT_MESSAGE,
      CV_STUCK_MESSAGE,
      CV_UPLOAD_INCOMPLETE_MESSAGE,
    ]) {
      expect(ilikeMatches(CV_BUDGET_CAPPED_ILIKE_PATTERN, message)).toBe(false)
      expect(isBudgetCapped(message)).toBe(false)
    }
  })

  it('isUnparseableSource matches only the no-extractable-text message', () => {
    expect(isUnparseableSource(CV_NO_TEXT_MESSAGE)).toBe(true)
    for (const message of [
      CV_PARSE_FAILED_MESSAGE,
      CV_BUDGET_CAPPED_MESSAGE,
      CV_STUCK_MESSAGE,
      CV_UPLOAD_INCOMPLETE_MESSAGE,
    ]) {
      expect(isUnparseableSource(message)).toBe(false)
    }
  })

  it('isUploadIncomplete matches only the upload-incomplete message (C2)', () => {
    expect(isUploadIncomplete(CV_UPLOAD_INCOMPLETE_MESSAGE)).toBe(true)
    for (const message of [
      CV_PARSE_FAILED_MESSAGE,
      CV_BUDGET_CAPPED_MESSAGE,
      CV_NO_TEXT_MESSAGE,
      // CV_STUCK_MESSAGE deliberately KEEPS its retry button: parsing simply
      // never started, and a re-dispatch can genuinely succeed.
      CV_STUCK_MESSAGE,
    ]) {
      expect(isUploadIncomplete(message)).toBe(false)
    }
  })

  it('all predicates treat null/undefined/empty as no-match', () => {
    for (const predicate of [isBudgetCapped, isUnparseableSource, isUploadIncomplete]) {
      expect(predicate(null)).toBe(false)
      expect(predicate(undefined)).toBe(false)
      expect(predicate('')).toBe(false)
    }
  })
})
