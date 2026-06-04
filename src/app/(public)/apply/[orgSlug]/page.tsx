import Image from 'next/image'
import { notFound } from 'next/navigation'

import { getOrganizationBySlug } from '@/lib/db/organizations'
import { BRAND_DEFAULTS, safeHex } from '@/lib/branding/colours'
import { renderConsentTextV2 } from '@/lib/legal/consent'
import { createServiceClient } from '@/lib/supabase/service'

import { ApplyForm } from './apply-form'

// Plan 3 Task 3.1 — public apply form route.
// Phase 5 Task 2.2 — per-org branding: logo + CSS custom property colours.
//
// SECURITY NOTE — service-role read here is justified:
//   * The apply route has NO authenticated session (RLS on organizations
//     would block the read for the `anon` role).
//   * The lookup is by slug, which is part of the URL — non-secret.
//   * The CHECK constraint `organizations_slug_format` (migration
//     20260519092943) plus the maybeSingle() lookup limit the surface to a
//     single-row read of a single, well-shaped column set.
//   * No PII is logged here. Slug-only context goes to Sentry on errors.
//
// Anti-enumeration (D2-10): unknown slugs AND orgs with apply_form_enabled
// = false BOTH render the standard Next 404 — gives nothing away to a
// would-be enumerator. No "this org has disabled applications" message.
//
// BRAND-XSS DEFENCE IN DEPTH:
//   * DB CHECK constraint (05-00 migration) rejects non-hex on write.
//   * Server Action (05-02) validates with Zod hex regex before writing.
//   * safeHex() below re-validates at render — if a rogue DB write somehow
//     bypassed the layers above, safeHex falls back to the Altus defaults.
//   * Colours are injected ONLY as CSS custom properties via React's style
//     object ({ '--brand-primary': colour }). NEVER concatenated into a raw
//     style tag or dangerouslySetInnerHTML string.

type Props = { params: Promise<{ orgSlug: string }> }

export const dynamic = 'force-dynamic'

export default async function ApplyPage({ params }: Props) {
  const { orgSlug } = await params

  // Service-role client — see SECURITY NOTE above. This is the FIRST
  // unauthenticated DB read in the app; reviewers should treat any future
  // expansion of the SELECT list with extra care.
  const supabase = createServiceClient()
  const orgResult = await getOrganizationBySlug(supabase, orgSlug)
  if (!orgResult.ok || orgResult.data.apply_form_enabled === false) {
    notFound()
  }
  const org = orgResult.data

  // Re-validate brand colours at render time (defence in depth — Pitfall 5).
  // safeHex returns the DB value if it passes /^#[0-9a-fA-F]{6}$/, otherwise
  // falls back to the Altus default. Result is ALWAYS a safe 6-digit hex string.
  const brandPrimary = safeHex(org.brand_primary, BRAND_DEFAULTS.primary)
  const brandSecondary = safeHex(org.brand_secondary, BRAND_DEFAULTS.secondary)

  // Contact email is a generic mailbox; per-org branding (incl. contact
  // address) lands in Phase 5 SaaS shell. Until then, every consent block
  // points at the same Altus mailbox.
  const consentText = renderConsentTextV2({
    orgName: org.name,
    contactEmail: 'careers@altus.co.uk',
  })

  return (
    // CSS custom properties injected via React style object — NEVER via a
    // raw style tag or string interpolation. This is the XSS containment point.
    <div
      style={
        {
          '--brand-primary': brandPrimary,
          '--brand-secondary': brandSecondary,
        } as React.CSSProperties
      }
      className="space-y-6"
    >
      {/* Branded header: logo (if set) + org name */}
      <header className="space-y-4 border-b pb-6">
        {org.logo_url ? (
          <div className="flex items-center gap-3">
            {/* next/image requires width+height or fill; use unoptimized for
                externally-hosted logos until we control the domain list.
                The src comes from the DB (service-role read of a non-secret
                URL); it renders in an <img> context only, not a script context.
                Validation: logo_url passed through z.string().url() on write. */}
            <Image
              src={org.logo_url}
              alt={`${org.name} logo`}
              width={160}
              height={48}
              className="max-h-12 w-auto object-contain"
              unoptimized
            />
          </div>
        ) : (
          /* Wordmark fallback when no logo_url is set */
          <div
            className="text-xl font-bold tracking-tight"
            style={{ color: 'var(--brand-primary)' }}
          >
            {org.name}
          </div>
        )}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Apply to {org.name}</h1>
          <p className="text-muted-foreground text-sm font-normal">
            Tell us a bit about yourself and we&apos;ll be in touch.
          </p>
        </div>
      </header>

      <ApplyForm
        orgSlug={org.slug}
        orgName={org.name}
        consentText={consentText}
        brandPrimary={brandPrimary}
        brandSecondary={brandSecondary}
      />
    </div>
  )
}
