import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { getCandidate } from '@/lib/db/candidates'
import { listFloatsForCandidate } from '@/lib/db/shortlists'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { formatTimeAgo } from '@/lib/date'

import { FloatForm } from './float-form'
import { FloatRowActions } from './float-row-actions'

/**
 * Per-candidate floats tab (SHORT-02).
 *
 * Floats are speculative candidate submissions with NO job attached
 * (application_type='float', job_id IS NULL). They live on the candidate's
 * own page (so the recruiter can see all the prospects they've floated this
 * person to) and on the global /floats list (org-wide visibility).
 *
 * Adding a float requires no job — that's the entire point. The CHECK
 * constraint at the DB layer enforces (float => job_id IS NULL); the
 * null-safe FK guard (20260520010420_*.sql) lets the insert pass.
 */
export default async function CandidateFloatsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseClient()

  const candidateResult = await getCandidate(supabase, id)
  if (!candidateResult.ok) {
    if (candidateResult.code === 'not_found') notFound()
    return (
      <div className="text-destructive p-8">
        Couldn&apos;t load this candidate. Please refresh.
      </div>
    )
  }
  const candidate = candidateResult.data

  const floatsResult = await listFloatsForCandidate(supabase, id)
  const rows = floatsResult.ok ? floatsResult.data : []

  // Pull the most recent "note" activity per float application so the row
  // can display whatever context the recruiter typed at submission time.
  // Single query keyed by entity_id; we shape it into a Map below.
  let notesByApp = new Map<string, string>()
  if (rows.length > 0) {
    const { data: noteRows } = await supabase
      .from('activities')
      .select('entity_id, body, occurred_at')
      .eq('entity_type', 'application')
      .eq('kind', 'note')
      .in(
        'entity_id',
        rows.map((r) => r.id),
      )
      .order('occurred_at', { ascending: false })
    if (noteRows) {
      // First occurrence per entity_id wins (newest, because of the order).
      const seen = new Map<string, string>()
      for (const r of noteRows) {
        if (!seen.has(r.entity_id) && r.body) {
          seen.set(r.entity_id, r.body)
        }
      }
      notesByApp = seen
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/candidates/${id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          {candidate.full_name}
        </Link>
        <Button asChild variant="outline">
          <Link href="/floats">All floats</Link>
        </Button>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{candidate.full_name} — Floats</h1>
        <p className="text-muted-foreground text-sm">
          Speculative submissions with no job attached. Useful for staying
          front-of-mind with clients between briefs.
        </p>
      </div>

      <section className="bg-card space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Add a float</h2>
        <FloatForm candidateId={id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Floats ({rows.length})</h2>
        {rows.length === 0 ? (
          <div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">
            No floats yet. Use the form above to record a speculative submission.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const note = notesByApp.get(row.id) ?? null
              return (
                <li
                  key={row.id}
                  className="bg-card flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <div className="text-muted-foreground text-xs">
                      Added {formatTimeAgo(row.created_at)}
                    </div>
                    {note ? (
                      <p className="whitespace-pre-wrap">{note}</p>
                    ) : (
                      <p className="text-muted-foreground italic">No note.</p>
                    )}
                  </div>
                  <FloatRowActions applicationId={row.id} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
