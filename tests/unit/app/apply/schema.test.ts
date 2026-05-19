/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { applyFormSchema } from '@/app/(public)/apply/[orgSlug]/schema'

// Plan 3 Task 3.1 unit tests — schema-only (no server, no DOM). Verifies the
// five canonical pass/fail paths the submitApplyAction relies on at the
// belt-and-braces re-validate step.

const baseInput = {
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+447700900000',
  location: 'London, UK',
  current_role_title: 'Senior Engineer',
  availability: 'immediate' as const,
  salary_expectation: '65000',
  source_detail: 'LinkedIn',
  consent_confirmed: true as const,
  marketing_consent: false,
  hp: '',
  turnstile_token: 'valid-token',
}

describe('applyFormSchema', () => {
  it('accepts a complete valid input', () => {
    const result = applyFormSchema.safeParse(baseInput)
    expect(result.success).toBe(true)
  })

  it('rejects missing consent (consent_confirmed=false)', () => {
    const result = applyFormSchema.safeParse({ ...baseInput, consent_confirmed: false })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors
      expect(errors.consent_confirmed).toBeDefined()
    }
  })

  it('rejects a bad email', () => {
    const result = applyFormSchema.safeParse({ ...baseInput, email: 'not-an-email' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email).toBeDefined()
    }
  })

  it('rejects a non-empty honeypot value', () => {
    const result = applyFormSchema.safeParse({ ...baseInput, hp: 'bot-was-here' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.hp).toBeDefined()
    }
  })

  it('rejects an empty turnstile_token', () => {
    const result = applyFormSchema.safeParse({ ...baseInput, turnstile_token: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.turnstile_token).toBeDefined()
    }
  })

  it('rejects a too-short full_name', () => {
    const result = applyFormSchema.safeParse({ ...baseInput, full_name: 'A' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-numeric salary_expectation', () => {
    const result = applyFormSchema.safeParse({
      ...baseInput,
      salary_expectation: '£60k',
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty optional fields', () => {
    const result = applyFormSchema.safeParse({
      ...baseInput,
      phone: undefined,
      location: undefined,
      current_role_title: undefined,
      salary_expectation: undefined,
      source_detail: undefined,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown availability enum value', () => {
    // safeParse takes `unknown`, so a plain bad-string literal is allowed
    // by TS at the input boundary — the test asserts schema rejection.
    const result = applyFormSchema.safeParse({
      ...baseInput,
      availability: 'never',
    })
    expect(result.success).toBe(false)
  })

  // Phase 2 review M2 — schema lowercases email so case variants don't
  // create duplicate candidate rows.
  it('lowercases mixed-case email to prevent duplicate candidate rows', () => {
    const result = applyFormSchema.safeParse({
      ...baseInput,
      email: 'Alice@Example.COM',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('alice@example.com')
    }
  })

  it('trims surrounding whitespace then lowercases the email', () => {
    const result = applyFormSchema.safeParse({
      ...baseInput,
      email: '  Bob@EXAMPLE.com  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('bob@example.com')
    }
  })
})
