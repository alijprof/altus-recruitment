import { z } from 'zod'

// Phase 1 job create form. company_id comes from the route param, not the
// form payload.
//
// Form-side keeps salary as plain strings (RHF emits strings from
// <Input type="number">). The server action coerces and validates ranges.

const optionalString = z.string().trim().max(2000, 'Too long').optional()

// Accepts empty string or a numeric string. Stays a string here; the
// action coerces to integer or null. Doing it here as a transform would
// break the form-input/output parity that react-hook-form's resolver expects
// and surface as a Resolver<Output, Input> type mismatch.
const numericString = z
  .string()
  .trim()
  .max(20, 'Too long')
  .refine(
    (v) => v === '' || (Number.isFinite(Number(v)) && Number.isInteger(Number(v)) && Number(v) >= 0),
    'Whole numbers only',
  )
  .optional()

export const jobFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200, 'Too long'),
    job_type: z.enum(['perm', 'contract', 'temp']),
    hiring_context: z.enum(['new_role', 'backfill']),
    location: optionalString,
    salary_min: numericString,
    salary_max: numericString,
    description: z.string().trim().max(10_000, 'Too long').optional(),
  })
  .refine(
    (data) => {
      const min = data.salary_min && data.salary_min.length > 0 ? Number(data.salary_min) : null
      const max = data.salary_max && data.salary_max.length > 0 ? Number(data.salary_max) : null
      if (min == null || max == null) return true
      return min <= max
    },
    {
      message: 'Min salary cannot exceed max',
      path: ['salary_max'],
    },
  )

export type JobFormInput = z.infer<typeof jobFormSchema>

/**
 * Coerce form-string salary values to integer-or-null for the DB boundary.
 * Returns 0 ≤ n ≤ 10_000_000 or null.
 */
export function coerceSalary(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10_000_000) return null
  return n
}
