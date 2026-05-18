import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimeAgo } from '@/lib/date'
import { formatDeclineReason } from '@/lib/legal/decline-reasons'
import type { PipelineCardData } from '@/lib/db/applications'

// Stage label mapping — keep inline because it's only used here in Phase 1.
// Mirrors the column titles in PipelineBoard's STAGES capitalisation rule.
function stageLabel(stage: string): string {
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export type ApplicationsListProps = {
  rows: (PipelineCardData & {
    decline_reason?: string | null
  })[]
}

export function ApplicationsList({ rows }: ApplicationsListProps) {
  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-md border p-10 text-center">
        <h3 className="text-sm font-semibold">No candidates in pipeline</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Add candidates to this job to start tracking them.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Candidate
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Role / Company
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Stage
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Days in stage
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Last move
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isTerminal = row.stage === 'rejected' || row.stage === 'withdrawn'
            return (
              <TableRow key={row.id}>
                <TableCell className="font-normal">
                  <Link
                    href={`/candidates/${row.candidate_id}`}
                    className="hover:underline focus:outline-none focus-visible:underline"
                  >
                    {row.candidate_name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm font-normal">
                  {row.current_role_title || row.current_company ? (
                    <>
                      <span className="text-foreground">
                        {row.current_role_title ?? '—'}
                      </span>
                      {row.current_company ? (
                        <>
                          {' '}
                          <span aria-hidden="true">·</span> {row.current_company}
                        </>
                      ) : null}
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={isTerminal ? 'outline' : 'secondary'}
                    className="text-xs font-normal"
                  >
                    {stageLabel(row.stage)}
                  </Badge>
                  {isTerminal && row.decline_reason ? (
                    <span className="text-muted-foreground ml-2 text-xs">
                      ({formatDeclineReason(row.decline_reason)})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm font-normal">
                  {row.days_in_stage}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm font-normal">
                  {formatTimeAgo(row.stage_changed_at)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
