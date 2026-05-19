/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  BLOCKED_EMAIL_DOMAINS,
  isBlockedEmailDomain,
} from '@/lib/legal/apply-form-blocklist'

describe('isBlockedEmailDomain', () => {
  it('returns true for canonical blocked domains', () => {
    expect(isBlockedEmailDomain('foo@mailinator.com')).toBe(true)
    expect(isBlockedEmailDomain('bar@yopmail.com')).toBe(true)
    expect(isBlockedEmailDomain('baz@10minutemail.com')).toBe(true)
  })

  it('is case-insensitive on the domain', () => {
    expect(isBlockedEmailDomain('foo@MAILINATOR.COM')).toBe(true)
    expect(isBlockedEmailDomain('foo@Mailinator.Com')).toBe(true)
  })

  it('returns false for allowed domains', () => {
    expect(isBlockedEmailDomain('alice@gmail.com')).toBe(false)
    expect(isBlockedEmailDomain('alice@altus-recruitment.com')).toBe(false)
  })

  it('returns false for malformed inputs without throwing', () => {
    expect(isBlockedEmailDomain('')).toBe(false)
    expect(isBlockedEmailDomain('no-at-sign')).toBe(false)
    expect(isBlockedEmailDomain('trailing-at@')).toBe(false)
    // @ts-expect-error — defensive against unexpected non-string input
    expect(isBlockedEmailDomain(null)).toBe(false)
    // @ts-expect-error — defensive against unexpected non-string input
    expect(isBlockedEmailDomain(undefined)).toBe(false)
  })

  it('exports the seed list', () => {
    expect(BLOCKED_EMAIL_DOMAINS).toContain('mailinator.com')
    expect(BLOCKED_EMAIL_DOMAINS.length).toBeGreaterThanOrEqual(5)
  })
})
