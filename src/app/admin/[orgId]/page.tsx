// src/app/admin/[orgId]/page.tsx — Super-admin per-org detail page.
//
// RSC. Gate is enforced by layout.tsx + getOrgAdminDetail (defence in depth).
// Shows: subscription state + current-month AI cost by purpose + override form.
//
// PII discipline: only org name + aggregate cost numbers surfaced.
// Candidate-level data is NEVER fetched or displayed here.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getOrgAdminDetail } from '@/lib/admin/queries'
import { OverrideForm } from './OverrideForm'

type Props = {
  params: Promise<{ orgId: string }>
}

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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default async function AdminOrgDetailPage({ params }: Props) {
  const { orgId } = await params
  const detail = await getOrgAdminDetail(orgId)

  if (!detail) {
    notFound()
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        >
          <ChevronLeft className="size-4" />
          All organisations
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{detail.orgName}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {detail.orgSlug} · {detail.orgId}
          </p>
        </div>
        <Badge variant={statusBadgeVariant(detail.status)} className="text-sm">
          {detail.status}
        </Badge>
      </div>

      {/* Subscription block */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Subscription</CardTitle>
          <CardDescription>Billing state as of the last Stripe webhook sync.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Plan</dt>
              <dd className="font-medium">{detail.planLabel}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Seats</dt>
              <dd className="font-medium">
                {detail.activeSeats} active / {detail.planSeats || '—'} allowed
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd>
                <Badge variant={statusBadgeVariant(detail.status)}>{detail.status}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Trial end</dt>
              <dd className="font-medium">{formatDate(detail.trialEnd)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Period end</dt>
              <dd className="font-medium">{formatDate(detail.currentPeriodEnd)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Stripe subscription</dt>
              <dd className="font-mono text-xs text-slate-700">
                {detail.stripeSubscriptionId ?? '—'}
              </dd>
            </div>
          </dl>

          {detail.override && (
            <>
              <Separator className="my-4" />
              <div className="rounded-md bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">Active admin override</p>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                  {detail.override.trialEndOverride && (
                    <li>
                      Trial extension: {new Date(detail.override.trialEndOverride).toLocaleString('en-GB')}
                    </li>
                  )}
                  {detail.override.capMultiplier != null && (
                    <li>Cap multiplier: {detail.override.capMultiplier}×</li>
                  )}
                  {detail.override.note && <li>Note: {detail.override.note}</li>}
                  {detail.override.updatedAt && (
                    <li className="text-amber-600">
                      Last updated: {new Date(detail.override.updatedAt).toLocaleString('en-GB')}
                    </li>
                  )}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* AI usage block */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">AI usage — this month</CardTitle>
          <CardDescription>
            Month-to-date cost by AI purpose. Total:{' '}
            <span className="font-semibold tabular-nums">{detail.monthAiCostFormatted}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.aiByPurpose.length === 0 ? (
            <p className="text-sm text-slate-500">No AI usage recorded this month.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.aiByPurpose.map((row) => (
                  <TableRow key={row.purpose}>
                    <TableCell className="font-medium">{row.purpose}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.callCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.costFormatted}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Override form — client component (needs useState for form inputs) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Plan overrides</CardTitle>
          <CardDescription>
            Extend trial or bump AI caps for this org without a code deploy. Changes take effect
            immediately (entitlement reads plan_overrides on every request).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OverrideForm orgId={detail.orgId} override={detail.override} />
        </CardContent>
      </Card>
    </div>
  )
}
