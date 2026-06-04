'use server'

import { revalidatePath } from 'next/cache'

import { updateOrganization } from '@/lib/db/organizations'
import { createClient } from '@/lib/supabase/server'

import { updateBrandingSchema } from './schema'

// Branding Server Action — BRAND-01 (05-02).
//
// Security ordering (R8 — owner check BEFORE any write):
//   1. Parse input with Zod (hex regex rejects injection payloads at the gate)
//   2. Authenticate (getUser)
//   3. Authorise (owner role check on the users table)
//   4. Write (updateOrganization — RLS-scoped to the owner's org)
//
// This action accepts empty string for hex fields and maps them to null
// ("clear the colour → revert to Altus defaults on the apply page").
// Logo URL: empty string → null (cleared).
//
// SECURITY: never log colour values or logo URLs to Sentry — tag-only.
// Colour values could theoretically contain attempted injection content and
// logging them raw violates the PII-minimisation discipline.

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

export async function updateBrandingAction(rawInput: unknown): Promise<ActionResult> {
  // Step 1: Zod parse — hex regex blocks injection payloads before anything else.
  const parsed = updateBrandingSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    }
  }

  // Step 2: Authenticate.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  // Step 3: Authorise — owner check BEFORE any write (R8 ordering).
  // The RLS-scoped client already prevents cross-org reads, but a non-owner
  // member could attempt to patch their own org. Reject them explicitly.
  const { data: me } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!me) return { ok: false, formError: 'Profile not found.' }
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can edit branding settings.' }
  }

  // Step 4: Map empty strings to null (clear) then write.
  const { brand_primary, brand_secondary, logo_url } = parsed.data

  const patch = {
    brand_primary: brand_primary && brand_primary.length > 0 ? brand_primary : null,
    brand_secondary: brand_secondary && brand_secondary.length > 0 ? brand_secondary : null,
    logo_url: logo_url && logo_url.length > 0 ? logo_url : null,
  }

  const result = await updateOrganization(supabase, me.organization_id, patch)
  if (!result.ok) {
    // Tag-only — no colour/URL values reach Sentry.
    return { ok: false, formError: 'Could not save branding settings. Please try again.' }
  }

  revalidatePath('/settings/branding')
  // Revalidate the public apply page for this org's slug so the branded
  // render is immediately visible. force-dynamic on that page means it
  // will always fetch fresh, but revalidating helps CDN edge caches.
  revalidatePath('/apply/[orgSlug]', 'page')
  return { ok: true }
}
