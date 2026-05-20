'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { addFloatAction } from './actions'

type FloatFormProps = {
  candidateId: string
}

export function FloatForm({ candidateId }: FloatFormProps) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await addFloatAction({
        candidateId,
        note: note.trim() || null,
      })
      if (!res.ok) {
        setError(res.formError)
        toast.error(res.formError)
        return
      }
      setNote('')
      toast.success('Float added.')
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="float-note" className="text-xs">
          Note (optional)
        </Label>
        <Textarea
          id="float-note"
          placeholder="e.g. Mentioned this candidate to ACME last Friday — they were curious about the data role."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          disabled={isPending}
          maxLength={2_000}
        />
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          Add float
        </Button>
      </div>
    </form>
  )
}
