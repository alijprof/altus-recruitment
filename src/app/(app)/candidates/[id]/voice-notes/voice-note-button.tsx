import Link from 'next/link'
import { Mic } from 'lucide-react'

import { Button } from '@/components/ui/button'

type VoiceNoteButtonProps = {
  candidateId: string
  hasPendingReview?: boolean
}

// Server Component — just a link-styled button. No client-side state needed.
// The amber dot badge indicates there is a voice note ready_for_review so the
// recruiter knows to check back.
export function VoiceNoteButton({ candidateId, hasPendingReview = false }: VoiceNoteButtonProps) {
  return (
    <div className="relative inline-flex">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/candidates/${candidateId}/voice-notes/new`}>
          <Mic className="size-4" aria-hidden />
          Voice note
        </Link>
      </Button>
      {hasPendingReview ? (
        <span
          className="absolute right-0 top-0 size-2 rounded-full bg-amber-500"
          aria-label="Voice note pending review"
        />
      ) : null}
    </div>
  )
}
