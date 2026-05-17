import { describe, expect, it } from 'vitest'

import { safeNext } from '@/lib/auth/safe-next'

describe('safeNext', () => {
  it('returns / for null', () => {
    expect(safeNext(null)).toBe('/')
  })

  it('returns / for empty string', () => {
    expect(safeNext('')).toBe('/')
  })

  it('returns / for protocol-relative URLs', () => {
    expect(safeNext('//evil.com')).toBe('/')
  })

  it('returns / for backslash variants', () => {
    expect(safeNext('/\\evil.com')).toBe('/')
  })

  it('returns / for absolute URLs', () => {
    expect(safeNext('https://evil.com')).toBe('/')
  })

  it('returns / for strings containing ://', () => {
    expect(safeNext('/example://attacker')).toBe('/')
  })

  it('returns / for non-slash starting paths', () => {
    expect(safeNext('candidates')).toBe('/')
  })

  it('returns the path for safe relative paths', () => {
    expect(safeNext('/candidates')).toBe('/candidates')
    expect(safeNext('/candidates/123')).toBe('/candidates/123')
    expect(safeNext('/?q=foo')).toBe('/?q=foo')
  })
})
