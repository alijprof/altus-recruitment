'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  PRESET_OPTIONS,
  type BuyerValuePreset,
} from '@/lib/reports/buyer-value-range'

// Quick task 260524-cwd — REPORT-02.
//
// Client Component that updates `?preset=` (+ optional `?from=&to=`) on the
// `/reports/buyer-value` URL. On change, the RSC page re-renders against the
// new window via `router.push` (server-side navigation).
//
// Cloned from `/reports/source-attribution/date-filter.tsx` per RESEARCH
// §"Pattern 2: Clone, don't refactor" — only the basePath constant differs.
//
// Reasoning (carried over from source-attribution):
//   - The URL is the source of truth for preset / from / to so the
//     `currentPreset` etc. props are read directly from the parent RSC.
//     Back/forward and deep-links stay in sync without any client cache.
//   - `useTransition` gives a tiny "pending" affordance while Next routes;
//     the spinner is intentionally low-key — the page re-render is fast.

type DateFilterProps = {
  currentPreset: BuyerValuePreset
  currentFrom: string
  currentTo: string
}

export function DateFilter({
  currentPreset,
  currentFrom,
  currentTo,
}: DateFilterProps) {
  const router = useRouter()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function navigate(next: URLSearchParams) {
    startTransition(() => {
      router.push(`/reports/buyer-value?${next.toString()}`)
    })
  }

  function selectPreset(preset: BuyerValuePreset) {
    const next = new URLSearchParams(params?.toString() ?? '')
    next.set('preset', preset)
    if (preset !== 'custom') {
      next.delete('from')
      next.delete('to')
    } else {
      // Default the custom window to whatever the page is already
      // displaying — gives the date inputs a sensible starting point.
      if (!next.get('from')) next.set('from', currentFrom)
      if (!next.get('to')) next.set('to', currentTo)
    }
    navigate(next)
  }

  function onCustomSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const from = String(formData.get('from') ?? '').trim()
    const to = String(formData.get('to') ?? '').trim()
    if (!from || !to || from > to) {
      // Server helper falls back to the default window; we still navigate
      // so the user sees the URL update and any error UI the page renders.
    }
    const next = new URLSearchParams(params?.toString() ?? '')
    next.set('preset', 'custom')
    next.set('from', from)
    next.set('to', to)
    navigate(next)
  }

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Date range presets"
      >
        {PRESET_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            variant={opt.value === currentPreset ? 'default' : 'outline'}
            size="sm"
            disabled={isPending}
            onClick={() => selectPreset(opt.value)}
            aria-pressed={opt.value === currentPreset}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {currentPreset === 'custom' && (
        <form
          onSubmit={onCustomSubmit}
          className={cn(
            'flex flex-wrap items-end gap-3 rounded-md border bg-muted/40 p-3',
            isPending && 'opacity-70',
          )}
        >
          <div className="space-y-1">
            <Label htmlFor="custom-from" className="text-xs">
              From
            </Label>
            <Input
              id="custom-from"
              name="from"
              type="date"
              defaultValue={currentFrom}
              required
              className="h-8 w-[10.5rem]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="custom-to" className="text-xs">
              To
            </Label>
            <Input
              id="custom-to"
              name="to"
              type="date"
              defaultValue={currentTo}
              required
              className="h-8 w-[10.5rem]"
            />
          </div>
          <Button type="submit" size="sm" disabled={isPending}>
            Apply
          </Button>
        </form>
      )}
    </div>
  )
}
