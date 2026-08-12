import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/types/database'

import { isMissingColumnError } from './postgrest-errors'
import type { DbResult } from './types'

// Plan 5: organizations.logo_url was added by migration
// 20260518202000_organizations_logo_url.sql but the generated database.ts has
// not been regenerated yet. We extend the row shape locally and cast at the
// boundary; RLS + the column-level grant still enforce correctness server-side.
//
// Plan 3 Task 3.3: apply_form_enabled added by migration
// 20260519092943_phase2_organizations_extensions.sql — owner-toggleable
// boolean for inbound apply-form submissions.
//
// Phase 5 Task 0.3: stripe_customer_id, brand_primary, brand_secondary added
// by migration 20260604120000_phase5_saas_billing.sql. The `as unknown as`
// cast boundary below remains in effect until Task 0.4 regenerates database.ts
// against the live schema — at that point the cast may be removed and the
// extended fields promoted into the generated type directly.
//
// Phase 8 Plan 05 (BCV-04): logo_storage_path added by migration
// 20260812120100_org_logos_bucket.sql. Same cast-boundary discipline: the
// SELECT string below is the source of truth until database.ts is
// regenerated against the post-08-01/08-05 schema.
export type OrganizationRow = Pick<Tables<'organizations'>, 'id' | 'name' | 'slug'> & {
  logo_url: string | null
  logo_storage_path: string | null
  apply_form_enabled: boolean
  stripe_customer_id: string | null
  brand_primary: string | null
  brand_secondary: string | null
}

// CR-01 hotfix (2026-08-12 incident): this module's queries referenced
// logo_storage_path while its migration (20260812120100) was still pending
// the founder's manual db push — PostgREST fails the WHOLE query on an
// unknown column (42703), which 404'd every tenant's public apply form and
// broke org-settings saves on the live pre-migration database. Every reader
// below therefore retries WITHOUT the column and substitutes null. The
// fallback is inert once the migration is applied; do not remove until the
// migration is confirmed applied everywhere this code ships.
const ORG_COLUMNS =
  'id, name, slug, logo_url, logo_storage_path, apply_form_enabled, stripe_customer_id, brand_primary, brand_secondary'
const ORG_COLUMNS_PRE_MIGRATION =
  'id, name, slug, logo_url, apply_form_enabled, stripe_customer_id, brand_primary, brand_secondary'
const APPLY_COLUMNS =
  'id, name, slug, apply_form_enabled, logo_url, logo_storage_path, brand_primary, brand_secondary'
const APPLY_COLUMNS_PRE_MIGRATION =
  'id, name, slug, apply_form_enabled, logo_url, brand_primary, brand_secondary'

