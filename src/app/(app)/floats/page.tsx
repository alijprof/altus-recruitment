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
import { listAllFloats } from '@/lib/db/shortlists'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

/**
 * Org-wide floats list (SHORT-02).
 *
 * Shows every floated candidate across the org. D3-29 mandates org-wide
 * visibility — anchor agency is 2-3 people; transparency wins over an
 * owner-only filter. The UI may surface a "mine only" toggle later but
 * that's a client-side filter on top of the same RPC.
 */
export default async function FloatsPage() {
  const supabase = await createSupabaseClient()
  const floatsResult = await listAllFloats(supabase)
  const rows = floatsResult.ok ? floatsResult.data : []

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Floats</h1>
        <p className="text-muted-foreground text-sm">
          Speculative candidate submissions with no job attached. Org-wide view.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">
          No floats yet. From a candidate&apos;s page, click <strong>Floats</strong> to
          record a speculative submission.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Current role</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.candidate ? (
                      <Link
                        href={`/candidates/${row.candidate.id}/floats`}
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
                  <TableCell className="text-right">
                    <Badge variant="outline" className="text-xs font-normal">
                      Float
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
