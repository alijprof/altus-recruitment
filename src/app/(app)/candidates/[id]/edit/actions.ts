'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { updateCandidate } from '@/lib/db/candidates'
import { createClient } from '@/lib/supabase/server'

import { editCandidateSchema } from './schema'

// Wraps the schema with the id (passed via the URL, not the form body) so we
// can validate id + patch together in a single safeParse.
const updateCandidateActionSchema = z.object({
  id: z.string().uuid('Invalid candidate id.'),
  patch: editCandidateSchema,
})

export type UpdateCandidateResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

export async function updateCandidateAction(
  id: string,
  rawPatch: unknown,
): Promise<UpdateCandidateResult> {
  const parsed = updateCandidateActionSchema.safeParse({ id, patch: rawPatch })
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    }
  }

  const supabase = await createClient()
  const result = await updateCandidate(supabase, parsed.data.id, {
    full_name: parsed.data.patch.full_name,
    email: parsed.data.patch.email || null,
    phone: parsed.data.patch.phone || null,
    location: parsed.data.patch.location || null,
    current_role_title: parsed.data.patch.current_role_title || null,
    current_company: parsed.data.patch.current_company || null,
    market_status: parsed.data.patch.market_status,
    source: parsed.data.patch.source,
  })

  if (!result.ok) {
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath('/candidates')
  revalidatePath(`/candidates/${parsed.data.id}`)
  redirect(`/candidates/${parsed.data.id}`)
}
