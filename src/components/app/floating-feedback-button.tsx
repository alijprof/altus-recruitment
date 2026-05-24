'use client'

// Quick task 260524-b6v: floating in-app feedback FAB.
//
// Mounted once in src/app/(app)/layout.tsx so it appears on every
// authenticated route — and ONLY authenticated routes (the (auth) and
// (public) layouts do not include it). No props: the server action resolves
// user + org from cookies; this component only contributes body + browser-
// side captures (page_url + user_agent).

import { useState } from 'react'

import { MessageSquarePlus } from 'lucide-react'

import { submitFeedbackAction } from '@/app/(app)/_actions/submit-feedback'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

const MAX_BODY_LENGTH = 2000
const AUTO_CLOSE_MS = 1500

export function FloatingFeedbackButton() {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  function reset() {
    setOpen(false)
    setBody('')
    setStatus({ kind: 'idle' })
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (body.trim() === '') {
      setStatus({ kind: 'error', message: 'Please enter some feedback' })
      return
    }
    setStatus({ kind: 'submitting' })

    const result = await submitFeedbackAction({
      body: body.trim(),
      page_url: window.location.pathname + window.location.search,
      user_agent: navigator.userAgent,
    })

    if (result.ok) {
      setStatus({ kind: 'success' })
      window.setTimeout(reset, AUTO_CLOSE_MS)
      return
    }

    const message =
      ('formError' in result ? result.formError : undefined) ??
      ('fieldErrors' in result ? result.fieldErrors.body?.[0] : undefined) ??
      'Could not send feedback. Please try again.'
    setStatus({ kind: 'error', message })
  }

  const isBusy = status.kind === 'submitting' || status.kind === 'success'
  const submitDisabled = isBusy || body.trim().length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        else setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="default"
          size="icon"
          aria-label="Send feedback"
          className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
        >
          <MessageSquarePlus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Tell us what&apos;s broken, missing, or confusing. We read every one.
          </DialogDescription>
        </DialogHeader>
        {status.kind === 'success' ? (
          <div className="py-8 text-center text-sm">Thanks — sent.</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="feedback-body">Your feedback</Label>
              <Textarea
                id="feedback-body"
                placeholder="What's broken? What's missing? What's confusing?"
                maxLength={MAX_BODY_LENGTH}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={isBusy}
                rows={6}
              />
              <p className="text-muted-foreground text-xs">
                {body.length} / {MAX_BODY_LENGTH}
              </p>
            </div>
            {status.kind === 'error' && (
              <p className="text-destructive text-sm" role="alert">
                {status.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitDisabled}>
                {status.kind === 'submitting' ? 'Sending…' : 'Send'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
