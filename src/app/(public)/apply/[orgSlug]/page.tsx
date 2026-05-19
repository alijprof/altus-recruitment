import { notFound } from 'next/navigation'

import { getOrganizationBySlug } from '@/lib/db/organizations'
import { renderConsentTextV2 } from '@/lib/legal/consent'
import { createServiceClient } from '@/lib/supabase/service'

import { ApplyForm } from './apply-form'

// Plan 3 Task 3.1 — public apply form route.
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

  // Contact email is a generic mailbox; per-org branding (incl. contact
  // address) lands in Phase 5 SaaS shell. Until then, every consent block
  // points at the same Altus mailbox.
  const consentText = renderConsentTextV2({
    orgName: org.name,
    contactEmail: 'careers@altus.co.uk',
  })

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Apply to {org.name}
        </h1>
        <p className="text-muted-foreground text-sm font-normal">
          Tell us a bit about yourself and we&apos;ll be in touch.
        </p>
      </header>

      <ApplyForm
        orgSlug={org.slug}
        orgName={org.name}
        consentText={consentText}
      />
    </div>
  )
}
