'use client'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  getLatestOutreachDraftAction,
  requestOutreachDraftAction,
  sendOutreachAction,
} from '@/app/(app)/clients/[id]/outreach-actions'

// ---------------------------------------------------------------------------
// Plan 03-05 / Task E.2 — REPEAT-01 + D3-20 + D3-21.
//
// Client Component modal that powers the "Send check-in" CTA on the
// dashboard's dormant-clients widget. Flow:
//   1. Modal opens → requestOutreachDraftAction fires `outreach-draft/requested`.
//   2. Loop calls getLatestOutreachDraftAction every 1s, up to 10s, until a
//      Sonnet-drafted activity row appears (or we time out and show a Retry).
//   3. Recruiter edits subject + body and clicks "Send via Outlook" →
//      sendOutreachAction calls Microsoft Graph.
//      On `reconnect_required` we render an inline banner with the
//      consentUrl (D3-20 incremental consent on first click — NO auto-send,
//      HARD RULE 8).
//   4. On success, the activity row flips to kind='email' (server-side) and
//      we close the modal.
//
// The body lives in a sub-component (SendCheckinModalBody) that is only
// rendered when `open` is true. Mount/unmount drives the state reset
// naturally, sidestepping the react-hooks/set-state-in-effect rule.
// ---------------------------------------------------------------------------

type Status =
  | { kind: 'requesting' }
  | { kind: 'polling' }
  | { kind: 'ready' }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string }
  | { kind: 'sending' }
  | { kind: 'needs_consent'; consentUrl: string }

const MAX_POLL_ATTEMPTS = 10
const POLL_INTERVAL_MS = 1_000

export type SendCheckinModalProps = {
  clientId: string
  clientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SendCheckinModal({
  clientId,
  clientName,
  open,
  onOpenChange,
}: SendCheckinModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send check-in to {clientName}</DialogTitle>
          <DialogDescription>
            Edit the AI-drafted email below, then send it via Outlook.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SendCheckinModalBody
            clientId={clientId}
            onSent={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type BodyProps = {
  clientId: string
  onSent: () => void
  onCancel: () => void
}

function SendCheckinModalBody({ clientId, onSent, onCancel }: BodyProps) {
  // Initial status starts as `requesting`; the effect dispatches the
  // Inngest event + begins polling immediately on mount. No `open` check
  // needed because the parent only mounts us when open=true.
  const [status, setStatus] = useState<Status>({ kind: 'requesting' })
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  // Set seed inside the effect (Date.now() is impure during render).
  const seedTimeRef = useRef<number>(0)

  useEffect(() => {
    let cancelled = false
    seedTimeRef.current = Date.now()

    async function go() {
      const requested = await requestOutreachDraftAction({ clientId })
      if (cancelled) return
      if (!requested.ok) {
        setStatus({ kind: 'error', message: requested.error })
        return
      }
      setStatus({ kind: 'polling' })
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (cancelled) return
        const got = await getLatestOutreachDraftAction({ clientId })
        if (cancelled) return
        if (!got.ok) {
          setStatus({ kind: 'error', message: got.error })
          return
        }
        if (got.data) {
          const draftTime = new Date(got.data.created_at).getTime()
          if (draftTime + 5_000 >= seedTimeRef.current) {
            setSubject(got.data.subject)
            setBodyHtml(got.data.body_html)
            setStatus({ kind: 'ready' })
            return
          }
        }
      }
      setStatus({ kind: 'timeout' })
    }

    void go()
    return () => {
      cancelled = true
    }
  }, [clientId])

  async function handleSend() {
    setStatus({ kind: 'sending' })
    const result = await sendOutreachAction({ clientId, subject, body_html: bodyHtml })
    if (result.ok) {
      onSent()
      return
    }
    if (result.error === 'reconnect_required' && 'consentUrl' in result) {
      setStatus({ kind: 'needs_consent', consentUrl: result.consentUrl })
      return
    }
    setStatus({ kind: 'error', message: result.error })
  }

  async function handleRetryDraft() {
    seedTimeRef.current = Date.now()
    setStatus({ kind: 'requesting' })
    const requested = await requestOutreachDraftAction({ clientId })
    if (!requested.ok) {
      setStatus({ kind: 'error', message: requested.error })
      return
    }
    setStatus({ kind: 'polling' })
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      const got = await getLatestOutreachDraftAction({ clientId })
      if (!got.ok) {
        setStatus({ kind: 'error', message: got.error })
        return
      }
      if (got.data) {
        const draftTime = new Date(got.data.created_at).getTime()
        if (draftTime + 5_000 >= seedTimeRef.current) {
          setSubject(got.data.subject)
          setBodyHtml(got.data.body_html)
          setStatus({ kind: 'ready' })
          return
        }
      }
    }
    setStatus({ kind: 'timeout' })
  }

  const showForm =
    status.kind === 'ready' ||
    status.kind === 'sending' ||
    status.kind === 'needs_consent'

  return (
    <>
      {status.kind === 'requesting' || status.kind === 'polling' ? (
        <p
          role="status"
          aria-live="polite"
          className="text-muted-foreground text-sm font-normal"
        >
          Drafting an email with AI…
        </p>
      ) : null}

      {status.kind === 'timeout' ? (
        <div role="alert" className="text-destructive text-sm">
          <p>The AI draft is taking longer than expected.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={handleRetryDraft}>
            Retry
          </Button>
        </div>
      ) : null}

      {status.kind === 'error' ? (
        <div role="alert" className="text-destructive text-sm">
          {status.message}
        </div>
      ) : null}

      {status.kind === 'needs_consent' ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
        >
          <p className="font-semibold">Outlook needs send permission</p>
          <p className="mt-1">
            Allow Altus to send emails as you, only when you click Send. We never
            auto-send.
          </p>
          <a
            href={status.consentUrl}
            className="mt-2 inline-block underline"
            target="_blank"
            rel="noreferrer"
          >
            Connect send permission
          </a>
        </div>
      ) : null}

      {showForm ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSend()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="dormant-subject">Subject</Label>
            <Input
              id="dormant-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dormant-body">Body (HTML)</Label>
            <Textarea
              id="dormant-body"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              required
              rows={10}
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={status.kind === 'sending'}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={status.kind === 'sending'}>
              {status.kind === 'sending' ? 'Sending…' : 'Send via Outlook'}
            </Button>
          </DialogFooter>
        </form>
      ) : null}
    </>
  )
}
