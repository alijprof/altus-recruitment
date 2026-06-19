'use client'

// ---------------------------------------------------------------------------
// ManualAccessForm — grant/revoke invoice-billed (no-Stripe) access for an org.
//
// Same security model as OverrideForm: receives already-fetched props, never
// holds the service-role client. The gate is enforced in the admin layout AND
// re-checked inside grantManualAccessAction / revokeManualAccessAction.
// ---------------------------------------------------------------------------

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { grantManualAccessAction, revokeManualAccessAction } from '@/app/admin/actions'

const PLAN_OPTIONS = [
  { key: 'starter', label: 'Starter' },
  { key: 'pro', label: 'Pro' },
  { key: 'scale', label: 'Scale' },
] as const

type Props = {
  orgId: string
  currentPlanKey: string
  currentSeats: number
  status: string
  hasStripeSubscription: boolean
}

export function ManualAccessForm({
  orgId,
  currentPlanKey,
  currentSeats,
  status,
  hasStripeSubscription,
}: Props) {
  const isManualActive = status === 'active' && !hasStripeSubscription

  const defaultPlan = PLAN_OPTIONS.some((p) => p.key === currentPlanKey) ? currentPlanKey : 'scale'
  const [planKey, setPlanKey] = useState<string>(defaultPlan)
  const [seats, setSeats] = useState<string>(currentSeats > 0 ? String(currentSeats) : '3')

  const [isGranting, startGrant] = useTransition()
  const [isRevoking, startRevoke] = useTransition()

  // A live Stripe subscription owns billing — manual access doesn't apply.
  if (hasStripeSubscription) {
    return (
      <p className="text-sm text-slate-500">
        This org is billed through Stripe — manual/invoice access doesn&apos;t apply. Manage the
        subscription in Stripe.
      </p>
    )
  }

  function handleGrant() {
    const seatsValue = Number.parseInt(seats, 10)
    if (!Number.isInteger(seatsValue) || seatsValue < 1) {
      toast.error('Enter a seat count of 1 or more.')
      return
    }
    startGrant(async () => {
      try {
        const result = await grantManualAccessAction(orgId, planKey, seatsValue)
        if (result.ok) {
          toast.success(result.message)
        } else {
          toast.error(result.error)
        }
      } catch (err) {
        console.error('grantManualAccessAction failed:', err)
        toast.error(err instanceof Error ? err.message : 'Failed to grant manual access')
      }
    })
  }

  function handleRevoke() {
    startRevoke(async () => {
      try {
        const result = await revokeManualAccessAction(orgId)
        if (result.ok) {
          toast.success(result.message)
        } else {
          toast.error(result.error)
        }
      } catch (err) {
        console.error('revokeManualAccessAction failed:', err)
        toast.error(err instanceof Error ? err.message : 'Failed to revoke manual access')
      }
    })
  }

  return (
    <div className="space-y-4">
      {isManualActive && (
        <div className="rounded-md bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-900">Manual access is active (invoice-billed)</p>
          <p className="mt-0.5 text-xs text-emerald-700">
            This org has full access with no Stripe subscription. Update the plan/seats below, or
            revoke to send them back to the paywall.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="manual-plan" className="text-xs">
            Plan
          </Label>
          <select
            id="manual-plan"
            value={planKey}
            onChange={(e) => setPlanKey(e.target.value)}
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            {PLAN_OPTIONS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28 space-y-1">
          <Label htmlFor="manual-seats" className="text-xs">
            Seats
          </Label>
          <Input
            id="manual-seats"
            type="number"
            min="1"
            step="1"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            className="text-sm"
          />
        </div>
        <Button type="button" onClick={handleGrant} disabled={isGranting} size="sm">
          {isGranting ? 'Saving…' : isManualActive ? 'Update manual access' : 'Grant manual access'}
        </Button>
        {isManualActive && (
          <Button
            type="button"
            variant="outline"
            onClick={handleRevoke}
            disabled={isRevoking}
            size="sm"
          >
            {isRevoking ? 'Revoking…' : 'Revoke access'}
          </Button>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Billing the customer (invoice + your bank details) is a manual step outside the app — this
        only grants or revokes access.
      </p>
    </div>
  )
}
