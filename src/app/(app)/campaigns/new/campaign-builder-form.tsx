'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { previewCampaignAction, approveCampaignAction } from './actions'
import { getCampaignProgressAction, getRecipientStatusesAction } from './progress-actions'
import {
  CampaignRecipientTable,
  type RecipientRow,
} from './_components/campaign-recipient-table'
import type { Enums } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MarketStatus = Enums<'market_status'>

type WizardStatus =
  | { kind: 'building' }
  | { kind: 'previewing' }
  | { kind: 'approving' }
  | { kind: 'sending'; campaignId: string }
  | { kind: 'sent'; campaignId: string }
  | { kind: 'error'; message: string }

type ActiveTab = 'segment' | 'message' | 'review'

type PreviewSample = Array<{
  id: string
  full_name: string
  email: string
  market_status: string
  current_role_title: string | null
  current_company: string | null
}>

// ---------------------------------------------------------------------------
// Market status options — derived from the enum
// ---------------------------------------------------------------------------

const MARKET_STATUS_OPTIONS: Array<{ value: MarketStatus; label: string }> = [
  { value: 'actively_looking', label: 'Actively looking' },
  { value: 'passively_looking', label: 'Passively looking' },
  { value: 'hot', label: 'Hot' },
  { value: 'placed', label: 'Placed' },
  { value: 'cold', label: 'Cold' },
]

// ---------------------------------------------------------------------------
// Poll interval
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000

// ---------------------------------------------------------------------------
// MarketStatusMultiSelect — Command + Popover multi-select
// ---------------------------------------------------------------------------

type MarketStatusMultiSelectProps = {
  selected: MarketStatus[]
  onChange: (value: MarketStatus[]) => void
  disabled?: boolean
}

