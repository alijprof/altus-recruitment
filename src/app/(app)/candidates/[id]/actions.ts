'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createActivity } from '@/lib/db/activities'
import { createClient } from '@/lib/supabase/server'

export type ActionResult = { ok: true } | { ok: false; error: string }

// Activity kinds the in-page LogActivityForm can write. We intentionally don't
// expose `stage_change` or `system` here — those are written by the pipeline
// (Plan 4) and by background jobs respectively, not by the manual log form.
const LOG_ACTIVITY_KINDS = ['note', 'call', 'meeting'] as const

const logActivitySchema = z.object({
  candidateId: z.string().uuid('Invalid candidate id.'),
  kind: z.enum(LOG_ACTIVITY_KINDS),
  body: z
    .string()
    .trim()
    .min(1, 'Add a short note before saving.')
    .max(5000, 'That note is too long — keep it under 5,000 characters.'),
})

export type LogActivityInput = z.infer<typeof logActivitySchema>

export async function logActivityAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = logActivitySchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Invalid activity.'
    return { ok: false, error: first }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    // The middleware should have caught this; defensive check.
    return { ok: false, error: 'Not signed in.' }
  }

  // We use Plan 3's createActivity helper because it landed first and owns
  // src/lib/db/activities.ts (parallel-execution scope split). The bump of
  // candidates.last_contacted_at is handled by the
  // activities_bump_candidate_last_contacted Postgres trigger added in
  // migration 20260517215938.
  const result = await createActivity(supabase, {
    kind: parsed.data.kind,
    entity_type: 'candidate',
    entity_id: parsed.data.candidateId,
    body: parsed.data.body,
    actor_user_id: user.id,
  })

  if (!result.ok) {
    return { ok: false, error: 'Couldn’t save activity. Please try again.' }
  }

  // Revalidate the detail page so the timeline + last_contacted_at refresh.
  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  revalidatePath('/candidates')
  return { ok: true }
}
