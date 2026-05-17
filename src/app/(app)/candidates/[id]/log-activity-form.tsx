'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { logActivityAction } from './actions'

type Kind = 'note' | 'call' | 'meeting'

const KIND_LABEL: Record<Kind, string> = {
  note: 'Note',
  call: 'Call',
  meeting: 'Meeting',
}

const PLACEHOLDER: Record<Kind, string> = {
  note: 'Write a quick note about this candidate…',
  call: 'What did you discuss?',
  meeting: 'Where did you meet, who was there, what was agreed?',
}

export type LogActivityFormProps = {
  candidateId: string
}

// Compact inline form rendered below the candidate header. Kept simple
// (useState + useTransition; no RHF) because the schema is tiny — three
// fields, no error fan-out across many inputs. RHF would be overkill here.
export function LogActivityForm({ candidateId }: LogActivityFormProps) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('note')
  const [body, setBody] = useState('')
  const [isPending, startTransition] = useTransition()

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) {
      toast.error('Add a short note before saving.')
      return
    }
    startTransition(async () => {
      const result = await logActivityAction({ candidateId, kind, body: trimmed })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setBody('')
      toast.success(`${KIND_LABEL[kind]} logged.`)
      // refresh re-runs the parent RSC so the timeline re-renders with the
      // new entry — no client-side store needed.
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="bg-card space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="activity-kind" className="text-sm font-semibold">
          Log activity
        </label>
        <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <SelectTrigger id="activity-kind" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="note">Note</SelectItem>
            <SelectItem value="call">Call</SelectItem>
            <SelectItem value="meeting">Meeting</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={PLACEHOLDER[kind]}
        rows={3}
        maxLength={5000}
        aria-label="Activity body"
        disabled={isPending}
      />
      <div className="flex items-center justify-end">
        <Button type="submit" size="sm" disabled={isPending || body.trim().length === 0}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
