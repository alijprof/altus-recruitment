import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

export type CreateContactInput = Pick<
  TablesInsert<'contacts'>,
  'company_id' | 'full_name' | 'role_title' | 'email' | 'phone' | 'notes'
>

export type UpdateContactPatch = Pick<
  TablesUpdate<'contacts'>,
  'full_name' | 'role_title' | 'email' | 'phone' | 'notes'
>

export async function listContactsForCompany(
  supabase: SupabaseClient<Database>,
  companyId: string,
): Promise<DbResult<Tables<'contacts'>[]>> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('company_id', companyId)
    .order('full_name', { ascending: true })

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listContactsForCompany' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

export async function getContact(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<DbResult<Tables<'contacts'>>> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getContact' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}

export async function createContact(
  supabase: SupabaseClient<Database>,
  input: CreateContactInput,
): Promise<DbResult<Tables<'contacts'>>> {
  // organization_id is filled by the set_organization_id() trigger; the cross-
  // tenant FK guard (20260517204500_cross_tenant_fk_guards.sql) verifies the
  // company_id resolves to the same org and will raise an exception if not.
  // reason: server-side trigger populates organization_id; RLS WITH CHECK
  // enforces correctness — type system can't see that contract.
  const insertPayload = {
    company_id: input.company_id,
    full_name: input.full_name,
    role_title: input.role_title ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
  } as TablesInsert<'contacts'>

  const { data, error } = await supabase
    .from('contacts')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createContact' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

export async function updateContact(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: UpdateContactPatch,
): Promise<DbResult<Tables<'contacts'>>> {
  const { data, error } = await supabase
    .from('contacts')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'updateContact' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

export async function deleteContact(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<DbResult<{ id: string }>> {
  const { error } = await supabase.from('contacts').delete().eq('id', id)

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'deleteContact' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id } }
}

/**
 * Plan 4 Task 4.3 — exact-email lookup for the Outlook sync function.
 * Service-role-friendly: pass `organizationId` explicitly because the
 * caller has no session for RLS to read.
 *
 * Phase 2 review M1 fix: use `.eq` instead of `.ilike` — `.ilike`
 * interprets `_` and `%` in the pattern as wildcards, so a contact email
 * containing `_` (legal per RFC 5321) would false-match other contacts
 * (e.g. `john_doe@x.com` matched `john1doe@x.com`). Inputs are lowercased
 * at write-time (candidates from apply form / Outlook sync; contacts
 * follow the same convention) so exact `.eq` is correct.
 */
export async function findContactByEmail(
  supabase: SupabaseClient<Database>,
  email: string,
  organizationId: string,
): Promise<DbResult<{ id: string } | null>> {
  const normalised = email.toLowerCase().trim()
  if (!normalised) return { ok: true, data: null }
  const { data, error } = await supabase
    .from('contacts')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('email', normalised)
    .limit(1)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'findContactByEmail' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? null }
}
