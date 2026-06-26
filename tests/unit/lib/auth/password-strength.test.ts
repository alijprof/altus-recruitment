import { describe, expect, it } from 'vitest'

import { LABELS, scorePassword } from '@/lib/auth/password-strength'

describe('scorePassword', () => {
  it('returns 0 for an empty password', () => {
    expect(scorePassword('')).toBe(0)
  })

  it('scores a short single-class password as Weak (1)', () => {
    // 8+ chars (length point) but lowercase-only, no digits/symbols.
    expect(scorePassword('aaaaaaaa')).toBe(1)
  })

  it('scores a short mixed-case password as Fair (2)', () => {
    // length>=8 (1) + upper+lower (1) = 2.
    expect(scorePassword('Abcdefgh')).toBe(2)
  })

  it('scores a long mixed-case password as Good (3)', () => {
    // length>=8 (1) + length>=12 (1) + upper+lower (1) = 3.
    expect(scorePassword('Abcdefghijkl')).toBe(3)
  })

  it('scores a long mixed-case password with digits/symbols as Strong (4)', () => {
    // all four points.
    expect(scorePassword('Abcdefghij12')).toBe(4)
    expect(scorePassword('Abcdefghij!@')).toBe(4)
  })

  it('caps the score at 4', () => {
    expect(scorePassword('Abcdefghij12!@£$')).toBe(4)
  })

  it('does not award the length points below the thresholds', () => {
    // 7 chars, mixed case + digit: both diversity points (2), but NO length
    // point — the 8-char equivalent would score 3.
    expect(scorePassword('Abc123x')).toBe(2)
    expect(scorePassword('Abc1234x')).toBe(3)
  })

  it('exposes a human label for every non-zero score', () => {
    expect(LABELS[1]).toBe('Weak')
    expect(LABELS[2]).toBe('Fair')
    expect(LABELS[3]).toBe('Good')
    expect(LABELS[4]).toBe('Strong')
    expect(LABELS[0]).toBe('')
  })
})
