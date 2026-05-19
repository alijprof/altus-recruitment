'use server'

import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { inngest } from '@/lib/inngest/client'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

// Plan 1 Task 1.3 — Settings → Integrations server actions.
//
// triggerCandidateBackfillAction: fires `embed/backfill-org` so the
// shared `embed-batch` Inngest function sweeps THIS org only.
//
// triggerHnswBuildAction: fires `admin/build-vector-index` so the
// `bootstrap-vector-index` function records state + signals the operator
// to run the manual DDL (VERIFICATION M-1).

export type SettingsActionResult = { ok: true } | { ok: false; error: string }

export async function triggerCandidateBackfillAction(): Promise<SettingsActionResult> {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // Use current_organization_id() to derive the org from the session
  // context — never trust a client-supplied org id here. RPC is
  // SECURITY DEFINER, so it doesn't recurse into RLS.
  const orgRpc = await supabase.rpc('current_organization_id')
  const organizationId = typeof orgRpc.data === 'string' ? orgRpc.data : null
  if (!organizationId) {
    return { ok: false, error: 'Could not resolve your organisation.' }
  }

  try {
    await inngest.send({
      name: 'embed/backfill-org',
      data: {
        organization_id: organizationId,
        user_id: user.id,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(
      new Error(`${errName}: inngest.send embed/backfill-org failed`),
      {
        tags: {
          layer: 'action',
          helper: 'triggerCandidateBackfillAction',
          subop: 'inngest.send',
        },
      },
    )
    return { ok: false, error: 'Could not start the backfill. Please try again.' }
  }

  return { ok: true }
}

const buildIndexSchema = z.object({
  table: z.enum(['candidates', 'jobs']),
})

export async function triggerHnswBuildAction(
  rawInput: unknown,
): Promise<SettingsActionResult> {
  const parsed = buildIndexSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid table name.' }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  try {
    await inngest.send({
      name: 'admin/build-vector-index',
      data: { table_name: parsed.data.table },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(
      new Error(`${errName}: inngest.send admin/build-vector-index failed`),
      {
        tags: {
          layer: 'action',
          helper: 'triggerHnswBuildAction',
          subop: 'inngest.send',
        },
      },
    )
    return { ok: false, error: 'Could not request the build. Please try again.' }
  }

  return { ok: true }
}
