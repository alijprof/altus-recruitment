'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { createClient as createClientRow } from '@/lib/db/clients'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { clientFormSchema } from './schema'

export type CreateClientActionResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string[]> }
  | { ok: false; formError: string }

export async function createClientAction(rawInput: unknown): Promise<CreateClientActionResult> {
  const parsed = clientFormSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  // Coerce empty/undefined optional fields to null for DB.
  const result = await createClientRow(supabase, {
    name: parsed.data.name,
    industry: parsed.data.industry?.trim() ? parsed.data.industry : null,
    website: parsed.data.website?.trim() ? parsed.data.website : null,
    notes: parsed.data.notes?.trim() ? parsed.data.notes : null,
  })
  if (!result.ok) {
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath('/clients')
  redirect(`/clients/${result.data.id}`)
}
