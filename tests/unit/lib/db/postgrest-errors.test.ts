/**
 * @vitest-environment node
 *
 * isMissingColumnError — review 2026-08-04 L9.
 *
 * This predicate is the load-bearing pre/post-migration guard on a LIVE
 * database whose migrations are pushed by hand: it decides whether a write
 * failure means "deployed ahead of the migration, degrade quietly" or "a real
 * fault, tell a human". It existed in three places (two verbatim copies plus
 * a looser variant) and was certain to drift.
 */
import { describe, expect, it } from 'vitest'

import { isMissingColumnError } from '@/lib/db/postgrest-errors'

describe('isMissingColumnError', () => {
  it('matches PGRST204 (schema-cache write miss)', () => {
    expect(isMissingColumnError({ code: 'PGRST204', message: 'column not found' })).toBe(true)
  })

  it('matches 42703 (Postgres undefined_column, surfaced on reads)', () => {
    expect(isMissingColumnError({ code: '42703', message: 'column does not exist' })).toBe(true)
  })

  it('does NOT match an unrelated database error', () => {
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingColumnError({ code: '08006', message: 'connection failure' })).toBe(false)
  })

  it('does NOT match non-objects', () => {
    expect(isMissingColumnError(null)).toBe(false)
    expect(isMissingColumnError(undefined)).toBe(false)
    expect(isMissingColumnError('PGRST204')).toBe(false)
  })

  it('stays strict by default — a message naming the column is not enough', () => {
    // The Stripe ledger guards rely on this: they must never be fooled by an
    // unrelated error whose message happens to mention a column name.
    expect(isMissingColumnError({ code: '42501', message: 'permission denied for status' })).toBe(
      false,
    )
  })

  it('opts into message matching only when a column is supplied', () => {
    // updateCandidateCVParse needs this looser form for shapes PostgREST
    // reports without a machine-readable code.
    const err = { message: "Could not find the 'parse_error_detail' column" }
    expect(isMissingColumnError(err)).toBe(false)
    expect(isMissingColumnError(err, 'parse_error_detail')).toBe(true)
    expect(isMissingColumnError(err, 'some_other_column')).toBe(false)
  })
})
