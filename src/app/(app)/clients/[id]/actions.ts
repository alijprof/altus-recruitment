'use server'

import * as Sentry from '@sentry/nextjs'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createActivity } from '@/lib/db/activities'
import { updateClient } from '@/lib/db/clients'
import {
  createContact,
  deleteContact,
  updateContact,
  type UpdateContactPatch,
} from '@/lib/db/contacts'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { contactFormSchema } from './contacts/new/schema'

// ---------------------------------------------------------------------------
// Contact CRUD
// ---------------------------------------------------------------------------

export type ContactActionResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string[]> }
  | { ok: false; formError: string }

const idSchema = z.string().uuid('Invalid id')

function coerceOptional(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function createContactAction(
  companyId: string,
  rawInput: unknown,
): Promise<ContactActionResult> {
  const idResult = idSchema.safeParse(companyId)
  if (!idResult.success) {
    return { ok: false, formError: 'Invalid client id.' }
  }
  const parsed = contactFormSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const result = await createContact(supabase, {
    company_id: idResult.data,
    full_name: parsed.data.full_name,
    role_title: coerceOptional(parsed.data.role_title),
    email: coerceOptional(parsed.data.email),
    phone: coerceOptional(parsed.data.phone),
    notes: coerceOptional(parsed.data.notes),
  })
  if (!result.ok) {
    // Could be a cross-tenant FK guard fire — keep the generic message rather
    // than leaking that a company in another org exists.
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath(`/clients/${idResult.data}`)
  redirect(`/clients/${idResult.data}`)
}

export async function updateContactAction(
  companyId: string,
  contactId: string,
  rawInput: unknown,
): Promise<ContactActionResult> {
  const companyIdResult = idSchema.safeParse(companyId)
  const contactIdResult = idSchema.safeParse(contactId)
  if (!companyIdResult.success || !contactIdResult.success) {
    return { ok: false, formError: 'Invalid id.' }
  }
  const parsed = contactFormSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const patch: UpdateContactPatch = {
    full_name: parsed.data.full_name,
    role_title: coerceOptional(parsed.data.role_title),
    email: coerceOptional(parsed.data.email),
    phone: coerceOptional(parsed.data.phone),
    notes: coerceOptional(parsed.data.notes),
  }
  const result = await updateContact(supabase, contactIdResult.data, patch)
  if (!result.ok) {
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath(`/clients/${companyIdResult.data}`)
  redirect(`/clients/${companyIdResult.data}`)
}

export type DeleteContactResult = { ok: true } | { ok: false; formError: string }

export async function deleteContactAction(
  companyId: string,
  contactId: string,
): Promise<DeleteContactResult> {
  const companyIdResult = idSchema.safeParse(companyId)
  const contactIdResult = idSchema.safeParse(contactId)
  if (!companyIdResult.success || !contactIdResult.success) {
    return { ok: false, formError: 'Invalid id.' }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const result = await deleteContact(supabase, contactIdResult.data)
  if (!result.ok) {
    return { ok: false, formError: 'Could not delete contact. Please try again.' }
  }

  revalidatePath(`/clients/${companyIdResult.data}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Log note (Notes tab)
// ---------------------------------------------------------------------------

const logNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Note cannot be empty')
    .max(5000, 'Too long'),
})

export type LogNoteResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string[]> }
  | { ok: false; formError: string }

export async function logNoteAction(
  companyId: string,
  rawInput: unknown,
): Promise<LogNoteResult> {
  const idResult = idSchema.safeParse(companyId)
  if (!idResult.success) {
    return { ok: false, formError: 'Invalid client id.' }
  }
  const parsed = logNoteSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()

  const result = await createActivity(supabase, {
    kind: 'note',
    entity_type: 'company',
    entity_id: idResult.data,
    body: parsed.data.body,
    actor_user_id: userData.user?.id ?? null,
  })
  if (!result.ok) {
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath(`/clients/${idResult.data}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Update client (top-level "Edit" — not implemented as a separate page in this
// plan; left as an exported action so a future inline edit Sheet can call it).
// ---------------------------------------------------------------------------

const updateClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(2000).optional(),
  website: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(5000).optional(),
})

export type UpdateClientResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string[]> }
  | { ok: false; formError: string }

export async function updateClientAction(
  companyId: string,
  rawInput: unknown,
): Promise<UpdateClientResult> {
  const idResult = idSchema.safeParse(companyId)
  if (!idResult.success) {
    return { ok: false, formError: 'Invalid client id.' }
  }
  const parsed = updateClientSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const result = await updateClient(supabase, idResult.data, {
    name: parsed.data.name,
    industry: coerceOptional(parsed.data.industry),
    website: coerceOptional(parsed.data.website),
    notes: coerceOptional(parsed.data.notes),
  })
  if (!result.ok) {
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath(`/clients/${idResult.data}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Delete a client/company (hard delete, tenant-safe, blocks when it has jobs).
//
// Routes through the delete_company SECURITY DEFINER RPC (migration
// 20260603130000): asserts the client is in the caller's org, BLOCKS with
// `company_has_jobs` if it has any jobs (those carry applications/placement
// history, and the jobs->companies FK is RESTRICT), cascades contacts via FK,
// cleans polymorphic activities + audit_log orphans for the company and its
// contacts, SET-NULLs spec_drafts, and writes a `delete` audit row.
// ---------------------------------------------------------------------------

const deleteCompanySchema = z.object({ companyId: idSchema })

export type DeleteCompanyResult = { ok: true } | { ok: false; error: string }

export async function deleteCompanyAction(rawInput: unknown): Promise<DeleteCompanyResult> {
  const parsed = deleteCompanySchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Invalid client id.' }
  const { companyId } = parsed.data

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // reason: delete_company isn't in the generated Database types until `pnpm
  // db:types` re-runs after the migration push — use the untyped .rpc cast.
  const supabaseUntyped = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string; code?: string } | null }>
  }
  const { error } = await supabaseUntyped.rpc('delete_company', { p_company_id: companyId })

  if (error) {
    if (error.message.includes('company_has_jobs')) {
      return {
        ok: false,
        error:
          'This client has jobs. Delete or reassign all of its jobs first, then delete the client.',
      }
    }
    if (error.message.includes('company not found')) {
      return { ok: false, error: 'Client not found.' }
    }
    Sentry.captureException(new Error(`delete_company failed: ${error.code ?? 'unknown'}`), {
      tags: { layer: 'server-action', action: 'deleteCompanyAction', company_id: companyId },
    })
    return { ok: false, error: 'Couldn’t delete this client. Please try again.' }
  }

  revalidatePath('/clients')
  redirect('/clients')
}
