'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ConfidenceBadge, type ConfidenceLevel } from '@/components/app/confidence-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { CandidateCvRow } from '@/lib/db/candidate-cvs'

import { acceptCVFieldsAction, retryParseAction } from './actions'

type CvReviewPanelProps = {
  candidateCv: CandidateCvRow
  candidateFullName: string
}

// Labels shown in the review sheet. Keeps the order stable across renders
// so the sheet doesn't reflow on re-parse.
const FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'location', label: 'Location' },
  { key: 'current_role', label: 'Current role' },
  { key: 'current_company', label: 'Current company' },
  { key: 'seniority_level', label: 'Seniority' },
  { key: 'years_experience_total', label: 'Years experience' },
  { key: 'salary_current_estimate', label: 'Current salary (est.)' },
  { key: 'salary_expectation', label: 'Salary expectation' },
  { key: 'skills', label: 'Skills' },
  { key: 'sector_tags', label: 'Sectors' },
]

type ExtractedShape = {
  [key: string]: unknown
  confidence_per_field?: Record<string, ConfidenceLevel>
}

function isConfidence(value: unknown): value is ConfidenceLevel {
  return value === 'high' || value === 'medium' || value === 'low'
}

function formatValue(value: unknown): string {
  if (value == null) return '—'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.join(', ')
  }
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}

function ReviewSheetBody({ extracted }: { extracted: ExtractedShape }) {
  return (
    <div className="space-y-2 px-4">
      {FIELD_LABELS.map(({ key, label }) => {
        const value = extracted[key]
        const confidence = extracted.confidence_per_field?.[key]
        // Don't render rows for fields the model didn't return at all,
        // EXCEPT for the always-present `name` (so the sheet never looks
        // empty for a candidate where the CV was thin).
        if (key !== 'name' && value == null && !confidence) return null
        return (
          <div
            key={key}
            className="flex items-start justify-between gap-3 border-b py-2 last:border-b-0"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-muted-foreground text-xs font-normal">{label}</p>
              <p className="break-words text-sm font-normal">{formatValue(value)}</p>
            </div>
            {isConfidence(confidence) ? (
              <ConfidenceBadge confidence={confidence} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function PendingState() {
  const router = useRouter()
  // Lazy useState initializer runs once on mount — keeps the impure Date.now()
  // out of the render body (calling it during render trips react-hooks/purity).
  const [startedAt] = useState(() => Date.now())

  // Poll the route every 3s while the CV is still parsing. router.refresh()
  // re-fetches the RSC tree, so when the Inngest job marks the row
  // complete/failed, the parent CvReviewPanel switches to a different
  // child and this component unmounts — naturally stopping the loop.
  //
  // Cap at 5 minutes so a silently stalled parse doesn't spin forever.
  // Sentry / Inngest dashboards will surface the underlying failure.
  useEffect(() => {
    const MAX_DURATION_MS = 5 * 60_000
    const INTERVAL_MS = 3_000
    const id = setInterval(() => {
      if (Date.now() - startedAt > MAX_DURATION_MS) {
        clearInterval(id)
        return
      }
      router.refresh()
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [router, startedAt])

  return (
    <div className="bg-card space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Latest CV</h3>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-normal">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Parsing…
        </span>
      </div>
      <Progress className="h-1" />
      <p className="text-muted-foreground text-xs font-normal">
        AI is extracting structured fields. This usually takes under 30 seconds.
      </p>
    </div>
  )
}

function FailedState({
  candidateCvId,
}: {
  candidateCvId: string
}) {
  const [isPending, startTransition] = useTransition()

  const onRetry = () => {
    startTransition(async () => {
      const result = await retryParseAction({ candidateCvId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Retrying — parsing again…')
    })
  }

  return (
    <Alert variant="default" className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <AlertTriangle className="size-4" aria-hidden />
      <AlertTitle className="text-sm font-semibold">CV parsing failed.</AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-xs font-normal">
          You can retry now or continue and parse later.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={isPending}
          className="bg-background"
        >
          {isPending ? 'Retrying…' : 'Try again'}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function CompleteState({
  candidateCv,
  candidateFullName,
}: {
  candidateCv: CandidateCvRow
  candidateFullName: string
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const extracted = (candidateCv.extracted_data ?? {}) as ExtractedShape

  const onAcceptAll = () => {
    startTransition(async () => {
      const result = await acceptCVFieldsAction({ candidateCvId: candidateCv.id })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const count = result.fieldsPopulated.length
      if (count === 0) {
        toast.message('No empty fields to fill — candidate already up to date.')
      } else {
        toast.success(
          `Filled ${count} ${count === 1 ? 'field' : 'fields'} from the CV.`,
        )
      }
      setOpen(false)
    })
  }

  return (
    <div className="bg-card space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Latest CV</h3>
        <span className="text-muted-foreground text-xs font-normal">
          Parsing complete
        </span>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button size="sm" variant="outline" className="w-full">
            Review extracted data
          </Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-md"
          aria-describedby="cv-review-description"
        >
          <SheetHeader>
            <SheetTitle className="text-sm font-semibold">
              Review extracted data
            </SheetTitle>
            <SheetDescription
              id="cv-review-description"
              className="text-xs font-normal"
            >
              AI-extracted fields from {candidateFullName}&apos;s CV. Accept all
              fills any empty candidate fields — your manually-entered values
              are never overwritten.
            </SheetDescription>
          </SheetHeader>
          <Separator />
          <ReviewSheetBody extracted={extracted} />
          <SheetFooter className="border-t">
            <Button
              type="button"
              onClick={onAcceptAll}
              disabled={isPending}
              size="sm"
              className="w-full"
            >
              {isPending ? 'Accepting…' : 'Accept all'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

export function CvReviewPanel({ candidateCv, candidateFullName }: CvReviewPanelProps) {
  if (candidateCv.parsing_status === 'pending') {
    return <PendingState />
  }
  if (candidateCv.parsing_status === 'failed') {
    return <FailedState candidateCvId={candidateCv.id} />
  }
  return <CompleteState candidateCv={candidateCv} candidateFullName={candidateFullName} />
}
