'use client'

// ---------------------------------------------------------------------------
// OverrideForm — client component for the admin per-org override form.
//
// Manages form state (trial extension + cap multiplier) and calls the gated
// server actions. Errors and success are surfaced via sonner toast (CLAUDE.md
// mandate: no silent success; no silent failure).
//
// SECURITY NOTE: This component receives already-fetched data as props — it
// never holds or imports the service-role client. The gate is enforced in:
//   1. The admin layout (requireSuperAdmin before render)
//   2. The server actions (requireSuperAdmin re-checked before each write)
// ---------------------------------------------------------------------------

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { extendTrialAction, setCapOverrideAction } from '@/app/admin/actions'
import type { OrgAdminDetail } from '@/lib/admin/queries'

type Props = {
  orgId: string
  override: OrgAdminDetail['override']
}

export function OverrideForm({ orgId, override }: Props) {
  // Trial extension state
  const [trialEnd, setTrialEnd] = useState<string>(
    override?.trialEndOverride
      ? // Convert ISO to the datetime-local input format (YYYY-MM-DDTHH:mm)
        override.trialEndOverride.slice(0, 16)
      : '',
  )

  // Cap multiplier state (empty string = cleared/no override)
  const [capMultiplier, setCapMultiplier] = useState<string>(
    override?.capMultiplier != null ? String(override.capMultiplier) : '',
  )
  const [overrideNote, setOverrideNote] = useState<string>(override?.note ?? '')

  const [isPendingTrial, startTrialTransition] = useTransition()
  const [isPendingCap, startCapTransition] = useTransition()

  function handleExtendTrial() {
    if (!trialEnd) {
      toast.error('Enter a trial end date before saving.')
      return
    }

    // Convert local datetime-local value to UTC ISO string
    const utcIso = new Date(trialEnd).toISOString()

    startTrialTransition(async () => {
      try {
        const result = await extendTrialAction(orgId, utcIso)
        if (result.ok) {
          toast.success(result.message)
        } else {
          toast.error(result.error)
        }
      } catch (err) {
        console.error('extendTrialAction failed:', err)
        toast.error(err instanceof Error ? err.message : 'Failed to extend trial')
      }
    })
  }

  function handleSetCap() {
    const multiplierValue = capMultiplier === '' ? null : parseFloat(capMultiplier)

    if (multiplierValue !== null && (isNaN(multiplierValue) || multiplierValue <= 0)) {
      toast.error('Cap multiplier must be a positive number (e.g. 1.5 for +50%).')
      return
    }

    startCapTransition(async () => {
      try {
        const result = await setCapOverrideAction(
          orgId,
          multiplierValue,
          overrideNote || undefined,
        )
        if (result.ok) {
          toast.success(result.message)
        } else {
          toast.error(result.error)
        }
      } catch (err) {
        console.error('setCapOverrideAction failed:', err)
        toast.error(err instanceof Error ? err.message : 'Failed to set cap override')
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Trial Extension */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Extend trial</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Sets trial_end_override on this org. The entitlement helper will treat the org as
            trialing until this date, regardless of the subscription row&apos;s trial_end.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="trial-end" className="text-xs">
              New trial end (local time, converted to UTC on save)
            </Label>
            <Input
              id="trial-end"
              type="datetime-local"
              value={trialEnd}
              onChange={(e) => setTrialEnd(e.target.value)}
              className="text-sm"
            />
          </div>
          <Button
            type="button"
            onClick={handleExtendTrial}
            disabled={isPendingTrial || !trialEnd}
            size="sm"
          >
            {isPendingTrial ? 'Saving…' : 'Save trial extension'}
          </Button>
        </div>
        {override?.trialEndOverride && (
          <p className="text-xs text-amber-700">
            Current override: {new Date(override.trialEndOverride).toLocaleString('en-GB')}
          </p>
        )}
      </div>

      <Separator />

      {/* Cap Override */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Cap multiplier</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Multiplies all AI cap buckets for this org. 1.0 = baseline (no change). 1.5 = 50%
            more. Leave blank to clear the override and revert to plan defaults.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="cap-multiplier" className="text-xs">
              Multiplier (e.g. 1.5)
            </Label>
            <Input
              id="cap-multiplier"
              type="number"
              step="0.1"
              min="0.1"
              placeholder="1.0 (no override)"
              value={capMultiplier}
              onChange={(e) => setCapMultiplier(e.target.value)}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="override-note" className="text-xs">
              Note (reason, optional)
            </Label>
            <Input
              id="override-note"
              type="text"
              placeholder="e.g. demo extension for TechCorp"
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              className="text-sm"
            />
          </div>
        </div>
        <div className="flex justify-between">
          <Button
            type="button"
            onClick={handleSetCap}
            disabled={isPendingCap}
            size="sm"
          >
            {isPendingCap ? 'Saving…' : 'Save cap override'}
          </Button>
          {override?.capMultiplier != null && (
            <p className="self-center text-xs text-amber-700">
              Current: {override.capMultiplier}× ({override.note ?? 'no note'})
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
