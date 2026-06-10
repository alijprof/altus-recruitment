import { z } from 'zod'

// Standalone "create job" form schema (M-8). Mirrors
// clients/[id]/jobs/new/schema.ts but adds `company_id`, because this route is
// NOT scoped to a client — the recruiter picks the client in the form itself.
// Kept self-contained (co-located per route, matching the codebase convention)
// rather than importing across the [id] dynamic-route folder.
//
// Form-side keeps salary as plain strings (RHF emits strings from
// <Input type="number">). The server action coerces and validates ranges.

const optionalString = z.string().trim().max(2000, 'Too long').optional()

const numericString = z
  .string()
  .trim()
  .max(20, 'Too long')
  .refine(
    (v) => v === '' || (Number.isFinite(Number(v)) && Number.isInteger(Number(v)) && Number(v) >= 0),
    'Whole numbers only',
  )
  .optional()

export const newJobFormSchema = z
  .object({
    company_id: z.string().uuid('Select a client'),
    title: z.string().trim().min(1, 'Title is required').max(200, 'Too long'),
    job_type: z.enum(['perm', 'contract', 'temp']),
    hiring_context: z.enum(['new_role', 'backfill']),
    location: optionalString,
    // Plan 04-06 / Task 2 — REPORT-02 sector gap. Free-text sector label
    // (e.g. "Renewable Energy", "Software", "Oil & Gas"). Empty string → null
    // so the jobs.sector scalar column is left unset rather than written as ''.
    sector: z.string().trim().max(200, 'Too long').optional(),
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

export type NewJobFormInput = z.infer<typeof newJobFormSchema>

/**
 * Coerce form-string salary values to integer-or-null for the DB boundary.
 * Returns 0 ≤ n ≤ 10_000_000 or null. (Mirrors the clients/[id]/jobs/new
 * helper of the same name.)
 */
export function coerceSalary(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10_000_000) return null
  return n
}
