'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { approveSpecDraftAction, rejectSpecDraftAction } from './actions'

type StructuredJd = {
  title: string
  seniority_level: string | null
  job_type: string | null
  location: string | null
  salary_range_min: number | null
  salary_range_max: number | null
  currency: string | null
  must_haves: string[]
  nice_to_haves: string[]
  culture_notes: string | null
  reporting_line: string | null
  urgency: string | null
  hiring_context: string | null
  confidence_per_field?: Record<string, 'high' | 'medium' | 'low'>
}

type Props = {
  draftId: string
  initial: StructuredJd
}

function ConfidenceBadge({ level }: { level?: 'high' | 'medium' | 'low' }) {
  if (level !== 'low') return null
  return (
    <Badge variant="outline" className="text-xs">
      verify this
    </Badge>
  )
}

export function SpecReviewForm({ draftId, initial }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<StructuredJd>(initial)
  const [isApproving, startApproveTransition] = useTransition()
  const [isRejecting, startRejectTransition] = useTransition()
  const confidence = initial.confidence_per_field ?? {}

  const updateField = <K extends keyof StructuredJd>(key: K, value: StructuredJd[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleApprove = () => {
    startApproveTransition(async () => {
      const result = await approveSpecDraftAction({
        specDraftId: draftId,
        structuredData: {
          title: form.title,
          seniority_level: form.seniority_level || null,
          job_type: form.job_type || null,
          location: form.location || null,
          salary_range_min: form.salary_range_min,
          salary_range_max: form.salary_range_max,
          currency: form.currency || null,
          must_haves: form.must_haves.filter((s) => s.trim().length > 0),
          nice_to_haves: form.nice_to_haves.filter((s) => s.trim().length > 0),
          culture_notes: form.culture_notes || null,
          reporting_line: form.reporting_line || null,
          urgency: form.urgency || null,
          hiring_context: form.hiring_context || null,
        },
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Draft approved — creating job…')
      router.push('/jobs')
      router.refresh()
    })
  }

  const handleReject = () => {
    if (!confirm('Reject this draft? The recording will be deleted in 30 days.')) {
      return
    }
    startRejectTransition(async () => {
      const result = await rejectSpecDraftAction({ specDraftId: draftId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Draft rejected.')
      router.push('/spec')
      router.refresh()
    })
  }

  const busy = isApproving || isRejecting

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleApprove()
      }}
      className="space-y-6"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="title">Title</Label>
          <ConfidenceBadge level={confidence.title} />
        </div>
        <Input
          id="title"
          value={form.title}
          onChange={(e) => updateField('title', e.target.value)}
          required
          disabled={busy}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="seniority">Seniority</Label>
            <ConfidenceBadge level={confidence.seniority_level} />
          </div>
          <select
            id="seniority"
            value={form.seniority_level ?? ''}
            onChange={(e) => updateField('seniority_level', e.target.value || null)}
            disabled={busy}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— Not specified —</option>
            <option value="junior">Junior</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="lead">Lead</option>
            <option value="principal">Principal</option>
            <option value="manager">Manager</option>
            <option value="director">Director</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="job-type">Type</Label>
          <select
            id="job-type"
            value={form.job_type ?? ''}
            onChange={(e) => updateField('job_type', e.target.value || null)}
            disabled={busy}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— Not specified —</option>
            <option value="perm">Perm</option>
            <option value="contract">Contract</option>
            <option value="temp">Temp</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={form.location ?? ''}
          onChange={(e) => updateField('location', e.target.value || null)}
          disabled={busy}
          placeholder="e.g. Aberdeen, hybrid"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="salary-min">Salary min</Label>
            <ConfidenceBadge level={confidence.salary_range_min} />
          </div>
          <Input
            id="salary-min"
            type="number"
            value={form.salary_range_min ?? ''}
            onChange={(e) =>
              updateField(
                'salary_range_min',
                e.target.value === '' ? null : Number(e.target.value),
              )
            }
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="salary-max">Salary max</Label>
          <Input
            id="salary-max"
            type="number"
            value={form.salary_range_max ?? ''}
            onChange={(e) =>
              updateField(
                'salary_range_max',
                e.target.value === '' ? null : Number(e.target.value),
              )
            }
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            value={form.currency ?? ''}
            onChange={(e) => updateField('currency', e.target.value || null)}
            disabled={busy}
            placeholder="GBP"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="must-haves">Must-haves (one per line)</Label>
        <Textarea
          id="must-haves"
          value={form.must_haves.join('\n')}
          onChange={(e) => updateField('must_haves', e.target.value.split(/\r?\n/))}
          rows={5}
          disabled={busy}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nice-to-haves">Nice-to-haves (one per line)</Label>
        <Textarea
          id="nice-to-haves"
          value={form.nice_to_haves.join('\n')}
          onChange={(e) => updateField('nice_to_haves', e.target.value.split(/\r?\n/))}
          rows={4}
          disabled={busy}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="culture">Culture notes</Label>
        <Textarea
          id="culture"
          value={form.culture_notes ?? ''}
          onChange={(e) => updateField('culture_notes', e.target.value || null)}
          rows={3}
          disabled={busy}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="reporting">Reporting line</Label>
          <Input
            id="reporting"
            value={form.reporting_line ?? ''}
            onChange={(e) => updateField('reporting_line', e.target.value || null)}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="urgency">Urgency</Label>
          <select
            id="urgency"
            value={form.urgency ?? ''}
            onChange={(e) => updateField('urgency', e.target.value || null)}
            disabled={busy}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— Not signalled —</option>
            <option value="now">Now</option>
            <option value="weeks">Weeks</option>
            <option value="exploratory">Exploratory</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={handleReject}
          disabled={busy}
        >
          {isRejecting ? 'Rejecting…' : 'Reject draft'}
        </Button>
        <Button type="submit" disabled={busy || !form.title.trim()}>
          {isApproving ? 'Approving…' : 'Approve & create job'}
        </Button>
      </div>
    </form>
  )
}
