'use client'

import { Loader2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  GenerateAdResult,
  InclusivityDimension,
  InclusivityDimensions,
  InclusivitySuggestion,
  ScoreOnlyResult,
} from '@/lib/ai/ad-generate'

import {
  generateAdAction,
  saveJobAdAction,
  scoreInclusivityAction,
} from './actions'

// ---------------------------------------------------------------------------
// Plan 03-04 Task D.3 — AdPanel client component.
//
// Lives inside a parent <Sheet> (mounted in jobs/[id]/page.tsx). Two tabs:
//   1. Generate — calls generateAdAction({ jobId }), renders markdown +
//      inclusivity score + dimensions + suggestions; copy-to-clipboard +
//      save-to-job_ads CTAs.
//   2. Score existing — pasted-ad ephemeral path (D3-14 / D3-31). Renders
//      score + suggestions. Optional "Save score to this job" button uses
//      the pasted text as body_markdown (recruiter opting in).
//
// State machine via discriminated union per project conventions.
// ---------------------------------------------------------------------------

type GenState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: GenerateAdResult }
  | { kind: 'error'; message: string }

type ScoreState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: ScoreOnlyResult; adText: string }
  | { kind: 'error'; message: string }

function ScorePill({ score }: { score: number | null | undefined }) {
  if (score == null) return null
  const variant: 'default' | 'secondary' | 'destructive' =
    score >= 80 ? 'default' : score >= 60 ? 'secondary' : 'destructive'
  return (
    <Badge variant={variant} className="text-xs">
      Inclusivity {score}/100
    </Badge>
  )
}

const DIM_LABELS: Array<{ key: keyof InclusivityDimensions; label: string }> = [
  { key: 'gender', label: 'Gender' },
  { key: 'age', label: 'Age' },
  { key: 'jargon', label: 'Jargon' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'salary_transparency', label: 'Salary' },
]

