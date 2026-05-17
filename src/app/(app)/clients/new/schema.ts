import { z } from 'zod'

// Reusable across new/edit. Optional fields stay as `string | undefined` on
// the form side (so RHF input/output types stay aligned); the server action
// coerces empty strings to null at the DB boundary.

const optionalString = z
  .string()
  .trim()
  .max(2000, 'Too long')
  .optional()

export const clientFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Too long'),
  industry: optionalString,
  website: optionalString,
  notes: optionalString,
})

export type ClientFormInput = z.infer<typeof clientFormSchema>
