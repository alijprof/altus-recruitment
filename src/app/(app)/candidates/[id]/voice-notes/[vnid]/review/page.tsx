import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getVoiceNote } from '@/lib/db/voice-notes'
import { createClient } from '@/lib/supabase/server'

import { VoiceNoteReviewForm } from './voice-note-review-form'

export default async function VoiceNoteReviewPage({
  params,
}: {
  params: Promise<{ id: string; vnid: string }>
}) {
  const { id: candidateId, vnid } = await params
  const supabase = await createClient()
  const result = await getVoiceNote(supabase, vnid)

  if (!result.ok) {
    if (result.code === 'not_found') notFound()
    throw new Error('Failed to load voice note')
  }
  const voiceNote = result.data

  // WR-07: cross-resource binding — the voice note must belong to the
  // candidate in the URL. Mirrors the assertion in applyVoiceNoteAction /
  // rejectVoiceNoteAction so a mismatched URL never renders another
  // candidate's proposal in this candidate's context.
  if (voiceNote.candidate_id !== candidateId) notFound()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="link"
          asChild
          className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal"
        >
          <Link href={`/candidates/${candidateId}`}>← Back to candidate</Link>
        </Button>
      </div>

      {/* ---- Processing state (pending / transcribing) ---- */}
      {(voiceNote.status === 'pending' || voiceNote.status === 'transcribing') && (
        <Card>
          <CardContent className="py-8">
            <div
              className="bg-muted/40 flex flex-col items-center gap-4 rounded-md p-6 text-center"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-2">
                <span className="inline-block size-2.5 animate-pulse rounded-full bg-amber-500" />
                <p className="text-sm font-medium">Processing your voice note…</p>
              </div>
              <p className="text-muted-foreground text-sm">
                This usually takes under 30 seconds. Check back in a moment.
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/candidates/${candidateId}/voice-notes/${vnid}/review`}>
                  Refresh
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Applied state ---- */}
      {voiceNote.status === 'applied' && (
        <div
          className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800"
          role="alert"
        >
          <p className="font-medium">Changes applied successfully.</p>
          <p className="mt-1">
            The approved fields have been updated on the candidate record.
          </p>
          <Button variant="link" asChild className="-ml-3 mt-2 h-auto p-0 text-sm text-green-700">
            <Link href={`/candidates/${candidateId}`}>Back to candidate →</Link>
          </Button>
        </div>
      )}

      {/* ---- Rejected state ---- */}
      {voiceNote.status === 'rejected' && (
        <div className="bg-muted/30 rounded-md border p-4 text-sm" role="alert">
          <p className="text-muted-foreground font-medium">Voice note rejected.</p>
          <p className="text-muted-foreground mt-1">
            The proposed changes were discarded. Your transcript is still saved.
          </p>
          <Button variant="link" asChild className="text-muted-foreground -ml-3 mt-2 h-auto p-0 text-sm">
            <Link href={`/candidates/${candidateId}`}>Back to candidate →</Link>
          </Button>
        </div>
      )}

      {/* ---- Failed state ---- */}
      {voiceNote.status === 'failed' && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">Something went wrong processing this voice note.</p>
          <p className="mt-1">
            {voiceNote.parse_error ??
              'Please try again or log your note manually.'}
          </p>
          <Button variant="link" asChild className="text-destructive -ml-3 mt-2 h-auto p-0 text-sm">
            <Link href={`/candidates/${candidateId}`}>Log manually →</Link>
          </Button>
        </div>
      )}

      {/* ---- Ready for review state ---- */}
      {voiceNote.status === 'ready_for_review' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review proposed changes</CardTitle>
          </CardHeader>
          <CardContent>
            <VoiceNoteReviewForm
              voiceNoteId={vnid}
              candidateId={candidateId}
              // reason: structured_data is Json (recursive union from generated
              // types). The Inngest pipeline writes a known-shape VoiceNoteProposal
              // object here. We pass as unknown and the form re-parses it at the
              // client boundary.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              proposal={voiceNote.structured_data as any}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
