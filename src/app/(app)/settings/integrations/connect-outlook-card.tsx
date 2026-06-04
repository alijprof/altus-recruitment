'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import {
  disconnectOutlookAction,
  startOutlookOAuthAction,
} from './outlook-actions'

// Plan 4 Task 4.2 — Connect-Outlook card.
//
// Renders one of three states based on the row passed down from the
// server component:
//   * 'disconnected' — never connected; primary "Connect Outlook" CTA
//   * 'connected'    — heading shows microsoft_email + Disconnect btn
//   * 'revoked'      — heading shows "(Disconnected)" + Reconnect btn
//
// URL params (?outlook=connected / ?outlook_error=...) drive toast
// + inline admin-consent block.

export type OutlookCardStatus = 'connected' | 'disconnected' | 'revoked'

export type ConnectOutlookCardProps = {
  status: OutlookCardStatus
  microsoftEmail: string | null
  connectedAt: string | null
  adminConsentUrl: string | null
}

const ERROR_COPY: Record<string, string> = {
  state_mismatch:
    'Sign-in security check failed. Please try connecting Outlook again.',
  missing_params:
    'Microsoft returned an incomplete response. Please try connecting again.',
  foreign_tenant:
    'That Microsoft account belongs to a different organisation than this app is configured for.',
  persist_failed:
    'We received your Microsoft sign-in but could not save the credentials. Try again or contact support.',
  unexpected: 'Something went wrong connecting Outlook. Please try again.',
  admin_consent_required:
    'Your IT admin needs to approve Altus Recruitment for your organisation. Send them the link below.',
}

export function ConnectOutlookCard({
  status,
  microsoftEmail,
  connectedAt,
  adminConsentUrl,
}: ConnectOutlookCardProps) {
  const router = useRouter()
  const params = useSearchParams()
  const errorCode = params.get('outlook_error')
  const successFlag = params.get('outlook')

  // Surface toasts on URL params, then clean the URL.
  useEffect(() => {
    if (successFlag === 'connected') {
      toast.success('Outlook connected.')
      router.replace('/settings/integrations')
    } else if (errorCode) {
      const msg = ERROR_COPY[errorCode] ?? 'Outlook connection failed.'
      toast.error(msg)
      // Don't clear URL on admin_consent_required so the inline block
      // stays visible. For other errors, clean URL after toast.
      if (errorCode !== 'admin_consent_required') {
        router.replace('/settings/integrations')
      }
    }
  }, [successFlag, errorCode, router])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {status === 'revoked' ? 'Outlook (Disconnected)' : 'Outlook'}
        </CardTitle>
        <CardDescription>
          {status === 'connected' && microsoftEmail
            ? `Connected as ${microsoftEmail}. Inbound emails to candidates and contacts appear automatically on their timelines.`
            : 'Connect your Outlook inbox so emails to and from candidates appear on their timelines automatically.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'connected' ? (
          <ConnectedState
            microsoftEmail={microsoftEmail}
            connectedAt={connectedAt}
          />
        ) : (
          <DisconnectedState status={status} />
        )}

        {errorCode === 'admin_consent_required' && adminConsentUrl ? (
          <AdminConsentBlock url={adminConsentUrl} />
        ) : null}

        <p className="text-muted-foreground text-xs">
          Reads inbound emails so they appear on candidate and contact timelines, and can
          send check-in emails you compose and approve. Altus never sends email
          automatically.
        </p>
      </CardContent>
    </Card>
  )
}

function ConnectedState({
  microsoftEmail,
  connectedAt,
}: {
  microsoftEmail: string | null
  connectedAt: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1 text-sm">
        <p className="font-medium">{microsoftEmail ?? 'Outlook account'}</p>
        <p className="text-muted-foreground text-xs">
          <span className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 me-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            Active
          </span>
          {connectedAt
            ? `Connected ${new Date(connectedAt).toLocaleDateString()}`
            : null}
        </p>
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await disconnectOutlookAction()
                if (res.ok) {
                  toast.success('Outlook disconnected.')
                  setConfirming(false)
                } else {
                  toast.error(res.error)
                }
              })
            }
          >
            {pending ? 'Disconnecting…' : 'Confirm disconnect'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          Disconnect
        </Button>
      )}
    </div>
  )
}

function DisconnectedState({ status }: { status: OutlookCardStatus }) {
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm">
        {status === 'revoked'
          ? 'Reconnect Outlook to resume timeline ingestion.'
          : 'One-time consent. Your IT admin may need to approve the app the first time someone connects.'}
      </p>
      <Button
        type="button"
        variant="default"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await startOutlookOAuthAction()
            if (res.ok && res.url) {
              window.location.href = res.url
            } else if (!res.ok) {
              toast.error(res.error)
            }
          })
        }
      >
        {pending ? 'Starting…' : status === 'revoked' ? 'Reconnect' : 'Connect Outlook'}
      </Button>
    </div>
  )
}

function AdminConsentBlock({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">
      <p className="text-foreground font-medium">Admin consent required</p>
      <p className="text-muted-foreground mt-1 text-xs">
        Your tenant requires an administrator to approve Altus Recruitment.
        Send this link to your IT admin and ask them to click it once:
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="bg-background min-w-0 flex-1 truncate rounded border px-2 py-1 text-xs">
          {url}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}
