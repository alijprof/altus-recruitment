import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSpecDraft } from '@/lib/db/spec-drafts'
import { createClient } from '@/lib/supabase/server'

type Params = { id: string }

// Polls every 4s while the draft is pending/transcribing. Once status flips
// to ready_for_review or approved we redirect into the review page. On
// failure we render the parse_error with a "back to upload" CTA.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SpecStatusPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { id } = await params
  const supabase = await createClient()
  const result = await getSpecDraft(supabase, id)
  if (!result.ok) {
    if (result.code === 'not_found') notFound()
    throw new Error('Failed to load spec draft')
  }
  const draft = result.data

  if (draft.status === 'ready_for_review' || draft.status === 'approved') {
    redirect(`/spec/${id}/review`)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Auto-refresh via meta until status changes. Server re-renders on
          each tick because dynamic + revalidate=0; cheap because the row
          is a single primary-key lookup. */}
      {draft.status === 'pending' || draft.status === 'transcribing' ? (
        <meta httpEquiv="refresh" content="4" />
      ) : null}

      <div>
        <Button
          variant="link"
          asChild
          className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal"
        >
          <Link href="/spec">← All spec calls</Link>
        </Button>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {draft.status === 'failed' ? 'Transcription failed' : 'Transcribing…'}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status: {draft.status}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {draft.status === 'pending' ? (
            <p>Your recording is queued. This page will refresh automatically.</p>
          ) : null}
          {draft.status === 'transcribing' ? (
            <p>
              Transcribing audio and drafting the JD. Typical turnaround is 30-60
              seconds. This page will refresh automatically.
            </p>
          ) : null}
          {draft.status === 'failed' ? (
            <>
              <p className="text-destructive font-medium">
                {draft.parse_error ?? 'Something went wrong.'}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/spec/new">Upload another recording</Link>
              </Button>
            </>
          ) : null}
          {draft.status === 'rejected' ? (
            <p className="text-muted-foreground">This draft was rejected.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
