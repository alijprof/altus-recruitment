import { Badge } from '@/components/ui/badge'
import { formatDateLong } from '@/lib/date'
import { CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY, cvDisplayFilename, isCvFileDownloadable } from '@/lib/cv/cv-file-display'
import type { CandidateCvRow } from '@/lib/db/candidate-cvs'

import { CvFileLink } from './cv-file-link'

type CvFilesPanelProps = {
  // Full candidate_cvs row set for this candidate, newest first — the same
  // ordering listCandidateCVs (page.tsx) already returns.
  cvs: CandidateCvRow[]
}

const STATUS_LABEL: Record<CandidateCvRow['parsing_status'], string> = {
  complete: 'Parsed',
  failed: 'Failed',
  pending: 'Pending',
}

/**
 * Always-rendered "CV files" section (D-01, Plan 07-01) — every
 * candidate_cvs row gets a filename, upload date, status, and a View
 * control, whether the candidate has one CV or six. Replaces the old
 * "Previous CVs" block that only rendered for candidates with more than one
 * CV, which meant the customer's #1 trust complaint ("I can't see the CV
 * you're holding for me") went unaddressed for the majority of candidates —
 * 81 of the 87 CV-holding candidates in the anchor org have exactly one.
 *
 * SERVER component (no 'use client') — cvDisplayFilename and
 * isCvFileDownloadable are pure and dependency-free, so there's no reason
 * to push this render to the client. Only the individual View control
 * (cv-file-link.tsx) needs interactivity.
 *
 * THREE hard constraints protecting the frozen Phase-6 smoke spec
 * (tests/smoke/authed/cv-intake.smoke.ts) — see 07-01-PLAN.md Task 3:
 *   a. formatDateLong (an ABSOLUTE date), never formatTimeAgo — a relative
 *      timestamp can tick over between cvSidebarSnapshot's before/after
 *      reads and flake the comparison.
 *   b. No Alert component and no element carrying role="alert" anywhere in
 *      this section — waitForParseOutcome treats any role="alert" inside
 *      <main> as a parse failure.
 *   c. The View control for a failed row lives HERE, never inside
 *      CvReviewPanel's FailedState alert, for the same reason as (b).
 */
export function CvFilesPanel({ cvs }: CvFilesPanelProps) {
  return (
    <section className="bg-card space-y-2 rounded-md border p-4">
      <h2 className="text-sm font-semibold">CV files</h2>
      <ul className="space-y-2">
        {cvs.map((cv, index) => {
          const filename = cvDisplayFilename(cv.storage_path)
          const downloadable = isCvFileDownloadable(cv)
          const statusLabel = STATUS_LABEL[cv.parsing_status] ?? 'Pending'
          return (
            <li key={cv.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="text-muted-foreground truncate text-xs font-normal"
                    title={filename}
                  >
                    v{cv.version} · {filename}
                  </span>
                  {index === 0 ? (
                    <Badge variant="secondary" className="text-xs font-normal">
                      Latest
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-xs font-normal">
                    {statusLabel}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs font-normal">
                  {formatDateLong(cv.created_at)}
                </p>
              </div>
              <CvFileLink
                candidateCvId={cv.id}
                filename={filename}
                downloadable={downloadable}
                disabledReason={CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
