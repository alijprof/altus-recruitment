import { z } from 'zod'

// Reused by create and edit. company_id is supplied by the route param at the
// server-action boundary so it doesn't appear on the form — preventing the
// client from injecting it into a different company.

const optionalString = z
  .string()
  .trim()
  .max(2000, 'Too long')
  .optional()

export const contactFormSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Too long'),
  role_title: optionalString,
  email: z
    .string()
    .trim()
    .max(320, 'Too long')
    .optional()
    .refine(
      (v) => v === undefined || v === '' || /.+@.+\..+/.test(v),
      'Enter a valid email address',
    ),
  phone: optionalString,
  notes: optionalString,
})

export type ContactFormInput = z.infer<typeof contactFormSchema>
