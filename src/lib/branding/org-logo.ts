import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import { sniffImageType, type SniffedImageType } from '@/lib/upload/image-signature'
import type { Database } from '@/types/database'

// Org-logo storage helper — BCV-04 (08-05).
//
// Single source of truth for "what is this org's logo" across three
// consumers: the settings UI (08-06, a signed URL for <img>), the public
// apply page (08-06, same signed-URL path via the service client), and the
// branded-CV PDF generator (08-07, raw bytes — @react-pdf/renderer's Image
// component needs a Buffer/Uint8Array, never a URL).
//
// THE PRECEDENCE RULE (established once, here, per 08-05-PLAN.md <objective>):
//   1. logo_storage_path set → the uploaded object IS the logo (signed URL
//      for display; bytes for the PDF).
//   2. else logo_url set → legacy external URL, DISPLAY ONLY. Never fetched
//      server-side (that would be an SSRF surface) and therefore never
//      embedded in a branded PDF.
//   3. else → no logo; every consumer falls back to the org-name wordmark.
//
// SECURITY (PII discipline, mirrors cv-file/[cvId]/route.ts): every Sentry
// capture below carries a fixed subop tag and, where available, the org id
// ONLY — never the storage path (it embeds the org id anyway, but logging
// the full path invites scope creep) and never the org name.

export const ORG_LOGO_BUCKET = 'org-logos'

// One hour — the consumers are dynamically rendered pages that mint a fresh
// signed URL on every render; short enough that a leaked URL dies quickly,
// long enough to survive a slow page load.
export const ORG_LOGO_SIGNED_URL_TTL_SECONDS = 3600

/**
 * Builds the Storage path for a newly-uploaded org logo. The org id is
 * ALWAYS the first path segment — that IS the Storage RLS boundary
 * (`(storage.foldername(name))[1] = current_organization_id()::text`,
 * migration 20260812120100) — and no client-supplied filename ever appears
 * in it, closing the path-traversal surface a slugified-filename approach
 * would open (T-08-23).
 */
export function buildOrgLogoPath(orgId: string, ext: 'png' | 'jpg'): string {
  return `${orgId}/logo-${crypto.randomUUID()}.${ext}`
}

export type OrgLogoSource = {
  id: string
  logo_storage_path: string | null
  logo_url: string | null
}

/**
 * Resolves a displayable URL for an org's logo, implementing the three-step
 * precedence rule above. Takes any `SupabaseClient<Database>` — the
 * RLS-scoped client in settings, the service client on the public apply
 * page — since the bucket's own RLS policy (or the service role) governs
 * access either way.
 *
 * Never throws. A failed sign returns `null` (the caller falls back to the
 * org-name wordmark, never blocks the page render) and captures a PII-free
 * Sentry event tagged with the org id only.
 */
export async function resolveOrgLogoUrl(
  client: SupabaseClient<Database>,
  org: OrgLogoSource,
): Promise<string | null> {
  if (org.logo_storage_path) {
    const { data, error } = await client.storage
      .from(ORG_LOGO_BUCKET)
      .createSignedUrl(org.logo_storage_path, ORG_LOGO_SIGNED_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) {
      Sentry.captureException(new Error(error?.name ?? 'MissingSignedUrl'), {
        tags: {
          layer: 'lib',
          helper: 'resolveOrgLogoUrl',
          subop: 'createSignedUrl',
          organization_id: org.id,
        },
      })
      return null
    }
    return data.signedUrl
  }

  // Legacy free-text URL — display only, never fetched server-side (SSRF
  // surface, T-08-28). Returned as-is.
  if (org.logo_url) return org.logo_url

  return null
}

export type DownloadedOrgLogo = { data: Uint8Array; format: SniffedImageType }

/**
 * Downloads the raw bytes of an org's stored logo for server-side embedding
 * (the branded-CV PDF generator, 08-07). Only ever reads from the
 * `org-logos` bucket via `logo_storage_path` — a legacy `logo_url` is never
 * fetched here (see the precedence rule above).
 *
 * Re-runs `sniffImageType` on the downloaded bytes before returning them:
 * the object was validated on the way in (uploadOrgLogoAction), but
 * re-checking on the way out means a hand-edited Storage object can never
 * reach the PDF image decoder as an unknown format.
 *
 * Never throws. Returns `null` for a missing/empty path, a download error,
 * or bytes that fail the magic-byte re-check.
 */
export async function downloadOrgLogo(
  client: SupabaseClient<Database>,
  storagePath: string | null,
): Promise<DownloadedOrgLogo | null> {
  if (!storagePath) return null

  const { data: blob, error } = await client.storage.from(ORG_LOGO_BUCKET).download(storagePath)
  if (error || !blob) {
    Sentry.captureException(new Error(error?.name ?? 'MissingLogoObject'), {
      tags: { layer: 'lib', helper: 'downloadOrgLogo', subop: 'download' },
    })
    return null
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const sniffed = sniffImageType(bytes)
  if (sniffed === 'unknown') {
    Sentry.captureException(new Error('UnrecognisedLogoBytes'), {
      tags: { layer: 'lib', helper: 'downloadOrgLogo', subop: 'sniff-recheck' },
    })
    return null
  }

  return { data: bytes, format: sniffed }
}
