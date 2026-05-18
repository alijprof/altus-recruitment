'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createJob } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { coerceSalary, jobFormSchema } from './schema'

export type CreateJobActionResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string[]> }
  | { ok: false; formError: string }

const idSchema = z.string().uuid('Invalid client id')

export async function createJobAction(
  companyId: string,
  rawInput: unknown,
): Promise<CreateJobActionResult> {
  const idResult = idSchema.safeParse(companyId)
  if (!idResult.success) {
    return { ok: false, formError: 'Invalid client id.' }
  }
  const parsed = jobFormSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createSupabaseClient()

  // Default the owner to the current user — recruiters usually own the job
  // they create. UI exposes no owner picker in MVP (D-15 keeps defaults).
  const { data: userData } = await supabase.auth.getUser()
  const ownerUserId = userData.user?.id ?? null

  const result = await createJob(supabase, {
    company_id: idResult.data,
    title: parsed.data.title,
    job_type: parsed.data.job_type,
    hiring_context: parsed.data.hiring_context,
    location: parsed.data.location?.trim() ? parsed.data.location : null,
    salary_min: coerceSalary(parsed.data.salary_min),
    salary_max: coerceSalary(parsed.data.salary_max),
    description: parsed.data.description?.trim() ? parsed.data.description : null,
    owner_user_id: ownerUserId,
  })

  if (!result.ok) {
    // Could be a cross-tenant FK guard fire (company in another org). Keep
    // the message generic rather than leaking the cause.
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath(`/clients/${idResult.data}`)
  revalidatePath('/jobs')
  redirect(`/jobs/${result.data.id}`)
}
