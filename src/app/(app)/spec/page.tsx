import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listSpecDrafts, type SpecDraftRow, type SpecDraftStatus } from '@/lib/db/spec-drafts'
import { createClient } from '@/lib/supabase/server'

function statusLabel(status: SpecDraftStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'transcribing':
      return 'Transcribing'
    case 'ready_for_review':
      return 'Ready for review'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    case 'failed':
      return 'Failed'
  }
}

function statusVariant(
  status: SpecDraftStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ready_for_review') return 'default'
  if (status === 'failed') return 'destructive'
  if (status === 'approved') return 'secondary'
  return 'outline'
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - then) / 1000))
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86_400)}d ago`
}

function getDraftTitle(draft: SpecDraftRow): string {
  const structured = draft.structured_data as Record<string, unknown> | null
  const title = structured && typeof structured.title === 'string' ? structured.title : null
  return title ?? 'Untitled spec call'
}

export default async function SpecListPage() {
  const supabase = await createClient()
  const result = await listSpecDrafts(supabase, { limit: 50 })
  const drafts = result.ok ? result.data : []

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spec calls</h1>
          <p className="text-muted-foreground mt-1 text-sm font-normal">
            Upload a spec-call recording; the structured JD lands here for review.
          </p>
        </div>
        <Button asChild>
          <Link href="/spec/new">New spec call</Link>
        </Button>
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm">
            <p className="text-muted-foreground font-normal">
              No spec calls yet. <Link className="underline" href="/spec/new">Upload your first recording</Link>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <Card key={draft.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">
                    <Link
                      href={
                        draft.status === 'ready_for_review' || draft.status === 'approved'
                          ? `/spec/${draft.id}/review`
                          : `/spec/${draft.id}`
                      }
                      className="hover:underline"
                    >
                      {getDraftTitle(draft)}
                    </Link>
                  </CardTitle>
                  <Badge variant={statusVariant(draft.status)}>{statusLabel(draft.status)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="text-muted-foreground pt-0 text-xs font-normal">
                Created {formatRelative(draft.created_at)}
                {draft.parse_error ? (
                  <span className="text-destructive ml-2">— {draft.parse_error}</span>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
