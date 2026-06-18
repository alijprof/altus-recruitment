'use server'

import * as Sentry from '@sentry/nextjs'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createJob } from '@/lib/db/jobs'
import { inngest } from '@/lib/inngest/client'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
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

  // Entitlement gate — job create drives embed + scoring AI; block non-entitled orgs.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
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

  // Plan 1 Task 1.1: dispatch the job/embed Inngest event so the new job
  // gets a Voyage embedding. The function does its own tenant boundary
  // check; we pass organization_id explicitly so the event reads as
  // authoritative for the recipient. Failure is non-fatal — the scheduled
  // sweep will pick the job up on its next 10-min run.
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
        helper: 'createJobAction',
        subop: 'inngest.send',
        job_id: result.data.id,
      },
    })
  }

  // Plan 2 Task 2.1: fire `job/score-top-candidates` so precompute is
  // queued from the moment the job is created. The embed-job-on-jd-change
  // function ALSO chains this event after a successful embed (via
  // step.sendEvent) so two invocations may fire — the first usually no-ops
  // because the embed isn't ready yet (top-N vector lookup returns empty
  // and the function exits cleanly). The redundancy keeps the matches
  // pipeline observable from the action layer without depending on the
  // embed chain firing. Failure is non-fatal (same fallback as job/embed).
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
          helper: 'createJobAction',
          subop: 'inngest.send-score',
          job_id: result.data.id,
        },
      },
    )
  }

  revalidatePath(`/clients/${idResult.data}`)
  revalidatePath('/jobs')
  redirect(`/jobs/${result.data.id}`)
}
