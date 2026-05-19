import { z } from 'zod'

// Plan 3 / D2-12: zod schema for the public apply form. Re-validated
// server-side inside submitApplyAction — the client check is UX, the server
// check is the legal/security gate.
//
// Mirrors src/app/(app)/candidates/new/schema.ts conventions:
//   * optional fields are `string | undefined` (RHF input/output align;
//     the action coerces '' → null at the DB boundary)
//   * consent_confirmed is `z.literal(true)` so a tampered POST without the
//     checkbox fails server-side validation
//
// The honeypot field `hp` MUST validate as empty string. Bots that fill in
// every form field will populate `hp` — the action silently drops those.
//
// turnstile_token is required; the action passes it to
// verifyTurnstileToken before any DB work.

export const AVAILABILITY_VALUES = [
  'immediate',
  'two_weeks',
  'one_month',
  'other',
] as const

export const AVAILABILITY_LABELS: Record<(typeof AVAILABILITY_VALUES)[number], string> = {
  immediate: 'Immediately',
  two_weeks: 'Within 2 weeks',
  one_month: 'Within 1 month',
  other: 'Other / flexible',
}

const optionalText = z.string().trim().max(255, 'Too long').optional()

// Email pattern mirrors candidates/new/schema.ts but is REQUIRED here.
export const applyFormSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Please enter your full name.')
    .max(255, 'Too long'),
  // Phase 2 review M2 fix — lowercase at the schema boundary so the
  // duplicate-detection path (getCandidateByEmailForOrg uses .eq) and the
  // candidate insert agree on case. Without this, `Alice@example.com`
  // and `alice@example.com` were treated as different candidates.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(255, 'Too long')
    .refine(
      (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Enter a valid email.',
    ),
  phone: z.string().trim().max(50, 'Too long').optional(),
  location: optionalText,
  current_role_title: optionalText,
  availability: z.enum(AVAILABILITY_VALUES),
  // Salary expectation arrives as a string from the client so we can keep
  // the input forgiving (people type "60000", "60 000", "£60k", etc.). The
  // schema only accepts a digit-only form up to 8 chars; the form helps the
  // user normalise (placeholder, inputmode=numeric).
  salary_expectation: z
    .string()
    .trim()
    .regex(/^\d{0,8}$/, 'Enter a number (no commas, symbols).')
    .optional(),
  source_detail: optionalText,
  consent_confirmed: z.literal(true, {
    error: 'Please confirm consent to submit your application.',
  }),
  marketing_consent: z.boolean(),
  // Honeypot — bots that fill every form field will trip this. Real users
  // never see the input (sr-only, off-screen). Action drops silently when
  // non-empty so the bot can't tune its behaviour from the error message.
  // No `.default('')` — that would make the inferred output type diverge
  // from the input shape and break RHF's resolver type inference.
  hp: z.string().max(0, ''),
  // Cloudflare Turnstile token — required for human verification.
  turnstile_token: z
    .string()
    .min(1, 'Please complete the verification challenge.'),
})

export type ApplyFormInput = z.infer<typeof applyFormSchema>
