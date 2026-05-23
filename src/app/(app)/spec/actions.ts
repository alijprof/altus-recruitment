'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { markSpecDraftRejected } from '@/lib/db/spec-drafts'
import { createClient } from '@/lib/supabase/server'

// Soft-delete a spec draft from the list view. Reuses the reject path
// (status='rejected', deleted_at=now) so the existing cleanup sweep
// picks it up. Available for any status — list-level "tidy up" affordance,
// distinct from the in-review Reject button (which keeps confirm()).

export type ActionResult = { ok: true } | { ok: false; error: string }

const schema = z.object({
  specDraftId: z.string().uuid('Invalid draft id.'),
})

export async function deleteSpecDraftAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const result = await markSpecDraftRejected(supabase, { id: parsed.data.specDraftId })
  if (!result.ok) {
    return { ok: false, error: 'Could not delete draft.' }
  }

  revalidatePath('/spec')
  return { ok: true }
}