function DimensionsTable({ dims }: { dims: InclusivityDimensions }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Dimensions
      </h4>
      <div className="space-y-1.5">
        {DIM_LABELS.map(({ key, label }) => {
          const d: InclusivityDimension = dims[key]
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-3 border-b py-1.5 text-sm last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="font-normal">{label}</p>
                {d.rationale ? (
                  <p className="text-muted-foreground text-xs font-normal">
                    {d.rationale}
                  </p>
                ) : null}
                {d.flagged_phrases.length > 0 ? (
                  <p className="text-muted-foreground text-xs font-normal">
                    Flagged: {d.flagged_phrases.join(', ')}
                  </p>
                ) : null}
              </div>
              <span className="tabular-nums text-xs font-normal">{d.score}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SuggestionsList({ items }: { items: readonly InclusivitySuggestion[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Suggestions
      </h4>
      <ul className="space-y-2">
        {items.map((s, i) => (
          <li
            key={`${i}-${s.original}`}
            className="border-l-2 border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/40"
          >
            <p>
              <span className="font-semibold">Replace:</span>{' '}
              <span className="line-through">{s.original}</span>{' '}
              <span aria-hidden>→</span>{' '}
              <span className="font-semibold">{s.improved}</span>
            </p>
            <p className="text-muted-foreground mt-1 font-normal">{s.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generate tab body
// ---------------------------------------------------------------------------

function GenerateTab({ jobId }: { jobId: string }) {
  const [state, setState] = useState<GenState>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const [savePending, startSaveTransition] = useTransition()

  const onGenerate = () => {
    setState({ kind: 'loading' })
    startTransition(async () => {
      const r = await generateAdAction({ jobId })
      if (!r.ok) {
        setState({ kind: 'error', message: r.error })
        return
      }
      setState({ kind: 'ready', data: r.data })
    })
  }

  const onCopy = async () => {
    if (state.kind !== 'ready') return
    try {
      await navigator.clipboard.writeText(state.data.body_markdown)
      toast.success('Ad copied to clipboard.')
    } catch {
      toast.error('Copy failed. Select the text manually.')
    }
  }

  const onSave = () => {
    if (state.kind !== 'ready') return
    const data = state.data
    startSaveTransition(async () => {
      const r = await saveJobAdAction({
        jobId,
        bodyMarkdown: data.body_markdown,
        inclusivityScore: data.inclusivity_score,
        inclusivityDimensions: data.dimensions,
        inclusivitySuggestions: data.suggestions,
        model: data.model,
        costPence: data.costPence,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Saved to job ads.')
    })
  }

  return (
    <div className="space-y-4 px-1 py-2">
      <Button onClick={onGenerate} disabled={isPending} size="sm">
        {isPending ? (
          <>
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Generating…
          </>
        ) : (
          'Generate ad'
        )}
      </Button>

      {state.kind === 'error' && (
        <div
          role="alert"
          className="text-destructive border-destructive/30 bg-destructive/10 rounded border p-2 text-xs"
        >
          {state.message}
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ScorePill score={state.data.inclusivity_score} />
            <span className="text-muted-foreground text-xs font-normal">
              {state.data.model} · {state.data.costPence}p
            </span>
          </div>

          <Separator />

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ad
            </h4>
            <pre className="bg-muted/40 max-h-72 overflow-y-auto rounded border p-3 text-xs font-normal whitespace-pre-wrap">
              {state.data.body_markdown}
            </pre>
          </div>

          <DimensionsTable dims={state.data.dimensions} />
          <SuggestionsList items={state.data.suggestions} />

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button onClick={onCopy} size="sm" variant="outline">
              Copy to clipboard
            </Button>
            <Button onClick={onSave} size="sm" disabled={savePending}>
              {savePending ? 'Saving…' : 'Save to job ads'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Score existing ad tab body — D3-14 ephemeral path
// ---------------------------------------------------------------------------

function ScoreExistingTab({ jobId }: { jobId: string }) {
  const [adText, setAdText] = useState('')
  const [state, setState] = useState<ScoreState>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const [savePending, startSaveTransition] = useTransition()

  const onScore = () => {
    if (adText.trim().length < 20) {
      setState({ kind: 'error', message: 'Paste a longer ad to score.' })
      return
    }
    setState({ kind: 'loading' })
    startTransition(async () => {
      const r = await scoreInclusivityAction({ adText, jobId })
      if (!r.ok) {
        setState({ kind: 'error', message: r.error })
        return
      }
      setState({ kind: 'ready', data: r.data, adText })
    })
  }

  const onSaveScore = () => {
    if (state.kind !== 'ready') return
    const data = state.data
    startSaveTransition(async () => {
      const r = await saveJobAdAction({
        jobId,
        bodyMarkdown: state.adText,
        inclusivityScore: data.inclusivity_score,
        inclusivityDimensions: data.dimensions,
        inclusivitySuggestions: data.suggestions,
        model: data.model,
        costPence: data.costPence,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Score saved to job ads.')
    })
  }

  return (
    <div className="space-y-3 px-1 py-2">
      <label htmlFor="paste-ad" className="text-xs font-semibold">
        Paste an existing ad
      </label>
      <textarea
        id="paste-ad"
        value={adText}
        onChange={(e) => setAdText(e.target.value)}
        placeholder="Paste the full ad here — we'll score it without saving anything unless you opt in."
        className="border-input bg-background focus-visible:ring-ring h-40 w-full resize-y rounded-md border px-3 py-2 text-xs font-normal shadow-sm focus-visible:ring-1 focus-visible:outline-none"
      />
      <Button onClick={onScore} size="sm" disabled={isPending || !adText.trim()}>
        {isPending ? (
          <>
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Scoring…
          </>
        ) : (
          'Score'
        )}
      </Button>

      {state.kind === 'error' && (
        <div
          role="alert"
          className="text-destructive border-destructive/30 bg-destructive/10 rounded border p-2 text-xs"
        >
          {state.message}
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            <ScorePill score={state.data.inclusivity_score} />
            <span className="text-muted-foreground text-xs font-normal">
              {state.data.model} · {state.data.costPence}p (not saved)
            </span>
          </div>
          <DimensionsTable dims={state.data.dimensions} />
          <SuggestionsList items={state.data.suggestions} />
          <Separator />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={onSaveScore}
              size="sm"
              variant="outline"
              disabled={savePending}
            >
              {savePending ? 'Saving…' : 'Save score to this job'}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs font-normal">
            By default this scorer is ephemeral. Saving stores the pasted ad
            text along with the score as a new entry in this job&apos;s ads.
          </p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AdPanel — the container with the two tabs.
// ---------------------------------------------------------------------------

export function AdPanel({ jobId }: { jobId: string }) {
  return (
    <Tabs defaultValue="generate" className="w-full">
      <TabsList>
        <TabsTrigger value="generate">Generate</TabsTrigger>
        <TabsTrigger value="score">Score existing</TabsTrigger>
      </TabsList>
      <TabsContent value="generate">
        <GenerateTab jobId={jobId} />
      </TabsContent>
      <TabsContent value="score">
        <ScoreExistingTab jobId={jobId} />
      </TabsContent>
    </Tabs>
  )
}
