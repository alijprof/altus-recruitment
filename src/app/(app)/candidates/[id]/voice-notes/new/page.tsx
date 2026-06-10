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

      <div className="bg-card rounded-md border p-6">
        <VoiceNoteForm candidateId={id} />
      </div>
    </div>
  )
}
