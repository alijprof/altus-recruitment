'use server'

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'

import { ORG_LOGO_BUCKET, buildOrgLogoPath } from '@/lib/branding/org-logo'
import { getOrganization, updateOrganization } from '@/lib/db/organizations'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient } from '@/lib/supabase/server'
import { assertUploadableLogo, MAX_LOGO_BYTES } from '@/lib/upload/image-signature'

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
//
// Phase 8 Plan 06 (BCV-04, single-surface consolidation): this action no
// longer touches logo_url or logo_storage_path at all — saving colours can
// never clobber the logo. The logo is written exclusively by
// uploadOrgLogoAction / removeOrgLogoAction below.
//
// SECURITY: never log colour values to Sentry — tag-only. Colour values
// could theoretically contain attempted injection content and logging them
// raw violates the PII-minimisation discipline.

export type ActionResult<T = unknown> =
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

  // Entitlement gate — block org mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
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
  const { brand_primary, brand_secondary } = parsed.data

  const patch = {
    brand_primary: brand_primary && brand_primary.length > 0 ? brand_primary : null,
    brand_secondary: brand_secondary && brand_secondary.length > 0 ? brand_secondary : null,
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

// ---------------------------------------------------------------------------
// Org logo upload/remove — BCV-04 (08-05).
//
// Same R8 ordering as updateBrandingAction (owner check BEFORE any write),
// with one difference: byte-level format/size validation runs FIRST, before
// the entitlement gate and before touching Storage or the database. It is
// free (no session, no network) and needs no session — exactly the ordering
// uploadCVAction already established for CV uploads
// (candidates/[id]/actions.ts).
//
// WRITE-NEW-THEN-DELETE-OLD (08-RESEARCH.md Pitfall 6, T-08-31): the new
// object is uploaded to a fresh, uuid-suffixed path FIRST; only once the
// organizations row points at it do we best-effort remove the PREVIOUS
// object. A mid-flight failure at any step before the row update leaves the
// OLD logo pointer intact and servable — never a broken pointer. This is
// deliberately the opposite ordering to "delete then write": that ordering
// would leave the org with NO logo (worse than stale) if the write failed
// after the delete succeeded.
//
// SECURITY: no Sentry capture in either action below may carry the org name,
// a storage path, or a filename — organization id (a UUID, not a secret) and
// a fixed subop tag only, mirroring cv-file/[cvId]/route.ts.
// ---------------------------------------------------------------------------

function revalidateLogoPaths(): void {
  revalidatePath('/settings/branding')
  revalidatePath('/settings')
  // Revalidate the public apply page for every org slug — force-dynamic on
  // that page means it always fetches fresh, but this helps CDN edge caches
  // pick up the new logo immediately, same reasoning as updateBrandingAction.
  revalidatePath('/apply/[orgSlug]', 'page')
}

export async function uploadOrgLogoAction(formData: FormData): Promise<ActionResult> {
  const fileRaw = formData.get('file')
  if (!(fileRaw instanceof File) || fileRaw.size === 0) {
    return { ok: false, formError: 'Choose a logo file before uploading.' }
  }
  const file = fileRaw

  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, formError: 'This logo is too large — please upload a file under 2 MB.' }
  }

  // Read the bytes once, bounded by the MAX_LOGO_BYTES check immediately
  // above — same reasoning uploadCVAction documents for its own head-read.
  const bytes = new Uint8Array(await file.arrayBuffer())
  const sniff = assertUploadableLogo(bytes, file.type, file.size)
  if (!sniff.ok) {
    return { ok: false, formError: sniff.message }
  }

  // Entitlement gate — block org mutations for non-entitled orgs, consistent
  // with every other mutation action in this codebase.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  // Owner check BEFORE any write (R8 ordering) — identical shape to
  // updateBrandingAction.
  const { data: me } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!me) return { ok: false, formError: 'Profile not found.' }
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can edit branding settings.' }
  }

  // Read the current org to learn the previous logo_storage_path (if any) —
  // needed for the write-new-then-delete-old ordering below.
  const orgResult = await getOrganization(supabase, me.organization_id)
  if (!orgResult.ok) return { ok: false, formError: 'Organisation not found.' }
  const previousStoragePath = orgResult.data.logo_storage_path

  const newPath = buildOrgLogoPath(me.organization_id, sniff.ext)

  const { error: uploadError } = await supabase.storage
    .from(ORG_LOGO_BUCKET)
    .upload(newPath, bytes, { contentType: sniff.mime, upsert: false })
  if (uploadError) {
    return { ok: false, formError: 'Storage upload failed. Please try again.' }
  }

  // Uploading a new logo sets logo_storage_path AND clears the legacy
  // logo_url, so an org can never sit in a confusing "two logos" state
  // (08-05-PLAN.md <objective> precedence rule).
  const updateResult = await updateOrganization(supabase, me.organization_id, {
    logo_storage_path: newPath,
    logo_url: null,
  })
  if (!updateResult.ok) {
    // Roll back the just-uploaded object — a failed row update must never
    // leave an orphaned Storage object behind.
    await supabase.storage.from(ORG_LOGO_BUCKET).remove([newPath])
    return { ok: false, formError: 'Could not save branding settings. Please try again.' }
  }

  // The row now points at `newPath`; removing the OLD object is safe here —
  // a failure only leaves stale bytes (swept later by org-level erasure,
  // 08-08), never a broken pointer.
  if (previousStoragePath) {
    const { error: removeError } = await supabase.storage
      .from(ORG_LOGO_BUCKET)
      .remove([previousStoragePath])
    if (removeError) {
      Sentry.captureException(new Error(removeError.name ?? 'RemoveOldLogoFailed'), {
        tags: {
          layer: 'action',
          helper: 'uploadOrgLogoAction',
          subop: 'removeOldLogo',
          organization_id: me.organization_id,
        },
      })
    }
  }

  revalidateLogoPaths()
  return { ok: true }
}

export async function removeOrgLogoAction(): Promise<ActionResult> {
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!me) return { ok: false, formError: 'Profile not found.' }
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can edit branding settings.' }
  }

  const orgResult = await getOrganization(supabase, me.organization_id)
  if (!orgResult.ok) return { ok: false, formError: 'Organisation not found.' }
  const currentStoragePath = orgResult.data.logo_storage_path

  const updateResult = await updateOrganization(supabase, me.organization_id, {
    logo_storage_path: null,
    logo_url: null,
  })
  if (!updateResult.ok) {
    return { ok: false, formError: 'Could not save branding settings. Please try again.' }
  }

  // Best-effort delete: the pointer is already gone (which is what the user
  // asked for), so a delete failure still returns ok:true — it just leaves
  // stale bytes for org-level erasure (08-08) to sweep later. Capture a
  // PII-free Sentry event so the leak is at least visible in observability.
  if (currentStoragePath) {
    const { error: removeError } = await supabase.storage
      .from(ORG_LOGO_BUCKET)
      .remove([currentStoragePath])
    if (removeError) {
      Sentry.captureException(new Error(removeError.name ?? 'RemoveLogoFailed'), {
        tags: {
          layer: 'action',
          helper: 'removeOrgLogoAction',
          subop: 'removeLogo',
          organization_id: me.organization_id,
        },
      })
    }
  }

  revalidateLogoPaths()
  return { ok: true }
}
