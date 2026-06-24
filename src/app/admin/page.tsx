// src/app/admin/page.tsx — Super-admin org overview.
//
// RSC. The gate is enforced by the admin layout (layout.tsx calls
// requireSuperAdmin() before rendering children). Data fetch here uses the
// gated getAllOrgsBillingOverview() which re-calls requireSuperAdmin() internally
// (defence in depth — the query function never trusts that only the layout ran).
//
// UI: sortable table of orgs by current-month AI cost (margin-outlier view).
// Internal tool — functional, not design-polished.

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { getAllOrgsBillingOverview } from '@/lib/admin/queries'
import { ProvisionExternalOrgForm } from './ProvisionExternalOrgForm'

function statusBadgeVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default'
    case 'trialing':
      return 'secondary'
    case 'past_due':
      return 'destructive'
    case 'cancelled':
      return 'outline'
    default:
      return 'outline'
  }
}

export default async function AdminOverviewPage() {
  const { rows: orgs, dataIncomplete } = await getAllOrgsBillingOverview()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Tenant Overview</h1>
        <p className="mt-1 text-sm text-slate-500">
          {orgs.length} organisation{orgs.length !== 1 ? 's' : ''} · Sorted by current-month AI
          cost (highest first)
        </p>
      </div>

      <ProvisionExternalOrgForm />

      {dataIncomplete ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some data could not be loaded — figures may be incomplete.
        </div>
      ) : null}

      {orgs.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-slate-500">
          No organisations found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead className="text-right">Month AI cost</TableHead>
                <TableHead>Override</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((org) => (
                <TableRow key={org.orgId}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{org.orgName}</div>
                    <div className="text-xs text-slate-400">{org.orgSlug}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{org.planLabel}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(org.status)}>{org.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {org.activeSeats} / {org.planSeats || '–'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    {org.monthAiCostFormatted}
                  </TableCell>
                  <TableCell>
                    {org.hasOverride ? (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        Override
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/${org.orgId}`}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      Detail
                      <ExternalLink className="size-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
