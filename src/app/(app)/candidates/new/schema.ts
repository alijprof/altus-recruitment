import { z } from 'zod'

// Co-located with the form + action so the same schema validates on both
// sides. RESEARCH §11 pattern. The literal(true) on consent_confirmed is the
// legal guarantee that the recruiter explicitly ticked the box; the disabled
// submit button is just a UX safety net (UI-SPEC §7).
//
// Enum values mirror the Postgres enums in 20260513152244_phase1_domain_schema.sql.
// Optional fields stay as `string | undefined` (Plan 3 convention) so RHF
// input/output types align; the action coerces '' → null at the DB boundary.

export const MARKET_STATUS_VALUES = [
  'passively_looking',
  'actively_looking',
  'hot',
  'placed',
  'cold',
] as const

export const CANDIDATE_SOURCE_VALUES = [
  'direct_add',
  'apply_form',
  'linkedin',
  'referral',
  'email_inbox',
  'event',
  'other',
] as const

export const CONSENT_BASIS_VALUES = ['consent', 'legitimate_interest'] as const

const optionalText = z.string().trim().max(255, 'Too long').optional()

export const createCandidateSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required.').max(255, 'Too long'),
  // We accept empty string OR a valid email. Refine instead of pipe/transform
  // chain so the inferred type stays a plain `string | undefined` (resolver
  // type inference breaks on transform pipelines under @hookform/resolvers 5).
  email: z
    .string()
    .trim()
    .max(255, 'Too long')
    .optional()
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Enter a valid email.',
    ),
  phone: optionalText,
  location: optionalText,
  current_role_title: optionalText,
  current_company: optionalText,
  market_status: z.enum(MARKET_STATUS_VALUES),
  source: z.enum(CANDIDATE_SOURCE_VALUES),
  consent_basis: z.enum(CONSENT_BASIS_VALUES),
  consent_confirmed: z.literal(true, {
    error: 'You must confirm consent before adding this candidate.',
  }),
})

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>

export const MARKET_STATUS_LABELS: Record<(typeof MARKET_STATUS_VALUES)[number], string> = {
  passively_looking: 'Passively looking',
  actively_looking: 'Actively looking',
  hot: 'Hot (recently redundant)',
  placed: 'Placed',
  cold: 'Cold',
}

export const CANDIDATE_SOURCE_LABELS: Record<(typeof CANDIDATE_SOURCE_VALUES)[number], string> = {
  direct_add: 'Direct add',
  apply_form: 'Apply form',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  email_inbox: 'Email inbox',
  event: 'Event',
  other: 'Other',
}

export const CONSENT_BASIS_LABELS: Record<(typeof CONSENT_BASIS_VALUES)[number], string> = {
  consent: 'Explicit consent',
  legitimate_interest: 'Legitimate interest',
}
