'use client'

import Link from 'next/link'
import { useTransition, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimeAgo } from '@/lib/date'
import type { ShortlistRow } from '@/lib/db/shortlists'

import { convertShortlistToApplicationAction } from '@/app/(app)/candidates/[id]/shortlist-actions'

import { removeFromShortlistAction } from './actions'

type ShortlistListProps = {
  jobId: string
  rows: ShortlistRow[]
}

export function ShortlistList({ jobId, rows }: ShortlistListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function promote(row: ShortlistRow) {
    setPendingId(row.id)
    startTransition(async () => {
      const res = await convertShortlistToApplicationAction({
        applicationId: row.id,
      })
      setPendingId(null)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Promoted to formal application.')
    })
  }

  function remove(row: ShortlistRow) {
    setPendingId(row.id)
    startTransition(async () => {
      const res = await removeFromShortlistAction({
        applicationId: row.id,
        jobId,
      })
      setPendingId(null)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Removed from shortlist.')
    })
  }

  if (rows.length === 0) {
    return (
      <div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">
        Nothing on the shortlist yet. Use “Add to shortlist” to build the working set
        for this job.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>Current role</TableHead>
            <TableHead>Added</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isPending = pendingId === row.id
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  {row.candidate ? (
                    <Link
                      href={`/candidates/${row.candidate.id}`}
                      className="hover:underline"
                    >
                      {row.candidate.full_name}
                    </Link>
                  ) : (
                    'Unknown'
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.candidate?.current_role_title ? (
                    <span>
                      {row.candidate.current_role_title}
                      {row.candidate.current_company ? (
                        <span className="text-muted-foreground/80">
                          {' '}
                          · {row.candidate.current_company}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm tabular-nums">
                  {formatTimeAgo(row.created_at)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {isPending ? (
                      <Loader2
                        className="text-muted-foreground size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => remove(row)}
                      disabled={isPending}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => promote(row)}
                      disabled={isPending}
                    >
                      Convert to application
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
