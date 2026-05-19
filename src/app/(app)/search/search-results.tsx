import Link from 'next/link'

import { MarketStatusBadge } from '@/components/app/market-status-badge'
import { MatchScoreBadge } from '@/components/app/match-score-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { HybridCandidateRow } from '@/lib/db/embeddings'
import type { Enums } from '@/types/database'

// Plan 1 Task 1.2 — presentation-only component for /search results.
//
// Renders the RRF-ranked candidate list. Rows whose RRF score is small
// (< 0.02 — both ranks are deep) are visually de-prioritised (muted text)
// rather than hidden so the recruiter sees all 50 results with the
// noisier ones soft-collapsed.

export type SearchResultsProps = {
  rows: HybridCandidateRow[]
  mode: 'semantic' | 'trigram'
}

const RRF_DEPRIORITISE_THRESHOLD = 0.02

export function SearchResults({ rows, mode }: SearchResultsProps) {
  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-md border p-12 text-center text-sm">
        No candidates match this query.
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Name
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Role / Company
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Location
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Market Status
            </TableHead>
            {mode === 'semantic' ? (
              <TableHead className="text-muted-foreground text-xs font-normal">
                Score
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const muted = mode === 'semantic' && row.rrf_score < RRF_DEPRIORITISE_THRESHOLD
            return (
              <TableRow
                key={row.id}
                className={cn('group', muted && 'opacity-60')}
              >
                <TableCell className="font-normal">
                  <Link
                    href={`/candidates/${row.id}`}
                    className="hover:underline focus:outline-none focus-visible:underline"
                  >
                    {row.full_name}
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
                <TableCell className="text-muted-foreground text-sm font-normal">
                  {row.location || '—'}
                </TableCell>
                <TableCell>
                  <MarketStatusBadge status={row.market_status} />
                </TableCell>
                {mode === 'semantic' ? (
                  <TableCell>
                    <MatchScoreBadge
                      cosine={row.cosine_similarity}
                      trigram={row.trigram_similarity}
                      rrf={row.rrf_score}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {/* Footnote so the muted rows are explained. */}
      {mode === 'semantic' ? (
        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          Ranked by hybrid score (semantic similarity + keyword overlap).
          Lower-ranked rows are dimmed.
        </p>
      ) : (
        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          Ranked by keyword similarity.
        </p>
      )}
    </div>
  )
}

export type TrigramSearchResultsProps = {
  rows: Array<{
    id: string
    full_name: string
    current_role_title: string | null
    current_company: string | null
    location: string | null
    market_status: Enums<'market_status'>
  }>
}

/**
 * Trigram fallback — no scores. Reused presentation; minimal column set.
 */
export function TrigramResults({ rows }: TrigramSearchResultsProps) {
  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-md border p-12 text-center text-sm">
        No candidates match this query.
      </div>
    )
  }
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Name
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Role / Company
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Location
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Market Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-normal">
                <Link
                  href={`/candidates/${row.id}`}
                  className="hover:underline focus:outline-none focus-visible:underline"
                >
                  {row.full_name}
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
              <TableCell className="text-muted-foreground text-sm font-normal">
                {row.location || '—'}
              </TableCell>
              <TableCell>
                <MarketStatusBadge status={row.market_status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

