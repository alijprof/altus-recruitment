import { z } from 'zod'

// Settings forms. Two forms share this file:
//   1. ProfileForm    — full_name + email (display only — see ProfileForm)
//   2. OrgForm        — name + logo_url (free text; upload UI is Phase 2)
//
// (Team invites moved to /settings/team and its own schema; the legacy invite
// schema was removed in the launch-readiness cleanup, M-4.)
//
// Optional text fields stay as `string | undefined` (Plan 3 convention) so
// RHF input/output types align; the server actions coerce empty string to
// NULL at the DB boundary.

const optionalUrl = z
  .string()
  .trim()
  .max(2048, 'URL too long')
  .optional()
  .refine((v) => !v || /^https?:\/\//i.test(v), 'Use a full URL starting with https://')

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required.').max(255, 'Too long'),
  email: z.string().trim().email('Enter a valid email.').max(255, 'Too long'),
})
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organisation name is required.').max(255, 'Too long'),
  logo_url: optionalUrl,
})
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>
