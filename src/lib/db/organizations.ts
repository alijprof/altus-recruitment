import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/types/database'

import type { DbResult } from './types'

// Plan 5: organizations.logo_url was added by migration
// 20260518202000_organizations_logo_url.sql but the generated database.ts has
// not been regenerated yet. We extend the row shape locally and cast at the
// boundary; RLS + the column-level grant still enforce correctness server-side.
//
// Plan 3 Task 3.3: apply_form_enabled added by migration
// 20260519092943_phase2_organizations_extensions.sql — owner-toggleable
// boolean for inbound apply-form submissions.
export type OrganizationRow = Pick<Tables<'organizations'>, 'id' | 'name' | 'slug'> & {
  logo_url: string | null
  apply_form_enabled: boolean
}

export async function getOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<DbResult<OrganizationRow>> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, apply_form_enabled')
    .eq('id', organizationId)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getOrganization' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  // reason: generated Database types pre-date the logo_url + apply_form_enabled
  // migrations; cast at the boundary. The select string above is the source of truth.
  return { ok: true, data: data as unknown as OrganizationRow }
}

export type UpdateOrganizationPatch = {
  name?: string
  logo_url?: string | null
  apply_form_enabled?: boolean
}

export async function updateOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  patch: UpdateOrganizationPatch,
): Promise<DbResult<OrganizationRow>> {
  // reason: PostgREST .update() row-type is derived from the generated types;
  // logo_url + apply_form_enabled are not yet on the generated Update row.
  // Cast through unknown.
  const updatePayload = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.logo_url !== undefined ? { logo_url: patch.logo_url } : {}),
    ...(patch.apply_form_enabled !== undefined
      ? { apply_form_enabled: patch.apply_form_enabled }
      : {}),
  } as unknown as Tables<'organizations'>

  const { data, error } = await supabase
    .from('organizations')
    .update(updatePayload)
    .eq('id', organizationId)
    .select('id, name, slug, logo_url, apply_form_enabled')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'updateOrganization' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data as unknown as OrganizationRow }
}

// Plan 3 / D2-10: Public apply-form lookup. Called from
// (public)/apply/[orgSlug]/page.tsx AND the apply-form server action, both
// using createServiceClient — there is no authenticated session for an
// anonymous applicant. Service-role bypasses RLS; the slug regex CHECK
// (migration 20260519092943) gates the input shape; the lookup itself
// returns no secrets (slug + name are non-sensitive).
//
// Returns `not_found` both for unknown slugs AND for orgs where
// apply_form_enabled = false. Callers should treat both as 404 to avoid
// leaking org existence to enumerators (anti-enumeration). NEVER pass an
// applicant email or name to Sentry — slug-only context (PII discipline; M-4).
export type OrganizationApplyRow = {
  id: string
  name: string
  slug: string
  apply_form_enabled: boolean
}

export async function getOrganizationBySlug(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<DbResult<OrganizationApplyRow>> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, apply_form_enabled')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    // Slug is non-secret (it's in the URL). No PII passes through here.
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getOrganizationBySlug', org_slug: slug },
    })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  // reason: apply_form_enabled was added by migration
  // 20260519092943_phase2_organizations_extensions.sql; the generated
  // database.ts predates it. Cast at the boundary; the select string above
  // is the source of truth.
  return { ok: true, data: data as unknown as OrganizationApplyRow }
}
