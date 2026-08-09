'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import Link from 'next/link'
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
import {
  CV_PARSE_FAILED_MESSAGE,
  isBudgetCapped,
  isUnretryableParseFailure,
  isUploadIncomplete,
} from '@/lib/cv/parse-messages'
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
              <p className="text-sm font-normal break-words">{formatValue(value)}</p>
            </div>
            {isConfidence(confidence) ? <ConfidenceBadge confidence={confidence} /> : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Shared retry transition + toast handling for the amber "failed"/"stuck"
 * panels below. Factored out so PendingState's post-timeout retry button
 * and FailedState's retry buttons behave identically.
 */
function useRetryParse(candidateCvId: string, onSuccess?: () => void) {
  const [isPending, startTransition] = useTransition()
  const onRetry = () => {
    startTransition(async () => {
      const result = await retryParseAction({ candidateCvId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Retrying — parsing again…')
      // Review 2026-08-04 C3: callers that hold local "we've been waiting too
      // long" state MUST reset it here. Without this the retry succeeded on
      // the server while the component stayed frozen in its timed-out state.
      onSuccess?.()
    })
  }
  return { isPending, onRetry }
}

function PendingState({ candidateCvId }: { candidateCvId: string }) {
  const router = useRouter()
  // Lazy useState initializer runs once on mount — keeps the impure Date.now()
  // out of the render body (calling it during render trips react-hooks/purity).
  const [startedAt, setStartedAt] = useState(() => Date.now())
  // SF-5 fix: the 5-minute cap used to only stop the poll and leave "Parsing…"
  // forever with no way out. Now it flips into an honest timed-out state with
  // a retry affordance.
  const [timedOut, setTimedOut] = useState(false)
  // Review 2026-08-04 C3: `timedOut` used to be a one-way latch. The poll
  // effect cleared its interval and never re-ran (startedAt was frozen by the
  // lazy initialiser and router is stable), and retryParseAction's
  // revalidatePath re-rendered <PendingState> at the identical tree position
  // with parsing_status still 'pending' — so React reused the instance and
  // the latch survived. The user got a success toast and an amber alert that
  // never changed again, with no polling: a dead end with extra steps, i.e.
  // the very SF-5 failure this state was added to close.
  //
  // Resetting startedAt is what re-arms it: startedAt is a dependency of the
  // poll effect, so a new value tears down the (already-cleared) interval and
  // installs a fresh one, with the 5-minute budget restarted.
  const { isPending, onRetry } = useRetryParse(candidateCvId, () => {
    setTimedOut(false)
    setStartedAt(Date.now())
  })

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
        setTimedOut(true)
        return
      }
      router.refresh()
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [router, startedAt])

  if (timedOut) {
    return (
      <Alert
        variant="default"
        className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle className="text-sm font-semibold">
          This is taking longer than expected.
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-xs font-normal">
            Parsing normally finishes in under 30 seconds. You can retry now, or upload the CV again
            if the problem continues.
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
  parseError,
}: {
  candidateCvId: string
  parseError?: string | null
}) {
  const { isPending, onRetry } = useRetryParse(candidateCvId)

  // Batch A item 1 / SF-1 fix: the predicates all come from the shared
  // src/lib/cv/parse-messages.ts module so the server (parse-cv.ts,
  // reconcile-cv-parses.ts) and this client component can never drift on the
  // sentinel substrings.
  const budgetCapped = isBudgetCapped(parseError)
  // Plan 06-07 Task 3: a single gate replaces the three separate no-retry
  // branches this used to have (unparseable, uploadIncomplete, and — before
  // this plan — no honest copy at all for damaged/password-protected/wrong-
  // format/unsupported-format). Retrying the SAME stored bytes cannot
  // possibly succeed for ANY class this predicate matches — see
  // isUnretryableParseFailure's doc comment for the full class list and
  // what's deliberately excluded (budget-capped, stuck, generic, truncated).
  const unretryable = isUnretryableParseFailure(parseError)
  const uploadIncomplete = isUploadIncomplete(parseError)

  // Review 2026-08-04 C2: render what the server actually stored. The generic
  // branch used to hardcode its body copy and never read `parseError` at all,
  // so every message this codebase writes that isn't budget-capped or
  // unparseable (CV_UPLOAD_INCOMPLETE_MESSAGE, CV_STUCK_MESSAGE) was
  // write-only — the recruiter saw boilerplate instead of the real reason.
  //
  // PII-safe by construction: parse_error only ever holds one of the
  // exported message constants in src/lib/cv/parse-messages.ts (or the
  // retry-dispatch string in retryParseAction). The technical root cause
  // lives in parse_error_detail, which NO UI reads.
  const message = parseError ?? CV_PARSE_FAILED_MESSAGE

  if (budgetCapped) {
    return (
      <Alert
        variant="default"
        className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle className="text-sm font-semibold">
          AI budget reached — parsing paused until reset.
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-xs font-normal">
            Parsing resumes automatically when your monthly AI budget resets. To raise it sooner,
            contact us. Everything else still works — the CV is saved. If the budget has since reset
            or been raised, a retry works right now too.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="bg-background">
              <Link href="/settings/billing">View AI budget</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={isPending}
              className="bg-background"
            >
              {isPending ? 'Retrying…' : 'Try again now'}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (unretryable) {
    // Plan 06-07 Task 3: one gate for every class where retrying the SAME
    // stored bytes cannot possibly succeed — no "Try again" button in any
    // of them. The candidate page's existing upload control is the
    // re-upload path; we don't add a second uploader.
    //
    // uploadIncomplete keeps its distinct guidance copy (SF-4/SF-5, review
    // 2026-08-04 C2): there is NO storage object for this row — the client
    // PUT never completed — so the extra line pointing at the Upload CV
    // control is meaningfully different from "the file itself is bad".
    // Every other unretryable class (no-text, damaged, password-protected,
    // wrong-format, unsupported-format) renders the stored message alone.
    if (uploadIncomplete) {
      return (
        <Alert
          variant="default"
          className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle className="text-sm font-semibold">CV upload didn&apos;t finish.</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="text-xs font-normal">{message}</p>
            <p className="text-xs font-normal">
              Use the <span className="font-semibold">Upload CV</span> control on this page to add
              the file again — there&apos;s nothing stored to retry.
            </p>
          </AlertDescription>
        </Alert>
      )
    }
    return (
      <Alert
        variant="default"
        className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle className="text-sm font-semibold">CV parsing failed.</AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-xs font-normal">{message}</p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert
      variant="default"
      className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <AlertTriangle className="size-4" aria-hidden />
      <AlertTitle className="text-sm font-semibold">CV parsing failed.</AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-xs font-normal">{message}</p>
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
  const router = useRouter()
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
        toast.success(`Filled ${count} ${count === 1 ? 'field' : 'fields'} from the CV.`)
      }
      setOpen(false)
      // Refresh so the candidate's newly filled fields render immediately.
      router.refresh()
    })
  }

  return (
    <div className="bg-card space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Latest CV</h3>
        <span className="text-muted-foreground text-xs font-normal">Parsing complete</span>
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
            <SheetTitle className="text-sm font-semibold">Review extracted data</SheetTitle>
            <SheetDescription id="cv-review-description" className="text-xs font-normal">
              AI-extracted fields from {candidateFullName}&apos;s CV. Accept all fills any empty
              candidate fields — your manually-entered values are never overwritten.
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
    return <PendingState candidateCvId={candidateCv.id} />
  }
  if (candidateCv.parsing_status === 'failed') {
    return <FailedState candidateCvId={candidateCv.id} parseError={candidateCv.parse_error} />
  }
  return <CompleteState candidateCv={candidateCv} candidateFullName={candidateFullName} />
}
