'use client'

import { Loader2, Search } from 'lucide-react'
import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { nlQueryAction } from '../actions'
import { NlResultTable } from './NlResultTable'

// ---------------------------------------------------------------------------
// Plan 04-07 Task 2 — NL query form.
//
// Client Component: Textarea → nlQueryAction → matched-template transparency
// + NlResultTable, or no-match / error inline alerts with role="alert".
// State machine follows the discriminated union pattern from send-checkin-modal.
// ---------------------------------------------------------------------------

type Status =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'success'; matchedTemplate: string; rows: Record<string, unknown>[]; question: string }
  | { kind: 'no-match' }
  | { kind: 'error'; message: string }

// 3 example questions shown on no-match — per UI-SPEC
const EXAMPLE_QUESTIONS = [
  'How many placements did we make last quarter by sector?',
  'Time to fill by recruiter over the last 90 days',
  'Source ROI for the last year',
]

export function NlQueryForm() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const question = textareaRef.current?.value?.trim() ?? ''
    if (!question) return

    setStatus({ kind: 'asking' })
    startTransition(async () => {
      const result = await nlQueryAction(question)
      if (!result.ok) {
        if (result.error === 'no-matching-template') {
          setStatus({ kind: 'no-match' })
        } else {
          setStatus({ kind: 'error', message: result.error })
        }
        return
      }
      setStatus({
        kind: 'success',
        matchedTemplate: result.matchedTemplate,
        rows: result.rows,
        question: result.question,
      })
    })
  }

  function prefillQuestion(q: string) {
    if (textareaRef.current) {
      textareaRef.current.value = q
      textareaRef.current.focus()
    }
    setStatus({ kind: 'idle' })
  }

  const isAsking = isPending || status.kind === 'asking'

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="nl-question">Your question</Label>
          <Textarea
            id="nl-question"
            ref={textareaRef}
            rows={2}
            placeholder="e.g. How many placements did we make last quarter by sector?"
            disabled={isAsking}
            className="resize-none"
          />
          <p className="text-muted-foreground text-xs">
            Questions are matched to pre-validated report templates — no free-form SQL.
          </p>
        </div>

        <Button type="submit" disabled={isAsking}>
          {isAsking ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              Asking…
            </>
          ) : (
            <>
              <Search className="mr-2 size-4" aria-hidden />
              Ask
            </>
          )}
        </Button>
      </form>

      {/* Success state */}
      {status.kind === 'success' && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">
            Matched template:{' '}
            <span className="text-foreground font-medium">{status.matchedTemplate}</span>
          </p>
          <NlResultTable rows={status.rows} />
          <p className="text-muted-foreground text-xs">
            {status.rows.length} row{status.rows.length !== 1 ? 's' : ''} returned
          </p>
        </div>
      )}

      {/* No-match state */}
      {status.kind === 'no-match' && (
        <div role="alert" className="rounded-md border bg-muted/40 p-4 text-sm">
          <p className="mb-3">
            No matching report template. Try rephrasing your question, or choose from the example
            questions below.
          </p>
          <ul className="space-y-1">
            {EXAMPLE_QUESTIONS.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => prefillQuestion(q)}
                  className="text-sm underline hover:no-underline"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error state */}
      {status.kind === 'error' && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
        >
          Couldn&apos;t run that report. {status.message}. Please try again.
        </div>
      )}
    </div>
  )
}
