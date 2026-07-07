/**
 * @vitest-environment jsdom
 *
 * The shared leave-placed / remove confirmations (audit min-24 + batch4 review).
 * These centralise the guard so every pipeline move/remove surface shares one
 * rule — the tests pin exactly when a confirm is shown and what it warns.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { confirmLeavePlaced, confirmRemoveApplication } from '@/lib/pipeline-confirms'

let confirmSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

describe('confirmLeavePlaced', () => {
  it('does NOT prompt when the move is not leaving placed', () => {
    expect(confirmLeavePlaced('offer', 'placed', 'Jane')).toBe(true)
    expect(confirmLeavePlaced('screening', 'first_interview', 'Jane')).toBe(true)
    expect(confirmLeavePlaced('placed', 'placed', 'Jane')).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('prompts when leaving placed and returns the user choice', () => {
    confirmSpy.mockReturnValue(false)
    expect(confirmLeavePlaced('placed', 'offer', 'Jane')).toBe(false)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0]![0]).toContain('out of Placed')
    expect(confirmSpy.mock.calls[0]![0]).toContain('Jane')
  })

  it('returns true when the user accepts leaving placed', () => {
    confirmSpy.mockReturnValue(true)
    expect(confirmLeavePlaced('placed', 'offer', 'Jane')).toBe(true)
  })

  it('prompts when declining/rejecting a placed application (the 5th surface)', () => {
    confirmSpy.mockReturnValue(false)
    expect(confirmLeavePlaced('placed', 'rejected', 'Jane')).toBe(false)
    expect(confirmLeavePlaced('placed', 'withdrawn', 'Jane')).toBe(false)
    expect(confirmSpy).toHaveBeenCalledTimes(2)
  })
})

describe('confirmRemoveApplication', () => {
  it('uses the explicit PLACEMENT warning for a placed application', () => {
    confirmRemoveApplication('placed', 'Jane', 'Acme — Engineer')
    const msg = confirmSpy.mock.calls[0]![0] as string
    expect(msg).toContain('PLACEMENT')
    expect(msg).toContain('cannot be undone')
    expect(msg).toContain('Acme — Engineer')
  })

  it('uses the reassuring message for a non-placed application', () => {
    confirmRemoveApplication('screening', 'Jane')
    const msg = confirmSpy.mock.calls[0]![0] as string
    expect(msg).not.toContain('PLACEMENT')
    expect(msg).toContain('candidate record will remain')
  })

  it('returns the user choice', () => {
    confirmSpy.mockReturnValue(false)
    expect(confirmRemoveApplication('placed', 'Jane')).toBe(false)
  })
})
