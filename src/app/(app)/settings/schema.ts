import { z } from 'zod'

// Settings forms. Two forms share this file:
//   1. ProfileForm    — full_name + email (display only — see ProfileForm)
//   2. OrgForm        — name only
//
// (Team invites moved to /settings/team and its own schema; the legacy invite
// schema was removed in the launch-readiness cleanup, M-4.)
//
// Phase 8 Plan 06 (BCV-04, single-surface consolidation): logo_url was
// removed from this schema entirely. /settings/branding is now the ONLY
// surface that edits the org logo (via uploadOrgLogoAction /
// removeOrgLogoAction) — closing 08-RESEARCH.md Pitfall 1, where this form
// and the branding form both wrote the same column and could silently
// clobber each other. This page links to Branding instead.
//
// Optional text fields stay as `string | undefined` (Plan 3 convention) so
// RHF input/output types align; the server actions coerce empty string to
// NULL at the DB boundary.

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required.').max(255, 'Too long'),
  email: z.string().trim().email('Enter a valid email.').max(255, 'Too long'),
})
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organisation name is required.').max(255, 'Too long'),
})
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>
