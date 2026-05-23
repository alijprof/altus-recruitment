'use client'

import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { updateFloatNoteAction } from './actions'

// In-place editor for the note attached to a float row. Renders the
// existing note text by default; clicking the pencil swaps in a textarea
// + Save/Cancel buttons. On save, calls updateFloatNoteAction which
// either updates the underlying activity row or inserts a fresh one.

type Props = {
  applicationId: string
  candidateId: string
  initialNote: string | null
}

export function FloatNoteEditor({ applicationId, candidateId, initialNote }: Props) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(initialNote ?? '')
  const [isPending, startTransition] = useTransition()

  const onSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = draft.trim()
    startTransition(async () => {
      const res = await updateFloatNoteAction({
        applicationId,
        candidateId,
        body: trimmed,
      })
      if (!res.ok) {
        toast.error(res.formError)
        return
      }
      toast.success('Note updated.')
      setIsEditing(false)
      router.refresh()
    })
  }

  const onCancel = () => {
    setDraft(initialNote ?? '')
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <form onSubmit={onSave} className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          disabled={isPending}
          maxLength={2_000}
          autoFocus
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="group flex items-start gap-2">
      {initialNote ? (
        <p className="flex-1 whitespace-pre-wrap">{initialNote}</p>
      ) : (
        <p className="text-muted-foreground flex-1 italic">No note.</p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Edit note"
        onClick={() => setIsEditing(true)}
        className="text-muted-foreground hover:text-foreground size-7 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Pencil className="size-3.5" aria-hidden />
      </Button>
    </div>
  )
}
