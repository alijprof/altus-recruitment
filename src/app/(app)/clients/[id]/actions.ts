'use server'

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
