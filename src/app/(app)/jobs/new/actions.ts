'use server'

import * as Sentry from '@sentry/nextjs'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { createJob } from '@/lib/db/jobs'
import { inngest } from '@/lib/inngest/client'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { coerceSalary, newJobFormSchema } from './schema'

// Standalone job-create action (M-8). Mirrors createJobAction in
// clients/[id]/jobs/new/actions.ts, but reads company_id from the validated
// form payload instead of the route param. createJob() fails closed if the
// company resolves to another org (the cross-tenant FK guard fires), so no
// extra org check is needed here.

export type CreateJobActionResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string[]> }
  | { ok: false; formError: string }

export async function createJobStandaloneAction(
  rawInput: unknown,
): Promise<CreateJobActionResult> {
  const parsed = newJobFormSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createSupabaseClient()

  // Default the owner to the current user — recruiters usually own the job
  // they create (mirrors createJobAction; no owner picker in MVP).
  const { data: userData } = await supabase.auth.getUser()
  const ownerUserId = userData.user?.id ?? null

  const result = await createJob(supabase, {
    company_id: parsed.data.company_id,
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
    // Most likely a cross-tenant FK guard fire (client in another org) or a
    // transient DB error. Keep the message generic rather than leaking cause.
    return { ok: false, formError: 'Could not create the job. Check the client and try again.' }
  }

  // Mirror createJobAction: dispatch job/embed so the new job gets a Voyage
  // embedding. Non-fatal — the scheduled sweep recovers if Inngest is down.
  try {
    await inngest.send({
      name: 'job/embed',
      data: {
        organization_id: result.data.organization_id,
        job_id: result.data.id,
        user_id: ownerUserId,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${errName}: inngest.send job/embed failed`), {
      tags: {
        layer: 'action',
        helper: 'createJobStandaloneAction',
        subop: 'inngest.send',
        job_id: result.data.id,
      },
    })
  }

  // Queue precompute of top-candidate matches (mirrors createJobAction).
  try {
    await inngest.send({
      name: 'job/score-top-candidates',
      data: {
        organization_id: result.data.organization_id,
        job_id: result.data.id,
        user_id: ownerUserId,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(
      new Error(`${errName}: inngest.send job/score-top-candidates failed`),
      {
        tags: {
          layer: 'action',
          helper: 'createJobStandaloneAction',
          subop: 'inngest.send-score',
          job_id: result.data.id,
        },
      },
    )
  }

  revalidatePath(`/clients/${parsed.data.company_id}`)
  revalidatePath('/jobs')
  redirect(`/jobs/${result.data.id}`)
}
