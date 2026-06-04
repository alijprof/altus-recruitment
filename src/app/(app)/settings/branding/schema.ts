import { z } from 'zod'

// Branding settings schema — BRAND-01 (05-02).
//
// The hex regex here MIRRORS the one in src/lib/branding/colours.ts (HEX_RE).
// colours.ts is the canonical implementation; this schema is the form-layer
// mirror used by zodResolver on the client and safeParse on the server action.
//
// Empty string is allowed → treated as "clear the colour" (maps to null in DB).
// The same convention is used for logo_url (empty = clear).

const hexField = z
  .string()
  .regex(
    /^#[0-9a-fA-F]{6}$/,
    'Enter a 6-digit hex colour (e.g. #0A3D5C) or leave blank to use the default.',
  )
  .or(z.literal(''))
  .optional()

// logo_url renders into next/image, so require https:// (no http://).
// Empty string is still allowed → "clear the logo".
const optionalUrl = z
  .string()
  .trim()
  .max(2048, 'URL too long')
  .refine(
    (v) => !v || /^https:\/\//i.test(v),
    'Use a full URL starting with https://',
  )
  .or(z.literal(''))
  .optional()

export const updateBrandingSchema = z.object({
  brand_primary: hexField,
  brand_secondary: hexField,
  logo_url: optionalUrl,
})

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>
