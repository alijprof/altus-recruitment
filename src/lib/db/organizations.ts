import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/types/database'

import type { DbResult } from './types'

// Plan 5: organizations.logo_url was added by migration
// 20260518202000_organizations_logo_url.sql but the generated database.ts has
// not been regenerated yet. We extend the row shape locally and cast at the
// boundary; RLS + the column-level grant still enforce correctness server-side.
export type OrganizationRow = Pick<Tables<'organizations'>, 'id' | 'name' | 'slug'> & {
  logo_url: string | null
}

export async function getOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<DbResult<OrganizationRow>> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url')
    .eq('id', organizationId)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getOrganization' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  // reason: generated Database types pre-date the logo_url migration; cast at
  // the boundary. The select string above is the source of truth.
  return { ok: true, data: data as unknown as OrganizationRow }
}

export type UpdateOrganizationPatch = {
  name?: string
  logo_url?: string | null
}

export async function updateOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  patch: UpdateOrganizationPatch,
): Promise<DbResult<OrganizationRow>> {
  // reason: PostgREST .update() row-type is derived from the generated types;
  // logo_url is not yet on the generated Update row. Cast through unknown.
  const updatePayload = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.logo_url !== undefined ? { logo_url: patch.logo_url } : {}),
  } as unknown as Tables<'organizations'>

  const { data, error } = await supabase
    .from('organizations')
    .update(updatePayload)
    .eq('id', organizationId)
    .select('id, name, slug, logo_url')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'updateOrganization' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data as unknown as OrganizationRow }
}
