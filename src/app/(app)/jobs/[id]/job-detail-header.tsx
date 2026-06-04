import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import type { JobWithCompany } from '@/lib/db/jobs'
import type { Enums } from '@/types/database'

const TYPE_LABEL: Record<Enums<'job_type'>, string> = {
  perm: 'Perm',
  contract: 'Contract',
  temp: 'Temp',
}

const CONTEXT_LABEL: Record<Enums<'hiring_context'>, string> = {
  new_role: 'New role',
  backfill: 'Backfill',
}

const STATUS_LABEL: Record<Enums<'job_status'>, string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  filled: 'Filled',
  cancelled: 'Cancelled',
}

function formatSalary(min: number | null, max: number | null, currency: string): string | null {
  if (min == null && max == null) return null
  // A free-text currency transcribed from a spec call ("pounds", "£",
  // "GBP " with a trailing space) crashes Intl.NumberFormat with a
  // RangeError and makes the whole job un-viewable. Coerce to a valid
  // ISO-4217 code, defaulting to GBP, and wrap construction in try/catch.
  const code = (currency ?? '').trim().toUpperCase()
  const safe = /^[A-Z]{3}$/.test(code) ? code : 'GBP'
  let fmt: Intl.NumberFormat
  try {
    fmt = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: safe,
      maximumFractionDigits: 0,
    })
  } catch {
    fmt = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0,
    })
  }
  if (min != null && max != null) return `${fmt.format(min)} – ${fmt.format(max)}`
  if (min != null) return `${fmt.format(min)}+`
  if (max != null) return `up to ${fmt.format(max)}`
  return null
}

export function JobDetailHeader({ job }: { job: JobWithCompany }) {
  const salary = formatSalary(job.salary_min, job.salary_max, job.currency)

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{job.title}</h1>
          <Badge variant="outline" className="text-xs font-normal">
            {STATUS_LABEL[job.status]}
          </Badge>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
          {job.company_name ? (
            <Link
              href={`/clients/${job.company_id}`}
              className="hover:text-foreground hover:underline"
            >
              {job.company_name}
            </Link>
          ) : null}
          <span>{TYPE_LABEL[job.job_type]}</span>
          <span>·</span>
          <span>{CONTEXT_LABEL[job.hiring_context]}</span>
          {job.location ? (
            <>
              <span>·</span>
              <span>{job.location}</span>
            </>
          ) : null}
          {salary ? (
            <>
              <span>·</span>
              <span>{salary}</span>
            </>
          ) : null}
        </div>
        {job.description ? (
          <p className="text-muted-foreground mt-3 max-w-prose text-sm whitespace-pre-wrap">
            {job.description}
          </p>
        ) : null}
      </div>
    </header>
  )
}
