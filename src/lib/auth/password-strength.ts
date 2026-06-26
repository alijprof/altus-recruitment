// 4-level password strength heuristic — length + character-class diversity.
// Returns 0 (empty) | 1 (Weak) | 2 (Fair) | 3 (Good) | 4 (Strong).
// No external dependency — keeps the auth bundle minimal. Copied from
// altus-move (src/lib/auth/password-strength.ts), which uses the same
// @supabase/ssr password flows this repo follows.
//
// This is UX guidance only. The authoritative minimum length + leaked-password
// check are enforced by Supabase Auth server-side; never rely on this score as
// a security control.

export type StrengthLevel = 0 | 1 | 2 | 3 | 4

export const LABELS: Record<StrengthLevel, string> = {
  0: '',
  1: 'Weak',
  2: 'Fair',
  3: 'Good',
  4: 'Strong',
}

export function scorePassword(password: string): StrengthLevel {
  if (!password) return 0

  let score = 0

  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++

  return Math.min(score, 4) as StrengthLevel
}
