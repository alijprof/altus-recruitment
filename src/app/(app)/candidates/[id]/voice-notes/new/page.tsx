import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getCandidate } from '@/lib/db/candidates'
import { createClient } from '@/lib/supabase/server'

import { VoiceNoteForm } from '../voice-note-form'

export default async function VoiceNoteNewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch candidate to display name in heading and enforce RLS tenant scoping.
  const candidateResult = await getCandidate(supabase, id)
  if (!candidateResult.ok) {
    if (candidateResult.code === 'not_found') notFound()
    return (
      <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
        Couldn&apos;t load this candidate. Please refresh.
      </div>
    )
  }
  const candidate = candidateResult.data

  // Surface unfinished notes so the header badge dot is actionable: without
  // this list, a note left at ready_for_review (recruiter navigated away
  // before applying) is unreachable — the review page is otherwise only
  // linked from the post-submit redirect. RLS scopes the query to the org.
  const { data: openNotes } = await supabase
    .from('voice_notes')
    .select('id, status, created_at')
    .eq('candidate_id', id)
    .in('status', ['pending', 'ready_for_review'])
    .order('created_at', { ascending: false })

  const awaitingReview = (openNotes ?? []).filter((n) => n.status === 'ready_for_review')
  const stillProcessing = (openNotes ?? []).filter((n) => n.status === 'pending')
  const formatWhen = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    )

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Voice note &mdash; {candidate.full_name}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Record or upload a voice note. Altus will transcribe it and extract key updates for
          you to review.
        </p>
      </div>

      {awaitingReview.length > 0 ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm"
          role="status"
        >
          <p className="font-semibold text-amber-900">
            {awaitingReview.length === 1
              ? 'A voice note is awaiting your review'
              : `${awaitingReview.length} voice notes are awaiting your review`}
          </p>
          <ul className="mt-2 space-y-1">
            {awaitingReview.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/candidates/${id}/voice-notes/${n.id}/review`}
                  className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
                >
                  Review proposed changes ({formatWhen(n.created_at)})
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {stillProcessing.length > 0 ? (
        <div className="text-muted-foreground rounded-md border bg-muted/30 p-4 text-sm" role="status">
          {stillProcessing.length === 1
            ? 'A voice note is still processing — its review will be ready shortly.'
            : `${stillProcessing.length} voice notes are still processing — their reviews will be ready shortly.`}
        </div>
      ) : null}

      <div className="bg-card rounded-md border p-6">
        <VoiceNoteForm candidateId={id} />
      </div>
    </div>
  )
}