export async function getOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<DbResult<OrganizationRow>> {
  let { data, error } = await supabase
    .from('organizations')
    .select(ORG_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle()

  if (error && isMissingColumnError(error, 'logo_storage_path')) {
    // CR-01: pre-migration DB — retry without the Phase 8 column.
    const retry = await supabase
      .from('organizations')
      .select(ORG_COLUMNS_PRE_MIGRATION)
      .eq('id', organizationId)
      .maybeSingle()
    data =
      retry.data === null ? null : ({ ...retry.data, logo_storage_path: null } as typeof data)
    error = retry.error
  }

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getOrganization' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  // reason: generated Database types pre-date the logo_url + apply_form_enabled +
  // stripe_customer_id + brand_primary + brand_secondary + logo_storage_path
  // migrations; cast at the boundary. Task 0.4 / 08-01's founder push
  // regenerates database.ts — after that this cast may be removed.
  return { ok: true, data: data as unknown as OrganizationRow }
}

export type UpdateOrganizationPatch = {
  name?: string
  logo_url?: string | null
  logo_storage_path?: string | null
  apply_form_enabled?: boolean
  // Phase 5 Task 0.3: brand colour fields (validated as hex at DB level
  // by the check constraint in 20260604120000_phase5_saas_billing.sql).
  brand_primary?: string | null
  brand_secondary?: string | null
}

export async function updateOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  patch: UpdateOrganizationPatch,
): Promise<DbResult<OrganizationRow>> {
  const updatePayload = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.logo_url !== undefined ? { logo_url: patch.logo_url } : {}),
    ...(patch.logo_storage_path !== undefined
      ? { logo_storage_path: patch.logo_storage_path }
      : {}),
    ...(patch.apply_form_enabled !== undefined
      ? { apply_form_enabled: patch.apply_form_enabled }
      : {}),
    ...(patch.brand_primary !== undefined ? { brand_primary: patch.brand_primary } : {}),
    ...(patch.brand_secondary !== undefined ? { brand_secondary: patch.brand_secondary } : {}),
  }
  // reason: PostgREST .update() row-type is derived from the generated types;
  // logo_url + apply_form_enabled + brand_primary + brand_secondary +
  // stripe_customer_id + logo_storage_path are not yet on the generated
  // Update row. Cast through unknown. Task 0.4 regenerates database.ts —
  // after that this cast may be removed.
  const typedPayload = updatePayload as unknown as Tables<'organizations'>

  let { data, error } = await supabase
    .from('organizations')
    .update(typedPayload)
    .eq('id', organizationId)
    .select(ORG_COLUMNS)
    .single()

  // CR-01: pre-migration DB. ONLY retry when the caller was not trying to
  // write logo_storage_path itself — silently dropping that write would fake
  // success for uploadOrgLogoAction (the silent-failure class this codebase
  // treats as its worst bug). Reads of the column degrade to null; writes of
  // it fail loudly until the migration is applied.
  if (
    error &&
    isMissingColumnError(error, 'logo_storage_path') &&
    patch.logo_storage_path === undefined
  ) {
    const retry = await supabase
      .from('organizations')
      .update(typedPayload)
      .eq('id', organizationId)
      .select(ORG_COLUMNS_PRE_MIGRATION)
      .single()
    data =
      retry.data === null ? null : ({ ...retry.data, logo_storage_path: null } as typeof data)
    error = retry.error
  }

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
//
// Phase 5 Task 0.3: logo_url + brand_primary + brand_secondary added so
// the public apply-page renderer (05-02 BRAND-01) can display the org's
// branding without a separate query. This is the BRAND-01 key link:
// getOrganizationBySlug is the only call path for the apply-page server
// component, so extending this type + the SELECT below is the single
// change that unlocks branded apply pages in 05-02.
//
// Phase 8 Plan 05 (BCV-04): logo_storage_path added so the apply page can
// resolve a signed URL for an uploaded logo via resolveOrgLogoUrl, same
// precedence rule as everywhere else (src/lib/branding/org-logo.ts).
export type OrganizationApplyRow = {
  id: string
  name: string
  slug: string
  apply_form_enabled: boolean
  logo_url: string | null
  logo_storage_path: string | null
  brand_primary: string | null
  brand_secondary: string | null
}

export async function getOrganizationBySlug(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<DbResult<OrganizationApplyRow>> {
  let { data, error } = await supabase
    .from('organizations')
    .select(APPLY_COLUMNS)
    .eq('slug', slug)
    .maybeSingle()

  if (error && isMissingColumnError(error, 'logo_storage_path')) {
    // CR-01: pre-migration DB — retry without the Phase 8 column so the
    // public apply form renders instead of 404ing for every tenant.
    const retry = await supabase
      .from('organizations')
      .select(APPLY_COLUMNS_PRE_MIGRATION)
      .eq('slug', slug)
      .maybeSingle()
    data =
      retry.data === null ? null : ({ ...retry.data, logo_storage_path: null } as typeof data)
    error = retry.error
  }

  if (error) {
    // Slug is non-secret (it's in the URL). No PII passes through here.
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getOrganizationBySlug', org_slug: slug },
    })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  // reason: apply_form_enabled + logo_url + brand_primary + brand_secondary +
  // logo_storage_path were added by migrations 20260519092943, 20260604120000
  // and 20260812120100; the generated database.ts predates them. Cast at the
  // boundary; the select string above is the source of truth. Task 0.4
  // regenerates database.ts.
  return { ok: true, data: data as unknown as OrganizationApplyRow }
}
