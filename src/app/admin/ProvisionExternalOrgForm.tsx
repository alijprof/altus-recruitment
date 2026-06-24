'use client'

// ---------------------------------------------------------------------------
// ProvisionExternalOrgForm — one-click onboarding of a brand-new external
// customer (handover blocker 3).
//
// Creates an isolated organisation, grants invoice-billed (no-Stripe) access,
// sets a per-org monthly AI-spend cap, and emails the customer a login link via
// Resend — so they NEVER hit the first-login paywall/card screen and the link
// bypasses Supabase's auth-email throttle. Same security model as the other
// admin forms: holds no service-role client; the gate is enforced in the admin
// layout AND re-checked inside provisionExternalOrgAction.
// ---------------------------------------------------------------------------

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { provisionExternalOrgAction } from '@/app/admin/actions'

const PLAN_OPTIONS = [
  { key: 'starter', label: 'Starter' },
  { key: 'pro', label: 'Pro' },
  { key: 'scale', label: 'Scale' },
] as const

export function ProvisionExternalOrgForm() {
  const [email, setEmail] = useState('')
  const [orgName, setOrgName] = useState('')
  const [fullName, setFullName] = useState('')
  const [planKey, setPlanKey] = useState<string>('starter')
  const [seats, setSeats] = useState('3')
  const [capPounds, setCapPounds] = useState('50')
  const [isPending, start] = useTransition()

  function handleSubmit() {
    const trimmedEmail = email.trim()
    const trimmedOrg = orgName.trim()
    if (!trimmedEmail || !trimmedOrg) {
      toast.error('Customer email and organisation name are required.')
      return
    }
    const seatsValue = Number.parseInt(seats, 10)
    if (!Number.isInteger(seatsValue) || seatsValue < 1) {
      toast.error('Enter a seat count of 1 or more.')
      return
    }
    // Blank cap → no per-org cap (the global backstop still applies).
    // 0 → an explicit £0 freeze (block all AI). Anything else → that ceiling.
    let monthlySpendCapPence: number | null = null
    const capTrim = capPounds.trim()
    if (capTrim !== '') {
      const pounds = Number(capTrim)
      if (!Number.isFinite(pounds) || pounds < 0) {
        toast.error('Monthly £ cap must be 0 or more (or blank for no per-org cap).')
        return
      }
      monthlySpendCapPence = Math.round(pounds * 100)
    }

    start(async () => {
      try {
        const result = await provisionExternalOrgAction({
          email: trimmedEmail,
          orgName: trimmedOrg,
          fullName: fullName.trim() || undefined,
          planKey,
          seats: seatsValue,
          monthlySpendCapPence,
        })
        if (result.ok) {
          toast.success(result.message)
          setEmail('')
          setOrgName('')
          setFullName('')
        } else {
          toast.error(result.error)
        }
      } catch (err) {
        console.error('provisionExternalOrgAction failed:', err)
        toast.error(err instanceof Error ? err.message : 'Failed to provision the customer')
      }
    })
  }

  return (
    <div className="rounded-lg border bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Provision external customer</h2>
      <p className="mt-1 text-xs text-slate-500">
        Creates a brand-new isolated organisation, grants invoice-billed (no-Stripe) access, sets a
        monthly AI-spend cap, and emails the customer a login link via Resend — so they never see
        the paywall. For NEW emails only (not already in the system).
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="prov-email" className="text-xs">
            Customer email
          </Label>
          <Input
            id="prov-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="liam@steelecharles.com"
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prov-org" className="text-xs">
            Organisation name
          </Label>
          <Input
            id="prov-org"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Steele Charles"
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prov-name" className="text-xs">
            Owner name (optional)
          </Label>
          <Input
            id="prov-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Liam"
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prov-plan" className="text-xs">
            Plan
          </Label>
          <select
            id="prov-plan"
            value={planKey}
            onChange={(e) => setPlanKey(e.target.value)}
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            {PLAN_OPTIONS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="prov-seats" className="text-xs">
            Seats
          </Label>
          <Input
            id="prov-seats"
            type="number"
            min="1"
            step="1"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="prov-cap" className="text-xs">
            Monthly AI £ cap (blank = none)
          </Label>
          <Input
            id="prov-cap"
            type="number"
            min="0"
            step="1"
            value={capPounds}
            onChange={(e) => setCapPounds(e.target.value)}
            placeholder="50"
            className="text-sm"
          />
        </div>
      </div>

      <Button type="button" onClick={handleSubmit} disabled={isPending} size="sm" className="mt-4">
        {isPending ? 'Provisioning…' : 'Provision + email login link'}
      </Button>
    </div>
  )
}
