import { describe, expect, it } from 'vitest'

import { BRAND_DEFAULTS, isHexColour, safeHex } from './colours'

// TDD RED — Task 2.1 (05-02 BRAND-01)
// Tests cover the isHexColour / safeHex behaviour block, including injection
// payloads that must be rejected.

describe('isHexColour', () => {
  it('accepts a valid 6-digit hex with uppercase letters', () => {
    expect(isHexColour('#0A3D5C')).toBe(true)
  })

  it('accepts a valid 6-digit hex with lowercase letters', () => {
    expect(isHexColour('#5dcaa5')).toBe(true)
  })

  it('accepts a valid 6-digit hex with mixed case', () => {
    expect(isHexColour('#aAbBcC')).toBe(true)
  })

  it('accepts #000000 and #ffffff', () => {
    expect(isHexColour('#000000')).toBe(true)
    expect(isHexColour('#ffffff')).toBe(true)
  })

  // --- MUST REJECT ---

  it('rejects a 3-digit short hex (#fff)', () => {
    expect(isHexColour('#fff')).toBe(false)
  })

  it('rejects a named colour (red)', () => {
    expect(isHexColour('red')).toBe(false)
  })

  it('rejects a hex without the # prefix', () => {
    expect(isHexColour('0A3D5C')).toBe(false)
  })

  it('rejects a value with invalid hex chars (#GGGGGG)', () => {
    expect(isHexColour('#GGGGGG')).toBe(false)
  })

  it('rejects an injection payload: CSS-escape attempt', () => {
    expect(isHexColour('; }<script>')).toBe(false)
  })

  it('rejects an injection payload: property injection', () => {
    expect(isHexColour('#000; background: url(evil)')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isHexColour('')).toBe(false)
  })

  it('rejects null (not a string)', () => {
    // reason: function accepts `unknown` so callers don't need to pre-filter
    expect(isHexColour(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isHexColour(undefined)).toBe(false)
  })
})

describe('safeHex', () => {
  const FALLBACK = '#123456'

  it('returns the raw value when it is a valid hex', () => {
    expect(safeHex('#0A3D5C', FALLBACK)).toBe('#0A3D5C')
  })

  it('returns the fallback when the raw value is invalid', () => {
    expect(safeHex('red', FALLBACK)).toBe(FALLBACK)
  })

  it('returns the fallback when the raw value is null', () => {
    expect(safeHex(null, FALLBACK)).toBe(FALLBACK)
  })

  it('returns the fallback when the raw value is undefined', () => {
    expect(safeHex(undefined, FALLBACK)).toBe(FALLBACK)
  })

  it('returns the fallback for an injection payload', () => {
    expect(safeHex('; }<script>', FALLBACK)).toBe(FALLBACK)
  })
})

describe('BRAND_DEFAULTS', () => {
  it('has a valid hex for primary', () => {
    expect(isHexColour(BRAND_DEFAULTS.primary)).toBe(true)
  })

  it('has a valid hex for secondary', () => {
    expect(isHexColour(BRAND_DEFAULTS.secondary)).toBe(true)
  })
})
