// Pure functions — no side effects, no env or db touch. Used by the public
// apply form (Plan 3) to drop submissions from disposable-email providers
// before they get a Turnstile token or a rate-limit slot.
//
// Seed list — expand as we observe abuse. Domain match is case-insensitive
// (we lowercase the input first).

export const BLOCKED_EMAIL_DOMAINS: readonly string[] = [
  'mailinator.com',
  '10minutemail.com',
  'guerrillamail.com',
  'tempmail.com',
  'throwawaymail.com',
  'yopmail.com',
  'sharklasers.com',
  'getairmail.com',
  'dispostable.com',
]

const BLOCKED_SET = new Set(BLOCKED_EMAIL_DOMAINS)

/**
 * True when the email's domain (case-insensitive, after the last `@`)
 * appears in BLOCKED_EMAIL_DOMAINS. Malformed input (no `@`, empty string,
 * etc.) returns false — zod validation in Plan 3 catches the malformed
 * case first; this helper's job is only domain matching.
 */
export function isBlockedEmailDomain(email: string): boolean {
  if (typeof email !== 'string' || email.length === 0) return false
  const at = email.lastIndexOf('@')
  if (at < 0 || at === email.length - 1) return false
  const domain = email.slice(at + 1).toLowerCase()
  return BLOCKED_SET.has(domain)
}
