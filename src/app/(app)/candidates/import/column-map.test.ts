import { describe, expect, it } from 'vitest'

import { HEADER_ALIASES, mapRow } from './column-map'

describe('HEADER_ALIASES', () => {
  it('covers canonical field names for full_name variants', () => {
    const fullNameKeys = Object.entries(HEADER_ALIASES)
      .filter(([, v]) => v === 'full_name')
      .map(([k]) => k)
    expect(fullNameKeys).toContain('name')
    expect(fullNameKeys).toContain('full name')
    expect(fullNameKeys).toContain('firstname')
    expect(fullNameKeys).toContain('candidate')
  })

  it('covers canonical field names for email variants', () => {
    const emailKeys = Object.entries(HEADER_ALIASES)
      .filter(([, v]) => v === 'email')
      .map(([k]) => k)
    expect(emailKeys).toContain('email')
    expect(emailKeys).toContain('email address')
    expect(emailKeys).toContain('e-mail')
  })
})

describe('mapRow', () => {
  it('maps common header variants to canonical fields', () => {
    const row = {
      name: 'Alice Smith',
      email: 'alice@example.com',
      mobile: '07700 900000',
      city: 'London',
      'job title': 'Engineer',
      employer: 'Acme Ltd',
    }
    const result = mapRow(row)
    expect(result).not.toBeNull()
    expect(result?.full_name).toBe('Alice Smith')
    expect(result?.email).toBe('alice@example.com')
    expect(result?.phone).toBe('07700 900000')
    expect(result?.location).toBe('London')
    expect(result?.current_role_title).toBe('Engineer')
    expect(result?.current_company).toBe('Acme Ltd')
  })

  it('maps "full name" header variant', () => {
    const row = { 'full name': 'Bob Jones', email: 'bob@example.com' }
    const result = mapRow(row)
    expect(result?.full_name).toBe('Bob Jones')
  })

  it('maps "firstname" header variant', () => {
    const row = { firstname: 'Carol', email: 'carol@example.com' }
    const result = mapRow(row)
    expect(result?.full_name).toBe('Carol')
  })

  it('returns null when no resolvable full_name', () => {
    const row = { email: 'no-name@example.com', phone: '0800 000000' }
    const result = mapRow(row)
    expect(result).toBeNull()
  })

  it('returns null for an empty row', () => {
    const result = mapRow({})
    expect(result).toBeNull()
  })

  it('returns null when full_name is blank whitespace only', () => {
    const row = { name: '   ', email: 'blank@example.com' }
    const result = mapRow(row)
    expect(result).toBeNull()
  })

  it('treats injection-ish cell values as plain strings (no eval)', () => {
    // A cell starting with = should be stored verbatim, not executed.
    const row = {
      name: '=cmd()',
      email: '+1HYPERLINK("http://evil.com")',
      mobile: '-1+2+cmd|" /C calc"!A0',
    }
    const result = mapRow(row)
    expect(result).not.toBeNull()
    // The value is stored as-is — the importer never evaluates it.
    expect(result?.full_name).toBe('=cmd()')
    expect(result?.phone).toBe('-1+2+cmd|" /C calc"!A0')
  })

  it('first-match wins when multiple aliases map to the same canonical field', () => {
    // Row has both 'name' and 'full name' — the first encountered wins.
    // Because mapRow iterates Object.entries (insertion order in V8),
    // the first key that resolves full_name wins.
    const row = { name: 'First Winner', 'full name': 'Second Loser' }
    const result = mapRow(row)
    expect(result?.full_name).toBe('First Winner')
  })

  it('trims whitespace from cell values', () => {
    const row = { name: '  Dave Brown  ', email: '  dave@example.com  ' }
    const result = mapRow(row)
    expect(result?.full_name).toBe('Dave Brown')
    expect(result?.email).toBe('dave@example.com')
  })

  it('maps unknown headers to null fields without error', () => {
    const row = { name: 'Eve White', unknowncolumn: 'ignored value' }
    const result = mapRow(row)
    expect(result).not.toBeNull()
    expect(result?.full_name).toBe('Eve White')
    expect(result?.email).toBeNull()
  })
})
