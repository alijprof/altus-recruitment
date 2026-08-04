// src/app/admin/[orgId]/export/route.ts — Super-admin org data export (item 6).
//
// GET returns a downloadable JSON dump of every org-scoped table (paginated)
// plus a Storage-object manifest, for GDPR data portability before erasure.
// A route handler (not a server action) is used so a large export streams as a
// file attachment, free of the server-action response-size limit.
//
// GATE: requireSuperAdmin() FIRST — redirects non-admins (silent). PII: the
// payload IS the customer's data by design; it is never logged.

import { NextResponse } from 'next/server'

import { requireSuperAdmin } from '@/lib/admin/guard'
import { collectOrgExport } from '@/lib/admin/org-erasure'
import { recordServiceAudit } from '@/lib/db/audit'
import { createServiceClient } from '@/lib/supabase/service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  // GATE — redirects (throws NEXT_REDIRECT) for non-super-admins.
  const admin = await requireSuperAdmin()

  const { orgId } = await params
  if (!UUID_RE.test(orgId)) {
    return NextResponse.json({ error: 'Invalid org id.' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  const { data: org, error: orgErr } = await serviceClient
    .from('organizations')
    .select('id, name, slug')
    .eq('id', orgId)
    .maybeSingle()
  if (orgErr) {
    return NextResponse.json({ error: 'Database read failed.' }, { status: 500 })
  }
  if (!org) {
    return NextResponse.json({ error: 'Organisation not found.' }, { status: 404 })
  }

  const data = await collectOrgExport(serviceClient, orgId)

  // Audit §4.11: `record_audit` cannot be used here — it is
  // `authenticated`-only and resolves the org from the CALLER's session,
  // so a super-admin exporting another org would file the row against
  // their own org, not the org being exported. This is the one path that
  // legitimately reads another org's data, so the audit row must carry
  // the EXPORTED org's id, not the admin's. Best-effort — a failed audit
  // must not block the download.
  await recordServiceAudit(serviceClient, {
    organizationId: orgId,
    actorUserId: admin.id,
    action: 'export',
    entityType: 'organization',
    entityId: orgId,
  })

  const payload = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      organization: { id: org.id, name: org.name, slug: org.slug },
      ...data,
    },
    null,
    2,
  )

  return new NextResponse(payload, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="altus-export-${org.slug}.json"`,
      'cache-control': 'no-store',
    },
  })
}
