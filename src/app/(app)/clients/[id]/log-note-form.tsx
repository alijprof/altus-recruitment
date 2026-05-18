'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { logNoteAction } from './actions'

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'error'; message: string }

export function LogNoteForm({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [state, setState] = useState<SubmitState>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = body.trim()
    if (trimmed.length === 0) {
      setState({ kind: 'error', message: 'Note cannot be empty.' })
      return
    }
    setState({ kind: 'pending' })
    startTransition(async () => {
      const result = await logNoteAction(companyId, { body: trimmed })
      if (!result.ok) {
        if ('fieldErrors' in result) {
          const first = Object.values(result.fieldErrors)[0]?.[0]
          setState({ kind: 'error', message: first ?? 'Could not save note.' })
          return
        }
        setState({ kind: 'error', message: result.formError })
        toast.error(result.formError)
        return
      }
      setState({ kind: 'idle' })
      setBody('')
      toast.success('Note added.')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What happened on the call / meeting / email? Anything worth a follow-up?"
        rows={4}
        disabled={isPending}
        aria-label="Note body"
      />
      {state.kind === 'error' && (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          className="h-11 md:h-10"
          disabled={isPending || body.trim().length === 0}
        >
          {isPending ? 'Saving…' : 'Save note'}
        </Button>
      </div>
    </form>
  )
}