function MarketStatusMultiSelect({ selected, onChange, disabled }: MarketStatusMultiSelectProps) {
  const [open, setOpen] = useState(false)

  function toggle(value: MarketStatus) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const displayLabel =
    selected.length === 0
      ? 'Select statuses…'
      : selected.length === 1
        ? (MARKET_STATUS_OPTIONS.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} statuses selected`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {displayLabel}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No statuses found.</CommandEmpty>
            <CommandGroup>
              {MARKET_STATUS_OPTIONS.map((option) => {
                const isSelected = selected.includes(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => toggle(option.value)}
                  >
                    <Check
                      className={cn('mr-2 size-4', isSelected ? 'opacity-100' : 'opacity-0')}
                    />
                    {option.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// CampaignBuilderForm
// ---------------------------------------------------------------------------

export function CampaignBuilderForm() {
  const router = useRouter()

  // --- Step 1: Segment ---
  const [campaignName, setCampaignName] = useState('')
  const [marketStatuses, setMarketStatuses] = useState<MarketStatus[]>([])
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewSample, setPreviewSample] = useState<PreviewSample>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  // --- Step 2: Message ---
  const [subject, setSubject] = useState('')
  const [bodyTemplate, setBodyTemplate] = useState('')

  // --- Tab state ---
  const [activeTab, setActiveTab] = useState<ActiveTab>('segment')

  // --- Wizard status ---
  const [status, setStatus] = useState<WizardStatus>({ kind: 'building' })

  // --- Post-send polling ---
  const [sentCount, setSentCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [recipientStatuses, setRecipientStatuses] = useState<Record<string, string>>({})
  const pollCancelRef = useRef(false)

  // Derived: tab gating
  const messageTabEnabled = previewCount !== null && previewCount > 0
  const reviewTabEnabled = messageTabEnabled && subject.trim().length > 0 && bodyTemplate.trim().length > 0

  // ---------------------------------------------------------------------------
  // Preview: fires on market_status change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false

    async function runPreview() {
      if (marketStatuses.length === 0) {
        setPreviewCount(null)
        setPreviewSample([])
        return
      }
      setPreviewLoading(true)
      const result = await previewCampaignAction({ marketStatuses })
      if (cancelled) return
      setPreviewLoading(false)
      if (result.ok) {
        setPreviewCount(result.count)
        setPreviewSample(result.sample)
      } else {
        setPreviewCount(null)
        setPreviewSample([])
      }
    }

    void runPreview()
    return () => {
      cancelled = true
    }
    // marketStatuses is compared by reference but the multi-select always
    // creates a new array, so this fires correctly on each selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(marketStatuses)])

  // ---------------------------------------------------------------------------
  // Polling: after approveCampaignAction returns
  // ---------------------------------------------------------------------------

  function startPolling(campaignId: string, total: number) {
    pollCancelRef.current = false
    setTotalCount(total)

    async function poll() {
      if (pollCancelRef.current) return

      const progressResult = await getCampaignProgressAction(campaignId)
      if (!pollCancelRef.current && progressResult.ok) {
        setSentCount(progressResult.data.sent)
        setTotalCount(progressResult.data.total)

        // Also fetch per-recipient statuses for the table
        const statusResult = await getRecipientStatusesAction(campaignId)
        if (!pollCancelRef.current && statusResult.ok) {
          const map: Record<string, string> = {}
          for (const r of statusResult.data) {
            map[r.id] = r.status
          }
          setRecipientStatuses(map)
        }

        // Campaign finished when status is 'sent' or 'failed'
        const finished =
          progressResult.data.status === 'sent' || progressResult.data.status === 'failed'
        if (finished) {
          setStatus({ kind: 'sent', campaignId })
          return
        }
      }

      if (!pollCancelRef.current) {
        setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    void poll()
  }

  useEffect(() => {
    return () => {
      pollCancelRef.current = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Approve handler — called from AlertDialog confirm
  // ---------------------------------------------------------------------------

  async function handleApprove() {
    setStatus({ kind: 'approving' })
    try {
      const result = await approveCampaignAction({
        name: campaignName,
        subject,
        bodyTemplate,
        marketStatuses,
      })
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error })
        toast.error(result.error)
        return
      }
      const { campaignId, recipientCount } = result
      setStatus({ kind: 'sending', campaignId })
      toast.success(`Campaign sending — ${recipientCount} email${recipientCount !== 1 ? 's' : ''} queued`)
      startPolling(campaignId, recipientCount)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setStatus({ kind: 'error', message: msg })
      toast.error(msg)
      // CLAUDE.md: do NOT navigate away on failure — stay on the step
    }
  }

  // ---------------------------------------------------------------------------
  // Recipient rows for the review table (preview sample → full list after send)
  // ---------------------------------------------------------------------------

  const recipientRows: RecipientRow[] = previewSample.map((s) => ({
    id: s.id,
    full_name: s.full_name,
    email: s.email,
    market_status: s.market_status as Enums<'market_status'>,
    last_active: null,
    recipient_status:
      status.kind === 'sending' || status.kind === 'sent'
        ? (recipientStatuses[s.id] as RecipientRow['recipient_status']) ?? 'pending'
        : undefined,
  }))

  const isSending = status.kind === 'sending' || status.kind === 'sent' || status.kind === 'approving'
  const sentPercent = totalCount > 0 ? Math.round((sentCount / totalCount) * 100) : 0
  const estimatedCostPounds = ((previewCount ?? 0) * 0.002).toFixed(2)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as ActiveTab)}
      className="space-y-6"
    >
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="segment">Segment</TabsTrigger>
        <TabsTrigger value="message" disabled={!messageTabEnabled}>
          Message
        </TabsTrigger>
        <TabsTrigger value="review" disabled={!reviewTabEnabled}>
          Review &amp; send
        </TabsTrigger>
      </TabsList>

      {/* ------------------------------------------------------------------ */}
      {/* Step 1 — Segment                                                   */}
      {/* ------------------------------------------------------------------ */}
      <TabsContent value="segment" className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="campaign-name">Campaign name</Label>
          <Input
            id="campaign-name"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Q3 actively-looking outreach"
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Send to candidates who are</Label>
          <MarketStatusMultiSelect
            selected={marketStatuses}
            onChange={setMarketStatuses}
            disabled={isSending}
          />
          {/* GDPR note — UI-SPEC §Surface 3 Step 1 */}
          <p className="text-muted-foreground mt-2 text-xs">
            Only candidates with active GDPR consent are included. Candidates who have withdrawn
            consent are automatically excluded.
          </p>
        </div>

        {/* Recipient count preview */}
        {previewLoading ? (
          <p role="status" aria-live="polite" className="text-muted-foreground text-sm">
            Loading recipient count…
          </p>
        ) : previewCount !== null ? (
          previewCount > 0 ? (
            <p className="mt-3 text-sm font-semibold">
              {previewCount} candidate{previewCount !== 1 ? 's' : ''} match this segment
            </p>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
              No candidates match this segment. Adjust the filters.
            </p>
          )
        ) : null}

        <Button
          onClick={() => setActiveTab('message')}
          disabled={!messageTabEnabled}
        >
          Continue to message
        </Button>
      </TabsContent>

      {/* ------------------------------------------------------------------ */}
      {/* Step 2 — Message                                                   */}
      {/* ------------------------------------------------------------------ */}
      <TabsContent value="message" className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email-subject">Email subject</Label>
          <Input
            id="email-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="An opportunity worth considering"
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email-body">Email body</Label>
          <Textarea
            id="email-body"
            value={bodyTemplate}
            onChange={(e) => setBodyTemplate(e.target.value)}
            rows={12}
            placeholder="Write your main message here…"
          />
          <p className="text-muted-foreground text-xs">
            Write the main body. A personalised introduction and sign-off will be added per
            recipient by AI.
          </p>
        </div>

        {/* Personalisation explainer — deferred live preview per D4-07 scope */}
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            How personalisation works
          </summary>
          <p className="text-muted-foreground mt-2 text-sm">
            For each recipient, the AI (Claude Sonnet) generates a personalised introduction
            and sign-off based on their name, current role, and market status. Your body template
            stays exactly as written. The introduction is prepended; the sign-off is appended.
            A one-click unsubscribe link is always included.
          </p>
        </details>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setActiveTab('segment')}>
            Back
          </Button>
          <Button
            onClick={() => setActiveTab('review')}
            disabled={!reviewTabEnabled}
          >
            Continue to review
          </Button>
        </div>
      </TabsContent>

      {/* ------------------------------------------------------------------ */}
      {/* Step 3 — Review &amp; send                                         */}
      {/* ------------------------------------------------------------------ */}
      <TabsContent value="review" className="space-y-6">
        {/* Summary card */}
        <div className="rounded-md border p-4 space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">{campaignName || '(Untitled campaign)'}</p>
              <p className="text-muted-foreground text-sm">
                {marketStatuses.length > 0
                  ? `Targeting: ${marketStatuses
                      .map(
                        (s) =>
                          MARKET_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s,
                      )
                      .join(', ')}`
                  : 'No segment selected'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">
                {previewCount ?? 0} recipient{(previewCount ?? 0) !== 1 ? 's' : ''}
              </p>
              <p className="text-muted-foreground text-xs">consented</p>
            </div>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Subject</p>
            <p className="text-sm">{subject}</p>
          </div>
        </div>

        {/* AI cost transparency line — UI-SPEC §Phase 4 AI-State UI Patterns */}
        <p className="text-muted-foreground text-xs">
          Estimated AI cost: ~£{estimatedCostPounds} ({previewCount ?? 0} × ~£0.002 per recipient)
        </p>

        {/* Recipient table */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">Recipients</p>
          <CampaignRecipientTable
            recipients={recipientRows}
            showStatus={status.kind === 'sending' || status.kind === 'sent'}
          />
        </div>

        {/* Send button / progress */}
        {isSending ? (
          <div className="space-y-2">
            <Progress
              className="h-2"
              value={sentPercent}
              aria-label="Campaign send progress"
            />
            <p className="text-muted-foreground text-sm">
              {status.kind === 'sent'
                ? `${sentCount} of ${totalCount} sent — complete`
                : `${sentCount} of ${totalCount} sent`}
            </p>
            {status.kind === 'sent' ? (
              <Button
                variant="outline"
                onClick={() => router.push('/campaigns')}
              >
                View all campaigns
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            {status.kind === 'error' ? (
              <div role="alert" className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
                {status.message}
              </div>
            ) : null}

            {/* MARKET-03 gate — AlertDialog confirmation required before any send */}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setActiveTab('message')}>
                Back
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={(previewCount ?? 0) === 0 || !campaignName.trim()}>
                    Send campaign
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Send this campaign?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will send {previewCount ?? 0} personalised email
                      {(previewCount ?? 0) !== 1 ? 's' : ''} via Resend. This action cannot be
                      undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Go back</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleApprove()}>
                      Send {previewCount ?? 0} email{(previewCount ?? 0) !== 1 ? 's' : ''}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </TabsContent>
    </Tabs>
  )
}
