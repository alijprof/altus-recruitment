import { z } from 'zod'

// Branding settings schema — BRAND-01 (05-02).
//
// The hex regex here MIRRORS the one in src/lib/branding/colours.ts (HEX_RE).
// colours.ts is the canonical implementation; this schema is the form-layer
// mirror used by zodResolver on the client and safeParse on the server action.
//
// Empty string is allowed → treated as "clear the colour" (maps to null in DB).
//
// Phase 8 Plan 06 (BCV-04, single-surface consolidation): logo_url was
// removed from this schema entirely. The logo is now edited exclusively via
// uploadOrgLogoAction / removeOrgLogoAction (FormData + file bytes, not a
// colours-form field) — see logo-upload-field.tsx. Saving colours can no
// longer touch the logo in any way, closing 08-RESEARCH.md Pitfall 1.

const hexField = z
  .string()
  .regex(
    /^#[0-9a-fA-F]{6}$/,
    'Enter a 6-digit hex colour (e.g. #0A3D5C) or leave blank to use the default.',
  )
  .or(z.literal(''))
  .optional()

export const updateBrandingSchema = z.object({
  brand_primary: hexField,
  brand_secondary: hexField,
})

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>
